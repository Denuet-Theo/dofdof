import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding, failureBanner } from './support/breeding';

/**
 * Une écriture que la base accepte **sans rien changer**.
 *
 * ## Le silence
 *
 * PostgREST rend un succès quand un `update … in(…)` ou un `delete … eq(…)` ne
 * trouve aucune ligne : zéro ligne modifiée n'est pas une erreur SQL. Côté app,
 * `{ error: null }` recouvrait donc deux états opposés — « les dix lignes sont
 * écrites » et « aucune de ces dix lignes n'existe » — et les quinze points
 * d'écriture filtrée lisaient le second comme le premier.
 *
 * Le 23/08, une fournée sortie en fécondes au niveau 44 a rendu six succès et
 * écrit dix lignes sur soixante. Les cinquante suivies étaient à l'écurie,
 * fertiles, comptées juste ; le `PATCH` est parti, la base a répondu sans
 * erreur, et personne n'a demandé combien de lignes il avait changées. La
 * fenêtre s'est refermée sur un message vert, l'enclos a quitté la fournée, et
 * l'état local affichait les montures fécondes — jusqu'au rechargement suivant,
 * qui les remettait fertiles sans rien dire. `reportWriteFailure` ne pouvait pas
 * aider : il n'y avait pas d'erreur à signaler.
 *
 * ## Ce que ces tests jouent
 *
 * L'écran et la base divergent — la seconde ne porte plus les lignes que le
 * premier croit tenir. C'est un état réel : un autre onglet a écrit, une
 * suppression est passée ailleurs, une ligne n'a jamais été écrite. Le faux
 * serveur le reproduit sans rien refuser, ce qu'aucun `refuse()` ne sait faire :
 * il **accepte** et ne touche rien.
 *
 * Le refus, lui, reste couvert par `enclos-exit.spec.ts`. Les deux chemins sont
 * différents et c'est le second qui manquait.
 */

const openLoad = async (page: Page) => {
  const tab = page.getByTestId('step-load');
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByTestId('pane-load')).toBeVisible();
};

type Unit = { id: string };
type Pen = { units: Unit[]; lockedAt: string | null };

const storedPens = (mock: SupabaseMock) => (mock.rows('breeding_batch')[0]?.pens ?? []) as Pen[];
const isCounted = (id: string) => /[#+]/.test(id);

/**
 * Fait disparaître des lignes de la base **sans que l'écran le sache**.
 *
 * Pas de rechargement : c'est tout l'intérêt. L'app garde ces montures dans son
 * écurie en mémoire, les envoie donc à l'écriture, et la base répond « d'accord »
 * en ne touchant rien. Recharger d'abord ferait tomber le cas dans une autre
 * garde — celle qui compare la liste d'enclos à l'écurie connue — et ce n'est
 * pas ce qu'on teste ici.
 */
const vanish = (mock: SupabaseMock, ids: string[]) => {
  const gone = new Set(ids);
  mock.tables.user_breeding_individuals = mock
    .rows('user_breeding_individuals')
    .filter((row) => !gone.has(row.id as string));
};

test.describe('une écriture qui n’a touché aucune ligne', () => {
  test('la sortie d’enclos ne l’annonce pas, et garde l’enclos', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openLoad(page);

    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen')).toHaveCount(1);

    const units = storedPens(mock)[0].units;
    const tracked = units.filter((unit) => !isCounted(unit.id)).map((unit) => unit.id);
    expect(tracked.length).toBeGreaterThan(0);

    // La base perd les lignes ; l'écran, lui, les tient toujours.
    vanish(mock, tracked);

    await page.getByTestId('locked-pen').first().getByTestId('exit-pen').click();
    await expect(page.getByRole('heading', { name: "Sortir les montures de l'enclos" })).toBeVisible();
    await page.getByPlaceholder('ex. 61').fill('44');
    await page.getByTestId('exit-cycled').click();
    await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 20_000 });

    // 1. L'échec se dit. C'est le point : il n'y avait aucune erreur à signaler.
    await expect(failureBanner(page).first()).toBeVisible();

    // 2. La fenêtre ne se referme pas sur un succès.
    await expect(page.getByRole('dialog')).toBeVisible();

    // 3. L'enclos reste dans la fournée. Le retirer aurait rendu ces montures
    //    introuvables : encore en enclos dans le jeu, nulle part dans l'app.
    await page.getByLabel('Fermer').click();
    await openLoad(page);
    await expect(page.getByTestId('locked-pen')).toHaveCount(1);
    expect(storedPens(mock).filter((pen) => pen.lockedAt !== null)).toHaveLength(1);

    // 4. Et rien n'a été inventé pour compenser.
    const cycled = mock.rows('user_breeding_individuals').filter((row) => row.cycled === true);
    expect(cycled.map((row) => row.id as string).filter((id) => tracked.includes(id))).toEqual([]);
  });

  test('un retrait qui ne trouve rien remet la monture à l’écran', async ({ page }) => {
    // Même classe, autre verbe. Une suppression qui ne trouve aucune ligne
    // laissait l'écran vide et la base pleine : la monture revenait au
    // rechargement suivant sans que rien n'ait prévenu — ce que le retour
    // arrière d'un refus fait déjà, et qui manquait pour un silence.
    const mock = await mockSupabase(page);
    await openBreeding(page);

    const stock = page.getByRole('button', { name: /montures ·/ });
    await expect(stock).toBeVisible({ timeout: 30_000 });
    await stock.click();

    const first = page.getByTestId('stock-mount').first();
    await expect(first).toBeVisible({ timeout: 30_000 });
    const shown = await page.getByTestId('stock-mount').count();

    // La base ne porte plus l'écurie du tout — l'écran, lui, l'affiche encore.
    // Quel que soit l'identifiant que le clic enverra, il ne trouvera aucune
    // ligne, et PostgREST répondra « d'accord » sans rien supprimer.
    mock.tables.user_breeding_individuals = [];

    await first.getByTitle("Retirer de l'écurie").click();

    await expect(failureBanner(page).first()).toBeVisible();
    // La monture est remise à l'écran : l'app ne prétend pas l'avoir retirée.
    await expect(page.getByTestId('stock-mount')).toHaveCount(shown);
  });
});
