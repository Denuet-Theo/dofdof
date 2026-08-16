import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * L'onglet Extraction ne propose que des extractions — et jamais celle qui sert
 * le projet.
 *
 * ## Le défaut que ces specs verrouillent
 *
 * Deux, et ils tenaient sur la même ligne d'en-tête. Relevé sur l'écurie du
 * 16/08 : « 42 stériles extractibles … 4 à extraire · 408 000 kamas ».
 *
 * 1. **Une gen 10 en tête de la liste.** Une Azur-Turquoise, généalogie Azur
 *    (gen 9) + Pourpre, la monture même du relevé #185 — celle qui, croisée avec
 *    un Doré à mille kamas, nomme **Azur-Doré**, la couleur que le projet vise.
 *    L'écran proposait de la détruire pour son ambre, et il la classait *la moins
 *    intéressante à reproduire de toute l'écurie*, parce que sa valeur était un
 *    prix de rang net des génétons : 22 594 pour une gen 10, contre 63 502 pour
 *    une gen 2. Voir `cloning.ts`, § « le projet ».
 *
 * 2. **Un total qui ne couvre pas la liste.** 42 lignes portant chacune un
 *    montant, un en-tête qui n'en additionnait que 4, et rien pour dire
 *    lesquelles. La somme visible faisait 1 700 000 face aux 408 000 annoncés.
 *
 * La fixture porte les deux : projet `azur_dore`, et une unique stérile gen 10
 * `azur_turquoise` — donc **dépareillée**, ce qui est le cas limite. Protégée de
 * l'extraction, elle n'a aucune paire de clonage pour la porter : sans la liste
 * `clone-held` elle disparaîtrait des deux écrans, ce qui serait pire que le
 * défaut d'origine.
 */

const GEN10 = 'G10 AZTU F AZ-PO';

/**
 * Une gen 2 de lignée **Doré**, protégée par la première version de la règle.
 *
 * Elle ne rend au projet qu'un Doré — gen 1, mille kamas, l'écurie en tient des
 * dizaines — pendant qu'un Azur-Pourpre fécond apportait l'Azur. Dix-neuf des
 * vingt protégées l'étaient par ce seul partenaire, et sanctuariser une monture
 * qu'un achat remplace vide l'écran de son objet.
 */
const GEN2_DORE = 'G2 DOOR F DO-OR';

const openExtraction = async (page: Page) => {
  const tab = page.getByTestId('step-extract');
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByTestId('pane-extract')).toBeVisible();
};

const openCloning = async (page: Page) => {
  await page.getByTestId('step-clone').click();
  await expect(page.getByTestId('pane-clone')).toBeVisible();
};

test.describe('extraction et projet', () => {
  test('la gen 10 qui vise la couleur du projet n’est pas à extraire', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openExtraction(page);

    const pane = page.getByTestId('pane-extract');
    await expect(pane).not.toContainText(GEN10);

    // Et le motif tient sur la génération, pas sur le nom : rien de ce que
    // l'écurie porte au sommet n'a d'ambre qui vaille la couleur visée.
    const rows = page.getByTestId('extraction-row');
    for (let index = 0; index < (await rows.count()); index += 1) {
      expect(Number(await rows.nth(index).getAttribute('data-generation'))).toBeLessThan(10);
    }
  });

  test('une gen 2 qui n’apporte que du Doré, elle, reste extractible', async ({ page }) => {
    // Le pendant du test précédent, et il borne la règle. « Peut nommer la
    // couleur visée » protégeait les deux moitiés du croisement ; seule celle
    // qu'on ne rachète pas mérite de l'être. Le seuil est `cible − 1`, donc
    // gen 9 pour Azur-Doré.
    await mockSupabase(page);
    await openBreeding(page);
    await openExtraction(page);

    await expect(page.getByTestId('pane-extract')).toContainText(GEN2_DORE);

    // Et rien de ce qui reste ici ne porte la moitié rare.
    const rows = page.getByTestId('extraction-row');
    for (let index = 0; index < (await rows.count()); index += 1) {
      expect(Number(await rows.nth(index).getAttribute('data-carried'))).toBeLessThan(9);
    }
  });

  test('elle est gardée à l’onglet Clonage, où elle attend une partenaire', async ({ page }) => {
    // Le pendant, et il compte autant : la retirer de l'extraction ne doit pas
    // la faire disparaître. Dépareillée, aucune paire ne peut la porter — d'où
    // la liste des gardées.
    await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    const held = page.getByTestId('clone-held');
    await expect(held.first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('pane-clone')).toContainText(GEN10);
    await expect(page.getByTestId('pane-clone')).toContainText('Azur-Dore');
  });

  test('le total de l’en-tête est la somme des lignes affichées', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openExtraction(page);

    const rows = page.getByTestId('extraction-row');
    await expect(rows.first()).toBeVisible();

    const ambers = await rows.evaluateAll((nodes) =>
      nodes.map((node) => Number(node.getAttribute('data-amber')))
    );
    const total = Number(await page.getByTestId('extraction-total').getAttribute('data-total'));

    // Les arrondis se font ligne par ligne d'un côté, sur la somme de l'autre :
    // un kama par ligne d'écart au plus, et c'est tout ce qu'on tolère.
    const sum = ambers.reduce((accumulator, amber) => accumulator + amber, 0);
    expect(Math.abs(sum - total)).toBeLessThanOrEqual(ambers.length);
    expect(total).toBeGreaterThan(0);
  });

  test('aucune ligne d’extraction ne dit « plutôt cloner »', async ({ page }) => {
    // Le symptôme exact du second défaut : la mention existait, donc la ligne
    // aussi, donc le total ne pouvait pas correspondre à la liste.
    await mockSupabase(page);
    await openBreeding(page);
    await openExtraction(page);

    await expect(page.getByTestId('pane-extract')).not.toContainText('plutôt cloner');
  });
});
