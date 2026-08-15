import { expect, test } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * « La fournée à charger » — la liste qu'on tient sous les yeux devant le jeu.
 *
 * Elle agrégeait par couleur : « 8 × ♂ Indigo dont 1 à procurer », suivi de
 * trois pastilles de noms et d'un « × 3 ». Juste, et impraticable — on ne
 * charge pas huit Indigo d'un geste, on remplit un enclos de dix montures, on
 * le referme, on passe au suivant. Au milieu de la liste, plus moyen de savoir
 * où l'on en était.
 *
 * Deux propriétés doivent tenir, et aucune n'est cosmétique :
 *
 * * **dix places par enclos, pas une de plus** — au-delà, la consigne ne peut
 *   pas s'exécuter ;
 * * **les deux parents d'un croisement dans le même enclos** — sinon ils ne se
 *   croisent pas, et la moitié de la fournée ne produit rien. C'est la raison
 *   pour laquelle le remplissage empile des croisements et non des montures.
 */

const SLOTS = 10;

test.describe('fournée à charger', () => {
  test('un enclos ne dépasse jamais ses dix places', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);

    const pens = page.getByTestId('load-pen');
    await expect(pens.first()).toBeVisible({ timeout: 30_000 });

    const total = await pens.count();
    expect(total).toBeGreaterThan(1);

    for (let index = 0; index < total; index += 1) {
      const pen = pens.nth(index);
      const lignes = pen.getByTestId('load-named');
      const paquets = pen.getByTestId('load-anonymous');

      // Les nommées comptent leur « × n », les anonymes leur « n × ».
      let montures = 0;
      for (const texte of await lignes.allInnerTexts()) {
        montures += Number(texte.match(/×\s*(\d+)/)?.[1] ?? 1);
      }
      for (const texte of await paquets.allInnerTexts()) {
        montures += Number(texte.match(/(\d+)\s*×/)?.[1] ?? 1);
      }

      expect(montures).toBeGreaterThan(0);
      expect(montures).toBeLessThanOrEqual(SLOTS);

      // L'en-tête annonce le même compte que ce que l'enclos liste.
      const entete = await pen.innerText();
      const annonce = Number(entete.match(/(\d+)\/10 places/)?.[1]);
      expect(annonce).toBe(montures);
    }
  });

  test('nommées et anonymes ne se mélangent pas dans un enclos', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);

    const pens = page.getByTestId('load-pen');
    await expect(pens.first()).toBeVisible({ timeout: 30_000 });

    // Au moins un enclos porte les deux, sinon la propriété ne se teste pas.
    let mixtes = 0;
    for (let index = 0; index < (await pens.count()); index += 1) {
      const pen = pens.nth(index);
      const nommees = await pen.getByTestId('load-named').count();
      const anonymes = await pen.getByTestId('load-anonymous').count();
      if (nommees === 0 || anonymes === 0) continue;
      mixtes += 1;

      // `innerText` rend le texte **tel qu'affiché** : les en-têtes portent
      // `uppercase` en CSS, donc on compare sans la casse.
      const texte = (await pen.innerText()).toLowerCase();
      // Les deux blocs sont annoncés, et les nommées passent avant.
      expect(texte).toContain('nommées');
      expect(texte).toContain('anonymes');
      expect(texte.indexOf('nommées')).toBeLessThan(texte.indexOf('anonymes'));
    }
    expect(mixtes).toBeGreaterThan(0);
  });

  test('la liste « D’abord, sans enclos » a disparu', async ({ page }) => {
    // Elle listait les couples déjà féconds juste au-dessus de la fournée, et
    // les deux ne se recoupent jamais : lues à la suite, l'une passait pour le
    // détail de l'autre.
    await mockSupabase(page);
    await openBreeding(page);

    await expect(page.getByTestId('load-pen').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('D’abord, sans enclos')).toHaveCount(0);
  });

  test('le total annoncé est celui des enclos', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);

    const pens = page.getByTestId('load-pen');
    await expect(pens.first()).toBeVisible({ timeout: 30_000 });

    let montures = 0;
    for (const texte of await pens.allInnerTexts()) {
      montures += Number(texte.match(/(\d+)\/10 places/)?.[1] ?? 0);
    }

    const entete = await page.getByText(/montures? · \d+\/\d+ places d’enclos/).innerText();
    expect(Number(entete.match(/(\d+) montures?/)![1])).toBe(montures);
  });

  test('« à procurer » de l’en-tête vaut ce que les enclos listent', async ({ page }) => {
    // Les deux moitiés ne se cherchent pas au même endroit — le coffre d'un
    // côté, l'hôtel de vente ou le filet de l'autre. Un en-tête qui annonce
    // vingt achats sur une liste qui en montre trente-deux envoie faire les
    // courses avec le mauvais budget.
    await mockSupabase(page);
    await openBreeding(page);

    const pens = page.getByTestId('load-pen');
    await expect(pens.first()).toBeVisible({ timeout: 30_000 });

    let aProcurer = 0;
    for (const texte of await pens.getByTestId('load-anonymous').allInnerTexts()) {
      if (texte.includes('à procurer')) aProcurer += Number(texte.match(/(\d+)\s*×/)?.[1] ?? 1);
    }

    const entete = await page.getByText(/du coffre/).innerText();
    expect(Number(entete.match(/(\d+) à procurer/)?.[1] ?? 0)).toBe(aProcurer);
  });
});
