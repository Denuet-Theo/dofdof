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
 * ## Ce qui n'est pas encore porté
 *
 * La **moisson** — extraire des génétons de ce qui est hors plan — et le
 * **réglage du niveau** (`tuned_for`). Les deux comptent : le banc mesure
 * l'échelle à +36 M sans le réglage et +70 M avec. Ce module rend donc la
 * composition, qui est déjà le double du champion, et les deux morceaux
 * suivants ont leur propre mesure à faire. `check-ladder-policy.mjs` compare
 * donc au Rust configuré `harvesting: false`, sans quoi la garde comparerait
 * deux politiques différentes et rougirait pour la mauvaise raison.
 *
 * Le **sommet** n'est pas porté non plus, et c'est sans effet : `Summit::Hold`
 * est le défaut des deux côtés, donc la branche ne s'exécute jamais.
 */

import type { BreedingColor } from './costs';
import type { EconomyView } from './census';
import { aimsAt, type Ladder } from './ladder';
import { canonicalParents, type Mate } from './pairing';
import { emptyPlan, type UnitPlan } from './search';
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
  if (ladder.wanted.size === 0) return plan;

  const { mounts, colors, generations, economy } = view;
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
  const mostBehind = (here: string[]): [string, number] | null => {
    let choice: [number, string, number] | null = null;
    for (const color of here) {
      const want = ladder.demand.get(color) ?? 0;
      if (want <= 0) continue;
      const pairs = byTarget.get(color);
      if (!pairs) continue;
      const position = pairs.findIndex(
        ([male, female]) => male !== female && free[male].length > 0 && free[female].length > 0
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

  if (options.purchases === false) return plan;

  /* ------------------------------------------------------------- les achats -- */

  const starter = economy.starterPrice;
  let budget = view.kamas - view.loadKamas;
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

  return plan;
};
