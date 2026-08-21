import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Faire les clonages ne fait pas repousser la liste d'accouplements.
 *
 * ## Ce qui s'est passé le 17/08
 *
 * 18 naissances saisies, puis 24 clonages, puis un rafraîchissement — et
 * l'écran proposait **4 accouplements de plus**. Ils étaient réels : quatre
 * paires de fécondes que la base n'avait jamais vues s'accoupler. Mais le jeu
 * était fermé, et l'éleveur a lu ça comme la liste qui repousse, c'est-à-dire
 * le défaut de #165 revenu par une autre porte.
 *
 * Il n'était pas revenu. `couplesToRecordAll` boucle bien jusqu'au point fixe —
 * saisir les sept qu'elle rend en propose zéro au tour suivant, vérifié sur
 * l'écurie du 17/08. Ce que la boucle ne garantit qu'à **écurie constante**,
 * c'est tout ce qu'elle garantit : l'onglet d'à côté demandait vingt clonages,
 * qui retirent quarante stériles et rendent vingt fertiles, et la politique est
 * une optimisation sur l'écurie entière. Elle réaffectait ses fécondes et
 * publiait des couples gratuits qu'elle avait laissés de côté.
 *
 * Mesuré sur l'export de l'éleveur, à fécondes identiques : **3 accouplements
 * avant les clonages, 7 après**. Un clone ressort fertile et non fécond — il ne
 * peut s'accoupler avec personne — donc les clonages n'avaient rien rendu
 * possible. Ils avaient fait changer d'avis la politique.
 *
 * ## Ce que cette spec verrouille
 *
 * La liste d'accouplements se calcule maintenant sur l'écurie **d'après** les
 * clonages proposés (`afterClonings`). Les exécuter ne doit donc plus rien y
 * changer : même compte, mêmes couples, avant et après.
 *
 * Elle clique les clonages **un par un**, comme l'éleveur, et non par un
 * raccourci d'état : le défaut se joue entre deux écritures, sur une écurie que
 * chaque clic déplace sous les doigts.
 */

const individus = 'user_breeding_individuals';

/**
 * Nomme toutes les stériles avant le chargement — même raison que dans
 * `cloning.spec.ts` : `cloneOptions` n'apparie aucune anonyme, et la fixture
 * n'en propose alors pas assez pour déplacer le plan.
 */
const nameEverySterile = (supabase: SupabaseMock) => {
  let numero = 0;
  for (const mount of supabase.rows(individus)) {
    if (mount.fertile === false && !mount.name) mount.name = `G1 ZZ M AA-BB ${++numero}`;
  }
};

/** Le compte affiché sur un onglet des gestes du jour. `0` quand il n'annonce rien. */
const stepCount = async (page: Page, step: 'mate' | 'clone'): Promise<number> => {
  const text = await page.getByTestId(`step-${step}`).innerText();
  const found = text.match(/(\d+)/);
  return found ? Number(found[1]) : 0;
};

/**
 * Saisit toute la fournée, croisement par croisement, sur la couleur cible.
 *
 * Le carrousel ne montre qu'un croisement à la fois : s'arrêter au premier panneau
 * mesurerait la taille d'un groupe et non celle de la liste.
 */
const recordEveryMating = async (page: Page): Promise<number> => {
  let recorded = 0;
  for (let group = 0; group < 80; group += 1) {
    for (let guard = 0; guard < 80; guard += 1) {
      const sexes = page.getByTestId('mating-panel').locator('button').filter({ hasText: /^[♂♀]$/ });
      const count = await sexes.count();
      let clicked = false;
      // Les deux premiers boutons sont le ♂ et le ♀ de la couleur **cible** : on
      // alterne, ce qui est le rapport des sexes que `projectBirths` projette.
      // Tout saisir en mâles laisse un résidu qui n'a rien à voir avec les
      // clonages — mesuré à 1 ici — et brouillerait ce que cette spec isole.
      const preferred = recorded % 2 === 1 ? [1, 0] : [0, 1];
      for (const index of [...preferred, ...Array.from({ length: count }, (_, i) => i)]) {
        if (index >= count) continue;
        if (await sexes.nth(index).isEnabled()) {
          await sexes.nth(index).click();
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

/** Les couples proposés, tels que l'onglet Accouplement les liste. */
const matePairs = async (page: Page): Promise<string[]> => {
  await page.getByTestId('step-mate').click();
  await expect(page.getByTestId('pane-mate')).toBeVisible();
  return page.getByTestId('pane-mate').innerText().then((text) => text.split('\n'));
};

/**
 * L'écurie de synthèse de `check-record-fixpoint`, portée telle quelle en base.
 *
 * La fixture du 15/08 ne sert pas ici, et c'est mesuré : la saisie y crée bien des
 * clonages, mais aucun accouplement n'y repousse, donc une spec écrite dessus
 * restait **verte avec le défaut remis**. Une garde qui ne rougit pas est pire
 * qu'aucune garde ; on prend donc l'écurie qui porte le cas.
 *
 * Ce qu'elle a de particulier : quatre gen 2 dont deux stériles chacune, et un vrac
 * de gen 1 largement fécond. Saisir la fournée stérilise assez de parents pour
 * apparier deux paires clonables **de plus**, et ce sont elles qui font repousser
 * la liste quand la boucle ne les reprojette pas.
 */
const USER = '00000000-0000-0000-0000-0000000000e2';
const montures = 'user_breeding_mounts';

const GEN1 = ['dore', 'ebene', 'indigo', 'pourpre', 'orchidee'];
const GEN2: [string, [string, string]][] = [
  ['dore_pourpre', ['dore', 'pourpre']],
  ['indigo_pourpre', ['indigo', 'pourpre']],
  ['ebene_pourpre', ['ebene', 'pourpre']],
  ['orchidee_pourpre', ['orchidee', 'pourpre']],
];
const GEN3: [string, [string, string]][] = [
  ['roux', ['dore_pourpre', 'dore_orchidee']],
  ['amande', ['indigo_pourpre', 'ebene_orchidee']],
];

/** Le vrac : six de chaque sexe par gen 1, dont quatre fécondes. */
const bulkRows = () =>
  GEN1.map((colorId) => ({
    user_id: USER,
    family: 'muldo',
    color_id: colorId,
    updated_at: '2026-08-15T12:00:00.000Z',
    males: 6,
    females: 6,
    cycled_males: 4,
    cycled_females: 4,
  }));

const syntheticStable = () => {
  const rows: Record<string, unknown>[] = [];
  const add = (
    colorId: string,
    parents: [string, string],
    sex: 'M' | 'F',
    fertile: boolean,
    cycled: boolean,
    name: string
  ) => {
    rows.push({
      id: `5017-0000-0000-0000-${String(rows.length + 1).padStart(12, '0')}`,
      user_id: USER,
      family: 'muldo',
      color_id: colorId,
      sex,
      level: 100,
      fertile,
      parent_a_color: parents[0],
      parent_b_color: parents[1],
      parent_a_id: null,
      parent_b_id: null,
      created_at: '2026-08-15T12:00:00.000Z',
      updated_at: '2026-08-15T12:00:00.000Z',
      name,
      cycled,
    });
  };
  for (const [colorId, parents] of GEN2) {
    const tag = colorId.slice(0, 3).toUpperCase();
    add(colorId, parents, 'M', true, true, `G2 ${tag} M`);
    add(colorId, parents, 'F', true, true, `G2 ${tag} F`);
    add(colorId, parents, 'M', false, false, `G2 ${tag} S1`);
    add(colorId, parents, 'F', false, false, `G2 ${tag} S2`);
  }
  for (const [colorId, parents] of GEN3) {
    const tag = colorId.slice(0, 3).toUpperCase();
    add(colorId, parents, 'M', true, true, `G3 ${tag} M`);
    add(colorId, parents, 'F', true, true, `G3 ${tag} F`);
  }
  return rows;
};

test.describe('clonages puis accouplements', () => {
  test('exécuter les clonages ne change pas la liste d’accouplements', async ({ page }) => {
    const supabase = await mockSupabase(page);
    nameEverySterile(supabase);
    await openBreeding(page);

    const avant = await stepCount(page, 'mate');
    const clonages = await stepCount(page, 'clone');
    const couplesAvant = await matePairs(page);

    // Sans ces deux-là, la spec passerait au vert sur un écran vide.
    expect(avant).toBeGreaterThan(0);
    expect(clonages).toBeGreaterThan(0);

    await page.getByTestId('step-clone').click();
    await page.getByRole('button', { name: /clonages? à faire/ }).click();
    await expect(page.getByRole('heading', { name: /^Clonage 1 \/ \d+$/ })).toBeVisible();

    // Un clic par clonage, et l'attente du retour de l'écriture : enchaîner sans
    // attendre testerait l'anti-double-clic plutôt que ce qu'on vise.
    for (let fait = 0; fait < clonages; fait += 1) {
      const bouton = page
        .getByTestId('clone-card')
        .first()
        .getByRole('button', { name: /celle-ci qui est sortie|Enregistrer le clonage/ });
      if ((await bouton.count()) === 0) break;
      await bouton.click();
      await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 20_000 });
    }

    await page.keyboard.press('Escape');

    // Les clonages ont bien été écrits : sans ça, « rien n'a changé » ne prouve
    // rien du tout.
    expect(await stepCount(page, 'clone')).toBe(0);

    // Et la liste d'accouplements n'a pas bougé — ni le compte, ni les couples.
    expect(await stepCount(page, 'mate')).toBe(avant);
    expect(await matePairs(page)).toEqual(couplesAvant);
  });

  test('la fournée annonce les clonages qu’elle suppose, et pas seulement ceux du jour', async ({
    page,
  }) => {
    // Le défaut mesuré : la boucle d'accouplements planifie sur une écurie
    // **déjà clonée**, et n'en disait rien. Sur l'écurie du 15/08 elle projetait
    // 203 montures et 20 poulains puis finissait à 201 — vingt-deux clonages tenus
    // pour acquis. L'éleveur saisissait ses accouplements, ne clonait rien parce
    // que personne ne le lui avait demandé, et des accouplements repoussaient.
    //
    // La liste ne repoussait donc pas : elle disait la moitié de ce qu'elle
    // demandait. L'onglet Clonage annonce désormais le total supposé, tout en ne
    // **proposant** que les paires formables aujourd'hui — les autres n'existent
    // pas encore, leurs stériles naîtront de la saisie.
    const supabase = await mockSupabase(page);
    nameEverySterile(supabase);
    await openBreeding(page);

    const proposes = await stepCount(page, 'clone');
    expect(proposes, 'la fixture doit proposer des clonages').toBeGreaterThan(0);

    await page.getByTestId('step-clone').click();
    await expect(page.getByTestId('pane-clone')).toBeVisible();

    const annonce = page.getByTestId('clonings-assumed');
    await expect(annonce).toBeVisible();

    // Le total annoncé dépasse ce qui est proposé, sinon il n'y aurait rien à dire.
    const total = Number((await annonce.innerText()).match(/suppose (\d+)/)![1]);
    expect(total, `annoncé ${total}, proposé ${proposes}`).toBeGreaterThan(proposes);
  });

  test('saisir les accouplements ne fait pas repousser la liste par les clonages qu’ils créent', async ({
    page,
  }) => {
    // Le sens inverse du test ci-dessus, et il manquait.
    //
    // Celui-là dit qu'exécuter les clonages ne bouge pas la liste. Celui-ci dit que
    // **saisir la liste** ne fabrique pas de clonages qui la font repousser — car un
    // accouplement rend ses deux parents stériles, et deux stériles de même
    // génération sont une paire clonable de plus. La boucle du point fixe posait les
    // clonages une seule fois, à l'entrée, donc elle ne voyait jamais arriver ceux
    // que la saisie créait.
    //
    // `check-record-fixpoint` mesure la même chose sur une écurie de synthèse —
    // quatre clonages à l'entrée, six après saisie, quatre couples qui repoussent.
    // Ici c'est l'écran, avec les écritures réelles.
    const supabase = await mockSupabase(page);
    supabase.tables[montures] = bulkRows() as never;
    supabase.tables[individus] = syntheticStable() as never;
    await openBreeding(page);

    const promis = await stepCount(page, 'mate');
    const clonagesAvant = await stepCount(page, 'clone');
    // Sans ça, la spec passerait au vert sur un écran vide.
    expect(promis).toBeGreaterThan(0);

    await page.getByTestId('step-mate').click();
    await expect(page.getByTestId('pane-mate')).toBeVisible();
    await page
      .getByTestId('pane-mate')
      .getByRole('button', { name: /reproductions? à faire/ })
      .click();
    await expect(page.getByRole('heading', { name: 'Ce qui est né' })).toBeVisible();
    const saisis = await recordEveryMating(page);
    await page.keyboard.press('Escape');

    // La fenêtre a délivré ce que l'onglet promettait.
    expect(saisis, 'le bouton promet ce que la fenêtre sait délivrer').toBe(promis);

    // Le mécanisme doit avoir été **exercé** : si la saisie ne crée aucun clonage,
    // ce test ne prouve rien et il faut le dire plutôt que de le lire vert.
    const clonagesApres = await stepCount(page, 'clone');
    expect(
      clonagesApres,
      `clonages avant ${clonagesAvant}, après ${clonagesApres} — la saisie doit en créer`
    ).toBeGreaterThan(clonagesAvant);

    // Et la liste ne repousse pas : tout saisir la vide, clonages neufs compris.
    await page.reload();
    await expect(page.getByRole('button', { name: /montures ·/ })).toBeVisible({ timeout: 30_000 });
    expect(await stepCount(page, 'mate'), 'la liste repousse après la saisie').toBe(0);
  });
});
