/**
 * La composition d'une fournée, cherchée au lieu d'être triée.
 *
 * Portage de `rust/breeding-sim/src/search.rs`. Quatrième et dernière pièce, après
 * `network.ts` (l'arithmétique), `census.ts` (ce qu'on lui donne à lire) et
 * `PairDelta` (ce qu'un croisement fait à l'écurie). Celle-ci est la plus longue
 * mais la moins risquée : tout ce qu'elle manipule est déjà porté et verrouillé.
 *
 * ## Il n'y a pas de score par coup
 *
 * `scoreOf` notait chaque appariement isolément, triait, et remplissait le parc
 * par ordre décroissant — la vingt-cinquième décision ignorait donc les
 * vingt-quatre précédentes. Ici il y a une **composition** — un ensemble de
 * croisements, d'achats, de fécondations, de clonages et de sacrifices — et une
 * fonction de valeur qui juge **l'écurie que la fournée laisse derrière elle**.
 *
 * C'est ce qui la sort de la myopie : une gen 9 gardée en réserve avec sa
 * partenaire de lignée ne rapporte aucun kama et ne gagne aucune génération, donc
 * aucun score par coup ne peut la valoriser. Une fonction de l'état, si.
 *
 * ## Une montée de colline, pas un glouton
 *
 * Un glouton par emplacement demanderait, à chaque place, d'évaluer tous les
 * candidats. On tire donc des **mutations au hasard** — ajouter, retirer, échanger
 * une action — et on garde ce qui améliore. Le tirage est uniforme sur ce qui est
 * disponible : aucune heuristique de qualité ne sert à élaguer, sans quoi on
 * réintroduirait par la porte de derrière exactement ce qu'on cherche à faire
 * découvrir.
 *
 * ## Pourquoi c'est reproductible
 *
 * `random.ts` et `breeding_sim::economy::Rng` sont le même Mulberry32 sur `u32`.
 * À écurie, graine et stratégie égales, cette recherche tire donc **la même suite
 * de mutations** que la recherche Rust et rend le même plan — c'est ce que
 * `check-search.mjs` vérifie, et c'est pour ça qu'il compare des plans entiers
 * plutôt que des nombres à une tolérance près.
 *
 * Toute la conséquence tient dans l'ordre des tirages. Un `rng()` de plus ou de
 * moins, même sur une branche qui ne sert à rien, décale la suite et fait diverger
 * les deux recherches sans qu'aucune des deux soit fausse. C'est pourquoi ce
 * fichier suit `search.rs` pas à pas, jusqu'aux branches qui rendent `null`.
 *
 * ## L'économie vient de l'app
 *
 * Le Rust n'a besoin ni de l'écurie de l'éleveur ni de ses prix : il produit des
 * poids. Ici on lit l'écurie saisie dans l'app et les prix du jour — d'où
 * `loadKamas`, qu'on **fournit** au lieu de le recalculer, puisque le coût d'un
 * chargement dépend des jauges et de leurs cours.
 */

import {
  applyCrossing,
  censusOf,
  cloning,
  cycle,
  pairDelta,
  purchase,
  sacrifice,
  MAX_GENERATION,
  type Census,
  type EconomyView,
  type PairDelta,
} from './census';
import { carriedGeneration } from './naming';
import { BULK_MATE_LEVEL, canonicalParents, type Mate } from './pairing';
import type { BreedingColor } from './costs';
import { cycledOf, type Individual, type Sex, type Stable } from './stable';

/**
 * Les réglages qui ne viennent pas de la recherche.
 *
 * Côté Rust ils vivent dans le génome : une bande rapide ne se justifie que par
 * les chargements supplémentaires qu'elle laisse faire, un bénéfice qui
 * n'apparaît nulle part dans l'écurie que le chargement laisse derrière lui.
 */
export type SearchStrategy = {
  /** Niveau de la **fournée**, que la Mangeoire monte d'un bloc. */
  level: number;
  /** Acheter une Optimakina à partir de cette génération visée. 11 = jamais. */
  optimakinaFrom: number;
};

/** Ce que la recherche voit quand une unité se libère. */
export type SearchView = {
  /** L'écurie à plat. Les indices du plan rendu s'y rapportent. */
  mounts: Individual[];
  colors: BreedingColor[];
  generations: Map<string, number>;
  economy: EconomyView;
  strategy: SearchStrategy;
  kamas: number;
  /** **Places d'enclos** disponibles, dix par enclos — et non des croisements. */
  capacity: number;
  /** Ce que coûte le chargement, dès qu'une place est occupée. */
  loadKamas: number;
};

/**
 * Ce qu'on met dans une unité qui se libère.
 *
 * Les indices sont **virtuels** : les achats sont ajoutés d'abord, si bien qu'une
 * monture achetée porte l'indice `mounts.length + j` et peut servir de parent dans
 * le même chargement.
 */
export type UnitPlan = {
  purchases: [string, Sex][];
  clonings: [number, number][];
  crossings: [number, number][];
  /** Une Optimakina par croisement, en regard de `crossings`. */
  optimakina: boolean[];
  /** Créditées **avant** les dépenses, pour qu'un chargement se finance. */
  sacrifices: number[];
  /**
   * Montures mises en enclos **sans être croisées** : elles en sortent fécondes et
   * restent en écurie.
   *
   * C'est la fécondité mise en banque, et elle ne se périme pas — une monture citée
   * ici occupe une place mais ne consomme pas sa reproduction.
   */
  cycles: number[];
};

export const emptyPlan = (): UnitPlan => ({
  purchases: [],
  clonings: [],
  crossings: [],
  optimakina: [],
  sacrifices: [],
  cycles: [],
});

/** Ce qui juge une écurie. C'est la seule chose que la neuroévolution remplace. */
export type ValueFn = (census: Census) => number;

/**
 * La valeur myope : ce que l'écurie rendrait si on liquidait tout de suite.
 *
 * Sans aucun réglage — c'est littéralement la fonction de score de la partie. Elle
 * sert de témoin : une valeur apprise qui ne la bat pas n'a rien appris que
 * l'arithmétique ne donnait déjà.
 */
export const myopic: ValueFn = (census) => census.kamas + census.liquidation;

/**
 * Une sonde linéaire sur **tous** les champs du recensement. Elle n'existe que
 * pour `check-search.mjs`, en regard de `Census::linear_probe` côté Rust.
 *
 * Ce garde-fou compare des plans entiers, donc les deux recherches doivent prendre
 * exactement les mêmes décisions d'acceptation. Le champion y arrive, mais il ne
 * dit pas *où* il regarde : sa note résume les 74 entrées en un nombre, et deux
 * erreurs opposées s'y annulent.
 *
 * La valeur myope ne convient pas non plus, pour la raison inverse : elle ne lit
 * que `kamas` et `liquidation`, si bien qu'une erreur sur `cycledMales` ou sur
 * `carried` lui est invisible — c'est ce trou-là qui a laissé vivre le débordement
 * de `cyclableFree` que `available` décrit.
 *
 * Celle-ci touche chaque champ, chaque génération et chaque couleur, et n'emploie
 * que `*` et `+`, qui sont correctement arrondis. Même plan des deux côtés ⇒ même
 * recensement, champ par champ, sur les quatre cents mutations.
 *
 * Les poids n'ont aucun sens d'élevage : ils sont seulement distincts, pour
 * qu'aucune permutation entre deux champs ne se compense.
 */
export const linearProbe =
  (colors: BreedingColor[]): ValueFn =>
  (census) => {
    let sum = census.kamas * 1e-6 + census.liquidation * 1e-6 + census.headcount;
    for (let generation = 0; generation <= MAX_GENERATION; generation += 1) {
      const weight = generation + 1;
      sum += census.fertileMales[generation] * weight;
      sum += census.fertileFemales[generation] * (weight + 11);
      sum += census.steriles[generation] * (weight + 23);
      sum += census.carried[generation] * (weight + 37);
      sum += census.cycledMales[generation] * (weight + 53);
      sum += census.cycledFemales[generation] * (weight + 71);
    }
    // Dans l'ordre du catalogue : côté Rust `held` est indexé par couleur, ici
    // c'est une `Map`, et seul cet ordre-là est commun aux deux.
    for (const [index, color] of colors.entries()) {
      sum += (census.held.get(color.id) ?? 0) * (index + 1);
    }
    return sum;
  };

export type SearchConfig = {
  /** Mutations tirées par fournée. */
  iterations: number;
  /**
   * Proposer des sacrifices, c'est-à-dire l'extraction en ambre.
   *
   * On ferme l'action dans la recherche plutôt qu'en filtrant le plan après coup :
   * filtrer laisserait le recensement porter un sacrifice qui n'a pas lieu, et la
   * fonction de valeur jugerait alors une écurie qui n'existe pas.
   */
  sacrifices: boolean;
  /**
   * Proposer d'**acheter** des gen 1 pour compléter une fournée.
   *
   * Fermé dans le navigateur, et pour une raison qui ne se lit pas dans le
   * modèle : une monture achetée arrive **fertile**, jamais féconde. Elle doit
   * donc un cycle de jauges complet avant de pouvoir s'accoupler — un enclos, du
   * carburant, des heures — là où l'éleveur demandait « commence par ce que je
   * peux faire avec mon stock ». Proposer l'achat en premier geste, c'est
   * répondre à côté de la question posée.
   *
   * On ferme l'action dans la recherche plutôt qu'en filtrant le plan après
   * coup, exactement comme  : filtrer laisserait le recensement
   * porter des achats qui n'ont pas lieu, et le réseau jugerait une écurie qui
   * n'existe pas.
   */
  purchases?: boolean;
};

export const DEFAULT_SEARCH: SearchConfig = {
  iterations: 1500,
  sacrifices: true,
  purchases: true,
};

/* ------------------------------------------------------------- l'inventaire -- */

/**
 * Des montures interchangeables : même couleur, même ascendance, même sexe — et
 * **même état de cycle**.
 *
 * Le cycle entre dans la clé parce qu'il change le prix et non la cible : deux
 * Doré de même ascendance visent la même chose, mais celle qui doit encore son
 * cycle coûte une place d'enclos et l'autre non. Les confondre ferait choisir au
 * hasard entre gratuit et payant.
 */
type Group = {
  sex: Sex | null;
  generation: number;
  carried: number;
  colorId: string;
  parents: [string, string] | null;
  value: number;
  /** Son cycle de fécondité est payé : elle s'accouple sans passer par l'enclos. */
  cycled: boolean;
  members: number[];
};

/** D'où vient une monture engagée dans un croisement. */
type Side =
  /** Un groupe de l'écurie, désigné par son indice. */
  | { have: number }
  /** Un gen 1 anonyme qu'on achète pour l'occasion. */
  | { buy: string };

type Candidate = {
  male: Side;
  female: Side;
  delta: PairDelta;
};

type Action =
  | { kind: 'cross'; index: number }
  /** Deux groupes stériles de même génération. Égaux si le clone est sûr. */
  | { kind: 'clone'; a: number; b: number }
  | { kind: 'sacrificeFertile'; group: number }
  | { kind: 'sacrificeSterile'; group: number }
  /**
   * Mettre une fertile en enclos **sans la croiser** : elle en sort féconde et
   * reste en écurie.
   *
   * C'est la seule action réellement nouvelle du découplage, et elle n'a de sens
   * que parce que la fécondité ne se perd qu'à la naissance. Une place occupée
   * ainsi n'est pas un croisement de moins : c'est un croisement de plus **au tour
   * suivant**, gratuit, dès que le partenaire existe.
   */
  | { kind: 'cycle'; group: number };

type State = {
  census: Census;
  actions: Action[];
  fertileFree: number[];
  sterileFree: number[];
  /**
   * Combien de chaque groupe fertile reste **à féconder** dans cette fournée.
   *
   * Distinct de `fertileFree` : féconder ne consomme pas la monture, elle reste
   * disponible pour un croisement — mais on ne peut pas la féconder deux fois, et
   * sans ce compteur la recherche gaspillerait des places à repayer un cycle déjà
   * payé.
   */
  cyclableFree: number[];
  crossings: number;
  /**
   * Places d'enclos engagées.
   *
   * C'est la **vraie** contrainte, et elle a remplacé le compte de croisements. Un
   * croisement paie une place par parent qui doit encore son cycle : deux fertiles
   * coûtent deux places comme avant, deux fécondes n'en coûtent aucune. Compter les
   * croisements plafonnait donc quelque chose qui n'est pas rare — l'accouplement
   * est un clic — au lieu de ce qui l'est : l'enclos.
   */
  places: number;
  /**
   * Les Optimakina engagées, suivies à part : leur prix dépend du rang visé par
   * chaque croisement, donc il ne se déduit pas du nombre de places.
   */
  optimakinaCost: number;
};

type Mutation =
  | { kind: 'add'; action: Action }
  | { kind: 'remove'; at: number; old: Action }
  | { kind: 'swap'; at: number; old: Action; next: Action };

/**
 * Le moteur, réutilisé d'une fournée à l'autre pour son cache.
 *
 * `pairDelta` est mémoïsé sur les deux signatures : deux montures de même couleur
 * et même ascendance produisent exactement la même distribution, et les mêmes
 * signatures reviennent sans cesse — même raisonnement que le `shapeCache` de
 * `simulate.ts`, et sans lui la recherche passe son temps à recalculer des lignées.
 */
export type Searcher = {
  cache: Map<string, PairDelta | null>;
  config: SearchConfig;
};

export const createSearcher = (config: SearchConfig = DEFAULT_SEARCH): Searcher => ({
  cache: new Map(),
  config,
});

/**
 * L'écurie de l'app, mise à plat.
 *
 * Le Rust ne connaît que des montures ; le vrac est une commodité de saisie propre
 * à l'écran. Une monture de vrac est **fertile, non féconde, sans ascendance** —
 * c'est ce que « achetée ou capturée » veut dire.
 *
 * L'ordre est le contrat : les indices que le plan rend s'y rapportent, vrac
 * d'abord puis individus.
 */
export const flatten = (stable: Stable): Individual[] => {
  const out: Individual[] = [];
  for (const [colorId, counts] of stable.bulk) {
    const cycled = cycledOf(counts);
    // Les fécondes d'abord dans chaque sexe : elles sont interchangeables entre
    // elles, donc l'ordre n'a pas de sens en soi — mais il en a un pour la
    // lecture, `materialise` piochant les fécondations par le début.
    const push = (sex: Sex, count: number, banked: number) => {
      for (let index = 0; index < count; index += 1) {
        out.push({
          id: `${colorId}#${sex}${index}`,
          colorId,
          name: null,
          sex,
          level: BULK_MATE_LEVEL,
          fertile: true,
          cycled: index < banked,
          parents: null,
        });
      }
    };
    push('M', counts.males, cycled.males);
    push('F', counts.females, cycled.females);
  }
  out.push(...stable.individuals);
  return out;
};

/* ------------------------------------------------------------ la recherche -- */

const signatureOf = (colorId: string, parents: [string, string] | null) =>
  `${colorId}|${(canonicalParents(colorId, parents) ?? []).join('+')}`;

const partition = (
  mounts: Individual[],
  generations: Map<string, number>,
  economy: EconomyView
): [Group[], Group[]] => {
  const fertile: Group[] = [];
  const sterile: Group[] = [];
  const fertileIndex = new Map<string, number>();
  const sterileIndex = new Map<string, number>();
  const generation = (colorId: string) => generations.get(colorId) ?? 1;

  for (const [position, mount] of mounts.entries()) {
    const signature = signatureOf(mount.colorId, mount.parents);
    const make = (sex: Sex | null): Group => ({
      sex,
      generation: generation(mount.colorId),
      carried: carriedGeneration(
        generation(mount.colorId),
        mount.parents
          ? [generation(mount.parents[0]), generation(mount.parents[1])]
          : null
      ),
      colorId: mount.colorId,
      parents: mount.parents,
      value: economy.valueOf(mount.colorId),
      cycled: mount.cycled,
      members: [],
    });

    if (mount.fertile) {
      const key = `${signature}|${mount.sex}|${mount.cycled ? 1 : 0}`;
      let at = fertileIndex.get(key);
      if (at === undefined) {
        at = fertile.push(make(mount.sex)) - 1;
        fertileIndex.set(key, at);
      }
      fertile[at].members.push(position);
    } else {
      let at = sterileIndex.get(signature);
      if (at === undefined) {
        at = sterile.push(make(null)) - 1;
        sterileIndex.set(signature, at);
      }
      sterile[at].members.push(position);
    }
  }

  return [fertile, sterile];
};

const deltaOf = (
  searcher: Searcher,
  view: SearchView,
  male: Mate,
  female: Mate
): PairDelta | null => {
  // Le niveau et le seuil d'Optimakina entrent dans la clé : ils changent le taux,
  // donc la distribution, donc tout ce que le delta porte.
  const key =
    `${signatureOf(male.colorId, male.parents)}/` +
    `${signatureOf(female.colorId, female.parents)}/` +
    `${view.strategy.level}/${view.strategy.optimakinaFrom}`;
  const hit = searcher.cache.get(key);
  if (hit !== undefined) return hit;
  const computed = pairDelta(
    male,
    female,
    view.colors,
    view.generations,
    view.economy,
    view.strategy.level,
    view.strategy.optimakinaFrom
  );
  searcher.cache.set(key, computed);
  return computed;
};

const candidatesOf = (
  searcher: Searcher,
  view: SearchView,
  fertile: Group[]
): Candidate[] => {
  const mateOf = (group: Group): Mate => ({
    id: null,
    colorId: group.colorId,
    sex: group.sex ?? 'M',
    level: BULK_MATE_LEVEL,
    parents: group.parents,
  });
  const bought = (colorId: string, sex: Sex): Mate => ({
    id: null,
    colorId,
    sex,
    level: BULK_MATE_LEVEL,
    parents: null,
  });

  // Les gen 1 achetables : sans ascendance, donc une seule signature par couleur.
  // À mille kamas contre cent cinquante mille la fournée, c'est le moyen le moins
  // cher de ne pas laisser une place vide — et c'est la marge que le glouton
  // n'exploite pas.
  const starters = view.colors.filter((color) => color.generation === 1).map((color) => color.id);
  const males: number[] = [];
  const females: number[] = [];
  for (const [index, group] of fertile.entries()) {
    if (group.sex === 'M') males.push(index);
    else if (group.sex === 'F') females.push(index);
  }

  const pairs: [Side, Side, Mate, Mate][] = [];

  // Les achats ne sont candidats que si l'appelant les autorise — et quand ils le
  // sont, ils reprennent **exactement** leur place d'avant dans la liste. L'ordre
  // des candidats décide des tirages : le déplacer, même sans rien retirer, fait
  // diverger le portage du Rust sur les 80 plans de .
  //
  // Fermés, il ne reste que ce que l'écurie permet — « commence par les
  // accouplements possibles dans mon stock » — et une fournée vide devient une
  // réponse recevable, qui vaut mieux qu'un panier de courses.
  const buying = searcher.config.purchases !== false;

  for (const m of males) {
    for (const f of females) {
      pairs.push([{ have: m }, { have: f }, mateOf(fertile[m]), mateOf(fertile[f])]);
    }
    if (!buying) continue;
    for (const colorId of starters) {
      pairs.push([{ have: m }, { buy: colorId }, mateOf(fertile[m]), bought(colorId, 'F')]);
    }
  }
  if (buying) {
    for (const f of females) {
      for (const colorId of starters) {
        pairs.push([{ buy: colorId }, { have: f }, bought(colorId, 'M'), mateOf(fertile[f])]);
      }
    }
    for (const maleColor of starters) {
      for (const femaleColor of starters) {
        pairs.push([
          { buy: maleColor },
          { buy: femaleColor },
          bought(maleColor, 'M'),
          bought(femaleColor, 'F'),
        ]);
      }
    }
  }

  const out: Candidate[] = [];
  for (const [male, female, maleMate, femaleMate] of pairs) {
    const delta = deltaOf(searcher, view, maleMate, femaleMate);
    if (delta) out.push({ male, female, delta });
  }
  return out;
};

/**
 * Places d'enclos qu'un croisement engage : une par parent qui doit son cycle.
 *
 * Zéro quand les deux parents sont déjà fécondes — l'accouplement est alors un
 * clic, sans gestation ni séjour en enclos. Une monture achetée arrive fertile,
 * donc elle compte toujours.
 */
const placesOf = (candidate: Candidate, fertile: Group[]): number => {
  const owes = (side: Side) => ('have' in side ? !fertile[side.have].cycled : true);
  return (owes(candidate.male) ? 1 : 0) + (owes(candidate.female) ? 1 : 0);
};

/**
 * Un candidat dont les deux parents sont encore à prendre.
 *
 * « Encore à prendre » demande **deux** compteurs. `fertileFree` dit ce qui n'a pas
 * encore été croisé ni sacrifié ; `cyclableFree` dit ce qui n'a été ni croisé ni
 * **mis en banque**. Un groupe dont toutes les montures ont été fécondées dans
 * cette fournée a donc encore du `fertileFree` — féconder ne consomme pas la
 * reproduction — mais plus une seule monture disponible.
 *
 * Une monture déjà féconde est le cas normal où les deux divergent : son cycle est
 * payé, son compteur vaut zéro par construction, et il ne dit rien de sa
 * disponibilité.
 */
const available = (state: State, candidate: Candidate, fertile: Group[]): boolean => {
  const free = (side: Side) =>
    'have' in side
      ? state.fertileFree[side.have] > 0 &&
        (fertile[side.have].cycled || state.cyclableFree[side.have] > 0)
      : true;
  return free(candidate.male) && free(candidate.female);
};

const feasible = (state: State, view: SearchView): boolean => {
  if (state.places > view.capacity) return false;
  // Le chargement se paie dès qu'une **place** est occupée, et non dès qu'un
  // croisement est lancé. La distinction n'existait pas avant le découplage : un
  // chargement sans croisement était impossible. Elle compte maintenant, sinon
  // féconder serait gratuit et la politique banquerait sans rien payer — un optimum
  // qui n'existe que dans la mesure.
  const load = state.places > 0 ? view.loadKamas + state.optimakinaCost : 0;
  return state.census.kamas - load >= 0;
};

const applyEffects = (
  state: State,
  action: Action,
  candidates: Candidate[],
  fertile: Group[],
  sterile: Group[],
  view: SearchView
): void => {
  switch (action.kind) {
    case 'cross': {
      const candidate = candidates[action.index];
      for (const [side, sex] of [
        [candidate.male, 'M'],
        [candidate.female, 'F'],
      ] as [Side, Sex][]) {
        if ('have' in side) {
          state.fertileFree[side.have] -= 1;
          if (fertile[side.have].cycled) {
            // Une féconde consommée quitte le stock immédiat sans coûter de place :
            // c'est tout le gain du report.
            cycle(state.census, fertile[side.have].generation, sex, -1);
          } else {
            state.cyclableFree[side.have] -= 1;
          }
        } else {
          purchase(state.census, side.buy, sex, view.economy.starterPrice, 1);
        }
      }
      applyCrossing(state.census, candidate.delta, view.generations, 1);
      state.crossings += 1;
      state.places += placesOf(candidate, fertile);
      state.optimakinaCost += candidate.delta.optimakinaCost;
      return;
    }
    case 'cycle': {
      state.cyclableFree[action.group] -= 1;
      state.places += 1;
      const group = fertile[action.group];
      if (group.sex) cycle(state.census, group.generation, group.sex, 1);
      return;
    }
    case 'clone': {
      state.sterileFree[action.a] -= 1;
      state.sterileFree[action.b] -= 1;
      const group = sterile[action.a];
      cloning(state.census, group.generation, group.carried, group.colorId, group.value, 1);
      return;
    }
    case 'sacrificeFertile': {
      state.fertileFree[action.group] -= 1;
      const group = fertile[action.group];
      sacrifice(
        state.census,
        group.generation,
        group.carried,
        group.colorId,
        group.sex,
        group.value,
        1
      );
      return;
    }
    case 'sacrificeSterile': {
      state.sterileFree[action.group] -= 1;
      const group = sterile[action.group];
      sacrifice(
        state.census,
        group.generation,
        group.carried,
        group.colorId,
        null,
        group.value,
        1
      );
    }
  }
};

const revertEffects = (
  state: State,
  action: Action,
  candidates: Candidate[],
  fertile: Group[],
  sterile: Group[],
  view: SearchView
): void => {
  switch (action.kind) {
    case 'cross': {
      const candidate = candidates[action.index];
      applyCrossing(state.census, candidate.delta, view.generations, -1);
      for (const [side, sex] of [
        [candidate.male, 'M'],
        [candidate.female, 'F'],
      ] as [Side, Sex][]) {
        if ('have' in side) {
          state.fertileFree[side.have] += 1;
          if (fertile[side.have].cycled) {
            cycle(state.census, fertile[side.have].generation, sex, 1);
          } else {
            state.cyclableFree[side.have] += 1;
          }
        } else {
          purchase(state.census, side.buy, sex, view.economy.starterPrice, -1);
        }
      }
      state.crossings -= 1;
      state.places -= placesOf(candidate, fertile);
      state.optimakinaCost -= candidate.delta.optimakinaCost;
      return;
    }
    case 'cycle': {
      state.cyclableFree[action.group] += 1;
      state.places -= 1;
      const group = fertile[action.group];
      if (group.sex) cycle(state.census, group.generation, group.sex, -1);
      return;
    }
    case 'clone': {
      state.sterileFree[action.a] += 1;
      state.sterileFree[action.b] += 1;
      const group = sterile[action.a];
      cloning(state.census, group.generation, group.carried, group.colorId, group.value, -1);
      return;
    }
    case 'sacrificeFertile': {
      state.fertileFree[action.group] += 1;
      const group = fertile[action.group];
      sacrifice(
        state.census,
        group.generation,
        group.carried,
        group.colorId,
        group.sex,
        group.value,
        -1
      );
      return;
    }
    case 'sacrificeSterile': {
      state.sterileFree[action.group] += 1;
      const group = sterile[action.group];
      sacrifice(
        state.census,
        group.generation,
        group.carried,
        group.colorId,
        null,
        group.value,
        -1
      );
    }
  }
};

/** `Vec::swap_remove` : le dernier élément prend la place du retiré. */
const swapRemove = (actions: Action[], at: number): void => {
  const last = actions.pop();
  if (last !== undefined && at < actions.length) actions[at] = last;
};

const applyMutation = (
  state: State,
  mutation: Mutation,
  candidates: Candidate[],
  fertile: Group[],
  sterile: Group[],
  view: SearchView
): void => {
  switch (mutation.kind) {
    case 'add':
      applyEffects(state, mutation.action, candidates, fertile, sterile, view);
      state.actions.push(mutation.action);
      return;
    case 'remove':
      revertEffects(state, mutation.old, candidates, fertile, sterile, view);
      swapRemove(state.actions, mutation.at);
      return;
    case 'swap':
      revertEffects(state, mutation.old, candidates, fertile, sterile, view);
      swapRemove(state.actions, mutation.at);
      applyEffects(state, mutation.next, candidates, fertile, sterile, view);
      state.actions.push(mutation.next);
  }
};

/**
 * L'inverse exact. La fournée est un **ensemble** : rétablir l'ordre n'importe pas,
 * rétablir le multiensemble et le recensement, si.
 */
const undoMutation = (
  state: State,
  mutation: Mutation,
  candidates: Candidate[],
  fertile: Group[],
  sterile: Group[],
  view: SearchView
): void => {
  switch (mutation.kind) {
    case 'add':
      state.actions.pop();
      revertEffects(state, mutation.action, candidates, fertile, sterile, view);
      return;
    case 'remove':
      applyEffects(state, mutation.old, candidates, fertile, sterile, view);
      state.actions.push(mutation.old);
      return;
    case 'swap':
      state.actions.pop();
      revertEffects(state, mutation.next, candidates, fertile, sterile, view);
      applyEffects(state, mutation.old, candidates, fertile, sterile, view);
      state.actions.push(mutation.old);
  }
};

const pick = (rng: () => number, count: number): number =>
  Math.min(Math.floor(rng() * count), Math.max(count - 1, 0));

const randomAction = (
  state: State,
  candidates: Candidate[],
  fertile: Group[],
  sterile: Group[],
  capacity: number,
  sacrifices: boolean,
  rng: () => number
): Action | null => {
  const kind = rng();

  // Un croisement le plus souvent : c'est la décision qui porte la partie.
  //
  // Le plafond ne se lit plus sur le nombre de croisements : un croisement de deux
  // fécondes ne coûte aucune place, donc il reste proposable même sur un enclos
  // plein. C'est ce qui rend le report profitable au lieu d'être simplement
  // possible.
  if (kind < 0.65 && candidates.length > 0) {
    // Quelques essais plutôt qu'un balayage : les candidats indisponibles sont
    // minoritaires, et balayer coûterait plus cher que retirer.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const index = pick(rng, candidates.length);
      const candidate = candidates[index];
      if (
        available(state, candidate, fertile) &&
        state.places + placesOf(candidate, fertile) <= capacity
      ) {
        return { kind: 'cross', index };
      }
    }
    return null;
  }

  // Féconder sans croiser. Tirée aussi souvent que le clonage : c'est une décision
  // de même nature — préparer plutôt que produire — et rien ne dit encore laquelle
  // des deux paie le plus.
  if (kind < 0.8 && state.places < capacity) {
    const usable: number[] = [];
    for (let index = 0; index < fertile.length; index += 1) {
      if (state.cyclableFree[index] > 0) usable.push(index);
    }
    if (usable.length === 0) return null;
    return { kind: 'cycle', group: usable[pick(rng, usable.length)] };
  }

  if (kind < 0.92) {
    const usable: number[] = [];
    for (let index = 0; index < sterile.length; index += 1) {
      if (state.sterileFree[index] > 0) usable.push(index);
    }
    if (usable.length === 0) return null;
    const first = usable[pick(rng, usable.length)];
    const partners = usable.filter(
      (other) =>
        sterile[other].generation === sterile[first].generation &&
        (other !== first || state.sterileFree[other] >= 2)
    );
    if (partners.length === 0) return null;
    return { kind: 'clone', a: first, b: partners[pick(rng, partners.length)] };
  }

  if (!sacrifices) return null;

  // Un sacrifice, fertile ou stérile. Une gen 1 ne rend rien, donc on ne la propose
  // pas — ce n'est pas une préférence, c'est zéro.
  const fromFertile = rng() < 0.5;
  const pool = fromFertile ? fertile : sterile;
  const free = fromFertile ? state.fertileFree : state.sterileFree;
  const usable: number[] = [];
  for (let index = 0; index < pool.length; index += 1) {
    if (free[index] > 0 && pool[index].value > 0) usable.push(index);
  }
  if (usable.length === 0) return null;
  const chosen = usable[pick(rng, usable.length)];
  return fromFertile
    ? { kind: 'sacrificeFertile', group: chosen }
    : { kind: 'sacrificeSterile', group: chosen };
};

const propose = (
  state: State,
  candidates: Candidate[],
  fertile: Group[],
  sterile: Group[],
  capacity: number,
  sacrifices: boolean,
  rng: () => number
): Mutation | null => {
  const roll = rng();

  if (state.actions.length > 0 && roll < 0.15) {
    const at = pick(rng, state.actions.length);
    return { kind: 'remove', at, old: state.actions[at] };
  }

  const action = randomAction(state, candidates, fertile, sterile, capacity, sacrifices, rng);
  if (!action) return null;
  if (state.actions.length > 0 && roll < 0.3) {
    const at = pick(rng, state.actions.length);
    return { kind: 'swap', at, old: state.actions[at], next: action };
  }
  return { kind: 'add', action };
};

const materialise = (
  state: State,
  candidates: Candidate[],
  fertile: Group[],
  sterile: Group[],
  stableSize: number
): UnitPlan => {
  const plan = emptyPlan();

  // La recherche a raisonné sur des compteurs ; on rattache ici des montures
  // concrètes. Toutes les membres d'un groupe sont interchangeables par
  // construction, donc l'ordre n'a aucune importance.
  const fertilePool = fertile.map((group) => [...group.members]);
  const sterilePool = sterile.map((group) => [...group.members]);
  // Combien de fécondations déjà nommées dans chaque groupe, pour piocher par le
  // début sans retirer du pool des croisements.
  const cycledTaken = new Array<number>(fertile.length).fill(0);
  let nextPurchase = stableSize;

  for (const action of state.actions) {
    switch (action.kind) {
      case 'cross': {
        const candidate = candidates[action.index];
        const take = (side: Side, sex: Sex): number | undefined => {
          if ('have' in side) return fertilePool[side.have].pop();
          plan.purchases.push([side.buy, sex]);
          return nextPurchase++;
        };
        const male = take(candidate.male, 'M');
        const female = take(candidate.female, 'F');
        if (male !== undefined && female !== undefined) {
          plan.crossings.push([male, female]);
          plan.optimakina.push(candidate.delta.optimakinaCost > 0);
        }
        break;
      }
      case 'clone': {
        const first = sterilePool[action.a].pop();
        const second = sterilePool[action.b].pop();
        if (first !== undefined && second !== undefined) plan.clonings.push([first, second]);
        break;
      }
      case 'sacrificeFertile': {
        const index = fertilePool[action.group].pop();
        if (index !== undefined) plan.sacrifices.push(index);
        break;
      }
      case 'sacrificeSterile': {
        const index = sterilePool[action.group].pop();
        if (index !== undefined) plan.sacrifices.push(index);
        break;
      }
      // Une fécondation ne retire rien du vivier : la monture reste disponible pour
      // un croisement de la même fournée. On ne peut donc pas la sortir du pool —
      // mais il ne faut pas non plus nommer deux fois la même monture.
      //
      // Les croisements piochent par la fin (`pop`), les fécondations par le début.
      // Elles ne peuvent pas se rencontrer : `cyclableFree` part de l'effectif du
      // groupe et les deux actions le décrémentent, donc leur somme ne dépasse
      // jamais cet effectif.
      case 'cycle': {
        const at = cycledTaken[action.group];
        const index = fertile[action.group].members[at];
        if (index !== undefined) {
          cycledTaken[action.group] += 1;
          plan.cycles.push(index);
        }
      }
    }
  }

  return plan;
};

/** Compose la fournée que la fonction de valeur préfère. */
export const planUnit = (
  searcher: Searcher,
  view: SearchView,
  rng: () => number,
  value: ValueFn
): UnitPlan => {
  const [fertile, sterile] = partition(view.mounts, view.generations, view.economy);
  const candidates = candidatesOf(searcher, view, fertile);
  if (candidates.length === 0 && sterile.length === 0) return emptyPlan();

  const state: State = {
    census: censusOf(
      { bulk: new Map(), individuals: view.mounts },
      view.colors,
      view.economy,
      view.kamas
    ),
    actions: [],
    fertileFree: fertile.map((group) => group.members.length),
    sterileFree: sterile.map((group) => group.members.length),
    cyclableFree: fertile.map((group) => (group.cycled ? 0 : group.members.length)),
    crossings: 0,
    places: 0,
    optimakinaCost: 0,
  };
  state.census.places = 0;
  state.census.capacity = view.capacity;
  let best = value(state.census);

  for (let iteration = 0; iteration < searcher.config.iterations; iteration += 1) {
    const mutation = propose(
      state,
      candidates,
      fertile,
      sterile,
      view.capacity,
      searcher.config.sacrifices,
      rng
    );
    if (!mutation) continue;

    applyMutation(state, mutation, candidates, fertile, sterile, view);
    // Les places engagées entrent dans le recensement juste avant qu'on le note.
    // Posées et non suivies : `state.places` en tient déjà le compte.
    state.census.places = state.places;
    const scored = feasible(state, view) ? value(state.census) : Number.NEGATIVE_INFINITY;

    if (scored > best) best = scored;
    else undoMutation(state, mutation, candidates, fertile, sterile, view);
  }

  return materialise(state, candidates, fertile, sterile, view.mounts.length);
};
