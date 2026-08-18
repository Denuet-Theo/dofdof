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
  test('tout saisir la vide, et le rafraîchissement n’en fait pas repousser', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);

    const promised = await openMatingDoor(page);
    // La fixture du 15/08 en porte une vingtaine : sans quoi le test ne prouve
    // rien sur une fournée, qui est le cas qui a échoué.
    expect(promised, 'la fixture doit proposer une vraie fournée').toBeGreaterThan(10);

    const recorded = await recordEverything(page);
    expect(recorded, 'le bouton promet ce que la fenêtre sait délivrer').toBe(promised);

    // Le geste de l'éleveur, celui qui révélait le défaut.
    await page.reload();
    await openBreeding(page);
    expect(await openMatingDoor(page), 'plus rien à faire après avoir tout fait').toBe(0);
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
});
