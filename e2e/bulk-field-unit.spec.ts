import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Le champ « Vrac hérité » écrit ce qu'il affiche.
 *
 * ## Le compteur qui se vidait quand on retapait ce qu'il montrait
 *
 * `saveBulkStock` a longtemps reçu un **total** — vrac plus montures suivies —
 * et retranchait les secondes avant d'écrire, pour ne pas compter deux fois une
 * gen 1 ou 2 née d'un croisement haut, donc suivie une par une. C'était juste
 * tant que le champ affichait ce total : il lisait `stockBySex` et s'appelait
 * « Mâles X fertiles en écurie ».
 *
 * #93 a remplacé les 120 compteurs par un assistant, et le champ survivant s'est
 * mis à lire `bulk`, l'effectif brut. Le libellé dit « en vrac », la valeur est
 * le vrac, et la soustraction est restée. Le seul appelant lui passait donc du
 * vrac là où elle attendait un total.
 *
 * Doré, 7 en vrac et 13 suivies fertiles dans la fixture :
 *
 * | saisi | attendu | écrit avant |
 * | --- | --- | --- |
 * | 47 | 47 | 34 |
 * | 7 — le chiffre affiché, retapé | 7 | **0** |
 *
 * La seconde ligne est celle qui saigne : recopier ce que le champ montre vidait
 * le compteur, en silence, et la politique planifiait ensuite sans ce stock.
 */

const seedBulk = (mock: SupabaseMock, males: number, females: number) => {
  mock.tables.user_breeding_mounts = [
    {
      user_id: '00000000-0000-0000-0000-0000000000e2',
      family: 'muldo',
      color_id: 'dore',
      males,
      females,
      cycled_males: 0,
      cycled_females: 0,
      updated_at: '2026-08-20T10:00:00.000Z',
    },
  ];
};

const openStocks = async (page: Page) => {
  const stock = page.getByRole('button', { name: /montures ·/ });
  await expect(stock).toBeVisible({ timeout: 30_000 });
  await stock.click();
  await expect(page.getByTestId('stock-list')).toBeVisible();
};

const storedMales = (mock: SupabaseMock) =>
  mock.rows('user_breeding_mounts')[0]?.males as number | undefined;

test.describe('le compteur de vrac hérité', () => {
  test('retaper le chiffre affiché ne vide pas le compteur', async ({ page }) => {
    // Le geste le plus innocent qui soit : cliquer dans le champ, retaper ce
    // qu'on y lit. Il faut des montures **suivies** de la même couleur pour que
    // l'ancienne soustraction morde — la fixture en porte treize en Doré.
    const mock = await mockSupabase(page);
    seedBulk(mock, 7, 3);
    const trackedDore = mock
      .rows('user_breeding_individuals')
      .filter((row) => row.color_id === 'dore' && row.fertile === true);
    expect(trackedDore.length).toBeGreaterThan(7);

    await openBreeding(page);
    await openStocks(page);

    const field = page.getByTitle('Mâles Dore en vrac');
    await expect(field).toBeVisible({ timeout: 30_000 });
    await expect(field).toHaveValue('7');

    // Une correction puis un retour en arrière — le geste réel : on efface, on
    // retape. Réécrire « 7 » sur « 7 » ne déclencherait rien du tout et ne
    // testerait que Playwright.
    await field.fill('8');
    await expect.poll(() => storedMales(mock), { timeout: 10_000 }).toBe(8);
    await field.fill('7');

    // On revient exactement où on était, en base comme à l'écran.
    await expect.poll(() => storedMales(mock), { timeout: 10_000 }).toBe(7);
    await expect(field).toHaveValue('7');
  });

  test('le chiffre saisi est celui qui est écrit', async ({ page }) => {
    const mock = await mockSupabase(page);
    seedBulk(mock, 7, 3);
    await openBreeding(page);
    await openStocks(page);

    const field = page.getByTitle('Mâles Dore en vrac');
    await expect(field).toBeVisible({ timeout: 30_000 });
    await field.fill('47');

    await expect.poll(() => storedMales(mock), { timeout: 10_000 }).toBe(47);
    await expect(field).toHaveValue('47');
  });

  test('les femelles suivent la même règle, et n’emportent pas les mâles', async ({ page }) => {
    // Les deux champs s'écrivent par le même appel — l'un passe la valeur de
    // l'autre — donc corriger l'unité d'un seul côté aurait laissé l'autre
    // amputer son voisin à chaque frappe.
    const mock = await mockSupabase(page);
    seedBulk(mock, 7, 3);
    await openBreeding(page);
    await openStocks(page);

    const females = page.getByTitle('Femelles Dore en vrac');
    await expect(females).toBeVisible({ timeout: 30_000 });
    await females.fill('9');

    await expect.poll(() => mock.rows('user_breeding_mounts')[0]?.females, { timeout: 10_000 }).toBe(9);
    expect(storedMales(mock)).toBe(7);
    await expect(page.getByTitle('Mâles Dore en vrac')).toHaveValue('7');
  });
});
