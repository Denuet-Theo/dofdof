import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding, recordBirthOn } from './support/breeding';

/**
 * Le verrou d'enclos — le défaut que plusieurs joueurs ont remonté.
 *
 * « On lance des fournées, on les retire plusieurs heures plus tard, et ce ne
 * sont plus les mêmes qui sont dedans. » Ce n'était pas une impression : la
 * fournée était **recalculée** à chaque rendu depuis l'écurie du moment. Entre
 * le chargement et la sortie, l'écurie bouge — naissances saisies, achats,
 * clonages — donc la politique reproposait une autre fournée, et « Les sortir de
 * l'enclos » offrait des montures qui n'y étaient jamais entrées. Le lot
 * réellement en enclos, lui, restait fertile pour l'app.
 *
 * La propriété qui compte, et la seule : **ce qui est verrouillé ne bouge
 * plus**. Ni quand l'écurie change, ni quand la page est rechargée, ni quand la
 * politique change d'avis.
 *
 * ## Comment ce test échoue sans le correctif
 *
 * Avant, il n'y avait pas de verrou du tout : le bouton `lock-pen` n'existe pas
 * et le premier `expect` échoue. Avec un verrou qui ne figerait que l'affichage
 * — sans instantané en base — c'est le rechargement qui le prend : la liste
 * revient de la politique et le contenu diffère.
 */

/** Ouvre l'onglet « Fournée » du panneau de politique. */
const openLoadTab = async (page: Page) => {
  const tab = page.getByTestId('step-load');
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByTestId('pane-load')).toBeVisible();
};

/** Ce que l'enclos en cours annonce, ligne à ligne — l'empreinte de son contenu. */
const currentPenLines = async (page: Page): Promise<string[]> => {
  const pen = page.getByTestId('current-pen');
  await expect(pen).toBeVisible();
  const named = await pen.getByTestId('load-named').allInnerTexts();
  const anonymous = await pen.getByTestId('load-anonymous').allInnerTexts();
  return [...named, ...anonymous].map((line) => line.replace(/\s+/g, ' ').trim());
};

/** La fournée telle que la base la tient. */
const storedPens = (mock: SupabaseMock) =>
  (mock.rows('breeding_batch')[0]?.pens ?? []) as { units: unknown[]; lockedAt: string | null }[];

/**
 * Vérifie que la sortie du premier enclos verrouillé propose **ces**
 * montures-là, nommément.
 *
 * L'assertion sur la base ne suffit pas, et c'est le piège de ce correctif : un
 * écran qui garderait le verrou en pastille tout en recalculant la liste en
 * dessous laisserait l'instantané intact en base et mentirait quand même à
 * l'éleveur. C'est la demi-correction la plus tentante, donc chaque test qui
 * bouscule l'écurie la vérifie.
 */
const exitDialogLists = async (page: Page, lines: string[]) => {
  await page.getByTestId('locked-pen').first().getByTestId('exit-pen').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  let checked = 0;
  for (const line of lines) {
    const name = line.match(/[A-Z]\d+ [A-Z]+ [MF] [A-Z-]+/)?.[0];
    if (!name) continue;
    await expect(dialog.getByText(name, { exact: true }).first()).toBeVisible();
    checked += 1;
  }
  // Sans un seul nom à comparer, le test ne prouverait rien.
  expect(checked).toBeGreaterThan(0);
};

test.describe('verrou d’enclos', () => {
  test('un enclos verrouillé garde son contenu après rechargement', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    const before = await currentPenLines(page);
    expect(before.length).toBeGreaterThan(0);

    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen').first()).toBeVisible();

    // La fournée **entière** part en base au premier verrou, pas seulement
    // l'enclos refermé : sans ça les suivants se recalculeraient, soit le même
    // défaut décalé d'un enclos.
    const stored = storedPens(mock);
    expect(stored.length).toBeGreaterThan(1);
    expect(stored[0].lockedAt).not.toBeNull();
    expect(stored.slice(1).every((pen) => pen.lockedAt === null)).toBe(true);
    const frozen = JSON.stringify(stored[0].units);

    // Le rechargement est le geste qui révélait le défaut : c'est en revenant
    // des heures plus tard qu'on découvrait une autre fournée.
    await page.reload();
    await openLoadTab(page);

    const locked = page.getByTestId('locked-pen').first();
    await expect(locked).toBeVisible({ timeout: 30_000 });
    await expect(locked).toContainText('Enclos 1');

    // Le contenu figé est **le même**, à la monture près — l'instantané n'a pas
    // été relu à travers la politique.
    expect(JSON.stringify(storedPens(mock)[0].units)).toBe(frozen);

    // Et c'est bien ce lot-là que la sortie propose, nommément.
    await locked.getByTestId('exit-pen').click();
    await expect(
      page.getByRole('heading', { name: "Sortir les montures de l'enclos" })
    ).toBeVisible();
    const names = stored[0].units
      .map((unit) => (unit as { name: string | null }).name)
      .filter((name): name is string => name !== null);
    for (const name of [...new Set(names)].slice(0, 5)) {
      await expect(page.getByRole('dialog').getByText(name, { exact: true }).first()).toBeVisible();
    }
  });

  test('l’enclos verrouillé ne suit pas une écurie qui grossit sous lui', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    const loaded = await currentPenLines(page);
    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen').first()).toBeVisible();
    const frozen = JSON.stringify(storedPens(mock)[0].units);
    const proposedBefore = JSON.stringify(storedPens(mock).slice(1));

    // L'écurie bouge : quarante montures fertiles de plus, ce qu'une matinée de
    // naissances et d'achats produit. La politique en tire une autre fournée —
    // c'est justement le point.
    const source = mock.rows('user_breeding_individuals');
    for (let index = 0; index < 40; index += 1) {
      mock.rows('user_breeding_individuals').push({
        ...source[index % source.length],
        id: `grown-${index}`,
        name: null,
        level: 100,
        fertile: true,
        cycled: false,
      });
    }

    await page.reload();
    await openLoadTab(page);
    await expect(page.getByTestId('locked-pen').first()).toBeVisible({ timeout: 30_000 });

    // Ni l'enclos refermé ni les enclos à venir n'ont bougé. Les seconds
    // comptent autant que le premier : ne figer que le verrouillé laisserait la
    // fournée se réécrire d'un chargement à l'autre.
    expect(JSON.stringify(storedPens(mock)[0].units)).toBe(frozen);
    expect(JSON.stringify(storedPens(mock).slice(1))).toBe(proposedBefore);
    await expect(page.getByTestId('current-pen')).toContainText('Enclos 2');
    await exitDialogLists(page, loaded);
  });

  test('l’enclos verrouillé ne suit pas une écurie qui maigrit sous lui', async ({ page }) => {
    // Le sens qui fait vraiment mal : la politique ne peut plus proposer ce
    // qu'elle proposait, donc une fournée recalculée **perdait** des montures.
    // Elles restaient en enclos dans le jeu et fertiles dans l'app — introuvables
    // des deux côtés.
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    const loaded = await currentPenLines(page);
    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen').first()).toBeVisible();
    const frozen = JSON.stringify(storedPens(mock)[0].units);

    // La moitié de l'écurie devient stérile : la politique n'a plus de quoi
    // former les mêmes couples.
    const rows = mock.rows('user_breeding_individuals');
    for (let index = 0; index < rows.length; index += 2) rows[index].fertile = false;

    await page.reload();
    await openLoadTab(page);
    await expect(page.getByTestId('locked-pen').first()).toBeVisible({ timeout: 30_000 });
    expect(JSON.stringify(storedPens(mock)[0].units)).toBe(frozen);
    await exitDialogLists(page, loaded);
  });

  test('saisir des naissances ne réécrit pas l’enclos verrouillé', async ({ page }) => {
    // Le parcours réel, et celui qui a été remonté : on verrouille les enclos,
    // puis on saisit dans la foulée ce qui est né du tour précédent. Chaque
    // naissance stérilise deux parents et ajoute un poulain, donc la politique
    // repropose une autre fournée à **chaque clic** — c'est exactement le
    // moment où l'enclos changeait de contenu sous les doigts.
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    const loaded = await currentPenLines(page);
    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen').first()).toBeVisible();
    const frozen = JSON.stringify(storedPens(mock)[0].units);
    // Le compte affiché, pas tout le texte : la ligne porte aussi « chargé il y
    // a … », qui est un compteur et doit bouger.
    const count = (await page.getByTestId('locked-pen').first().innerText()).match(
      /(\d+) montures?/
    )![1];

    // Trois naissances : une seule ne prouve rien, la fournée ne se réordonne
    // qu'une fois l'écurie réellement entamée.
    await page.getByTestId('step-mate').click();
    await page.getByRole('button', { name: /reproductions? à faire/ }).click();
    await expect(page.getByRole('heading', { name: 'Ce qui est né' })).toBeVisible();

    // Une par croisement, en avançant de carte en carte : un croisement dont
    // tous les couples ont leur résultat n'accepte plus de clic, et c'est ce
    // qu'on veut — trois écritures réparties, pas trois sur la même ligne.
    for (let index = 0; index < 3; index += 1) {
      await recordBirthOn(page.getByTestId('mating-panel').first());
      await page.getByTestId('next-cross').click();
    }
    await page.getByRole('button', { name: 'Fermer' }).last().click();

    // L'écurie a bien bougé — sinon le test ne prouverait rien.
    expect(mock.writes.filter((write) => write.method === 'PATCH').length).toBeGreaterThan(0);

    await openLoadTab(page);
    expect(JSON.stringify(storedPens(mock)[0].units)).toBe(frozen);
    await expect(page.getByTestId('locked-pen').first()).toContainText(`${count} monture`);
    await exitDialogLists(page, loaded);
  });

  test('on verrouille les enclos un par un, jamais deux à la fois', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    // Un seul enclos à l'écran : c'est le geste réel — on en remplit un, on le
    // referme, on passe au suivant. La liste des cinq faisait perdre le fil.
    await expect(page.getByTestId('current-pen')).toHaveCount(1);
    await expect(page.getByTestId('locked-pen')).toHaveCount(0);

    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen')).toHaveCount(1);
    await expect(page.getByTestId('current-pen')).toHaveCount(1);
    await expect(page.getByTestId('current-pen')).toContainText('Enclos 2');

    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen')).toHaveCount(2);

    const stored = storedPens(mock);
    expect(stored.filter((pen) => pen.lockedAt !== null)).toHaveLength(2);
    expect(stored.filter((pen) => pen.lockedAt === null).length).toBeGreaterThan(0);
  });

  test('un verrou refusé par la base ne s’affiche pas comme verrouillé', async ({ page }) => {
    // La classe « écriture optimiste sans retour arrière » : l'écran ne doit
    // jamais affirmer un verrou que la base n'a pas pris. Un enclos affiché
    // verrouillé sur une écriture perdue est pire que le bug d'origine —
    // l'éleveur l'a vu confirmé, et il redeviendra « à charger » au
    // rechargement suivant.
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    mock.refuse({ table: 'breeding_batch', method: 'POST' });
    await page.getByTestId('lock-pen').click();

    await expect(page.locator('[role="alert"]').filter({ hasText: 'Pas enregistré' })).toBeVisible();
    await expect(page.getByTestId('locked-pen')).toHaveCount(0);
    await expect(page.getByTestId('current-pen')).toContainText('Enclos 1');
    expect(mock.rows('breeding_batch')).toHaveLength(0);
  });

  test('la sortie propose fertile ou féconde', async ({ page }) => {
    // « Les sortir de l'enclos » n'avait qu'une issue : féconde. Or on referme
    // aussi un enclos par erreur, ou trop tôt — et passer alors le lot en
    // fécondes ferait tenter des croisements que le jeu refuse, cycle non payé.
    await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    await page.getByTestId('lock-pen').click();
    await page.getByTestId('locked-pen').first().getByTestId('exit-pen').click();

    await expect(page.getByTestId('exit-cycled')).toBeVisible();
    await expect(page.getByTestId('exit-fertile')).toBeVisible();
    await expect(page.getByTestId('exit-fertile')).toBeEnabled();
  });

  test('sortir en fertile n’écrit rien sur les montures', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen').first()).toBeVisible();

    const cycledBefore = mock
      .rows('user_breeding_individuals')
      .filter((row) => row.cycled === true).length;

    await page.getByTestId('locked-pen').first().getByTestId('exit-pen').click();
    await page.getByTestId('exit-fertile').click();

    // L'enclos quitte la fournée…
    await expect(page.getByTestId('locked-pen')).toHaveCount(0);
    // …et pas une monture n'a changé d'état. C'est la définition de l'annulation.
    expect(
      mock.rows('user_breeding_individuals').filter((row) => row.cycled === true).length
    ).toBe(cycledBefore);
  });
});
