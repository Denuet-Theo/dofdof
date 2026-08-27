/**
 * L'échelle qui **joue**, et non plus seulement qui interdit.
 *
 * Portage de `LadderPolicy` (`rust/breeding-sim/src/ladder.rs`). C'est la pièce
 * qui manquait au navigateur : `ladder.ts` construit le plan et répond « ce
 * croisement est-il admissible », mais rien ici ne s'en servait pour **composer
 * une fournée**. Le champion le faisait à sa place, et le banc dit ce que ça
 * coûte — sur les mêmes parties, l'échelle réglée finit avec 88,84 gen 10 quand
 * le champion embarqué en tient 17,8.
 *
 * ## La règle, en une phrase
 *
 * À chaque place, on sert la couleur voulue dont on est **le plus en retard**,
 * en commençant par l'étage le plus haut dont les ingrédients sont déjà en main.
 *
 * « En retard » se mesure en part : `ce qu'on tient / ce que le plan demande`.
 * C'est ce ratio, et non la valeur marchande, qui décide — une couleur dont
 * l'échelle réclame quatre unités et qui n'en tient qu'une passe avant une
 * couleur plus chère déjà servie.
 *
 * ## Ce qui est porté, et ce qui ne l'est pas
 *
 * Ce paragraphe a été faux pendant plusieurs jours, et faux dans le sens le plus
 * coûteux : il annonçait l'app **plus faible qu'elle n'est**, ce qui invite à
 * reporter du code qui existe déjà.
 *
 * Il disait « la moisson n'est pas portée » et « `check-ladder-policy.mjs` compare
 * donc au Rust configuré `harvesting: false` ». Les deux sont faux : `harvest` et
 * `harvestStocked` sont des options de ce module, et les cas de référence balayent
 * **les deux régimes** — `for stocked in [false, true]` dans `parity.rs`, et la
 * garde relit `harvestStocked` cas par cas. Elle compare donc la moisson allumée
 * aussi, et elle passe coup pour coup sur les trois familles.
 *
 * Sont portés et comparés : la composition de la fournée, les achats, les
 * clonages, les sacrifices, l'extraction, la moisson dans ses deux régimes, et
 * l'admissibilité du sommet (`Summit::Target`, le défaut des deux côtés).
 *
 * **N'est pas porté : le réglage du niveau** (`tuned_for`). Ce n'est pas un oubli,
 * c'est un choix — `tuned_for` maximise `nombre de fournées × (valeur − carburant)`
 * sur un horizon d'heures, et ce terme est **constant à un** pour un éleveur qui
 * fait une fournée par jour. Voir `AGENTS.md`. L'app choisit son niveau avec
 * `tunedLevel`, sur les prix saisis, et son en-tête dit pourquoi ce n'est pas un
 * portage et n'aura pas de garde de parité.
 *
 * Le seul écart mesuré qui reste, donc, est **ce niveau-là** : `tunedLevel`
 * conseille 50 sur le parc de l'éleveur, et le banc en mode fournées — le seul qui
 * corresponde à son calendrier — donne 67 gagnant à 30, 60, 100 et 150 fournées,
 * l'écart valant 1,35 M par mois. Les deux ne facturent pas la même Mangeoire, et
 * lequel des deux prix est le sien n'est pas tranché.
 *
 * Le **sommet**, lui, demande une distinction que ce commentaire a eue fausse.
 * Il disait « pas porté, et sans effet : `Summit::Hold` est le défaut des deux
 * côtés, donc la branche ne s'exécute jamais ». Le défaut est `Summit::Target`
 * depuis le 27/08 — c'est ce que `summit-target.spec.ts` a exigé — donc la
 * première moitié de la phrase était périmée et la seconde fausse.
 *
 * Ce qui est vrai : `Target` agit par l'**admissibilité**, `aimsAt(…, 'target')`,
 * et ça, c'est porté — un croisement qui nomme une couleur du sommet entre dans la
 * fournée des deux côtés. Ce qui n'est pas porté est la **composition** de
 * `Summit::Duplicate` : `LadderPolicy::summit` et `summit_partner`, la boucle du
 * forum qui accumule des gen 10 pour les vendre. Elle sort au premier test si le
 * régime n'est pas `Duplicate`, donc elle ne s'exécute jamais ici — et elle a été
 * mesurée à **−1,43 M** sur le parc de l'éleveur, ce pour quoi elle reste éteinte.
 */

import type { BreedingColor } from './costs';
import { genetonWeight, successRate, type EconomyView } from './census';
import { aimsAt, type Ladder } from './ladder';
import { carriedGeneration } from './naming';
import {
  canonicalParents,
  climbs,
  pairOutlook,
  topGenerationOf,
  type Mate,
} from './pairing';
import { emptyPlan, type UnitPlan } from './unit-plan';
import type { Individual, Sex } from './stable';

/** Ce que la composition a besoin de savoir. Un sous-ensemble de `SearchView`. */
export type LadderView = {
  /** L'écurie à plat. Les indices du plan rendu s'y rapportent. */
  mounts: Individual[];
  colors: BreedingColor[];
  generations: Map<string, number>;
  economy: EconomyView;
  /** Places d'enclos disponibles, dix par enclos. */
  capacity: number;
  /** Le solde de l'éleveur. */
  kamas: number;
  /** Ce que coûte le chargement, dès qu'une place est occupée. */
  loadKamas: number;
  /**
   * Le niveau auquel la fournée sera montée.
   *
   * Sert à deux choses et à rien d'autre : chiffrer si une gen 1 achetée pour la
   * moisson se rembourse, et donner un niveau au partenaire qu'on n'a pas encore
   * acheté. Les montures de l'écurie, elles, gardent le leur.
   *
   * Côté Rust c'est `economy.mount_level`, une donnée de l'économie et non de la
   * stratégie — d'où un champ à part plutôt qu'une lecture de `strategy`.
   */
  mountLevel: number;
};

/**
 * Un groupe d'accouplement : même couleur, même ascendance, même sexe.
 *
 * **`cycled` n'entre pas dans la clé**, contrairement au `partition` de
 * `search.ts`. Ce n'est pas un oubli : la recherche sépare les fécondes parce
 * qu'elles ne coûtent pas la même place, donc elle doit pouvoir les choisir. Ici
 * le prix se lit à l'engagement, monture par monture (`placesFor`), et grouper
 * plus finement changerait l'ordre d'énumération — donc le plan, donc la parité.
 */
type MateGroup = {
  sex: Sex;
  colorId: string;
  parents: [string, string] | null;
  /** La mieux montée : le taux de réussite croît avec le niveau. */
  sample: Mate;
  /** Indices dans `view.mounts`, dans l'ordre de l'écurie. */
  members: number[];
};

/** Les fertiles, repliées par signature et sexe — `Stable::fertile_groups`. */
const fertileGroups = (mounts: Individual[]): MateGroup[] => {
  const at = new Map<string, number>();
  const groups: MateGroup[] = [];

  for (const [position, mount] of mounts.entries()) {
    if (mount.fertile === false) continue;
    const parents = canonicalParents(mount.colorId, mount.parents ?? null);
    const key = `${mount.colorId}|${parents ? parents.join('-') : ''}|${mount.sex}`;
    const found = at.get(key);
    if (found !== undefined) {
      const group = groups[found];
      group.members.push(position);
      if ((mount.level ?? 1) > group.sample.level) {
        group.sample = {
          id: mount.id,
          colorId: mount.colorId,
          sex: mount.sex,
          level: mount.level ?? 1,
          parents,
        };
      }
      continue;
    }
    at.set(key, groups.length);
    groups.push({
      sex: mount.sex,
      colorId: mount.colorId,
      parents,
      sample: {
        id: mount.id,
        colorId: mount.colorId,
        sex: mount.sex,
        level: mount.level ?? 1,
        parents,
      },
      members: [position],
    });
  }

  return groups;
};

/**
 * Les places qu'un couple engage : une par parent qui doit encore son cycle.
 *
 * Le compte se fait **après** le tirage des deux montures, et non sur le
 * nombre de croisements : deux fécondes ne coûtent rien.
 */
const placesFor = (mounts: Individual[], pair: [number, number]): number =>
  pair.filter((index) => mounts[index]?.cycled !== true).length;

/** Ce que rend un engagement de couple. */
type Launched = 'yes' | 'retry' | 'full';

export type LadderPlanOptions = {
  /**
   * Se procurer des gen 1 pour finir de remplir le parc.
   *
   * Vrai par défaut, comme le Rust : à mille kamas la monture contre cent
   * cinquante mille le chargement, une place vide coûte plus cher qu'une paire
   * achetée — à condition qu'elle produise une couleur voulue, ce que le choix
   * de deux teintes d'un même bloc garantit.
   */
  purchases?: boolean;
  /**
   * Monnayer les montures que le plan ne sait pas employer.
   *
   * Vrai par défaut, comme le Rust. Un croisement réussi paie des génétons, le
   * barème est quasi exponentiel — 250 pour une gen 9 — et l'écurie d'un éleveur
   * porte toujours des couleurs hors plan qui ne servent à rien d'autre.
   */
  harvest?: boolean;
  /**
   * Étendre la moisson aux couleurs **du plan qui ne le retiennent plus**.
   *
   * La moisson épargne tout ce que le plan réclame, au motif qu'une monture au
   * plan garde sa fécondité pour la route. Le motif tient tant que la route la
   * consomme ; il cesse de tenir en haut. Rien n'absorbe une gen 9 sauf la
   * couronne, qui n'en prend qu'une par tentative — les gen 9 s'accumulent donc,
   * et leur dernière fécondité n'est jamais dépensée.
   *
   * Une Ambre gen 9 croisée avec un Doré gen 1 à mille kamas vise la gen 10 :
   * 45 % à niveau 50, **251 génétons**, et 12,5 % des ratés rendent une Ambre
   * gen 9 neuve. C'est le calcul que la moisson écrit déjà pour le hors-plan,
   * appliqué au gisement qu'elle s'interdisait.
   *
   * Faux par défaut, comme `harvest_stocked` côté Rust — la garde de parité
   * compare les deux côtés à leurs défauts, et le drapeau change ce que la
   * politique préfère, donc il se mesure au lieu de remplacer.
   *
   * **Les deux côtés doivent bouger ensemble** : voir `harvest_stocked` dans
   * `ladder.rs`.
   */
  harvestStocked?: boolean;
  /**
   * Écouler le sommet, et les stériles que le clonage n'a pas appariées.
   *
   * **Vrai par défaut, comme `sell_top` côté Rust : c'est la référence.** Garder
   * les gen 10 au bilan finissait la partie riche et illiquide — la boucle
   * mourait faute de kamas sans avoir dépensé son horizon, à 174 fournées sur
   * 200 pour le volkorne et 131 pour la dragodinde. Vendre les dépense toutes,
   * pour le même argent, et fait tomber l'écurie de 521 à 163 places sur le
   * muldo.
   *
   * **Les deux côtés doivent bouger ensemble** : voir `sell_top` dans
   * `ladder.rs`.
   */
  sellTop?: boolean;
  /**
   * Apparier les stériles sans regarder leur sexe.
   *
   * Faux par défaut, comme `sex_blind_cloning` côté Rust : préférer le même sexe
   * rend celui du clone certain et ne coûte rien.
   */
  sexBlindCloning?: boolean;
  /**
   * Refondre aussi les stériles **du sommet**.
   *
   * Vrai par défaut, comme `clone_top` côté Rust.
   */
  cloneTop?: boolean;
};

/**
 * Ce qu'une monture **porte** : sa génération ou celle de son meilleur parent.
 *
 * Port de `Mount::carried_generation`. C'est la valeur d'une stérile aux yeux du
 * clonage : une gen 8 née de deux gen 9 vaut mieux qu'une gen 8 née de gen 7,
 * parce que le clone tire sa couleur d'un des deux parents.
 */
const carriedOf = (mount: Individual, generations: Map<string, number>): number =>
  carriedGeneration(
    generations.get(mount.colorId) ?? 0,
    mount.parents
      ? [generations.get(mount.parents[0]) ?? 0, generations.get(mount.parents[1]) ?? 0]
      : null
  );

/** Une stérile se laisse-t-elle refondre ? Port de `clonable`. */
const clonable = (
  mount: Individual,
  generations: Map<string, number>,
  topGeneration: number,
  cloneTop: boolean
): boolean => cloneTop || (generations.get(mount.colorId) ?? 0) < topGeneration;

/**
 * Les stériles refondues **deux par deux, par génération**. Port de
 * `clone_by_generation`, ordre d'appariement compris.
 *
 * Le clonage échange deux stériles contre une féconde de niveau 1 : il ne rend
 * pas de kamas, il rend de la **fécondité**, et c'est pour ça qu'il passe avant
 * l'extraction dans `ladderPlan` — une stérile appariée vaut mieux qu'une
 * stérile vendue.
 *
 * L'ordre compte pour la parité, et il n'est pas intuitif :
 *
 * - le tri est **décroissant** sur `(porté, indice)`, donc la plus précieuse
 *   devant et, à valeur égale, le plus grand indice d'abord ;
 * - un effectif **impair** laisse tomber la dernière, c'est-à-dire la moins
 *   précieuse — dépareiller une porteuse la réduirait à son extraction ;
 * - on apparie la première restante avec la **moins précieuse**, en préférant
 *   le même sexe parmi celles qui valent autant : le sexe du clone devient
 *   certain et ça ne coûte rien.
 */
const cloneByGeneration = (
  mounts: Individual[],
  generations: Map<string, number>,
  topGeneration: number,
  sexBlind: boolean,
  cloneTop: boolean
): [number, number][] => {
  const byGeneration = new Map<number, number[]>();
  mounts.forEach((mount, index) => {
    if (mount.fertile || !clonable(mount, generations, topGeneration, cloneTop)) return;
    const generation = generations.get(mount.colorId) ?? 0;
    const pool = byGeneration.get(generation);
    if (pool) pool.push(index);
    else byGeneration.set(generation, [index]);
  });

  const carried = new Map<number, number>();
  for (const pool of byGeneration.values()) {
    for (const index of pool) carried.set(index, carriedOf(mounts[index], generations));
  }

  const pairs: [number, number][] = [];
  for (const generation of [...byGeneration.keys()].sort((a, b) => a - b)) {
    const pool = byGeneration.get(generation)!;
    // Décroissant sur le porté, puis sur l'indice — le `Reverse` du Rust porte
    // sur le couple entier, donc il renverse aussi le départage.
    pool.sort((a, b) => carried.get(b)! - carried.get(a)! || b - a);
    if (pool.length % 2 === 1) pool.pop();

    while (pool.length >= 2) {
      const keep = pool.shift()!;
      let at = pool.length - 1;
      if (!sexBlind) {
        const floor = carried.get(pool[at])!;
        for (let candidate = pool.length - 1; candidate >= 0; candidate -= 1) {
          if (carried.get(pool[candidate])! > floor) break;
          if (mounts[pool[candidate]].sex === mounts[keep].sex) {
            at = candidate;
            break;
          }
        }
      }
      const [partner] = pool.splice(at, 1);
      pairs.push([keep, partner]);
    }
  }

  return pairs;
};


/**
 * Le clonage, l'extraction, et le contrôle de solvabilité — la fin du plan.
 *
 * Port de la queue de `LadderPolicy::plan`. Trois choses dans cet ordre, et
 * l'ordre est la règle :
 *
 * 1. **le clonage d'abord**, parce qu'une stérile appariée rend une fécondité et
 *    qu'une stérile vendue ne rend que des kamas ;
 * 2. **l'extraction ensuite**, sur ce que ni un croisement ni un clonage n'a
 *    réclamé ;
 * 3. **la solvabilité enfin** : si même en vendant tout on ne paie pas le
 *    chargement, on ne garde que le clonage et l'extraction. Le chargement est
 *    perdu, pas deviné.
 *
 * L'extraction du sommet (`sellTop`) est la référence depuis qu'on a mesuré
 * l'inverse : garder les gen 10 finissait la partie riche et illiquide, à 131
 * fournées sur 200 pour la dragodinde, en tenant des centaines de montures que
 * rien ne convertissait.
 */
const settle = (
  plan: UnitPlan,
  view: LadderView,
  ladder: Ladder,
  topGeneration: number,
  options: LadderPlanOptions
): UnitPlan => {
  const { mounts, generations, economy } = view;
  const sellTop = options.sellTop ?? true;
  const clonings = cloneByGeneration(
    mounts,
    generations,
    topGeneration,
    options.sexBlindCloning ?? false,
    options.cloneTop ?? true
  );

  const claimed = new Set<number>();
  for (const [male, female] of plan.crossings) {
    claimed.add(male);
    claimed.add(female);
  }
  for (const [keep, partner] of clonings) {
    claimed.add(keep);
    claimed.add(partner);
  }

  const sacrifices: number[] = [];
  mounts.forEach((mount, index) => {
    if (claimed.has(index)) return;
    if (economy.valueOf(mount.colorId) === 0) return;
    const generation = generations.get(mount.colorId) ?? 0;
    if (sellTop) {
      // Le sommet s'écoule : aucun croisement ne le fait plus monter.
      if (generation >= topGeneration) {
        sacrifices.push(index);
        return;
      }
      // Une stérile que le clonage n'a pas appariée ne remontera plus l'échelle.
      if (!mount.fertile && generation > 2) {
        sacrifices.push(index);
        return;
      }
    }
    // La règle d'origine : ce qui est né hors plan, en bas de l'échelle.
    if (!ladder.wanted.has(mount.colorId) && generation <= 2) sacrifices.push(index);
  });

  plan.clonings = clonings;
  plan.sacrifices = sacrifices;

  const needed =
    (plan.crossings.length === 0 ? 0 : view.loadKamas) +
    plan.purchases.length * economy.starterPrice;
  const raised = sacrifices.reduce(
    (sum, index) => sum + economy.valueOf(mounts[index].colorId),
    0
  );
  if (view.kamas + raised < needed) {
    return { ...emptyPlan(), clonings, sacrifices };
  }

  return plan;
};


/**
 * Compose la fournée que l'échelle veut, sur cette écurie-ci.
 *
 * Rend le même `UnitPlan` que `planUnit`, donc `readPlan` le relit sans rien
 * savoir de qui l'a produit — c'est ce qui permet à l'écran de basculer d'une
 * politique à l'autre sans que le reste bouge.
 */
export const ladderPlan = (
  view: LadderView,
  ladder: Ladder,
  options: LadderPlanOptions = {}
): UnitPlan => {
  const plan = emptyPlan();
  // Échelle vide : plan nul, et pas même un clonage. C'est ce que fait
  // `LadderPolicy::plan` sur `self.ladder.is_empty()`.
  if (ladder.wanted.size === 0) return plan;

  const { mounts, colors, generations, economy } = view;
  const topGeneration = topGenerationOf(colors);
  // L'ordre du catalogue, et non l'alphabet : côté Rust une couleur est un
  // **indice**, et c'est lui qui départage les égalités — de retard entre deux
  // couleurs d'un même étage, et de recette entre deux achats.
  //
  // Mesuré : sur les quarante cas de la référence, trier alphabétiquement rend
  // exactement la même fournée. Les égalités strictes y sont trop rares pour
  // que la garde tranche. On garde quand même l'ordre du catalogue, parce que
  // c'est celui contre lequel le Rust est comparé et qu'une égalité finira par
  // arriver sur une écurie réelle.
  const rank = new Map(colors.map((color, index) => [color.id, index]));

  /** Ce que l'écurie tient déjà de chaque couleur voulue — le dénominateur. */
  const held = new Map<string, number>();
  for (const mount of mounts) {
    if (ladder.wanted.has(mount.colorId)) {
      held.set(mount.colorId, (held.get(mount.colorId) ?? 0) + 1);
    }
  }

  const groups = fertileGroups(mounts);
  const free = groups.map((group) => [...group.members]);

  /** Les couples admissibles, étiquetés par la couleur qu'ils visent. */
  const byTarget = new Map<string, [number, number][]>();
  for (const [male, group] of groups.entries()) {
    if (group.sex !== 'M') continue;
    for (const [female, other] of groups.entries()) {
      if (other.sex !== 'F') continue;
      const color = aimsAt(group.sample, other.sample, colors, generations, ladder);
      if (color === null) continue;
      const list = byTarget.get(color);
      if (list) list.push([male, female]);
      else byTarget.set(color, [[male, female]]);
    }
  }

  /** Ce que la fournée a déjà lancé, par couleur cible. */
  const made = new Map<string, number>();

  /**
   * Dans cet étage, la couleur dont on est le plus en retard — et le premier de
   * ses couples encore formable.
   *
   * Le retard est une **part** : `tenu / demandé`. Comparaison stricte, donc à
   * égalité c'est la première rencontrée qui gagne, et l'étage est trié.
   */
  /** Un groupe a-t-il encore une monture à donner ? Le cas ordinaire. */
  const available = (group: number): boolean => free[group].length > 0;

  /**
   * La dernière **féconde** encore libre du groupe, ou `null`.
   *
   * « La dernière » pour rejoindre le `pop` de `launch` : les deux passes
   * descendent la liste dans le même sens, donc le Rust n'a qu'une règle à
   * suivre au lieu de deux. Voir `cycled_at` là-bas.
   *
   * Le cycle se lit sur la **monture** et non sur le groupe : `fertileGroups`
   * ne met pas `cycled` dans sa clé — voir son en-tête — donc un même groupe
   * mêle des fécondes et des fertiles.
   */
  const takeCycled = (group: number): number | null => {
    const list = free[group];
    for (let at = list.length - 1; at >= 0; at -= 1) {
      if (mounts[list[at]]?.cycled === true) return list.splice(at, 1)[0];
    }
    return null;
  };

  /** Le prédicat jumeau de `takeCycled`, pour `mostBehind`. */
  const hasCycled = (group: number): boolean =>
    free[group].some((index) => mounts[index]?.cycled === true);

  const mostBehind = (
    here: string[],
    ready: (group: number) => boolean = available
  ): [string, number] | null => {
    let choice: [number, string, number] | null = null;
    for (const color of here) {
      const want = ladder.demand.get(color) ?? 0;
      if (want <= 0) continue;
      const pairs = byTarget.get(color);
      if (!pairs) continue;
      const position = pairs.findIndex(
        ([male, female]) => male !== female && ready(male) && ready(female)
      );
      if (position < 0) continue;

      const stock = (held.get(color) ?? 0) + (made.get(color) ?? 0);
      const lag = stock / want;
      if (choice === null || lag < choice[0]) choice = [lag, color, position];
    }
    return choice === null ? null : [choice[1], choice[2]];
  };

  let places = 0;

  /** Engager un couple, si la place le permet. */
  const launch = (pair: [number, number]): Launched => {
    const [male, female] = pair;
    const maleIndex = free[male].pop();
    if (maleIndex === undefined) return 'retry';
    const femaleIndex = free[female].pop();
    if (femaleIndex === undefined) {
      free[male].push(maleIndex);
      return 'retry';
    }
    const cost = placesFor(mounts, [maleIndex, femaleIndex]);
    if (places + cost > view.capacity) {
      free[male].push(maleIndex);
      free[female].push(femaleIndex);
      return 'full';
    }
    places += cost;
    plan.crossings.push([maleIndex, femaleIndex]);
    plan.optimakina.push(false);
    return 'yes';
  };

  // Les étages : une génération, et les couleurs voulues qu'elle porte. La plus
  // haute d'abord et vidée jusqu'à la dernière place — c'est `TopDown`, le
  // défaut du Rust. L'argument est écrit là-bas : une étape haute dont les
  // ingrédients sont en main se fait maintenant, parce que ces ingrédients ont
  // coûté dix fournées à produire, là où une place dépensée en gen 2 est
  // remplaçable.
  const grouped = new Map<number, string[]>();
  for (const color of ladder.wanted) {
    const generation = generations.get(color) ?? 1;
    const list = grouped.get(generation);
    if (list) list.push(color);
    else grouped.set(generation, [color]);
  }
  const tiers = [...grouped.entries()].sort(([a], [b]) => b - a);
  for (const [, here] of tiers) {
    here.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  }

  /**
   * Les croisements qui n'occupent **aucune** place : deux fécondes.
   *
   * ## Ce que cette passe répare
   *
   * La boucle d'étages s'arrête sur la capacité, et c'est juste pour tout ce qui
   * doit encore un cycle : ces montures-là passent par l'enclos, et l'enclos se
   * compte. Mais un couple dont les **deux** parents ont déjà cyclé ne passe par
   * aucun enclos — c'est un clic en jeu, `placesFor` le chiffre à zéro — donc la
   * capacité n'a rien à en dire. Elle le bornait quand même.
   *
   * Le prix se lit sur l'écurie de l'éleveur, export du 27/08 : 74 fécondes,
   * **34 accouplements admissibles et gratuits**, quatre proposés. Et parc plein,
   * la boucle d'étages ne tournant pas du tout, l'écran n'annonçait plus **aucun**
   * accouplement pendant toute la durée du cycle — alors que les fécondes du
   * coffre n'attendaient rien.
   *
   * ## Pourquoi elle vient en premier
   *
   * Elle a d'abord été posée en dernier, après tout ce qui se dispute une place,
   * au motif qu'elle ne leur retirait rien. C'était le mauvais bout : ce ne sont
   * pas les places qu'elle leur prend, c'est **l'ordre du geste**.
   *
   * L'éleveur accouple avant de charger, et il n'a pas le choix — un poulain né
   * du croisement de ce matin doit pouvoir entrer dans l'enclos de ce midi. Une
   * gen 9 qui sort d'un accouplement et qui attend la fournée du lendemain, c'est
   * une journée perdue, et il n'y en a qu'une par jour. Composer les gratuits en
   * dernier, c'était les annoncer après avoir distribué les soixante places, donc
   * après que le geste soit joué.
   *
   * Et le parc y gagne deux fois. Passée en dernier, une féconde que la boucle
   * d'étages avait déjà mariée à une fertile coûtait **une place** ; passée
   * devant, elle se marie à une autre féconde et n'en coûte aucune. La place
   * ainsi rendue va à une monture qui, elle, doit vraiment son cycle.
   *
   * ## Les étages sont ceux d'au-dessus
   *
   * Le même `tiers`, donc le même ordre : génération la plus haute d'abord,
   * couleurs dans l'ordre du catalogue. Côté Rust c'est `free_tiers`, qui le
   * reconstruit — la passe n'y suit pas les cinq `Ordering`, et n'a pas à le
   * faire : ils n'existent que pour arbitrer une place entre deux étages, et ici
   * aucun couple n'en prive un autre.
   */
  for (const [, here] of tiers) {
    for (;;) {
      const next = mostBehind(here, hasCycled);
      if (!next) break;
      const [color, position] = next;
      const [male, female] = byTarget.get(color)![position];
      // `mostBehind` vient de garantir les deux ; on relit quand même, plutôt
      // que d'écrire un `!` qui tomberait le jour où le prédicat et la prise
      // cesseraient de s'accorder.
      const maleIndex = takeCycled(male);
      if (maleIndex === null) break;
      const femaleIndex = takeCycled(female);
      if (femaleIndex === null) {
        free[male].push(maleIndex);
        break;
      }
      plan.crossings.push([maleIndex, femaleIndex]);
      plan.optimakina.push(false);
      made.set(color, (made.get(color) ?? 0) + 1);
    }
  }

  for (const [, here] of tiers) {
    while (places < view.capacity) {
      const next = mostBehind(here);
      if (!next) break;
      const [color, position] = next;
      const result = launch(byTarget.get(color)![position]);
      if (result === 'yes') made.set(color, (made.get(color) ?? 0) + 1);
      else if (result === 'retry') continue;
      else break;
    }
  }

  /**
   * La teinte de gen 1 à acheter pour moissonner ce sujet-là.
   *
   * Le partenaire ne se choisit pas au hasard : c'est lui qui décide de quelle
   * couleur sort le poulain, donc de ce qu'il vaudra. On prend celle dont la
   * cible la plus probable est la mieux payée du jour — le jeu tire un prix par
   * couleur, et l'éleveur les a saisis.
   */
  const bestStarter = (subject: number, sex: Sex): string | null => {
    let best: [string, number] | null = null;
    for (const color of colors) {
      if (color.generation !== 1) continue;
      const partner: Mate = {
        id: null,
        colorId: color.id,
        sex: sex === 'M' ? 'F' : 'M',
        level: view.mountLevel,
        parents: null,
      };
      const [male, female] =
        sex === 'M' ? [groups[subject].sample, partner] : [partner, groups[subject].sample];
      const outlook = pairOutlook(male, female, colors, generations);
      if (!outlook || !climbs(outlook)) continue;
      const target = outlook.targetColors[0];
      if (!target) continue;
      const value = economy.valueOf(target.colorId);
      // À valeur égale, l'ordre du catalogue — le même départage qu'ailleurs.
      if (
        best === null ||
        value > best[1] ||
        (value === best[1] && (rank.get(color.id) ?? 0) < (rank.get(best[0]) ?? 0))
      ) {
        best = [color.id, value];
      }
    }
    return best === null ? null : best[0];
  };

  /* ------------------------------------------------------------ la moisson -- */

  const starter = economy.starterPrice;
  let budget = view.kamas - view.loadKamas;

  /**
   * Monnayer ce que le plan ne sait pas employer.
   *
   * Un croisement réussi paie des génétons, et le barème est quasi exponentiel :
   * une gen 9 réussie en rend 250 à elle seule. L'écurie d'un éleveur porte
   * toujours des couleurs hors route ; les laisser dormir, c'est laisser ça.
   *
   * **Ce qu'on ne touche pas** : les gen 1 des blocs. Elles ne sont pas dans
   * `wanted` — on les achète au lieu de les produire — mais elles sont la matière
   * première de l'étage 1. Les moissonner reviendrait à brûler la base de
   * l'échelle pour un géneton, et c'est mesuré côté Rust : sans cette exclusion,
   * le départ de zéro perdait 1,5 M.
   */
  if (options.harvest !== false) {
    const planMaterial = (colorId: string) =>
      ladder.wanted.has(colorId) || ladder.blocks.some((block) => block.includes(colorId));

    /**
     * Le goulot du plan : la plus petite part `tenu / demandé` parmi les couleurs
     * voulues. Même lecture que `mostBehind`, qui fabrique en priorité ce qui est
     * le plus en retard.
     *
     * Une couleur **stockée** est celle qui n'est pas ce goulot : la moissonner ne
     * retarde donc rien de ce que le plan attend. Les gen 9 y tombent d'elles-mêmes
     * dès que la couronne cesse de les absorber.
     *
     * On lit `held` seul et non `held + made` — contrairement à `mostBehind` — parce
     * que la décision porte sur le stock **debout** en début de fournée, et parce que
     * c'est ce que fait le Rust : la parité se juge au plan près.
     *
     * Au premier chargement tout vaut zéro : le minimum est zéro, aucune couleur ne
     * le dépasse, et la moisson reste exactement celle d'avant.
     */
    const ratio = (colorId: string): number => {
      const want = ladder.demand.get(colorId) ?? 0;
      if (want <= 0) return Number.POSITIVE_INFINITY;
      return (held.get(colorId) ?? 0) / want;
    };
    let bottleneck = Number.POSITIVE_INFINITY;
    for (const colorId of ladder.wanted) bottleneck = Math.min(bottleneck, ratio(colorId));
    const stocked = (colorId: string) =>
      options.harvestStocked === true && ratio(colorId) > bottleneck && ratio(colorId) > 0;

    const spare = groups
      .map((group, at) => at)
      .filter((at) => !planMaterial(groups[at].colorId) || stocked(groups[at].colorId));

    if (spare.length > 0) {
      const weight = (at: number) => genetonWeight(generations.get(groups[at].colorId) ?? 1);
      // Les plus hautes d'abord : à places comptées, ce sont elles qui paient.
      const order = [...spare].sort(
        (a, b) =>
          weight(b) - weight(a) ||
          (rank.get(groups[b].colorId) ?? 0) - (rank.get(groups[a].colorId) ?? 0)
      );

      for (const subject of order) {
        while (places < view.capacity && free[subject].length > 0) {
          const sex = groups[subject].sex;

          // Le partenaire le moins cher de l'écurie : celui dont on se prive le
          // moins. `climbs` et non « a une cible » : les génétons ne tombent que
          // si l'enfant dépasse l'ascendance.
          let best: [number, number] | null = null;
          for (const other of spare) {
            if (other === subject || groups[other].sex === sex || free[other].length === 0) continue;
            const [male, female] =
              sex === 'M'
                ? [groups[subject].sample, groups[other].sample]
                : [groups[other].sample, groups[subject].sample];
            const outlook = pairOutlook(male, female, colors, generations);
            if (!outlook || !climbs(outlook)) continue;
            const cost = weight(other);
            if (best === null || cost < best[0]) best = [cost, other];
          }

          // Une gen 1 neuve pèse un géneton et coûte mille kamas. Encore faut-il
          // qu'elle se rembourse : les génétons ne tombent qu'en cas de succès,
          // donc `taux × (G(sujet) + G(1)) × prix ≥ prix de la gen 1`. Sur un
          // sujet de gen 2 ça donne 809 kamas espérés pour 1 000 dépensés — on y
          // perd, et sans ce garde-fou la moisson asséchait le budget que
          // l'étage 1 attendait pour acheter.
          const expected =
            successRate(view.mountLevel, economy, false) *
            (weight(subject) + genetonWeight(1)) *
            economy.genetonValue;
          const bought =
            budget >= starter && expected >= starter ? bestStarter(subject, sex) : null;

          const takeBought =
            bought !== null && (best === null || best[0] > genetonWeight(1));

          if (takeBought) {
            const index = mounts.length + plan.purchases.length;
            const subjectIndex = free[subject][free[subject].length - 1];
            const pair: [number, number] =
              sex === 'M' ? [subjectIndex, index] : [index, subjectIndex];
            // L'achetée doit son cycle par construction ; le sujet, pas forcément.
            const cost = placesFor(mounts, pair);
            if (places + cost > view.capacity) break;
            free[subject].pop();
            plan.purchases.push([bought!, sex === 'M' ? 'F' : 'M']);
            plan.crossings.push(pair);
            plan.optimakina.push(false);
            places += cost;
            budget -= starter;
            continue;
          }

          if (best === null) break;
          const other = best[1];
          const subjectIndex = free[subject][free[subject].length - 1];
          const otherIndex = free[other][free[other].length - 1];
          if (subjectIndex === undefined || otherIndex === undefined) break;
          const pair: [number, number] =
            sex === 'M' ? [subjectIndex, otherIndex] : [otherIndex, subjectIndex];
          const cost = placesFor(mounts, pair);
          if (places + cost > view.capacity) break;
          free[subject].pop();
          free[other].pop();
          plan.crossings.push(pair);
          plan.optimakina.push(false);
          places += cost;
        }
      }
    }
  }

  if (options.purchases === false) return settle(plan, view, ladder, topGeneration, options);

  /* ------------------------------------------------------------- les achats -- */

  /** Ce que l'achat a déjà engagé cette fournée, par gen 2 visée. */
  const bought = new Map<string, number>();

  /**
   * La paire de gen 1 qui produit la gen 2 dont on est le plus en retard.
   *
   * L'étage 1 seul : c'est tout ce qu'une paire de gen 1 peut viser. Une recette
   * qui se recopie — deux fois la même teinte — ne nomme rien et ne compte pas.
   */
  const mostNeededPurchase = (): [string, string] | null => {
    let choice: [number, string, [string, string]] | null = null;
    for (const color of ladder.wanted) {
      if ((generations.get(color) ?? 1) !== 2) continue;
      const want = ladder.demand.get(color) ?? 0;
      if (want <= 0) continue;
      const recipe = ladder.recipeOf.get(color);
      if (!recipe || recipe[0] === recipe[1]) continue;

      const stock =
        (held.get(color) ?? 0) + (made.get(color) ?? 0) + (bought.get(color) ?? 0);
      const lag = stock / want;
      // La couleur tranche les égalités, dans l'ordre du catalogue : sans ça
      // l'ordre dépendrait du parcours de l'ensemble et deux exécutions
      // différeraient.
      if (
        choice === null ||
        lag < choice[0] ||
        (lag === choice[0] && (rank.get(color) ?? 0) < (rank.get(choice[1]) ?? 0))
      ) {
        choice = [lag, color, [recipe[0], recipe[1]]];
      }
    }
    return choice === null ? null : choice[2];
  };

  while (places + 2 <= view.capacity && budget >= 2 * starter && ladder.blocks.length > 0) {
    const recipe = mostNeededPurchase();
    // Aucune gen 2 ne réclame quoi que ce soit : les places restantes valent
    // mieux vides qu'employées à produire du hors-plan.
    if (!recipe) break;

    for (const [color, wanted] of ladder.recipeOf) {
      if (wanted[0] === recipe[0] && wanted[1] === recipe[1]) {
        bought.set(color, (bought.get(color) ?? 0) + 1);
        break;
      }
    }

    const base = mounts.length + plan.purchases.length;
    plan.purchases.push([recipe[0], 'M'], [recipe[1], 'F']);
    plan.crossings.push([base, base + 1]);
    plan.optimakina.push(false);
    places += 2;
    budget -= 2 * starter;
  }


  return settle(plan, view, ladder, topGeneration, options);
};
