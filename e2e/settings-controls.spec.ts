import { expect, test } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Les deux réglages rendus à l'écran, et les quatre que l'écran ne touche plus.
 *
 * ## La panne d'origine
 *
 * #94 a retiré six réglages de l'écran d'élevage sans que le calcul cesse de les
 * lire. Une ligne enregistrée avant gardait donc sa valeur **à vie** : aucun
 * contrôle pour en changer, et rien à l'écran qui le signale. La fixture porte
 * exactement cette ligne — `gauge_cap: 90000`, `count_net_cost: false`,
 * `minutes_per_fight: 1`.
 *
 * Ce n'est pas une inquiétude, c'est la deuxième occurrence de la même panne à
 * onze jours d'écart : #179 était la première, sur trois autres colonnes.
 *
 * ## Ce que ce test regarde, et que `check:settings` ne peut pas voir
 *
 * La garde statique prouve qu'un champ lu est **écrit quelque part**. Elle ne
 * peut pas prouver que le contrôle marche, ni — surtout — que les quatre figés
 * ont vraiment quitté la requête. C'est ce que celui-ci fait : il lit le corps
 * qui part en base.
 *
 * La dernière assertion est la plus importante. Un `{ ...settings }` qui
 * recopierait les colonnes retirées les réécrirait à l'identique, donc sans rien
 * casser de visible — et la panne reviendrait au premier changement de défaut.
 * On vérifie donc que `minutes_per_fight: 1` **survit** à deux enregistrements :
 * s'il vaut encore 1 côté serveur, c'est que personne ne l'a écrit.
 */

/** Le corps du dernier `upsert` de réglages reçu. */
const lastSettingsWrite = (writes: { table: string; body: unknown }[]) => {
  const write = [...writes].reverse().find((entry) => entry.table === 'user_breeding_settings');
  expect(write, 'aucune écriture de réglages reçue').toBeTruthy();
  return write!.body as Record<string, unknown>;
};

const FROZEN = [
  'kamas_per_hour',
  'minutes_per_fight',
  'net_recovery_rate',
  'recycle_steriles',
  // Les trois de #179, débranchées par #182 : même règle, même requête.
  'credit_off_target',
  'never_sell_mounts',
  'breeder_level',
];

test.describe('les réglages de « Mes stocks »', () => {
  test('la bande et le prix des filets se lisent depuis la base', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await page.getByRole('button', { name: /montures ·/ }).click();

    // La ligne du 15/08 : bande 3, filets non comptés. Sans contrôle, ces deux
    // valeurs étaient invisibles — c'est toute la panne.
    await expect(page.getByTestId('setting-gauge-band')).toHaveValue('90000');
    await expect(page.getByTestId('setting-net-cost')).not.toBeChecked();

    // Rien n'a été écrit du simple fait d'ouvrir le panneau.
    expect(mock.writes.filter((write) => write.table === 'user_breeding_settings')).toHaveLength(0);
  });

  test('les changer les envoie, sans emporter les quatre figés', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await page.getByRole('button', { name: /montures ·/ }).click();

    await page.getByTestId('setting-gauge-band').selectOption('70000');
    await page.getByTestId('setting-net-cost').check();
    await page.getByTestId('save-settings').click();
    await expect(page.getByText('Enregistré', { exact: true })).toBeVisible();

    const body = lastSettingsWrite(mock.writes);
    expect(body.gauge_cap).toBe(70000);
    expect(body.count_net_cost).toBe(true);
    // Le parc et la caisse partent avec : les quatre vivent dans la même ligne,
    // et un bouton par réglage laisserait croire qu'oublier l'un annule l'autre.
    expect(body.enclos_count).toBe(5);
    expect(body.kamas_available).toBe(3_000_000);

    for (const column of FROZEN) {
      expect(body, `${column} ne doit plus voyager dans l'upsert`).not.toHaveProperty(column);
    }
  });

  test('deux enregistrements de suite ne réécrivent pas les colonnes figées', async ({ page }) => {
    // Deux clics et non un : la première écriture change l'état du panneau, et
    // c'est au second passage qu'un `{ ...settings }` recontaminerait la requête
    // avec ce que la relecture a rapporté.
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await page.getByRole('button', { name: /montures ·/ }).click();

    for (const band of ['70000', '100000']) {
      await page.getByTestId('setting-gauge-band').selectOption(band);
      await page.getByTestId('save-settings').click();
      await expect(page.getByText('Enregistré', { exact: true })).toBeVisible();
      expect(lastSettingsWrite(mock.writes).gauge_cap).toBe(Number(band));
      // Le message s'efface au bout de deux secondes ; l'attendre évite de
      // confondre celui du premier clic avec celui du second.
      await expect(page.getByText('Enregistré', { exact: true })).toHaveCount(0, { timeout: 5_000 });
    }

    expect(
      mock.writes.filter((write) => write.table === 'user_breeding_settings')
    ).toHaveLength(2);

    // La preuve côté serveur : la valeur délibérée de la ligne d'avant est
    // intacte après deux passages. Personne ne l'a écrite, donc personne ne la lit.
    const stored = mock.rows('user_breeding_settings')[0];
    expect(stored.minutes_per_fight).toBe(1);
    expect(stored.credit_off_target).toBe(false);
    expect(stored.gauge_cap).toBe(100_000);

    // Et l'écran garde ce qu'on vient de choisir, sans relecture réseau.
    await expect(page.getByTestId('setting-gauge-band')).toHaveValue('100000');
  });

  test('« le moins cher » reste choisissable, et part en null', async ({ page }) => {
    // Le nouveau défaut est la bande 2, mais l'ancien comportement — le moins
    // cher au point, sans regarder la vitesse — est une option, pas une valeur
    // perdue. Un `Number('')` la transformerait en « plafond nul ».
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await page.getByRole('button', { name: /montures ·/ }).click();

    await page.getByTestId('setting-gauge-band').selectOption('');
    await page.getByTestId('save-settings').click();
    await expect(page.getByText('Enregistré', { exact: true })).toBeVisible();

    expect(lastSettingsWrite(mock.writes).gauge_cap).toBeNull();
  });
});
