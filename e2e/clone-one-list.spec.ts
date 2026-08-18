import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * L'onglet Clonage affiche une liste, et c'est celle qu'on exécute.
 *
 * ## Les trois défauts que ces specs verrouillent
 *
 * 1. **Deux listes sous le même compte.** « Ce que valent tes stériles » venait
 *    de `cloneOptions`, la fenêtre de saisie de `cloningsToRecord` — le plan de
 *    la recherche. Toutes les deux annonçaient 12, et « Clonage 1 / 12 » ouvrait
 *    sur un couple qui n'était nulle part dans la liste affichée juste au-dessus.
 *    Relevé du 16/08 : la liste ouvrait sur ♀ Roux `G3 RO F DOEB-RO` + ♂ Roux
 *    `G3 RO M DOEB-DOOR`, la fenêtre sur ♂ Orchidée Anonyme + ♂ Doré
 *    `G1 DO M DO-IN`.
 *
 * 2. **Des anonymes.** Une consigne de clonage désigne deux montures précises, et
 *    une anonyme ne se cherche pas dans l'écurie du jeu — elle se compte dans un
 *    tas. La paire était par ailleurs sans intérêt : sans ascendance, le clone
 *    est une gen 1 nue.
 *
 * 3. **Quatre mentions par ligne qui ne décident rien.** « porte G2 », « 50 % de
 *    la garder », « sexe au tirage », « mieux vaut extraire » : le jeu tire la
 *    survivante et son sexe, l'éleveur constate. Les chiffres restent en
 *    `data-*`, où les specs les lisent — et où ils ne coûtent pas une ligne de
 *    lecture par clonage.
 */

const openCloning = async (page: Page) => {
  await page.getByRole('button', { name: 'Clonage' }).click();
  await expect(page.getByTestId('pane-clone')).toBeVisible({ timeout: 30_000 });
};

/** Les codes de nom d'une ligne ou d'une carte — ce qu'on cherche en jeu. */
const codesOf = (page: Page, testId: string) =>
  page.getByTestId(testId).locator('code').allInnerTexts();

test.describe('clonage — une seule liste', () => {
  test('la fenêtre ouvre sur le premier couple de la liste affichée', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    const lignes = page.getByTestId('clone-advice');
    await expect(lignes.first()).toBeVisible({ timeout: 30_000 });

    const attendu = await lignes.first().locator('code').allInnerTexts();
    expect(attendu).toHaveLength(2);

    // Le compte du bouton est celui de la liste : un seul lot, un seul chiffre.
    const bouton = page.getByRole('button', { name: /clonages? à faire/ });
    const annonce = Number((await bouton.innerText()).match(/(\d+)/)![1]);
    expect(annonce).toBe(await lignes.count());

    await bouton.click();
    await expect(page.getByRole('heading', { name: /^Clonage 1 \/ \d+$/ })).toBeVisible();

    // ## Deux exemplaires indiscernables ne font qu'une carte
    //
    // `cloneOptions` met les **doublons en tête** — deux stériles de même nom se
    // clonent en une recherche au lieu de deux, ce qui va environ cinq fois plus
    // vite en jeu. La première paire du lot est donc souvent l'une d'elles, et la
    // fenêtre l'affiche « × 2 » plutôt qu'en deux cartes jumelles : demander de
    // choisir entre deux choses identiques est une question sans réponse. Voir
    // `clone-twin`.
    //
    // La propriété testée ici n'en dépend pas : c'est que la fenêtre ouvre sur le
    // couple que la liste affiche en premier. On la lit donc sur l'ensemble des
    // noms, et le nombre de cartes se vérifie selon le cas.
    const jumelles =
      (await page.getByTestId('clone-pair').getAttribute('data-duplicate')) === 'true';
    const cartes = await codesOf(page, 'clone-card');
    expect(new Set(cartes)).toEqual(new Set(attendu));
    if (jumelles) await expect(page.getByTestId('clone-twin')).toBeVisible();
    else expect([...cartes].sort()).toEqual([...attendu].sort());
  });

  test('aucune anonyme, ni dans la liste ni dans la fenêtre', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    const pane = page.getByTestId('pane-clone');
    await expect(pane).not.toContainText('Anonyme');

    // Chaque monture proposée porte donc un nom à chercher en jeu, des deux côtés.
    const lignes = page.getByTestId('clone-advice');
    const total = await lignes.count();
    expect(total).toBeGreaterThan(0);
    for (let index = 0; index < total; index += 1) {
      expect(await lignes.nth(index).locator('code').count()).toBe(2);
    }

    await page.getByRole('button', { name: /clonages? à faire/ }).click();
    await expect(page.getByTestId('clone-card').first()).toBeVisible();
    for (const carte of await page.getByTestId('clone-card').allInnerTexts()) {
      expect(carte).not.toContain('Anonyme');
    }
  });

  test('une ligne ne dit que le couple', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    const lignes = page.getByTestId('clone-advice');
    await expect(lignes.first()).toBeVisible({ timeout: 30_000 });

    for (const mention of [
      '% de la garder',
      'sexe au tirage',
      'sexe certain',
      'porte G',
      'mieux vaut extraire',
      // Celle-là s'est ajoutée puis retirée dans la même journée : elle tombait
      // sur 13 lignes sur 15, donc elle ne disait plus rien de personne.
      'vise ',
    ]) {
      await expect(lignes.first()).not.toContainText(mention);
    }

    // Ce qui a disparu de l'écran reste mesurable : c'est la condition pour que
    // le retrait soit une simplification et non une perte.
    expect(await lignes.first().getAttribute('data-keep-carried')).not.toBeNull();
    expect(await lignes.first().getAttribute('data-partner-carried')).not.toBeNull();
  });
});
