import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Une monture inscrite à un enclos **à venir** qui ne peut plus y entrer.
 *
 * ## Le relevé du 20/08
 *
 * L'éleveur corrige `G2 EB M DOEB-DOIN` en stérile dans son écurie. L'écran de
 * fournée continue de la réclamer pour l'enclos 3. Un F5 n'y change rien — et
 * c'est la pire forme du défaut, parce que l'outil a l'air cassé alors qu'il
 * fait exactement ce qu'on lui a demandé : la fournée se fige au premier verrou,
 * enclos à venir compris.
 *
 * Le figeage est juste et ne bouge pas. Sans lui la liste change sous les doigts
 * pendant qu'on remplit, et « Les sortir de l'enclos » propose des montures qui
 * n'y sont jamais entrées — c'est tout l'objet de `batch-lock.spec.ts`.
 *
 * Ce qui manquait est le **lien entre les deux moitiés**. Figée veut dire figée
 * jusqu'à la fin de la fournée, et l'écurie continue de bouger. Il fallait donc
 * dire que la liste et l'écurie se contredisent, et offrir un recalcul — mais un
 * recalcul **demandé**, jamais automatique : ce que le verrou protège est « rien
 * ne change tout seul », pas « rien ne peut changer ».
 *
 * ## Ce que ce spec surveille, et dans cet ordre
 *
 * 1. l'avertissement paraît, sur la carte de l'enclos et pas ailleurs ;
 * 2. le recalcul retire la monture des enclos à venir ;
 * 3. il **ne touche pas** aux enclos verrouillés — ce sont des objets fermés
 *    dans le jeu, et aucun recalcul ne peut les rouvrir.
 *
 * Le point 3 est celui qui compte : un recalcul qui refait toute la fournée
 * serait exactement le défaut que le verrou ferme.
 */

const individus = 'user_breeding_individuals';

const openLoadTab = async (page: Page) => {
  const tab = page.getByTestId('step-load');
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByTestId('pane-load')).toBeVisible();
};

const storedPens = (mock: SupabaseMock) =>
  (mock.rows('breeding_batch')[0]?.pens ?? []) as {
    units: { id: string }[];
    lockedAt: string | null;
  }[];

/** Les identifiants suivis que l'enclos en cours réclame. */
const currentPenIds = (mock: SupabaseMock): string[] => {
  const pens = storedPens(mock);
  const at = pens.findIndex((pen) => pen.lockedAt === null);
  return at === -1 ? [] : pens[at].units.map((unit) => unit.id).filter((id) => id.includes('-'));
};

test.describe('monture inscrite à un enclos qu’elle ne peut plus rejoindre', () => {
  test('l’écran le dit, et le recalcul la retire sans toucher aux verrouillés', async ({
    page,
  }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    // Le premier verrou fige la fournée entière : c'est l'état dans lequel le
    // défaut existe, et il n'existe que là.
    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen').first()).toBeVisible();

    const verrouille = JSON.stringify(storedPens(mock)[0].units);
    const aVenir = currentPenIds(mock);
    expect(aVenir.length).toBeGreaterThan(0);

    // Rien à signaler tant que l'écurie n'a pas bougé.
    await expect(page.getByTestId('pen-unloadable')).toHaveCount(0);

    /*
     * Le geste de l'éleveur : une monture de l'enclos **à venir** passe stérile.
     * C'est ce que fait « Le clonage n'a pas eu lieu » du relevé d'écurie, et
     * c'est ce qui a produit le cas réel.
     */
    const cible = aVenir[0];
    const ligne = mock.rows(individus).find((row) => row.id === cible)!;
    ligne.fertile = false;
    ligne.cycled = false;

    await page.reload();
    await openLoadTab(page);

    const alerte = page.getByTestId('pen-unloadable');
    await expect(alerte).toBeVisible();
    await expect(alerte).toHaveAttribute('data-count', '1');

    // Le recalcul, demandé et pas subi.
    await alerte.getByRole('button', { name: /Recalculer/ }).click();
    await expect(page.getByTestId('pen-unloadable')).toHaveCount(0);

    // La monture a quitté les enclos à venir…
    expect(currentPenIds(mock)).not.toContain(cible);

    // …et l'enclos verrouillé n'a pas bougé d'une monture. C'est la propriété
    // qui sépare ce recalcul du défaut que le verrou ferme.
    const apres = storedPens(mock);
    expect(apres[0].lockedAt).not.toBeNull();
    expect(JSON.stringify(apres[0].units)).toBe(verrouille);
  });

  test('le vrac et les montures à acheter ne se signalent jamais', async ({ page }) => {
    /*
     * Leurs identifiants sont fabriqués — `couleur#M3` pour du vrac, `couleur+F0`
     * pour un achat — et ne désignent aucune ligne d'écurie : ils portent une
     * quantité ou une intention, pas une monture suivie. Les confronter à
     * `user_breeding_individuals` ferait se signaler toute fournée qui achète,
     * c'est-à-dire presque toutes, et l'avertissement serait mort le jour de sa
     * naissance.
     *
     * Sur cette fixture les achats commencent au **troisième** enclos : on en
     * verrouille donc deux pour que celui en cours en porte. Le test affirme
     * ensuite les deux moitiés d'un coup — sept fabriquées ignorées, une suivie
     * cassée comptée — parce que « aucun avertissement » tout seul passerait au
     * vert sur une règle qui ne marche pas du tout.
     */
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen').first()).toBeVisible();
    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen')).toHaveCount(2);

    const pens = storedPens(mock);
    const at = pens.findIndex((pen) => pen.lockedAt === null);
    expect(at).toBeGreaterThanOrEqual(0);
    const fabriques = pens[at].units.filter((unit) => !unit.id.includes('-'));
    const suivies = pens[at].units.filter((unit) => unit.id.includes('-'));
    expect(fabriques.length).toBeGreaterThan(0);
    expect(suivies.length).toBeGreaterThan(0);

    // Rien ne cloche encore : les fabriquées sont là et ne disent rien.
    await page.reload();
    await openLoadTab(page);
    await expect(page.getByTestId('pen-unloadable')).toHaveCount(0);

    // Une seule suivie cassée, au milieu des fabriquées : une seule signalée.
    const ligne = mock.rows(individus).find((row) => row.id === suivies[0].id)!;
    ligne.fertile = false;
    ligne.cycled = false;

    await page.reload();
    await openLoadTab(page);
    await expect(page.getByTestId('pen-unloadable')).toHaveAttribute('data-count', '1');
  });
});
