import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Enregistrer une extraction, et l'ordre des deux listes.
 *
 * ## La panne d'origine
 *
 * L'onglet « Extraction » disait quoi extraire et n'offrait **aucun moyen de le
 * dire**. Une extraction faite en jeu laissait donc la stérile en base : l'écran
 * continuait de la proposer, et le total annoncé comptait une ressource déjà
 * encaissée. Le seul recours était de la supprimer à la main depuis « Mes stocks »,
 * dans une liste de deux cents lignes.
 *
 * Le retrait est **irréversible** et il n'y a pas d'annulation, donc c'est
 * exactement le genre d'écriture que cette suite existe pour surveiller : le test
 * refuse le `DELETE` et vérifie que la monture **revient** à l'écran plutôt que de
 * disparaître d'un côté seulement.
 *
 * ## Et l'ordre
 *
 * Les accouplements sortaient les immédiats d'abord, les clonages dans aucun ordre
 * lisible. Les deux sont maintenant par génération cible croissante — c'est l'ordre
 * dans lequel on les fait devant l'enclos.
 */

const openTab = async (page: Page, step: string) => {
  await openBreeding(page);
  await page.getByTestId(`step-${step}`).click();
  await expect(page.getByTestId(`pane-${step}`)).toBeVisible();
};

test.describe('extraction faite en jeu', () => {
  test('« Extraite » retire la monture de l’écurie', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openTab(page, 'extract');

    const rows = page.getByTestId('extraction-row');
    const before = await rows.count();
    expect(before, 'la fixture doit porter des stériles à extraire').toBeGreaterThan(0);

    const target = rows.first();
    const mountId = await target.getByTestId('extraction-done').getAttribute('data-mount');
    expect(mountId).toBeTruthy();

    await target.getByTestId('extraction-done').click();

    // La ligne part, et la monture n'est plus en base.
    await expect(rows).toHaveCount(before - 1);
    const kept = mock
      .rows('user_breeding_individuals')
      .some((row) => row.id === mountId);
    expect(kept, 'la monture extraite doit avoir quitté la base').toBe(false);
  });

  test('un retrait refusé rend la monture, il ne la perd pas', async ({ page }) => {
    // La règle de cette suite : une écriture qui échoue ne doit pas laisser
    // l'écran en avance sur la base. Ici le sens est inversé — la monture doit
    // **revenir**, pas disparaître.
    const mock = await mockSupabase(page);
    await openTab(page, 'extract');

    const rows = page.getByTestId('extraction-row');
    const before = await rows.count();
    mock.refuseOnce({ table: 'user_breeding_individuals', method: 'DELETE' });

    const mountId = await rows.first().getByTestId('extraction-done').getAttribute('data-mount');
    await rows.first().getByTestId('extraction-done').click();

    // Elle revient à l'écran, et elle est toujours en base.
    await expect(rows).toHaveCount(before);
    expect(
      mock.rows('user_breeding_individuals').some((row) => row.id === mountId),
      'un retrait refusé doit laisser la monture en base'
    ).toBe(true);
    // Et la bannière le dit, plutôt que de laisser le silence passer pour un succès.
    await expect(page.locator('[role="alert"]').filter({ hasText: 'Pas enregistré' })).toBeVisible();
  });

  test('deux clics sur la même ligne n’envoient qu’un retrait', async ({ page }) => {
    // Un `DELETE` qui ne trouve rien ne rend aucune erreur : sans garde, le second
    // clic aurait annoncé une seconde extraction qui n'a jamais eu lieu.
    const mock = await mockSupabase(page);
    await openTab(page, 'extract');

    const button = page.getByTestId('extraction-row').first().getByTestId('extraction-done');
    const mountId = await button.getAttribute('data-mount');
    await button.click();
    // La ligne a disparu : le bouton n'existe plus, donc rien à recliquer.
    await expect(page.getByTestId('extraction-done').filter({ has: page.locator(`[data-mount="${mountId}"]`) })).toHaveCount(0);

    const deletes = mock.writes.filter(
      (write) => write.table === 'user_breeding_individuals' && write.method === 'DELETE'
    );
    expect(deletes).toHaveLength(1);
  });
});
