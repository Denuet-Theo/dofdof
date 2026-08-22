import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

const individus = 'user_breeding_individuals';

/**
 * « La fournée à charger » — la liste qu'on tient sous les yeux devant le jeu.
 *
 * Elle agrégeait par couleur : « 8 × ♂ Indigo dont 1 à procurer », suivi de
 * trois pastilles de noms et d'un « × 3 ». Juste, et impraticable — on ne
 * charge pas huit Indigo d'un geste, on remplit un enclos de dix montures, on
 * le referme, on passe au suivant.
 *
 * Puis les cinq enclos se sont affichés d'un bloc, ce qui était la même erreur
 * d'un cran plus haut : au milieu de la liste, plus moyen de savoir lequel on
 * était en train de remplir. **Un enclos à l'écran**, et le verrou fait passer
 * au suivant — voir `batch-lock.spec.ts` pour ce que le verrou garantit.
 *
 * La propriété qui compte ici : **dix places par enclos, pas une de plus**.
 * Au-delà, la consigne ne peut pas s'exécuter.
 *
 * Ce qui n'en est **pas** une, et qu'une première version imposait à tort : que
 * les deux parents d'un croisement soient dans le même enclos. L'enclos paie le
 * cycle de fécondité, l'appariement se décide après — deux montures qui
 * s'accoupleront peuvent avoir été fécondées à deux jours d'écart.
 */

const SLOTS = 10;

const openLoadTab = async (page: Page) => {
  const tab = page.getByTestId('step-load');
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByTestId('pane-load')).toBeVisible();
};

/** Ce que l'enclos affiché compte de montures, lu sur ses lignes. */
const mountsInCurrentPen = async (page: Page): Promise<number> => {
  const pen = page.getByTestId('current-pen');
  let total = 0;
  // Les nommées comptent leur « × n », les anonymes leur « n × ».
  for (const texte of await pen.getByTestId('load-named').allInnerTexts()) {
    total += Number(texte.match(/×\s*(\d+)/)?.[1] ?? 1);
  }
  for (const texte of await pen.getByTestId('load-anonymous').allInnerTexts()) {
    total += Number(texte.match(/(\d+)\s*×/)?.[1] ?? 1);
  }
  return total;
};

test.describe('fournée à charger', () => {
  test('aucun enclos ne dépasse ses dix places, du premier au dernier', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    const entete = await page.getByTestId('pane-load').innerText();
    const enclos = Number(entete.match(/(\d+) enclos/)![1]);
    expect(enclos).toBeGreaterThan(1);

    // On les parcourt comme l'éleveur : en verrouillant chacun pour voir le
    // suivant. C'est aussi ce qui vérifie que le verrou avance bien d'un cran.
    for (let index = 0; index < enclos; index += 1) {
      const pen = page.getByTestId('current-pen');
      await expect(pen).toContainText(`Enclos ${index + 1}`);

      const montures = await mountsInCurrentPen(page);
      expect(montures).toBeGreaterThan(0);
      expect(montures).toBeLessThanOrEqual(SLOTS);

      // L'en-tête annonce le même compte que ce que l'enclos liste.
      const annonce = Number((await pen.innerText()).match(/(\d+)\/10 places/)?.[1]);
      expect(annonce).toBe(montures);

      await page.getByTestId('lock-pen').click();
      await expect(page.getByTestId('locked-pen')).toHaveCount(index + 1);
    }
  });

  test('nommées et anonymes ne se mélangent pas dans un enclos', async ({ page }) => {
    /*
     * Un enclos qui porte les deux les **sépare** et met les nommées devant : ce
     * sont elles qu'il faut aller chercher au coffre, une par une, tandis que le
     * vrac se prend au tas.
     *
     * ## L'enclos est posé, pas espéré
     *
     * La version d'avant verrouillait tous les enclos de la fournée en comptant
     * ceux qui portaient les deux sortes, puis exigeait `mixtes > 0`. Elle
     * mesurait donc ce que le champion embarqué **compose** : un champion qui
     * remplit ses enclos de vrac n'en produit aucun de mixte, le compteur reste à
     * zéro, et la spec rougit sur sa prémisse alors que l'affichage est intact.
     * C'est arrivé au premier champion entraîné depuis la gen 1.
     *
     * On écrit donc la fournée en base avec un enclos mixte, et on vérifie ce que
     * l'écran en fait. La propriété testée est la même ; ce qui disparaît, c'est
     * la dépendance à la politique.
     */
    const mock = await mockSupabase(page);

    const nommee = mock.rows(individus).find((row) => row.name && row.fertile === true)!;
    const unit = (id: string, colorId: string, sex: 'M' | 'F', name: string | null) => ({
      id,
      colorId,
      sex,
      name,
      level: 1,
      banked: false,
      toBuy: false,
    });

    mock.tables['breeding_batch'] = [
      {
        id: '00000000-0000-0000-0000-0000000000b2',
        user_id: '00000000-0000-0000-0000-0000000000e2',
        family: 'muldo',
        level: 1,
        fertile: true,
        cycled: false,
        created_at: '2026-08-22T10:00:00.000Z',
        updated_at: '2026-08-22T10:00:00.000Z',
        pens: [
          {
            lockedAt: null,
            units: [
              // Volontairement le vrac d'abord : c'est l'écran qui doit remettre
              // les nommées devant, pas l'ordre où on les lui donne.
              unit('dore#M1', 'dore', 'M', null),
              unit('dore#F1', 'dore', 'F', null),
              unit(nommee.id as string, nommee.color_id as string, nommee.sex as 'M' | 'F', nommee.name as string),
            ],
          },
        ],
      },
    ] as never;

    await openBreeding(page);
    await openLoadTab(page);

    const pen = page.getByTestId('current-pen');
    // La prémisse, vraie par construction : l'enclos porte bien les deux sortes.
    expect(await pen.getByTestId('load-named').count()).toBeGreaterThan(0);
    expect(await pen.getByTestId('load-anonymous').count()).toBeGreaterThan(0);

    // `innerText` rend le texte **tel qu'affiché** : les en-têtes portent
    // `uppercase` en CSS, donc on compare sans la casse.
    const texte = (await pen.innerText()).toLowerCase();
    expect(texte).toContain('nommées');
    expect(texte).toContain('anonymes');
    expect(texte.indexOf('nommées')).toBeLessThan(texte.indexOf('anonymes'));
  });

  test('la liste « D’abord, sans enclos » a disparu', async ({ page }) => {
    // Elle listait les couples déjà féconds juste au-dessus de la fournée, et
    // les deux ne se recoupent jamais : lues à la suite, l'une passait pour le
    // détail de l'autre.
    await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    await expect(page.getByTestId('current-pen')).toBeVisible();
    await expect(page.getByText('D’abord, sans enclos')).toHaveCount(0);
  });

  test('le total annoncé est celui des enclos verrouillés bout à bout', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    const entete = await page.getByTestId('pane-load').innerText();
    const enclos = Number(entete.match(/(\d+) enclos/)![1]);
    const annonce = Number(entete.match(/(\d+) montures?/)![1]);

    let montures = 0;
    for (let index = 0; index < enclos; index += 1) {
      montures += await mountsInCurrentPen(page);
      await page.getByTestId('lock-pen').click();
      await expect(page.getByTestId('locked-pen')).toHaveCount(index + 1);
    }
    expect(montures).toBe(annonce);
  });

  test('« à procurer » se dit sur la ligne qui le concerne', async ({ page }) => {
    // Les deux moitiés ne se cherchent pas au même endroit — le coffre d'un
    // côté, l'hôtel de vente ou le filet de l'autre. C'est pour ça que la
    // mention vit sur la ligne et non dans un total qu'il faudrait redescendre.
    await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    const enclos = Number(
      (await page.getByTestId('pane-load').innerText()).match(/(\d+) enclos/)![1]
    );

    let aProcurer = 0;
    for (let index = 0; index < enclos; index += 1) {
      for (const texte of await page
        .getByTestId('current-pen')
        .getByTestId('load-anonymous')
        .allInnerTexts()) {
        if (texte.includes('à procurer')) aProcurer += Number(texte.match(/(\d+)\s*×/)?.[1] ?? 1);
      }
      await page.getByTestId('lock-pen').click();
      await expect(page.getByTestId('locked-pen')).toHaveCount(index + 1);
    }
    expect(aProcurer).toBeGreaterThan(0);
  });
});
