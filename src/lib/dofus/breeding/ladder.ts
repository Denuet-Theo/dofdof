import { pairOutlook, type Mate } from './pairing';
import type { BreedingColor } from './costs';

/**
 * L'échelle, portée dans le navigateur : le plan déduit de l'arbre, et la seule
 * règle qui décide si un accouplement mérite d'être proposé.
 *
 * ## Pourquoi ce module existe
 *
 * L'écran propose les accouplements que la politique entraînée compose, et elle
 * en compose qui ne peuvent **rien** rendre : le panneau d'accouplement les
 * affiche lui-même « rien à gagner ». Ce n'est pas un défaut d'affichage. Un
 * croisement dont l'ascendance force la cible un cran trop haut ne nomme aucune
 * couleur, donc le jeu recopie l'ascendance, ne paie aucun géneton, et stérilise
 * les deux parents. Relevé sur une écurie réelle de 36 montures : sur les 169
 * appariements possibles, **9** visaient quelque chose.
 *
 * La politique en échelle — `rust/breeding-sim/src/ladder.rs`, dont ceci est le
 * portage de la partie qui décide — n'en propose aucun, et c'est mesuré : 0 %
 * d'accouplements sans cible contre 50,5 % pour la recherche myope, sur deux
 * cents graines.
 *
 * ## La règle, et elle seule
 *
 * > **Un croisement est admissible si et seulement si ses couleurs cibles sont
 * > non vides et toutes dans le plan.**
 *
 * Elle suffit parce que la cible se lit sur les six cases d'ascendance et sur
 * rien d'autre — voir `pairTargetGeneration`. Elle rejette d'elle-même tout ce
 * qu'il aurait fallu écarter à la main : deux gen 1 de blocs différents, une
 * rescapée mariée à une gen 1 ordinaire, deux rescapées de barreaux différents,
 * deux `Doré-*` identiques là où le Roux exige deux teintes distinctes.
 *
 * ## Ce qui n'est pas porté
 *
 * La politique complète — l'ordonnancement des fournées, la moisson, le clonage,
 * la couronne qui choisit la gen 10 la mieux payée. Ici on ne porte que le
 * **plan** et l'**admissibilité**, parce que c'est ce qui répond à la question
 * posée à l'écran : « celui-ci, faut-il le proposer ? ». Le reste continue de
 * venir du champion entraîné.
 */

/**
 * Comment on passe de la gen 3 à la gen 5.
 *
 * Les deux routes atteignent la cible au même taux ; ce qui les sépare est la
 * dispersion des ratés. Mesuré sur 200 graines appariées : `+0,65 M ± 0,55`,
 * t = 1,19 — indifférent une fois l'échelle entière montée.
 */
export type Route = 'shared' | 'disjoint';

/** Le plan déduit de l'arbre : ce qu'on s'autorise à produire, et comment. */
export type Ladder = {
  /** Toute couleur qu'on accepte de produire. Ce qui naît en dehors est hors plan. */
  wanted: Set<string>;
  /** La recette retenue pour chaque couleur voulue. */
  recipeOf: Map<string, readonly [string, string]>;
  /** Combien d'unités il en faut pour une unité de chaque cible finale. */
  demand: Map<string, number>;
  /** Les blocs fermés de gen 1, qui disent quoi acheter. */
  blocks: string[][];
  /** Les couleurs les plus hautes du plan : ce qu'on cherche à produire. */
  summit: string[];
};

/** Le plus haut barreau que l'échelle sait poser aujourd'hui. */
export const TOP_RUNG = 7;

/**
 * L'ordre du catalogue, qui départage les jeux de couleurs à égalité.
 *
 * Le Rust compare des `ColorId` numériques, c'est-à-dire l'ordre du catalogue.
 * Comparer les identifiants textuels à la place rendrait un autre plan sur
 * certains arbres — même règle, autre arbitrage — donc on garde l'ordre du
 * catalogue et non l'alphabet.
 */
type Index = Map<string, number>;

const byCatalogOrder = (index: Index) => (a: string, b: string) =>
  (index.get(a) ?? 0) - (index.get(b) ?? 0);

/** Compare deux listes déjà triées, longueur d'abord — l'ordre du Rust. */
const shorterThenSmaller = (left: string[], right: string[], index: Index): boolean => {
  if (left.length !== right.length) return left.length < right.length;
  for (let position = 0; position < left.length; position += 1) {
    const delta = (index.get(left[position]) ?? 0) - (index.get(right[position]) ?? 0);
    if (delta !== 0) return delta < 0;
  }
  return false;
};

/**
 * La composition d'une couleur : ses deux teintes, telles que l'arbre les nomme.
 *
 * Une composée n'a qu'une composition — c'est ce qui la définit — même quand
 * plusieurs recettes la produisent.
 */
const constituents = (
  color: BreedingColor | undefined
): readonly [string, string] | null => color?.recipes[0] ?? null;

/** Le produit cartésien des recettes, énuméré par son indice. */
const pick = <T,>(options: T[][], index: number): T[] => {
  let rest = index;
  return options.map((choices) => {
    const chosen = choices[rest % choices.length];
    rest = Math.floor(rest / choices.length);
    return chosen;
  });
};

const emptyLadder = (): Ladder => ({
  wanted: new Set(),
  recipeOf: new Map(),
  demand: new Map(),
  blocks: [],
  summit: [],
});

/**
 * La gen 3 : un jeu de gen 2 minimal **et fermé** couvrant toutes les gen 3.
 *
 * Le choix n'est pas libre. En lisant chaque gen 2 comme une **arête** entre ses
 * deux gen 1, le jeu retenu doit être une union disjointe de cliques : un raté de
 * `A × B` rend une gen 1 portant `[A, B]`, et la réemployer face à un C fait
 * rencontrer B et C, qui nomment `B-C`. Dans une clique `B-C` est voulue et rien
 * n'est perdu ; sinon la cible se dédouble et 27 % de la masse utile s'en va.
 *
 * Sur les 18 jeux possibles du muldo, 6 sont fermés — tous de la forme
 * *triangle + arête isolée*.
 */
const layThird = (ladder: Ladder, colors: BreedingColor[], index: Index): boolean => {
  const byId = new Map(colors.map((color) => [color.id, color]));
  const third = colors.filter((color) => color.generation === 3);
  if (third.length === 0) return false;

  const choices = third.map((color) =>
    [...color.recipes].sort(
      (a, b) => byCatalogOrder(index)(a[0], b[0]) || byCatalogOrder(index)(a[1], b[1])
    )
  );
  if (choices.some((recipes) => recipes.length === 0)) return false;

  let best: {
    seconds: string[];
    recipes: Map<string, readonly [string, string]>;
    blocks: string[][];
  } | null = null;

  const total = choices.reduce((product, recipes) => product * recipes.length, 1);

  for (let attempt = 0; attempt < total; attempt += 1) {
    const picked = pick(choices, attempt);
    const recipes = new Map<string, readonly [string, string]>();
    const seconds = new Set<string>();
    picked.forEach((recipe, position) => {
      seconds.add(recipe[0]);
      seconds.add(recipe[1]);
      recipes.set(third[position].id, recipe);
    });

    // Chaque gen 2 voulue est une arête entre ses deux gen 1.
    const edges = new Set<string>();
    const vertices = new Set<string>();
    let sound = true;
    for (const colorId of seconds) {
      const pair = constituents(byId.get(colorId));
      if (!pair || pair[0] === pair[1]) {
        sound = false;
        break;
      }
      const [a, b] = [...pair].sort();
      edges.add(`${a}|${b}`);
      vertices.add(pair[0]);
      vertices.add(pair[1]);
    }
    if (!sound) continue;

    const joined = (a: string, b: string) => {
      const [first, second] = [a, b].sort();
      return edges.has(`${first}|${second}`);
    };
    const neighbours = (vertex: string) =>
      [...vertices].filter((other) => other !== vertex && joined(vertex, other));

    // Fermeture : deux arêtes partageant un sommet exigent la troisième.
    const closed = [...vertices].every((vertex) => {
      const near = neighbours(vertex);
      return near.every((x) => near.every((y) => x === y || joined(x, y)));
    });
    if (!closed) continue;

    // Les blocs sont les composantes connexes, qui sont donc les cliques.
    const blocks: string[][] = [];
    const seen = new Set<string>();
    for (const start of [...vertices].sort(byCatalogOrder(index))) {
      if (seen.has(start)) continue;
      seen.add(start);
      const block = [start];
      const queue = [start];
      while (queue.length > 0) {
        const vertex = queue.pop()!;
        for (const next of neighbours(vertex)) {
          if (seen.has(next)) continue;
          seen.add(next);
          block.push(next);
          queue.push(next);
        }
      }
      blocks.push(block.sort(byCatalogOrder(index)));
    }

    const order = [...seconds].sort(byCatalogOrder(index));
    if (best === null || shorterThenSmaller(order, best.seconds, index)) {
      best = { seconds: order, recipes, blocks };
    }
  }

  if (!best) return false;

  for (const colorId of best.seconds) {
    const recipe = constituents(byId.get(colorId));
    if (!recipe) continue;
    ladder.wanted.add(colorId);
    ladder.recipeOf.set(colorId, recipe);
  }
  for (const [colorId, recipe] of best.recipes) {
    ladder.wanted.add(colorId);
    ladder.recipeOf.set(colorId, recipe);
    ladder.summit.push(colorId);
  }
  ladder.blocks = best.blocks;
  ladder.summit.sort(byCatalogOrder(index));
  return true;
};

/**
 * Un barreau impair : choisir une recette par cible, selon la route.
 *
 * Deux critères, dans cet ordre :
 *
 * 1. **Le travail accumulé**, mesuré par la somme des générations des
 *    ingrédients de chaque composée retenue. Une gen 6 faite d'une gen 5 et
 *    d'une gen 1 coûte 6 ; la même faite de deux gen 5 coûte 10, et ces deux
 *    gen 5 sont ce que la montée a de plus rare.
 * 2. **Les gen 1 les moins sollicitées** par les barreaux du dessous, à coût
 *    égal.
 *
 * Rend `false` quand la route demandée n'a aucun candidat — l'appelant se rabat
 * alors sur l'autre plutôt que d'interrompre la montée.
 */
const layRung = (
  ladder: Ladder,
  colors: BreedingColor[],
  index: Index,
  generation: number,
  route: Route
): boolean => {
  const byId = new Map(colors.map((color) => [color.id, color]));
  const generationOf = (colorId: string) => byId.get(colorId)?.generation ?? 0;
  const targets = colors.filter((color) => color.generation === generation);
  if (targets.length < 2) return false;

  // Ce que chaque gen 1 sert déjà, pour départager à coût égal.
  const usage = new Map<string, number>();
  for (const colorId of ladder.wanted) {
    const recipe = constituents(byId.get(colorId));
    if (!recipe) continue;
    for (const ingredient of recipe) {
      if (generationOf(ingredient) === 1) {
        usage.set(ingredient, (usage.get(ingredient) ?? 0) + 1);
      }
    }
  }

  /** Le travail qu'une composée a demandé, puis la charge qu'elle ajoute. */
  const toll = (colorId: string): [number, number] => {
    const recipe = constituents(byId.get(colorId));
    if (!recipe) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    return [
      generationOf(recipe[0]) + generationOf(recipe[1]),
      (usage.get(recipe[0]) ?? 0) + (usage.get(recipe[1]) ?? 0),
    ];
  };

  const options = targets.map((color) =>
    [...color.recipes].sort(
      (a, b) => byCatalogOrder(index)(a[0], b[0]) || byCatalogOrder(index)(a[1], b[1])
    )
  );
  if (options.some((recipes) => recipes.length === 0)) return false;

  let best: {
    work: number;
    strain: number;
    ingredients: string[];
    picked: readonly (readonly [string, string])[];
  } | null = null;

  const total = options.reduce((product, recipes) => product * recipes.length, 1);

  for (let attempt = 0; attempt < total; attempt += 1) {
    const picked = pick(options, attempt);
    const ingredients = picked.flatMap((recipe) => [...recipe]).sort(byCatalogOrder(index));
    const distinct = [...new Set(ingredients)];
    const shared = ingredients.length - distinct.length;

    // Cas 1 : au moins un pivot partagé. Cas 2 : aucun.
    if (route === 'shared' ? shared < 1 : shared !== 0) continue;

    const work = distinct.reduce((sum, colorId) => sum + toll(colorId)[0], 0);
    const strain = distinct.reduce((sum, colorId) => sum + toll(colorId)[1], 0);

    const better =
      best === null ||
      work < best.work ||
      (work === best.work &&
        (strain < best.strain ||
          (strain === best.strain && shorterThenSmaller(distinct, best.ingredients, index))));
    if (better) best = { work, strain, ingredients: distinct, picked };
  }

  if (!best) return false;

  for (const colorId of best.ingredients) {
    const recipe = constituents(byId.get(colorId));
    if (!recipe) continue;
    ladder.wanted.add(colorId);
    ladder.recipeOf.set(colorId, recipe);
  }
  ladder.summit = [];
  best.picked.forEach((recipe, position) => {
    const colorId = targets[position].id;
    ladder.wanted.add(colorId);
    ladder.recipeOf.set(colorId, recipe);
    ladder.summit.push(colorId);
  });
  ladder.summit.sort(byCatalogOrder(index));
  return true;
};

/**
 * Combien d'unités de chaque couleur il faut pour une unité de sommet.
 *
 * Propagé depuis le haut : c'est lui qui donne le « deux fois plus de
 * Roux-Amande » sans qu'on ait à l'écrire.
 */
const spreadDemand = (ladder: Ladder, colors: BreedingColor[]) => {
  const generationOf = new Map(colors.map((color) => [color.id, color.generation]));
  ladder.demand.clear();
  for (const colorId of ladder.summit) ladder.demand.set(colorId, 1);

  const order = [...ladder.wanted].sort(
    (a, b) => (generationOf.get(b) ?? 0) - (generationOf.get(a) ?? 0) || b.localeCompare(a)
  );

  for (const colorId of order) {
    const share = ladder.demand.get(colorId) ?? 0;
    if (share <= 0) continue;
    const recipe = ladder.recipeOf.get(colorId);
    if (!recipe) continue;
    for (const ingredient of recipe) {
      if (ladder.wanted.has(ingredient)) {
        ladder.demand.set(ingredient, (ladder.demand.get(ingredient) ?? 0) + share);
      }
    }
  }
};

/** Les échelles déjà posées, une par catalogue et par route. */
const ladderCache = new WeakMap<BreedingColor[], Map<Route, Ladder>>();

/**
 * Le plan de l'échelle pour cette famille.
 *
 * Ne dépend que de l'arbre, donc se calcule une fois : l'énumération des jeux de
 * gen 2 et de gen 4 est un produit cartésien, négligeable une fois mais pas à
 * chaque rendu.
 */
export const ladderOf = (colors: BreedingColor[], route: Route = 'disjoint'): Ladder => {
  let byRoute = ladderCache.get(colors);
  if (!byRoute) {
    byRoute = new Map();
    ladderCache.set(colors, byRoute);
  }
  const cached = byRoute.get(route);
  if (cached) return cached;

  const index: Index = new Map(colors.map((color, position) => [color.id, position]));
  const ladder = emptyLadder();

  if (!layThird(ladder, colors, index)) {
    byRoute.set(route, ladder);
    return ladder;
  }

  // On monte de deux en deux : les couleurs simples sont aux générations
  // impaires, et ce sont elles qui font les barreaux.
  for (let rung = 5; rung <= TOP_RUNG; rung += 2) {
    if (layRung(ladder, colors, index, rung, route)) continue;
    // La route demandée peut n'avoir aucun candidat — chez le muldo, Prune et
    // Émeraude ne partagent aucune gen 6. On se rabat plutôt que de s'arrêter :
    // interrompre la montée fausserait la comparaison entre les routes.
    const fallback: Route = route === 'shared' ? 'disjoint' : 'shared';
    if (!layRung(ladder, colors, index, rung, fallback)) break;
  }

  spreadDemand(ladder, colors);
  byRoute.set(route, ladder);
  return ladder;
};

/**
 * La couleur qu'un couple vise, **s'il est admissible**.
 *
 * `null` dès qu'il ne nomme rien — recopie, deux fécondités brûlées pour rien —
 * ou qu'une de ses cibles sort du plan. Quand plusieurs couleurs voulues sont
 * atteignables, on retient la plus probable : `targetColors` est triée par poids
 * décroissant.
 */
export const aimsAt = (
  male: Mate,
  female: Mate,
  colors: BreedingColor[],
  generations: Map<string, number>,
  ladder: Ladder
): string | null => {
  const outlook = pairOutlook(male, female, colors, generations);
  if (!outlook || outlook.targetColors.length === 0) return null;
  if (!outlook.targetColors.every((target) => ladder.wanted.has(target.colorId))) return null;
  return outlook.targetColors[0].colorId;
};

/**
 * Le couple nomme-t-il quelque chose, plan mis à part ?
 *
 * C'est la moitié de la règle, et la seule qui vaille sur une écurie **qu'on n'a
 * pas montée à l'échelle** : le plan décrit une route depuis zéro, alors qu'un
 * éleveur arrive avec ce qu'il a. Refuser tout ce qui sort du plan lui
 * supprimerait des croisements qui, eux, rendent bien une couleur — voir
 * `admissibility` dans l'écran, qui choisit laquelle des deux lectures appliquer.
 */
export const namesSomething = (
  male: Mate,
  female: Mate,
  colors: BreedingColor[],
  generations: Map<string, number>
): boolean => {
  const outlook = pairOutlook(male, female, colors, generations);
  return outlook !== null && outlook.targetColors.length > 0;
};
