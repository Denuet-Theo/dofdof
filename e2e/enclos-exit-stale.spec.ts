import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding, failureBanner } from './support/breeding';

/**
 * La sortie d'un enclos que l'écurie ne peut plus honorer.
 *
 * ## Ce qui s'est passé le 23/08
 *
 * Une fournée sortie en fécondes au niveau 44, et **dix montures** apparues à
 * l'écurie — exactement les comptées que l'enclos allait chercher à l'achat. Les
 * suivies, elles, n'avaient rien reçu : ni cycle, ni niveau. Aucune bannière,
 * aucune erreur, la fenêtre refermée sur un message vert, et l'enclos retiré de
 * la fournée. Ces montures-là étaient donc encore en enclos dans le jeu,
 * absentes de l'écurie **et** absentes de la fournée — introuvables des deux
 * côtés, ce qui est strictement pire que de n'avoir rien écrit.
 *
 * La cause tenait en une ligne de `recordEnclosExit` :
 *
 *     const mount = known.get(entry.id);
 *     if (!mount || !mount.fertile) continue;
 *
 * `continue`, puis `complete: true`. La fournée se fige au premier verrou et
 * l'écurie, elle, continue de bouger : une monture vendue, sacrifiée ou passée
 * stérile entre le verrou et la sortie tombait dans ce `continue`. #251 avait
 * posé le bandeau « ne peut plus entrer en enclos », mais **seulement sur
 * l'enclos en cours de remplissage** — donc jamais sur un enclos verrouillé,
 * c'est-à-dire jamais sur celui qu'on sort.
 *
 * ## Ce que ces tests tiennent
 *
 * 1. Ce qui peut s'écrire s'écrit, et ce qui ne peut pas **reste dû** : l'enclos
 *    s'allège au lieu de disparaître.
 * 2. L'échec se dit — dans la fenêtre avant le clic, dans la bannière après.
 * 3. Le reclic ne double rien. C'est le deuxième clic qui compte : un enclos
 *    gardé intact aurait réinséré les comptées déjà entrées, et une monture
 *    achetée une fois en serait devenue deux.
 */

const openLoad = async (page: Page) => {
  const tab = page.getByTestId('step-load');
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByTestId('pane-load')).toBeVisible();
};

type Unit = { id: string; colorId: string; sex: string; name: string | null };
type Pen = { units: Unit[]; lockedAt: string | null };

const storedPens = (mock: SupabaseMock) => (mock.rows('breeding_batch')[0]?.pens ?? []) as Pen[];

/**
 * `couleur#M3` pour le vrac, `couleur+F0` pour ce qu'il faut procurer — et aucun
 * uuid ne porte `#` ni `+`. Relu ici plutôt qu'importé de `search.ts` : c'est le
 * contrat rendu par la base qu'on vérifie, pas la fonction qui l'a écrit.
 */
const isCounted = (id: string) => /[#+]/.test(id);

const cycledIds = (mock: SupabaseMock) =>
  new Set(
    mock
      .rows('user_breeding_individuals')
      .filter((row) => row.cycled === true)
      .map((row) => row.id as string)
  );

/**
 * Un enclos verrouillé qui mêle des suivies et des comptées.
 *
 * Les deux familles s'écrivent par des chemins différents — un `insert` pour les
 * comptées, un `update` par niveau pour les suivies — et c'est leur cohabitation
 * dans un même enclos qui a saigné : l'insert passait, les updates se sautaient,
 * et le compte rendu ne parlait que du premier. La fournée que la politique
 * propose sur la fixture range les nommées devant et les anonymes derrière, si
 * bien qu'aucun de ses enclos ne mêle les deux ; on en compose donc un, dans la
 * colonne `jsonb` que l'app relit — c'est exactement ce que `parsePens` promet
 * de savoir lire.
 */
const penMixing = async (page: Page, mock: SupabaseMock) => {
  await openLoad(page);
  for (let count = 1; count <= 10; count += 1) {
    if ((await page.getByTestId('lock-pen').count()) === 0) break;
    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen')).toHaveCount(count);
  }

  const pens = storedPens(mock);
  const tracked = pens.flatMap((pen) => pen.units).filter((unit) => !isCounted(unit.id));
  const counted = pens.flatMap((pen) => pen.units).filter((unit) => isCounted(unit.id));
  expect(tracked.length).toBeGreaterThan(3);
  expect(counted.length).toBeGreaterThan(2);

  const units = [...tracked.slice(0, 4), ...counted.slice(0, 3)];
  (mock.rows('breeding_batch')[0] as { pens: Pen[] }).pens = [
    { units, lockedAt: '2026-08-23T08:00:00.000Z' },
  ];
  return {
    units,
    tracked: tracked.slice(0, 4).map((unit) => unit.id),
    counted: counted.slice(0, 3).map((unit) => unit.id),
  };
};

const openExit = async (page: Page) => {
  await page.getByTestId('locked-pen').first().getByTestId('exit-pen').click();
  await expect(page.getByRole('heading', { name: "Sortir les montures de l'enclos" })).toBeVisible();
};

const confirmExit = async (page: Page, level = 44) => {
  // Le champ « même niveau pour tout le lot » ne s'affiche qu'à partir de deux
  // montures : un enclos réduit à sa dernière n'en a plus, et il faut alors la
  // ligne. C'est précisément l'état où le reclic se joue.
  const forAll = page.getByPlaceholder('ex. 61');
  if ((await forAll.count()) > 0) await forAll.fill(String(level));
  else {
    const rows = page.getByRole('dialog').getByRole('spinbutton');
    for (let index = 0; index < (await rows.count()); index += 1) {
      await rows.nth(index).fill(String(level));
    }
  }
  const confirm = page.getByTestId('exit-cycled');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  // L'écriture est revenue quand le bouton a repris son libellé.
  await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 20_000 });
};

test.describe('sortie d’enclos — l’écurie a bougé sous l’enclos fermé', () => {
  test('ce qui ne peut plus s’écrire reste dû, et se dit', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    const { tracked, counted } = await penMixing(page, mock);

    // L'écurie bouge sous l'enclos fermé, par les deux gestes que l'écran offre :
    // une fertilité corrigée dans « Mes stocks », une monture retirée par
    // l'extraction ou la vente.
    const rows = mock.rows('user_breeding_individuals');
    const [barren, sold] = tracked;
    rows.find((row) => row.id === barren)!.fertile = false;
    mock.tables.user_breeding_individuals = rows.filter((row) => row.id !== sold);

    await page.reload();
    await openLoad(page);
    await expect(page.getByTestId('locked-pen')).toHaveCount(1, { timeout: 30_000 });

    await openExit(page);
    // Dit **avant** le clic : l'apprendre après coup est ce qui a coûté la fournée.
    const notice = page.getByTestId('exit-blocked');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('data-count', '2');

    const before = mock.rows('user_breeding_individuals').length;
    await confirmExit(page);

    // …et dit **après**, fort, au lieu de se refermer sur un message vert.
    await expect(failureBanner(page).first()).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();

    const cycled = cycledIds(mock);
    for (const id of tracked.slice(2)) expect(cycled.has(id)).toBe(true);
    // Ni ressuscitée, ni réinventée.
    expect(cycled.has(barren)).toBe(false);
    expect(mock.rows('user_breeding_individuals').some((row) => row.id === sold)).toBe(false);
    // Les comptées sont bien entrées, une fois chacune.
    expect(mock.rows('user_breeding_individuals').length - before).toBe(counted.length);

    // L'enclos reste dans la fournée, réduit à ce qu'il doit encore.
    await page.getByLabel('Fermer').click();
    await openLoad(page);
    await expect(page.getByTestId('locked-pen')).toHaveCount(1);
    expect(storedPens(mock)[0].units.map((unit) => unit.id).sort()).toEqual(
      [barren, sold].sort()
    );
  });

  test('le reclic ne fait pas entrer deux fois les montures déjà écrites', async ({ page }) => {
    // Le premier clic ne prouve presque rien. Un enclos gardé intact sur une
    // sortie partielle réinsère ses comptées à chaque reclic : l'éleveur qui
    // corrige sa stérile et reclique se retrouve avec deux fois les montures
    // qu'il n'a achetées qu'une seule fois.
    const mock = await mockSupabase(page);
    await openBreeding(page);
    const { tracked, counted } = await penMixing(page, mock);
    const barren = tracked[0];

    mock.rows('user_breeding_individuals').find((row) => row.id === barren)!.fertile = false;

    await page.reload();
    await openLoad(page);
    await expect(page.getByTestId('locked-pen')).toHaveCount(1, { timeout: 30_000 });

    const before = mock.rows('user_breeding_individuals').length;
    await openExit(page);
    await confirmExit(page);
    const afterFirst = mock.rows('user_breeding_individuals').length;
    expect(afterFirst - before).toBe(counted.length);
    await page.getByLabel('Fermer').click();

    // La stérile est corrigée à l'écurie, et on reclique.
    mock.rows('user_breeding_individuals').find((row) => row.id === barren)!.fertile = true;
    await page.reload();
    await openLoad(page);
    await expect(page.getByTestId('locked-pen')).toHaveCount(1, { timeout: 30_000 });

    await openExit(page);
    await confirmExit(page);

    // Pas une ligne de plus : l'enclos ne portait plus que ce qu'il devait.
    expect(mock.rows('user_breeding_individuals').length).toBe(afterFirst);
    expect(cycledIds(mock).has(barren)).toBe(true);
    // Et l'enclos, réglé, quitte la fournée.
    await openLoad(page);
    await expect(page.getByTestId('locked-pen')).toHaveCount(0);
  });
});
