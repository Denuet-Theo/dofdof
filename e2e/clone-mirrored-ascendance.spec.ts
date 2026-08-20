import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Une ascendance à l'envers reste la même ascendance.
 *
 * ## Ce que l'écran montrait
 *
 * L'écurie du 15/08 porte deux stériles nées du même croisement joué dans les
 * deux sens : un `G2 DOPO M DO-PO` de Doré × Pourpre, un autre de Pourpre ×
 * Doré. Même couleur, même sexe, même nom dicté — en jeu ce sont **deux
 * exemplaires de la même monture**, et leur clone est le même quel que soit le
 * côté que le tirage prend.
 *
 * L'outil les tenait pour deux montures différentes, parce que l'ascendance se
 * comparait par un `join` sur l'**ordre stocké** — celui du couple qui a écrit
 * la naissance. Conséquences mesurées sur cette fixture, avant correctif :
 *
 * * le lot n'affichait aucun « × 2 » sur ce nom, donc deux recherches dans
 *   l'écurie du jeu au lieu d'une (l'éleveur mesure le doublon à cinq fois plus
 *   rapide) ;
 * * pire, le mâle se retrouvait apparié à la **femelle** de même nom — clonage 9
 *   du lot — ce qui rend le sexe du clone incertain, alors que les deux mâles
 *   ensemble le rendaient certain ;
 * * le second mâle partait avec un `G2 ORPO M OR-PO` sans rapport, à pile ou
 *   face sur l'ascendance.
 *
 * ## Ce que cette spec verrouille
 *
 * Le doublon est reconnu — une carte, un « × 2 » — et le lot entier ne demande
 * jamais de départager deux cartes qui portent le même nom, ce qui est la forme
 * générale du défaut. Voir `ascendanceKey`, seul passage autorisé pour comparer
 * deux ascendances.
 */

/** Le doublon en miroir que porte `muldo-stable.json`. */
const MIROIR = 'G2 DOPO M DO-PO';

const openCloning = async (page: Page) => {
  await page.getByRole('button', { name: 'Clonage' }).click();
  const open = page.getByRole('button', { name: /clonages? à faire/ });
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
};

/** Les noms dictés affichés par le clonage courant : une carte, ou deux. */
const namesOn = (page: Page) =>
  page.getByTestId('clone-card').getByTestId('copyable').locator('code').allInnerTexts();

test.describe('clonage — ascendance en miroir', () => {
  test('deux montures du même nom se reconnaissent, dans les deux sens', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    // « Passer » n'écrit rien : on traverse tout le lot sans toucher à l'écurie,
    // ce qui est le seul moyen de juger une **liste** plutôt qu'une carte. Et
    // c'est bien la liste qui était fausse : le défaut ne se voit pas sur le
    // premier clonage, il déplace des paires au milieu du lot.
    const doublons: string[] = [];
    let vus = 0;
    for (let pas = 0; pas < 40; pas += 1) {
      const noms = await namesOn(page);
      if (noms.length === 0) break;
      vus += 1;

      const jumelles = await page.getByTestId('clone-twin').count();
      if (jumelles > 0) {
        await expect(page.getByTestId('clone-twin')).toContainText('× 2');
        doublons.push(noms[0]);
      }

      // La forme générale du défaut : deux cartes du même nom sous « laquelle est
      // sortie » est une question sans réponse.
      if (noms.length === 2) {
        expect(new Set(noms).size, `clonage ${vus} : ${noms.join(' / ')}`).toBe(2);
      }

      const passer = page.getByTestId('clone-skip');
      if ((await passer.count()) === 0) break;
      await passer.click();
    }

    // Sans lot à traverser, les affirmations du dessus seraient vides.
    expect(vus, 'le lot proposé').toBeGreaterThan(5);

    // Et le cas nommé : les deux mâles en miroir forment un doublon, pas une
    // paire à départager. C'est l'assertion qui tombe sans le correctif.
    expect(doublons, 'le miroir reconnu comme doublon').toContain(MIROIR);
  });
});
