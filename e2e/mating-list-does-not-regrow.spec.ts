import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding, panels } from './support/breeding';

/**
 * La liste d'accouplements ne repousse pas.
 *
 * ## Le défaut, tel que l'éleveur le vit
 *
 * « J'en fais 20, j'ai fini, je refresh : 2 nouveaux. Je les fais, je refresh :
 * rien. Je fais mes clonages : 3 nouveaux. » Une liste qui repousse à chaque
 * geste, sans jamais dire pourquoi, et qui ne se termine qu'en tâtonnant.
 *
 * Ce n'était ni de l'aléa ni un oubli d'écriture — à écurie constante la liste
 * est stable, et c'est le second test ci-dessous. C'était que la boucle censée
 * atteindre le point fixe ne simulait que **la moitié** du geste : les deux
 * parents consommés, jamais le poulain arrivé. Elle convergeait donc sur une
 * écurie qui s'était vidée sans rien produire — une écurie que l'éleveur n'aurait
 * jamais — et la vraie replanification, elle, voyait les poulains et changeait
 * d'avis. Voir `projectBirths`.
 *
 * ## Pourquoi le test parcourt tout le carrousel
 *
 * La fenêtre « Ce qui est né » montre **un croisement à la fois**. Un test qui
 * saisit le premier panneau et s'arrête ne prouve rien : il mesure la taille d'un
 * groupe, pas celle de la liste. C'est ce qui a d'abord masqué le défaut pendant
 * le diagnostic. Il faut « Suivant » jusqu'au bout, ce qui est aussi le seul
 * moyen de saisir une vraie fournée de vingt.
 */

/** Ce que le bouton de l'onglet promet, sans ouvrir la fenêtre. `0` s'il n'y a rien. */
const promisedCount = async (page: Page): Promise<number> => {
  await page.getByTestId('step-mate').click();
  await expect(page.getByTestId('pane-mate')).toBeVisible();
  const button = page
    .getByTestId('pane-mate')
    .getByRole('button', { name: /reproductions? à faire/ });
  if ((await button.count()) === 0) return 0;
  return Number((await button.innerText()).match(/(\d+)/)![1]);
};

/** Ce que le bouton de l'onglet promet, et la fenêtre ouverte. `0` s'il n'y a rien. */
const openMatingDoor = async (page: Page): Promise<number> => {
  await page.getByTestId('step-mate').click();
  await expect(page.getByTestId('pane-mate')).toBeVisible();
  const button = page
    .getByTestId('pane-mate')
    .getByRole('button', { name: /reproductions? à faire/ });
  if ((await button.count()) === 0) return 0;
  const promised = Number((await button.innerText()).match(/(\d+)/)![1]);
  await button.click();
  await expect(page.getByRole('heading', { name: 'Ce qui est né' })).toBeVisible();
  return promised;
};

/** Saisit tout le carrousel, croisement par croisement, et rend le compte. */
const recordEverything = async (page: Page): Promise<number> => {
  let recorded = 0;
  for (let group = 0; group < 80; group += 1) {
    for (let guard = 0; guard < 80; guard += 1) {
      const sexes = panels(page).locator('button').filter({ hasText: /^[♂♀]$/ });
      const count = await sexes.count();
      let clicked = false;
      for (let index = 0; index < count; index += 1) {
        if (await sexes.nth(index).isEnabled()) {
          await sexes.nth(index).click();
          // L'écriture doit être revenue : enchaîner testerait l'anti-double-clic.
          await expect(page.getByText('enregistrement…')).toHaveCount(0, { timeout: 20_000 });
          recorded += 1;
          clicked = true;
          break;
        }
      }
      if (!clicked) break;
    }
    const next = page.getByTestId('next-cross');
    if ((await next.count()) === 0 || !(await next.isEnabled())) break;
    await next.click();
  }
  return recorded;
};

test.describe('la liste d’accouplements', () => {
  test('la liste s’épuise en un tour et un résidu, pas en dix', async ({ page }) => {
    // ## Pourquoi pas « zéro d'un coup »
    //
    // Parce que ce serait faux, et qu'une promesse fausse est ce qui fait perdre
    // confiance. La boucle projette la **cible** de chaque croisement — voir
    // `projectBirths` — alors que le jeu tire dans une distribution d'issues. Une
    // naissance hors cible laisse une autre écurie que celle projetée, la politique
    // arbitre autrement, et un couple gratuit peut apparaître. Aucune fidélité de
    // simulation ne ferme ça, et `check:record-fixpoint` garde justement la moitié
    // qui est démontrable : à naissances sur la cible, le point fixe est exact.
    //
    // Ce qui se tient ici, c'est que le résidu soit **borné et petit** : un tour
    // plus un reste, et non deux ou trois gestes distillés indéfiniment. Mesuré sur
    // l'écurie du 15/08 : 17 puis 1.
    await mockSupabase(page);

    const rounds: number[] = [];
    for (let round = 0; round < 6; round += 1) {
      await openBreeding(page);
      const promised = await openMatingDoor(page);
      if (promised === 0) break;
      rounds.push(promised);
      const recorded = await recordEverything(page);
      expect(recorded, 'le bouton promet ce que la fenêtre sait délivrer').toBe(promised);
      await page.reload();
    }

    // La fixture du 15/08 porte une vraie fournée : sans quoi le test ne prouve
    // rien sur un lot, qui est le cas qui a échoué.
    expect(rounds[0], 'la fixture doit proposer une vraie fournée').toBeGreaterThan(10);
    expect(rounds.length, `tours : ${rounds.join(' → ')}`).toBeLessThanOrEqual(2);
    // Le second tour, s'il existe, est un résidu et non une seconde fournée.
    if (rounds.length > 1) expect(rounds[1]).toBeLessThanOrEqual(2);
  });

  test('à écurie constante, la liste ne change pas d’un chargement à l’autre', async ({
    page,
  }) => {
    // Ce test sépare deux diagnostics qui se ressemblent : une liste qui bouge
    // parce que l'écurie a bougé, et une liste qui bouge toute seule. Sans lui,
    // « la politique change d'avis » et « le planificateur tire au hasard »
    // s'expliquent l'un par l'autre.
    await mockSupabase(page);
    const promised: number[] = [];
    for (let visit = 0; visit < 3; visit += 1) {
      await openBreeding(page);
      promised.push(await openMatingDoor(page));
      await page.reload();
    }
    expect(promised[0]).toBeGreaterThan(0);
    expect(promised, 'trois chargements, la même liste').toEqual([
      promised[0],
      promised[0],
      promised[0],
    ]);
  });

  test('le rafraîchissement seul ne change rien : même écurie, même liste', async ({ page }) => {
    // La phrase de l'éleveur, mot pour mot : « j'en fais 20, j'ai fini, je
    // refresh : 2 nouveaux ». Rien n'avait changé dans son écurie entre les deux
    // écrans — seulement l'**ordre des lignes**.
    //
    // La lecture trie par identifiant (`.order('id')`), les écritures locales
    // ajoutent en fin de tableau. Un poulain saisi vit donc en queue jusqu'au
    // rafraîchissement, où il reprend sa place d'uuid. Et le plan dépend de cet
    // ordre : la recherche départage à valeur égale dans l'ordre où elle
    // rencontre les montures. Même contenu, deux ordres, deux plans.
    //
    // Voir `canonicalStable`. Ce test compare les deux moments à contenu
    // identique : ce qu'on lit avant le rafraîchissement doit être ce qu'on lit
    // après, sans quoi l'éleveur voit une liste repousser sans cause.
    await mockSupabase(page);
    await openBreeding(page);
    await openMatingDoor(page);

    // Quelques saisies, pas toutes : c'est le cas où le compteur reste non nul,
    // donc où un écart se lit sur un nombre et pas seulement sur « 0 ou pas 0 ».
    for (let index = 0; index < 3; index += 1) {
      const sexes = panels(page).locator('button').filter({ hasText: /^[♂♀]$/ });
      const count = await sexes.count();
      for (let position = 0; position < count; position += 1) {
        if (await sexes.nth(position).isEnabled()) {
          await sexes.nth(position).click();
          await expect(page.getByText('enregistrement…')).toHaveCount(0, { timeout: 20_000 });
          break;
        }
      }
      const next = page.getByTestId('next-cross');
      if ((await next.count()) > 0 && (await next.isEnabled())) await next.click();
    }
    await page.keyboard.press('Escape');

    const inSession = await promisedCount(page);
    await page.reload();
    await openBreeding(page);
    const afterReload = await promisedCount(page);

    expect(afterReload, 'le rafraîchissement ne doit rien faire repousser').toBe(inSession);
  });
});
