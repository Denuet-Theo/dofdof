import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding, failureBanner } from './support/breeding';

/**
 * Corriger un lot de montures en un geste.
 *
 * ## Ce qui manquait
 *
 * L'app sait mettre soixante montures en enclos en quelques clics. Elle n'avait
 * aucun geste pour les en ramener : la sortie d'enclos suppose une fournée
 * enregistrée, et quand celle-ci est perdue — le 23/08 — il reste cinquante
 * montures à repasser fécondes **et** à reniveler une par une. Cent gestes,
 * c'est-à-dire un travail qu'on ne fait pas : donc une écurie qui reste fausse,
 * et une politique qui planifie dessus.
 *
 * ## Ce que ces tests tiennent
 *
 * 1. Une seule écriture pour tout le lot. Cinquante `update` séparés, ce sont
 *    cinquante refus possibles et un état final que personne ne peut décrire.
 * 2. Un refus **défait** l'écran — clause 2 de la règle d'or. C'est la moitié
 *    qui manque partout où l'écriture optimiste est posée sans son retour.
 * 3. Rien ne part tant que le lot n'a pas de correctif : une écriture vide
 *    passerait pour un geste accompli.
 */

const openStocks = async (page: Page) => {
  const stock = page.getByRole('button', { name: /montures ·/ });
  await expect(stock).toBeVisible({ timeout: 30_000 });
  await stock.click();
  await expect(page.getByTestId('stock-list')).toBeVisible();
};

/** Coche les `count` premières lignes et rend leurs états d'avant. */
const selectFirst = async (page: Page, mock: SupabaseMock, count: number) => {
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = page.getByTestId('stock-mount').nth(index);
    names.push((await row.getAttribute('data-name')) ?? '');
    await row.getByTestId('stock-select').check();
  }
  await expect(page.getByTestId('bulk-count')).toHaveAttribute('data-count', String(count));
  return names;
};

const patchesOn = (mock: SupabaseMock) =>
  mock.writes.filter(
    (write) => write.table === 'user_breeding_individuals' && write.method === 'PATCH'
  );

test.describe('correction en lot', () => {
  test('un seul aller-retour passe tout le lot en fécondes au niveau 44', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    await selectFirst(page, mock, 5);
    await page.getByTestId('bulk-status-feconde').click();
    await page.getByTestId('bulk-level').fill('44');

    const before = patchesOn(mock).length;
    await page.getByTestId('bulk-apply').click();
    await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 20_000 });

    // 1. **Une** requête, pas cinq : un `.in()` passe ou échoue en bloc.
    const sent = patchesOn(mock).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].query).toContain('id=in.');
    expect(JSON.stringify(sent[0].body)).toContain('"cycled":true');

    // 2. Cinq lignes, et cinq seulement, portent le nouvel état.
    const written = mock
      .rows('user_breeding_individuals')
      .filter((row) => row.level === 44 && row.cycled === true && row.fertile === true);
    expect(written.length).toBeGreaterThanOrEqual(5);

    // 3. La sélection se vide : la garder ferait recliquer sur un lot corrigé.
    await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
    await expect(failureBanner(page)).toHaveCount(0);
  });

  test('un refus défait l’écran au lieu de garder la correction', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    await selectFirst(page, mock, 3);
    // Les niveaux d'avant, lus à l'écran : c'est là que le mensonge se verrait.
    const levels = await page
      .getByTestId('stock-mount')
      .locator('input[type="number"]')
      .evaluateAll((nodes) => nodes.slice(0, 3).map((node) => (node as HTMLInputElement).value));

    mock.refuse({ table: 'user_breeding_individuals', method: 'PATCH' });
    await page.getByTestId('bulk-status-feconde').click();
    await page.getByTestId('bulk-level').fill('44');
    await page.getByTestId('bulk-apply').click();
    await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 20_000 });

    // L'échec se dit, deux fois : la bannière et la ligne du bandeau.
    await expect(failureBanner(page).first()).toBeVisible();
    await expect(page.getByTestId('bulk-error')).toBeVisible();

    // Et l'écran est revenu exactement où il était.
    const after = await page
      .getByTestId('stock-mount')
      .locator('input[type="number"]')
      .evaluateAll((nodes) => nodes.slice(0, 3).map((node) => (node as HTMLInputElement).value));
    expect(after).toEqual(levels);
    // La sélection reste : le geste est à reprendre, pas à refaire depuis zéro.
    await expect(page.getByTestId('bulk-count')).toHaveAttribute('data-count', '3');
  });

  test('sans état ni niveau, rien ne part', async ({ page }) => {
    // Une écriture vide réussirait, ne changerait rien, et passerait pour un
    // geste accompli — la forme même que toute cette série de correctifs traque.
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    await selectFirst(page, mock, 2);
    const before = patchesOn(mock).length;
    await expect(page.getByTestId('bulk-apply')).toBeDisabled();

    // Un niveau suffit à l'armer, et il part seul.
    await page.getByTestId('bulk-level').fill('44');
    await expect(page.getByTestId('bulk-apply')).toBeEnabled();
    await page.getByTestId('bulk-apply').click();
    await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 20_000 });

    const sent = patchesOn(mock).slice(before);
    expect(sent).toHaveLength(1);
    const body = JSON.stringify(sent[0].body);
    expect(body).toContain('"level":44');
    // Le statut n'a pas été touché : on n'écrit que ce qui a été demandé.
    expect(body).not.toContain('cycled');
  });

  test('la sélection survit au filtre, et le dit', async ({ page }) => {
    // L'usage même : filtrer sur une couleur, tout cocher, filtrer autrement,
    // continuer. Une sélection portée par les lignes disparaîtrait au premier
    // changement de filtre ; celle-ci compte ce qui est coché hors de vue.
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    await selectFirst(page, mock, 4);
    const search = page.getByPlaceholder(/nom/i).first();
    await expect(search).toBeVisible();
    await search.fill('G4');

    await expect(page.getByTestId('bulk-count')).toHaveAttribute('data-count', '4');
    await expect(page.getByTestId('bulk-count')).toContainText('hors filtre');
  });
});
