import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * L'écurie affichée dans l'ordre du jeu : par nom.
 *
 * ## Pourquoi cet ordre-là est un comportement et pas une préférence
 *
 * L'écran d'écurie existe pour être posé à côté de l'ETABLE du jeu et descendu
 * ligne à ligne — c'est le seul geste qui ferme un écart que les compteurs ont
 * localisé. Le jeu range sa liste par nom ; toute autre clé oblige à chercher
 * chaque ligne dans l'autre liste, et la comparaison ne se fait plus.
 *
 * La liste sortait par état, génération, couleur, niveau, puis **uuid**. Sur une
 * cellule pointée les quatre premières clés sont justement celles que les
 * filtres viennent de figer, donc l'ordre effectif était celui des
 * identifiants : six Amande gen 3 mâles fertiles s'affichaient dans un ordre qui
 * ne correspondait à rien, et surtout pas à celui du jeu.
 */
const openStocks = async (page: Page) => {
  const bouton = page.getByRole('button', { name: /montures ·/ });
  await expect(bouton).toBeVisible({ timeout: 30_000 });
  await bouton.click();
};

/** Les noms portés, dans l'ordre où la liste les affiche. */
const shownNames = (page: Page): Promise<string[]> =>
  page
    .getByTestId('stock-mount')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-name') ?? ''));

test.describe('l’ordre de l’écurie', () => {
  test('la liste descend par nom, comme l’ETABLE du jeu', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    const names = await shownNames(page);
    expect(names.length, 'la fixture doit porter des montures').toBeGreaterThan(20);
    expect(names, 'la liste doit descendre par nom').toEqual(
      [...names].sort((a, b) => a.localeCompare(b, 'fr'))
    );
  });

  test('les homonymes restent groupés sous un filtre', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    // Une cellule où les facettes ne séparent plus rien : c'est là que l'ordre
    // tombait sur l'uuid, et c'est la capture du 22/08.
    await page.getByRole('button', { name: 'Génération 3' }).click();
    const names = await shownNames(page);
    expect(names.length, 'la cellule doit porter plusieurs montures').toBeGreaterThan(2);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'fr')));

    // Et deux montures de même nom ne sont jamais séparées par une troisième.
    for (const name of new Set(names)) {
      const first = names.indexOf(name);
      const last = names.lastIndexOf(name);
      expect(
        names.slice(first, last + 1).every((entry) => entry === name),
        `« ${name} » est coupé en deux par un autre nom`
      ).toBe(true);
    }
  });
});
