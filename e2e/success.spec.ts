import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBirthDialog, openBreeding, panels, recordBirthOn } from './support/breeding';

/**
 * L'onglet Succès : la collection, et ce que la politique en fait.
 *
 * ## Ce que ce fichier surveille en priorité
 *
 * **Le chemin d'écriture.** La collection ne se remplit que par une naissance
 * saisie, donc si cette écriture se perd, le succès n'avance jamais et rien à
 * l'écran ne le dit : le compteur reste à 0/120, ce qui est exactement ce qu'il
 * affiche au départ. Une panne indistinguable de l'état normal, la famille de bugs
 * qui a coûté 22 montures.
 *
 * ## Et le réglage, maintenant qu'il agit
 *
 * `success_mode` est arrivé grisé (#221) parce que la politique ne le lisait pas.
 * Elle le lit — voir `applySuccess` — donc le sélecteur est rendu, et le test
 * vérifie les deux moitiés : que le clic écrit, et que les colonnes figées par
 * #216 ne repartent pas dans la requête au passage.
 */

const FROZEN = [
  'kamas_per_hour',
  'minutes_per_fight',
  'net_recovery_rate',
  'recycle_steriles',
  'credit_off_target',
  'never_sell_mounts',
  'breeder_level',
];

const openSuccess = async (page: Page) => {
  await openBreeding(page);
  await page.getByTestId('step-success').click();
  await expect(page.getByTestId('pane-success')).toBeVisible();
};

/** Le corps du dernier `upsert` de réglages reçu. */
const lastSettingsWrite = (mock: SupabaseMock) => {
  const write = [...mock.writes]
    .reverse()
    .find((entry) => entry.table === 'user_breeding_settings');
  expect(write, 'aucune écriture de réglages reçue').toBeTruthy();
  return write!.body as Record<string, unknown>;
};

test.describe('onglet Succès', () => {
  test('la collection part de zéro et liste ce qui manque', async ({ page }) => {
    await mockSupabase(page);
    await openSuccess(page);

    const progress = page.getByTestId('success-progress');
    await expect(progress).toHaveAttribute('data-done', '0');
    await expect(progress).toHaveAttribute('data-total', '120');
    expect(await page.getByTestId('success-missing').count()).toBe(120);

    // Le défaut est « ignoré », donc la politique ne propose rien de la collection.
    await expect(page.getByTestId('success-mode-ignore')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('success-redirections')).toHaveCount(0);
  });

  test('choisir un mode l’écrit, sans emporter les colonnes figées', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openSuccess(page);

    await page.getByTestId('success-mode-free').click();
    await expect(page.getByTestId('success-mode-free')).toHaveAttribute('data-active', 'true');

    const body = lastSettingsWrite(mock);
    expect(body.success_mode).toBe('free');
    for (const column of FROZEN) {
      expect(body, `${column} ne doit plus voyager dans l'upsert`).not.toHaveProperty(column);
    }
    expect(mock.rows('user_breeding_settings')[0].success_mode).toBe('free');
  });

  test('trois changements de suite : le dernier fait foi', async ({ page }) => {
    // Le mode vient d'un état qui a déjà voyagé. Une écriture qui ne relirait pas
    // ce qu'elle vient de poser ne se voit qu'au second clic.
    const mock = await mockSupabase(page);
    await openSuccess(page);

    for (const mode of ['free', 'priority', 'ignore'] as const) {
      await page.getByTestId(`success-mode-${mode}`).click();
      await expect(page.getByTestId(`success-mode-${mode}`)).toHaveAttribute(
        'data-active',
        'true'
      );
      expect(lastSettingsWrite(mock).success_mode).toBe(mode);
      expect(mock.rows('user_breeding_settings')[0].success_mode).toBe(mode);
    }

    expect(
      mock.writes.filter((write) => write.table === 'user_breeding_settings')
    ).toHaveLength(3);
  });

  test('les deux modes actifs disent ce qu’ils feraient', async ({ page }) => {
    await mockSupabase(page);
    await openSuccess(page);

    // « sans surcoût » ne montre que des détournements, jamais de croisement dédié.
    await page.getByTestId('success-mode-free').click();
    const redirections = page.getByTestId('success-redirections');
    await expect(redirections).toBeVisible();
    expect(Number(await redirections.getAttribute('data-count'))).toBeGreaterThan(0);
    await expect(page.getByTestId('success-crossings')).toHaveCount(0);

    // « priorisé » ajoute les croisements dédiés.
    await page.getByTestId('success-mode-priority').click();
    const crossings = page.getByTestId('success-crossings');
    await expect(crossings).toBeVisible();
    expect(Number(await crossings.getAttribute('data-count'))).toBeGreaterThan(0);
  });

  test('une naissance saisie entre dans la collection', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openBirthDialog(page);
    await recordBirthOn(panels(page).first(), '♂');

    const written = mock.writes.filter((write) => write.table === 'user_breeding_hatched');
    expect(written, 'la naissance doit entrer dans la collection').not.toHaveLength(0);
    const rows = mock.rows('user_breeding_hatched');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.family).toBe('muldo');
      expect(typeof row.color_id).toBe('string');
    }
  });

  test('le compteur suit la naissance, sans recharger', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openBirthDialog(page);
    await recordBirthOn(panels(page).first(), '♂');

    await page.keyboard.press('Escape');
    await page.getByTestId('step-success').click();
    await expect(page.getByTestId('pane-success')).toBeVisible();
    expect(
      Number(await page.getByTestId('success-progress').getAttribute('data-done'))
    ).toBeGreaterThan(0);
  });

  test('une couleur déjà collectionnée se lit comme acquise', async ({ page }) => {
    const mock = await mockSupabase(page);
    mock.tables.user_breeding_hatched = [
      { user_id: '00000000-0000-0000-0000-0000000000e2', family: 'muldo', color_id: 'dore' },
    ];
    await openSuccess(page);

    await expect(page.getByTestId('success-progress')).toHaveAttribute('data-done', '1');
    expect(await page.getByTestId('success-missing').count()).toBe(119);
  });
});
