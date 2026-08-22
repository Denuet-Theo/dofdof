import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * La montée, de **où on en est** à **où on va**.
 *
 * La ligne n'annonçait que le 1 → 200 : le seul cas où l'éleveur n'a rien à
 * calculer. Devant l'enclos la question est l'autre — « mes muldos sont à 48, je
 * les veux à 100, combien de points de Mangeoire ? » — et le barème est une loi
 * de puissance cumulative, donc la réponse ne se fait pas de tête.
 *
 * ## Ce que le test tient, et qui n'est pas l'arithmétique
 *
 * `mountXpForLevel` a ses propres relevés et sa propre garde. Ce qui se vérifie
 * ici est ce que l'écran en fait : que les deux bornes existent, que le chiffre
 * suit la saisie, et surtout qu'il se lise comme une **différence** — une montée
 * de 48 à 100 ne coûte pas ce que coûte une montée de 1 à 100.
 */
const points = async (page: Page): Promise<number> =>
  Number((await page.getByTestId('mangeoire-points').innerText()).replace(/\D/g, ''));

test.describe('points de Mangeoire à remplir', () => {
  test('le chiffre suit les deux bornes, et compte la différence', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);

    const from = page.getByTestId('mangeoire-from');
    const to = page.getByTestId('mangeoire-to');
    await expect(from).toBeVisible({ timeout: 30_000 });

    // Les bornes par défaut redonnent la ligne d'avant : la montée entière.
    await expect(from).toHaveValue('1');
    await expect(to).toHaveValue('200');
    const entiere = await points(page);
    expect(entiere).toBeGreaterThan(100_000);

    // De 1 à 100 : une part de la montée, pas la montée.
    await to.fill('100');
    const jusquCent = await points(page);
    expect(jusquCent).toBeGreaterThan(0);
    expect(jusquCent).toBeLessThan(entiere);

    /*
     * De 48 à 100 : c'est la question posée devant l'enclos, et la seule qui
     * distingue une différence d'un cumul. Un écran qui rendrait ici le même
     * chiffre qu'à « de 1 à 100 » ignorerait le niveau actuel — c'est-à-dire
     * tout ce qu'on vient d'ajouter.
     */
    await from.fill('48');
    const depuis48 = await points(page);
    expect(depuis48).toBeGreaterThan(0);
    expect(depuis48).toBeLessThan(jusquCent);

    // Et la part manquante est exactement ce que coûte la montée jusqu'à 48.
    await from.fill('1');
    await to.fill('48');
    expect(depuis48 + (await points(page))).toBe(jusquCent);
  });

  test('une cible sous le niveau actuel ne demande rien', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);

    await expect(page.getByTestId('mangeoire-from')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('mangeoire-from').fill('150');
    await page.getByTestId('mangeoire-to').fill('100');
    // Zéro, et non un nombre négatif : la Mangeoire ne rend pas de points.
    expect(await points(page)).toBe(0);
  });
});
