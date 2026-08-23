import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding, failureBanner } from './support/breeding';

/**
 * Clause 2 de la règle d'or : ce qui est posé en avance **revient**.
 *
 * Quatre écritures posaient la valeur à l'écran avant l'aller-retour et la
 * **gardaient** quand la base la refusait : le compteur de vrac, la réserve de
 * carburant, la cible du projet, les filtres de ferme. La bannière partait, donc
 * ce n'était pas tout à fait muet — mais l'écran continuait d'afficher
 * exactement ce que l'éleveur croyait avoir enregistré, ce qui est le mensonge
 * que `write-failures.ts` existe pour supprimer.
 *
 * Le coût n'est pas cosmétique : le vrac est une **entrée de la politique**. Un
 * compteur refusé laisse l'app planifier des fournées sur un stock qui n'existe
 * pas, et l'éleveur va chercher dans le jeu des montures qu'il n'a pas.
 *
 * Les filtres de ferme, eux, restent — `'gardé-exprès'` : les réécrire sous les
 * doigts pendant qu'on tape serait hostile, et la valeur est re-tentée à la
 * frappe suivante. La règle demande que le cas soit **jugé**, pas tranché dans
 * un seul sens.
 *
 * Les clauses 1 et 3 sont tenues ailleurs : `write-touched-nothing.spec.ts` pour
 * le succès que PostgREST rend sur zéro ligne, `enclos-exit-stale.spec.ts` pour
 * ce que l'écurie ne peut plus donner, `batch-unreadable.spec.ts` pour l'état
 * qu'on n'a pas su lire.
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

test.describe('règle d’or', () => {
  test('un compteur de vrac refusé revient à sa valeur d’avant', async ({ page }) => {
    const mock = await mockSupabase(page);
    seedBulk(mock, 7, 3);
    await openBreeding(page);
    await openStocks(page);

    const field = page.getByTitle('Mâles Dore en vrac');
    await expect(field).toBeVisible({ timeout: 30_000 });
    await expect(field).toHaveValue('7');

    mock.refuse({ table: 'user_breeding_mounts', method: 'POST' });
    await field.fill('47');

    // L'échec se dit…
    await expect(failureBanner(page).first()).toBeVisible();
    // …la base n'a rien pris…
    expect(mock.rows('user_breeding_mounts')[0]?.males).toBe(7);
    // …et l'écran ne prétend pas le contraire.
    await expect(field).toHaveValue('7');
  });

  test('un compteur accepté, lui, reste', async ({ page }) => {
    // Le retour arrière ne doit pas mordre sur le cas courant : une garde qui
    // annule aussi les écritures réussies rend la saisie inutilisable, et c'est
    // le mode d'échec le plus probable d'un correctif comme celui-ci.
    const mock = await mockSupabase(page);
    seedBulk(mock, 7, 3);
    await openBreeding(page);
    await openStocks(page);

    const field = page.getByTitle('Mâles Dore en vrac');
    await expect(field).toBeVisible({ timeout: 30_000 });
    await field.fill('47');

    // La base a changé — l'écriture est partie et personne ne l'a défaite.
    await expect
      .poll(() => mock.rows('user_breeding_mounts')[0]?.males, { timeout: 10_000 })
      .not.toBe(7);
    await expect(failureBanner(page)).toHaveCount(0);
    // Et l'écran montre exactement ce que la base porte. Le champ affiche le
    // vrac, que `saveBulkStock` calcule en retranchant les montures suivies du
    // total saisi — voir la note de la PR : ce champ dit « vrac » et lit
    // « total », ce qui est un défaut à part, pas celui qu'on teste ici.
    const stored = mock.rows('user_breeding_mounts')[0]?.males as number;
    await expect(field).toHaveValue(String(stored));
  });

});
