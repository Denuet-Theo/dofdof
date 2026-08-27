import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding, failureBanner } from './support/breeding';

/**
 * La sortie d'enclos **en fécondes** — le côté qui écrit.
 *
 * `batch-lock.spec.ts` couvre le verrou : ce qui est refermé ne bouge plus, et
 * la fenêtre de sortie propose bien ce lot-là. Il s'arrête à ce que la fenêtre
 * *affiche*. Le bouton « fécondes » y est vérifié visible et jamais cliqué,
 * donc **rien ne testait ce que la sortie écrit** — et c'est l'écriture qui a
 * coûté la matinée du 16/08 : 26 montures passées fécondes sans avoir vu un
 * enclos, et 16 créées de toutes pièces parce que la fournée recalculée
 * réclamait d'autres achats que ceux réellement faits. Le verrou empêche la
 * liste de bouger ; ces tests-ci vérifient que l'écriture suit la liste.
 *
 * Trois propriétés, et la troisième est celle qui saigne :
 *
 * 1. **Exactement** les montures de l'instantané passent fécondes. Pas une de
 *    plus — une féconde de trop est un cycle d'enclos crédité pour rien, que la
 *    politique dépensera en proposant un accouplement que le jeu refusera.
 * 2. Les comptées de l'enclos — vrac et « à procurer » — entrent à l'écurie
 *    suivie avec la couleur et le sexe de l'instantané, ni plus ni moins.
 * 3. Une écriture refusée **n'annonce pas** la sortie et **ne retire pas**
 *    l'enclos de la fournée. C'est la classe des 22 montures : un insert perdu,
 *    une erreur qui part dans une bannière, et une fenêtre qui se ferme en
 *    annonçant un succès. Un enclos retiré sur une écriture perdue est
 *    définitivement introuvable — il n'est plus ni dans la fournée ni à l'écurie.
 */

const openLoadTab = async (page: Page) => {
  const tab = page.getByTestId('step-load');
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByTestId('pane-load')).toBeVisible();
};

type Unit = { id: string; colorId: string; sex: string; name: string | null };
type Pen = { units: Unit[]; lockedAt: string | null };

const storedPens = (mock: SupabaseMock) =>
  (mock.rows('breeding_batch')[0]?.pens ?? []) as Pen[];

/**
 * Une monture **comptée** plutôt que suivie.
 *
 * `search.ts` fabrique `couleur#M3` pour le vrac et `couleur+F0` pour ce qu'il
 * faut procurer. Aucun uuid ne porte `#` ni `+`, donc le test sépare les deux
 * familles comme le fait `parseCountedMountId` — et sans l'importer, pour que
 * ce soit bien le contrat rendu par la base qu'on relit et non la fonction qui
 * l'a écrit.
 */
const isCounted = (id: string) => /[#+]/.test(id);

/**
 * Une monture que le plan se **procure** — `+`, et non `#` du vrac en stock.
 *
 * La distinction décide de ce test : seule une monture procurée doit être
 * **créée** à l'écurie en sortant d'enclos, donc seule elle déclenche l'insert
 * qu'on refuse ici. Une monture de vrac est déjà en stock ; elle ne fait que
 * passer féconde, sans POST, et un refus ne porte alors sur rien.
 *
 * Le test cherchait « comptée » tout court. Ça tenait tant que le champion
 * composait la fournée — ses enclos en portaient toujours une procurée — et ça
 * a cessé quand l'échelle a pris sa place : elle achète beaucoup moins (266
 * achats contre 464 sur la référence), donc l'enclos retenu n'en portait plus.
 * Le refus ne refusait rien, la fenêtre annonçait un succès, et le test tombait
 * sur une assertion qui avait raison de se plaindre.
 */
const isAcquired = (id: string) => id.includes('+');

/** La signature d'une monture comptée : ce que son insertion doit reproduire. */
const signature = (row: { colorId?: string; color_id?: string; sex: string }) =>
  `${row.colorId ?? row.color_id}/${row.sex}`;

const cycledIds = (mock: SupabaseMock) =>
  new Set(
    mock
      .rows('user_breeding_individuals')
      .filter((row) => row.cycled === true)
      .map((row) => row.id as string)
  );

const allIds = (mock: SupabaseMock) =>
  new Set(mock.rows('user_breeding_individuals').map((row) => row.id as string));

/** Referme l'enclos courant et rend l'instantané que la base en garde. */
const lockCurrentPen = async (page: Page, mock: SupabaseMock, expected: number) => {
  await page.getByTestId('lock-pen').click();
  await expect(page.getByTestId('locked-pen')).toHaveCount(expected);
  return storedPens(mock);
};

/**
 * Sort le n-ième enclos verrouillé en fécondes.
 *
 * Le niveau du lot est posé d'abord, et ce n'est pas une commodité de test : le
 * bouton reste **désactivé** tant qu'une monture comptée n'a pas de niveau
 * saisi, parce qu'elle entrerait sinon à l'écurie au niveau 1 et saboterait
 * tous ses croisements suivants. Le piloter sans ça ne testerait que la
 * désactivation.
 *
 * La fenêtre se referme d'elle-même sur confirmation : rien à cliquer après, et
 * son message de succès n'est jamais à l'écran — c'est l'état écrit qui fait
 * foi, pas lui.
 */
const exitAsCycled = async (page: Page, index = 0, level = 61) => {
  await page.getByTestId('locked-pen').nth(index).getByTestId('exit-pen').click();
  await expect(page.getByRole('heading', { name: "Sortir les montures de l'enclos" })).toBeVisible();
  await page.getByPlaceholder('ex. 61').fill(String(level));
  const confirm = page.getByTestId('exit-cycled');
  await expect(confirm).toBeEnabled();
  await confirm.click();
};

test.describe('sortie d’enclos en fécondes', () => {
  test('elle passe fécondes les montures de l’enclos, et aucune autre', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    const pens = await lockCurrentPen(page, mock, 1);
    const units = pens[0].units;
    const tracked = units.filter((unit) => !isCounted(unit.id)).map((unit) => unit.id);
    const counted = units.filter((unit) => isCounted(unit.id));
    expect(tracked.length).toBeGreaterThan(0);

    // L'écurie bouge entre le chargement et la sortie — naissances, achats,
    // clonages. C'est ce qui faisait repropose une **autre** fournée, et sans
    // cette perturbation le test se contenterait de relire ce qu'il vient
    // d'écrire.
    const source = mock.rows('user_breeding_individuals');
    const before = source.length;
    for (let index = 0; index < 40; index += 1) {
      source.push({
        ...source[index % before],
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

    const cycledBefore = cycledIds(mock);
    const idsBefore = allIds(mock);

    await exitAsCycled(page);
    // Une sortie écrite bascule l'écran sur l'accouplement — c'est le moment où de
    // nouveaux croisements deviennent possibles — donc on revient compter les
    // enclos là où ils sont affichés.
    await openLoadTab(page);
    // L'enclos quitte la fournée : la sortie a été écrite.
    await expect(page.getByTestId('locked-pen')).toHaveCount(0);

    const rows = mock.rows('user_breeding_individuals');
    const created = rows.filter((row) => !idsBefore.has(row.id as string));

    // 1. Chaque monture suivie de l'enclos a bien payé son cycle.
    const cycledAfter = cycledIds(mock);
    for (const id of tracked) expect(cycledAfter.has(id)).toBe(true);

    // 2. Et **rien d'autre** n'est devenu fécond. C'est l'assertion qui décrit
    //    le défaut : 26 montures créditées d'un cycle qu'elles n'avaient pas
    //    fait, parce que la fournée avait été recalculée sous l'enclos.
    const allowed = new Set([...tracked, ...created.map((row) => row.id as string)]);
    const wrongly = [...cycledAfter]
      .filter((id) => !cycledBefore.has(id))
      .filter((id) => !allowed.has(id));
    expect(wrongly).toEqual([]);

    // 3. Les comptées entrent à l'écurie, exactement celles de l'instantané.
    expect(created.map((row) => signature(row as never)).sort()).toEqual(
      counted.map(signature).sort()
    );
    // Une monture sortie d'enclos est féconde, et une créée sans ascendance
    // n'a pas de nom : en inventer un désignerait une monture introuvable en jeu.
    for (const row of created) {
      expect(row.cycled).toBe(true);
      expect(row.name ?? null).toBeNull();
    }
  });

  test('deux enclos sortis d’affilée écrivent chacun le sien', async ({ page }) => {
    // Le premier clic ne prouve presque rien : c'est la deuxième sortie, une
    // fois que la première a changé l'écurie dessous, qui rejoue la fournée de
    // dix-sept places. La régression qui a suivi le premier correctif
    // n'apparaissait qu'au deuxième enclos.
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    await lockCurrentPen(page, mock, 1);
    const pens = await lockCurrentPen(page, mock, 2);
    const second = pens[1].units.filter((unit) => !isCounted(unit.id)).map((unit) => unit.id);
    expect(second.length).toBeGreaterThan(0);

    await exitAsCycled(page, 0);
    await openLoadTab(page);
    await expect(page.getByTestId('locked-pen')).toHaveCount(1);

    const cycledBefore = cycledIds(mock);
    const idsBefore = allIds(mock);

    await exitAsCycled(page, 0);
    await openLoadTab(page);
    await expect(page.getByTestId('locked-pen')).toHaveCount(0);

    const created = mock
      .rows('user_breeding_individuals')
      .filter((row) => !idsBefore.has(row.id as string));
    const cycledAfter = cycledIds(mock);
    for (const id of second) expect(cycledAfter.has(id)).toBe(true);

    const allowed = new Set([...second, ...created.map((row) => row.id as string)]);
    const wrongly = [...cycledAfter]
      .filter((id) => !cycledBefore.has(id))
      .filter((id) => !allowed.has(id));
    expect(wrongly).toEqual([]);
  });

  test('un insert refusé n’annonce pas la sortie et laisse l’enclos verrouillé', async ({
    page,
  }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    // Il faut un enclos qui **procure** quelque chose, sinon aucune insertion
    // n'est tentée et le refus ne porte sur rien.
    let index = 0;
    let pens = await lockCurrentPen(page, mock, 1);
    while (pens[index].units.every((unit) => !isAcquired(unit.id))) {
      index += 1;
      expect(index).toBeLessThan(10);
      pens = await lockCurrentPen(page, mock, index + 1);
    }
    const acquired = pens[index].units.filter((unit) => isAcquired(unit.id));
    expect(acquired.length).toBeGreaterThan(0);

    const lockedBefore = await page.getByTestId('locked-pen').count();
    const idsBefore = allIds(mock);

    mock.refuse({ table: 'user_breeding_individuals', method: 'POST' });
    await exitAsCycled(page, index);
    // L'échec se dit à l'écran…
    await expect(failureBanner(page)).toBeVisible();
    // …et pas une monture comptée n'est entrée à l'écurie.
    expect(
      mock.rows('user_breeding_individuals').filter((row) => !idsBefore.has(row.id as string))
    ).toEqual([]);

    // La fenêtre **reste ouverte**, et elle ne dit pas que c'est fait. Se fermer
    // sur une bannière reléguée ailleurs est la forme exacte qui a coûté 22
    // montures : l'éleveur voit un geste accompli et passe au suivant.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    /*
     * **Pas un mot de succès**, plutôt qu'une phrase d'échec précise.
     *
     * L'assertion cherchait « rien n'a été enregistré ». Elle tenait tant que le
     * champion composait la fournée ; l'échelle met dans l'enclos une monture
     * procurée sans niveau, donc après le refus la fenêtre se réaffiche sur sa
     * validation — « pose le niveau du lot » — et la ligne d'état cède la place.
     * L'échec, lui, est bien dit : la bannière le porte, et le test l'exige
     * au-dessus.
     *
     * Ce que la garde doit interdire est l'inverse : **annoncer que c'est fait**.
     * C'est la forme exacte qui a coûté 22 montures — la fenêtre se ferme sur un
     * succès, l'éleveur passe au suivant. On l'épingle donc en négatif, ce qui ne
     * dépend pas de la phrase que le rendu choisit.
     */
    await expect(dialog).not.toContainText(/monture[s]? sortie/);
    /*
     * Le bouton n'est **pas** exigé actif. Il l'était dans l'assertion d'origine,
     * et c'est trop fort : après le refus la fenêtre redemande le niveau de la
     * monture procurée, donc elle le désactive à bon droit — refuser de partir
     * sans niveau est le comportement voulu, pas un blocage.
     *
     * Ce qui compte est que rien ne devienne irrattrapable, et les deux
     * assertions ci-dessous le disent mieux : l'enclos reste verrouillé **en
     * base** et **à l'écran**.
     */

    // Et l'enclos reste dans la fournée, donc rattrapable. C'est la vérité :
    // ces montures sont encore en enclos dans le jeu. Le retirer ici les
    // rendrait introuvables des deux côtés.
    expect(storedPens(mock).filter((pen) => pen.lockedAt !== null)).toHaveLength(lockedBefore);
    await dialog.getByLabel('Fermer').click();
    await openLoadTab(page);
    await expect(page.getByTestId('locked-pen')).toHaveCount(lockedBefore);
  });
});
