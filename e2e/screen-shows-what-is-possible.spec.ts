import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Les six onglets disent-ils tout ce que l'écurie permet ?
 *
 * ## Le trou que ce fichier comble
 *
 * Le dépôt mesure abondamment ce que la politique **compose** : le banc joue le
 * plan, la garde de parité compare deux compositions, onze gardes vérifient des
 * règles. Rien ne mesurait ce qui **arrive à l'écran**.
 *
 * Ce n'est pas une nuance. La panne du 27/08 s'est vécue ainsi : « je viens de
 * sortir 60 montures et l'onglet est passé de 0 à 4 », puis « ça me donne 0
 * accouplement » — 74 fécondes au coffre, 34 accouplements gratuits disponibles,
 * et un écran muet. Il a fallu **quatre** corrections (#299 puis #301) pour la
 * refermer, et vues comme des mécanismes elles n'ont rien en commun : une borne
 * de capacité fausse, un ordre de passes, une seconde borne fausse, et deux
 * comportements corrects qui s'annulaient. Vue de l'éleveur, c'est une seule
 * panne reprise quatre fois.
 *
 * Le banc ne pouvait en voir aucune : `table muldo 60` rend le même score au kama
 * avant et après les deux PR, parce que le simulateur ne remplit jamais son parc.
 * La garde de parité non plus : elle compare le TypeScript au Rust, et les deux
 * portaient la même erreur. **Ce qui n'est mesuré nulle part est ce qui compte le
 * plus** — est-ce que le geste m'a été dit.
 *
 * ## Les deux forces, et pourquoi pas une seule
 *
 * **Le fort** épingle un nombre exact, sur une écurie construite pour que ce
 * nombre se compte à la main. Il attrape une perte silencieuse — l'écran qui
 * propose 2 accouplements là où l'écurie en permet 4.
 *
 * **Le faible** interdit seulement de perdre, en comparant deux états du même
 * écran. Il ne dit rien de l'absolu, mais il ne rougit jamais à tort, ce qui le
 * rend employable sur une écurie réaliste dont personne ne sait calculer
 * l'optimum de tête.
 *
 * Les deux sont nécessaires : le fort seul demanderait de figer six nombres sur
 * une écurie réaliste, et ce dépôt a déjà payé ce prix-là — voir `banked-mounts`,
 * où « 17 avant, 18 après » était le compte d'un champion qui n'existe plus. Le
 * faible seul laisserait passer une politique qui n'annonce que 2 accouplements
 * sur 34, tant qu'elle en annonce 2 partout.
 *
 * ## Ce que chaque onglet compte
 *
 * Les six badges sont exactement « ce qui arrive à l'écran », et c'est pour ça
 * qu'on les lit eux plutôt que le contenu des volets : `mate` les accouplements à
 * saisir, `clone` les paires clonables, `load` les montures à mettre en enclos,
 * `extract` les extractions, `hdv` les montures dont l'ascendance vaut mieux que
 * la couleur, `success` les couleurs qui restent à faire naître.
 *
 * ## Comment ces tests échouent, mesuré
 *
 * En remettant les trois modules de politique d'avant #299 dans l'arbre courant
 * (`ladder-policy.ts`, `policy.ts`, `unit-plan.ts`) :
 *
 * | test | avant #299 | |
 * | --- | --- | --- |
 * | 1 · les comptes exacts, parc vide | 4 | **passe** |
 * | 2 · parc plein | 4 → **0** | rouge |
 * | 3 · solde vide | 4 → **0** | rouge |
 * | 4 · écurie réaliste, parc plein | 14 → **0** | rouge |
 *
 * Le premier passe, et il faut le dire plutôt que de laisser croire qu'il garde
 * la panne du 27/08 : celle-ci était **parc plein**, et parc vide l'ancienne
 * politique appariait déjà les quatre couples. Ce qu'il garde est l'autre
 * direction — une perte silencieuse à venir, l'écran qui proposerait deux
 * accouplements là où l'écurie en permet quatre. Aucune régression connue ne
 * l'exerce ; c'est un absolu, pas un témoin d'un défaut passé.
 *
 * Le troisième garde en plus le défaut trouvé en relisant #299 et #301, corrigé
 * dans le même lot : `settle` facturait le chargement de la Mangeoire dès qu'un
 * croisement existait, alors qu'il achète le carburant des jauges et ne se doit
 * que si un enclos s'ouvre. Vu rouge en remettant `plan.crossings.length === 0`
 * à la place de `placesUsed(mounts, plan) === 0` : « mate : 4 à 3 000 000 kamas,
 * 0 à 1 000 ».
 */

const USER = '00000000-0000-0000-0000-0000000000e2';
const individus = 'user_breeding_individuals';
const montures = 'user_breeding_mounts';
const reglages = 'user_breeding_settings';

type Onglet = 'mate' | 'clone' | 'load' | 'extract' | 'hdv' | 'success';
const ONGLETS: Onglet[] = ['mate', 'clone', 'load', 'extract', 'hdv', 'success'];

/** Le compte affiché sur l'onglet, tel que l'éleveur le lit. */
const badge = async (page: Page, id: Onglet): Promise<number> => {
  const text = await page.getByTestId(`step-${id}`).innerText();
  const count = text.match(/(\d+)\s*$/)?.[1];
  expect(count, `l'onglet ${id} doit porter un compte, il porte « ${text} »`).toBeDefined();
  return Number(count);
};

const tousLesBadges = async (page: Page): Promise<Record<Onglet, number>> => {
  const out = {} as Record<Onglet, number>;
  for (const id of ONGLETS) out[id] = await badge(page, id);
  return out;
};

/**
 * Remplit le parc : charge et verrouille tous les enclos.
 *
 * C'est le geste qui armait la panne du 27/08 — après lui, `places` valait la
 * capacité et toute boucle bornée par elle s'éteignait.
 */
const remplirLeParc = async (page: Page) => {
  await page.getByTestId('step-load').click();
  for (let pen = 0; pen < 10; pen += 1) {
    if ((await page.getByTestId('current-pen').count()) === 0) break;
    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen').nth(pen)).toBeVisible();
  }
};

/* ------------------------------------------------- l'écurie qui se compte -- */

/**
 * Quatre couleurs gen 2, et **exactement deux recettes** entre elles.
 *
 * Énuméré contre `aimsAt` sur l'échelle couronnée, hors du test pour qu'il n'ait
 * pas à réimporter le code qu'il vérifie — un test qui demande la réponse au
 * module qu'il surveille ne surveille rien :
 *
 *     dore_pourpre   × dore_orchidee   → roux
 *     indigo_pourpre × ebene_orchidee  → amande
 *
 * Et rien d'autre : les quatre autres appariements ne nomment aucune couleur, donc
 * l'échelle les refuse. Les deux recettes ne partagent aucune couleur, donc les
 * couples ne se disputent personne.
 */
const RECETTES: [string, [string, string]][] = [
  ['dore_pourpre', ['dore', 'pourpre']],
  ['dore_orchidee', ['dore', 'orchidee']],
  ['indigo_pourpre', ['indigo', 'pourpre']],
  ['ebene_orchidee', ['ebene', 'orchidee']],
];

/**
 * Ce que cette écurie permet, compté à la main.
 *
 * **Accouplements : 4.** Un mâle et une femelle de chacune des quatre couleurs,
 * toutes **fécondes**. Les deux recettes se jouent donc dans les deux sens —
 * `dore_pourpre ♂ × dore_orchidee ♀` et `dore_orchidee ♂ × dore_pourpre ♀`, puis
 * les deux mêmes pour l'autre recette. Quatre couples disjoints qui emploient les
 * huit montures : c'est le couplage maximum, et il ne reste personne.
 *
 * **Clonages : 2.** Quatre stériles nommées, deux par couleur, toutes gen 2.
 * `cloneOptions` apparie deux stériles de même génération et n'en apparie aucune
 * anonyme — d'où les noms. Quatre en font deux paires.
 *
 * **Succès : 120.** Le muldo a 120 couleurs et la fixture n'en a fait naître
 * aucune : le compte est la collection entière. Il ne dépend d'aucun réglage,
 * c'est ce qui en fait un témoin — s'il bouge, c'est le harnais qui a bougé.
 */
const ATTENDU = { mate: 4, clone: 2, success: 120 } as const;

const ecurieQuiSeCompte = () => {
  const rows: Record<string, unknown>[] = [];
  const add = (
    colorId: string,
    parents: [string, string],
    sex: 'M' | 'F',
    fertile: boolean,
    name: string
  ) => {
    rows.push({
      id: `7017-0000-0000-0000-${String(rows.length + 1).padStart(12, '0')}`,
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
      // Les fertiles sont **fécondes** : c'est ce qui rend leurs croisements
      // gratuits, donc inconditionnels. Les stériles ne le sont pas — elles ne
      // s'accouplent plus, elles se clonent.
      cycled: fertile,
    });
  };
  for (const [colorId, parents] of RECETTES) {
    const tag = colorId.slice(0, 3).toUpperCase();
    add(colorId, parents, 'M', true, `G2 ${tag} M`);
    add(colorId, parents, 'F', true, `G2 ${tag} F`);
  }
  for (const [colorId, parents] of RECETTES.slice(0, 2)) {
    const tag = colorId.slice(0, 3).toUpperCase();
    add(colorId, parents, 'M', false, `G2 ${tag} SM`);
    add(colorId, parents, 'F', false, `G2 ${tag} SF`);
  }
  return rows;
};

const poser = async (mock: SupabaseMock, kamas = '3000000') => {
  mock.tables[individus] = ecurieQuiSeCompte() as never;
  mock.tables[montures] = [] as never;
  (mock.tables[reglages] as Record<string, unknown>[])[0].kamas_available = kamas;
};

test.describe('l’écran montre ce que l’écurie permet', () => {
  /**
   * Le fort : les nombres exacts, sur l'écurie qui se compte.
   *
   * Le seul des quatre qui passait déjà avant #299 — voir le tableau de l'en-tête.
   * Il ne garde donc aucune régression connue, et c'est assumé : il garde la
   * direction que rien d'autre ne surveille, celle où l'écran proposerait moins
   * que ce que l'écurie permet sans que personne s'en aperçoive.
   */
  test('les comptes sont ceux que l’écurie permet, et pas moins', async ({ page }) => {
    const mock = await mockSupabase(page);
    await poser(mock);
    await openBreeding(page);
    await expect(page.getByTestId('policy-panel')).toBeVisible();

    const vu = await tousLesBadges(page);
    expect(vu.mate, 'quatre couples disjoints, huit fécondes employées').toBe(ATTENDU.mate);
    expect(vu.clone, 'quatre stériles gen 2 nommées, donc deux paires').toBe(ATTENDU.clone);
    expect(vu.success, 'les 120 couleurs du muldo, aucune éclose').toBe(ATTENDU.success);
  });

  /**
   * Remplir le parc n'enlève rien de ce qui ne le demande pas.
   *
   * C'est la panne du 27/08, épinglée sur les six onglets au lieu du seul qui
   * l'avait révélée. Un accouplement entre deux fécondes, un clonage, une couleur
   * de la collection : aucun de ces trois-là ne passe par un enclos, donc l'état
   * du parc ne doit pas les faire disparaître.
   */
  test('remplir le parc n’enlève aucun geste qui ne coûte pas d’enclos', async ({ page }) => {
    const mock = await mockSupabase(page);
    await poser(mock);
    await openBreeding(page);

    const avant = await tousLesBadges(page);
    await remplirLeParc(page);
    const apres = await tousLesBadges(page);

    for (const id of ['mate', 'clone', 'success'] as const) {
      expect(apres[id], `${id} : ${avant[id]} parc vide, ${apres[id]} parc plein`).toBe(avant[id]);
    }
    // Et les nombres restent les bons, pas seulement égaux à eux-mêmes : deux
    // états d'accord sur une valeur fausse s'accorderaient aussi.
    expect(apres.mate).toBe(ATTENDU.mate);
    expect(apres.clone).toBe(ATTENDU.clone);
  });

  /**
   * Un geste gratuit ne dépend pas de l'argent.
   *
   * La régression du défaut trouvé en relisant #299/#301 : `settle` facturait le
   * chargement de la Mangeoire dès qu'un croisement existait, alors qu'il achète
   * le carburant des jauges et ne se doit **que si un enclos s'ouvre**. Une
   * fournée qui ne fait que marier des fécondes n'en ouvre aucun.
   *
   * Mesuré avant le correctif, sur cette écurie : à 3 000 000 kamas l'écran
   * propose 4 accouplements, à 1 000 kamas il en propose **0** — les quatre
   * disparaissent pour payer un enclos que personne n'ouvre, et l'éleveur retrouve
   * le silence de #299 par la porte de l'argent au lieu de celle des places.
   *
   * `load` n'est pas dans la liste, et c'est voulu : charger un enclos demande
   * d'acheter des gen 1, donc il **doit** dépendre du solde. L'invariant ne porte
   * que sur ce qui est gratuit.
   */
  test('un solde vide n’enlève aucun geste gratuit', async ({ page }) => {
    const riche = await mockSupabase(page);
    await poser(riche, '3000000');
    await openBreeding(page);
    const avecKamas = await tousLesBadges(page);

    const pauvre = await mockSupabase(page);
    await poser(pauvre, '1000');
    await openBreeding(page);
    const sansKamas = await tousLesBadges(page);

    for (const id of ['mate', 'clone', 'success'] as const) {
      expect(
        sansKamas[id],
        `${id} : ${avecKamas[id]} à 3 000 000 kamas, ${sansKamas[id]} à 1 000`
      ).toBe(avecKamas[id]);
    }
    expect(sansKamas.mate).toBe(ATTENDU.mate);
  });

  /**
   * Le faible, sur l'écurie réaliste du dépôt.
   *
   * `muldo-stable.json` porte de quoi alimenter les six onglets — dont
   * `extract` et `hdv`, que l'écurie construite laisse à zéro parce que leurs
   * règles ne se comptent pas à la main : l'extraction dépend des prix relevés et
   * l'HDV d'un raccourci d'ascendance calculé contre tous les partenaires.
   *
   * On n'y épingle donc aucun absolu — ce serait figer un nombre que la politique
   * a le droit de changer. On y interdit la seule direction qui coûte à
   * l'éleveur : **en perdre en remplissant le parc**.
   */
  test('sur une écurie réaliste, remplir le parc ne retire rien des six onglets', async ({
    page,
  }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await expect(page.getByTestId('policy-panel')).toBeVisible();

    const avant = await tousLesBadges(page);
    // Sans quoi le test passerait au vert sur un écran vide.
    expect(
      Object.values(avant).filter((n) => n > 0).length,
      `les six onglets doivent avoir de quoi dire : ${JSON.stringify(avant)}`
    ).toBeGreaterThanOrEqual(5);

    await remplirLeParc(page);
    const apres = await tousLesBadges(page);

    for (const id of ONGLETS) {
      // `load` excepté : une fois les enclos verrouillés, ce qu'il reste à charger
      // a le droit de diminuer — c'est le geste qu'on vient de faire.
      if (id === 'load') continue;
      expect(
        apres[id],
        `${id} : ${avant[id]} parc vide, ${apres[id]} parc plein — un geste a disparu`
      ).toBeGreaterThanOrEqual(avant[id]);
    }
  });
});
