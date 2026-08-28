import { climbs, pairOutlook, type Mate, type PairOutlook } from './pairing';
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
 * cents graines. Ce 0 % est celui du Rust **couronné** ; il n'était pas
 * transposable ici tant que la couronne manquait, et il l'est depuis qu'elle est
 * portée — voir `crownAt` et `crownedLadderOf`.
 *
 * ## La règle, et elle seule
 *
 * > **Un croisement est admissible si et seulement s'il gagne une génération et
 * > que toutes ses couleurs cibles sont dans le plan — ou qu'il est au sommet,
 * > où il n'y a plus de route à suivre.**
 *
 * Elle suffit parce que la cible se lit sur les six cases d'ascendance et sur
 * rien d'autre — voir `pairTargetGeneration`. Elle rejette d'elle-même tout ce
 * qu'il aurait fallu écarter à la main : deux gen 1 de blocs différents, une
 * rescapée mariée à une gen 1 ordinaire, deux rescapées de barreaux différents,
 * deux `Doré-*` identiques là où le Roux exige deux teintes distinctes.
 *
 * La première moitié se lisait « ses couleurs cibles sont non vides », ce qui
 * était le même énoncé tant qu'un couple au plafond était refusé en amont. Ce
 * n'est plus le cas depuis #185 : au sommet la fenêtre est pleine et ne gagne
 * rien. Voir `aimsAt`, et `climbs` dans `pairing.ts`.
 *
 * ## Ce que ce module porte, et où vit le reste
 *
 * Ici : le **plan**, la **couronne** et l'**admissibilité** — ce qui répond à la
 * question posée à l'écran, « celui-ci, faut-il le proposer ? ».
 *
 * Le reste — composer la fournée, les achats, les clonages, les sacrifices, la
 * moisson — est dans `ladder-policy.ts`, porté et comparé au Rust coup pour coup.
 *
 * Ce paragraphe disait « le reste continue de venir du champion entraîné », et
 * c'est faux depuis le 27/08 : le champion a quitté le TypeScript avec
 * `search.ts`, `network.ts` et `champion.json`. Une phrase qui envoie le lecteur
 * vers un module supprimé coûte plus qu'un paragraphe absent.
 *
 * La couronne a longtemps manqué, et son absence n'était pas neutre : sans elle
 * `summit` gardait **toutes** les couleurs du dernier rang impair, `wanted` était
 * strictement plus large que celui du Rust, et `aimsAt` admettait donc des
 * croisements que la politique mesurée refuse. Mesuré au portage, sur 200 tirages
 * de prix de gen 10 en cloche autour de 600 000 :
 *
 * | famille | avant | après | ce qui sort |
 * | --- | --- | --- | --- |
 * | dragodinde | 18 | 17 | une gen 9 sur deux, et la gen 8 qu'elle seule servait |
 * | muldo | 30 | 19 ou 22 | 3 gen 9 sur 4, et les gen 6/7/8 qu'elles seules servaient |
 * | volkorne | 28 | 23 | 3 gen 9 sur 4, et leurs gen 8 |
 *
 * Et en croisements admissibles, sur toutes les paires de couleurs du catalogue :
 * 36 → 34 chez la dragodinde, 154 → 94/102/114 chez le muldo, 138 → 122 chez le
 * volkorne. Aucun accouplement sans cible n'est jamais admis, avant comme après.
 */

/**
 * Comment on passe de la gen 3 à la gen 5.
 *
 * Les deux routes atteignent la cible au même taux ; ce qui les sépare est la
 * dispersion des ratés. Mesuré sur 200 graines appariées : `+0,65 M ± 0,55`,
 * t = 1,19 — indifférent une fois l'échelle entière montée.
 */
export type Route = 'shared' | 'disjoint';

/**
 * La route qu'on prend quand l'appelant n'en nomme pas.
 *
 * Elle n'était écrite nulle part : `disjoint` ici par un défaut de paramètre sans
 * commentaire, `Shared` dans la source Rust où `Route` n'avait pas de `Default` et
 * où **tous** les sites d'appel le passaient à la main. Les deux échelles
 * décrivaient donc un plan différent pour le même arbre, sans qu'une ligne ne dise
 * laquelle avait raison.
 *
 * ## Ce qu'on a mesuré, et ce qui a surpris
 *
 * Le plan d'abord, les deux routes posées sur les trois familles. `shared` est
 * plus **petit**, vise le même sommet et achète les mêmes blocs :
 *
 * | famille | couleurs `disjoint` | couleurs `shared` | qui diffèrent | blocs | sommet |
 * | --- | --- | --- | --- | --- | --- |
 * | dragodinde | 18 | 18 | 0 | mêmes | mêmes |
 * | muldo | 30 | 25 | 7 | mêmes | mêmes |
 * | volkorne | 28 | 27 | 7 | mêmes | mêmes |
 *
 * Compter les couleurs suggérait donc d'aligner le portage sur le Rust. Le
 * **travail propagé** dit l'inverse — somme des demandes pour une unité de
 * sommet, c'est-à-dire le nombre de croisements que le plan réclame :
 *
 * | famille | `disjoint` | `shared` |
 * | --- | --- | --- |
 * | dragodinde | 222 | 222 |
 * | muldo | **204** | 252 (+24 %) |
 * | volkorne | **228** | 276 (+21 %) |
 *
 * Et joué, l'écart est plus large encore. `simulatePolicy` sur le Corail-Pourpre
 * du muldo, dix graines × vingt parties, seule la route changeant :
 *
 * | route | croisements (médiane) | coût (médiane) | aboutit à budget serré |
 * | --- | --- | --- | --- |
 * | `disjoint` | **1 369** | **16,7 M** | **36,5 %** |
 * | `shared` | 2 794 | 34,9 M | 2,0 % |
 *
 * Les dix graines ne se recouvrent pas (1 248–1 580 contre 2 653–2 927), pour un
 * bruit inter-graines de 15 %. Le Rust dit la même chose depuis que le plafond est
 * tombé : `bin/bench`, 200 graines, l'échelle rend 59,87 M en `Disjoint` contre
 * 52,72 M en `Shared`. C'est donc le Rust qu'on aligne, pas l'inverse.
 *
 * ## Pourquoi la route qui compte moins de couleurs coûte plus cher
 *
 * Le pivot partagé du muldo est `roux_amande`, une gen 4 faite de **deux gen 3**.
 * `disjoint` prend à la place `roux_dore` et `dore_amande`, chacune une gen 3 et
 * une gen 1 — qui s'achète à mille kamas. Le critère de `layRung` compte le
 * travail **local** d'un jeu de gen 4, et il donne raison à `shared` (14 contre
 * 16) ; la demande propagée compte le travail **réel** et le condamne, parce que
 * la gen 4 pivot est réclamée seize fois. La gen 2 passe de 80 à 112, la gen 3 de
 * 40 à 56.
 */
const DEFAULT_ROUTE: Route = 'disjoint';

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
  /**
   * Un croisement doit-il **gagner une génération**, et pas seulement des
   * croisements de construction ?
   *
   * `climbs` compare des coûts et non des rangs, ce qui admet un croisement
   * latéral — même génération, couleur plus chère à bâtir. C'est délibéré et
   * mesuré : c'est le seul chemin vers la couleur chère d'un rang, et le retirer
   * coûtait 41 M au volkorne et 34 M à la dragodinde. Voir `climbs`.
   *
   * Sur le **muldo**, l'éleveur a signalé le contraire depuis sa fenêtre de jeu :
   * une gen 6 dépensée pour une autre gen 6, sans géneton et sans rang gagné.
   * Mesuré sur son export du 28/08, 100 graines, couronne du projet, moisson
   * étendue éteinte, encaissé :
   *
   * | fournées | sans la règle | avec |
   * | --- | --- | --- |
   * | 30 | 26,75 M | 24,82 M |
   * | 60 | 42,97 M | 42,45 M |
   * | 90 | 52,21 M | 52,40 M |
   * | 120 | 57,28 M | **61,10 M** |
   * | 150 | 64,11 M | **68,94 M** |
   *
   * Elle perd court et gagne long, et tient plus de gen 10 aux cinq horizons —
   * 4,8 contre 2,6 à 120 fournées. **Les deux autres familles ne sont pas
   * mesurées** dans ce régime, d'où une règle par famille plutôt qu'un
   * renversement général.
   */
  climbMustGainGeneration: boolean;
};

/**
 * Les familles où un croisement doit gagner un rang, et pas seulement du coût.
 *
 * Le jumeau de `CLIMB_MUST_GAIN_GENERATION` dans `ladder.rs`. **Les deux côtés
 * doivent bouger ensemble** — `check-ladder-parity.mjs` compare les plans, et
 * `check-ladder.mjs` la règle elle-même.
 *
 * Pas dans `trees.json` : ce fichier est régénéré par
 * `extract-breeding-trees.mjs`, donc un drapeau posé dedans disparaîtrait au
 * prochain extract sans que rien ne rougisse.
 */
export const CLIMB_MUST_GAIN_GENERATION: readonly string[] = ['muldo'];

/**
 * Le plafond a été retiré.
 *
 * Il valait 7, avec pour toute justification « le plus haut barreau que
 * l'échelle sait poser aujourd'hui » — un état des lieux, pas une
 * démonstration. Mesuré avant de le retirer : à 9, `check-ladder` reste vert sur
 * les trois familles, et le plan passe de 18 à 30 couleurs chez le muldo, de 13
 * à 18 chez la dragodinde. La règle tenait donc déjà plus haut que le plafond ne
 * la laissait aller.
 *
 * La montée s'arrête maintenant sur `layRung`, qui rend `false` quand un rang n'a
 * **aucune** cible ou aucun jeu de recettes candidat, les deux routes essayées
 * avant d'abandonner. C'est la bonne borne — celle de la famille — au lieu d'un
 * nombre écrit à la main qui vaut pour toutes.
 *
 * ## Une phrase à corriger
 *
 * Le corps du commit qui a retiré le plafond disait que le volkorne s'arrêtait au
 * rang 5 parce que « l'arbre le dit », faute de jeu candidat au rang 9. C'est
 * inexact et la mesure le montre : le volkorne n'a **jamais atteint** le rang 9.
 * Il butait sur un second seuil écrit à la main dans `layRung` — « au moins deux
 * cibles » — et son rang 7 n'a qu'une couleur, Doré. Ce seuil retiré, le plan
 * passe de 16 à 28 couleurs et monte jusqu'à la gen 9. Voir `layRung`.
 */

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

/**
 * Compare deux listes déjà triées, élément par élément — l'ordre de `Vec<ColorId>`.
 *
 * C'est l'ordre lexicographique de Rust : la longueur ne tranche que si l'une est
 * un **préfixe** de l'autre.
 */
const smaller = (left: string[], right: string[], index: Index): boolean => {
  const shared = Math.min(left.length, right.length);
  for (let position = 0; position < shared; position += 1) {
    const delta = (index.get(left[position]) ?? 0) - (index.get(right[position]) ?? 0);
    if (delta !== 0) return delta < 0;
  }
  return left.length < right.length;
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
  climbMustGainGeneration: false,
});

/**
 * Le premier barreau, celui dont les ingrédients s'**achètent**.
 *
 * C'est la seule chose qui distingue le rang 3 des autres, et c'est ce qui rend
 * sa contrainte de fermeture nécessaire — voir `layRung`.
 */
const BUYABLE_RUNG = 3;

/**
 * Un barreau : choisir une recette par cible, et les ingrédients qui s'ensuivent.
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
 *
 * ## Le rang 3 passe par ici aussi, et son critère n'a jamais divergé
 *
 * Il avait son propre poseur, qui départageait sur la **taille** du jeu là où
 * celui-ci départage sur le travail accumulé. La divergence n'était écrite nulle
 * part, ce qui laissait croire à un arbitrage tacite. Il n'y en a pas : au
 * rang 3 les deux critères sont **le même**, et pour trois raisons qui tiennent
 * par construction plutôt que par chance —
 *
 * - `toll` d'une gen 2 vaut toujours **2** : une gen 2 est faite de deux gen 1,
 *   et une gen 1 a la génération 1. Vérifié sur les trois catalogues, sans une
 *   exception. Donc le travail d'un jeu vaut `2 × sa taille`, et le minimiser
 *   **est** minimiser sa taille.
 * - `strain` y vaut **0** pour tout le monde : il se lit sur `ladder.wanted`, que
 *   ce rang est le premier à remplir. Rien n'est encore sollicité.
 * - À taille égale, `shorterThenSmaller` se réduit à `smaller`, qui est ce
 *   comparateur-ci.
 *
 * Le départage retombe donc sur l'ordre du catalogue, exactement comme avant.
 * Et il départage réellement : le muldo a **six** jeux de gen 2 fermés, tous de
 * taille 4. Ils réclament les mêmes cinq gen 1 — Doré, Ébène, Indigo, Orchidée,
 * Pourpre — donc le choix ne change ni ce qu'on achète ni ce qu'on paie. La
 * dragodinde n'a qu'un candidat, le volkorne n'en a qu'un jeu distinct.
 *
 * ## Ce qui est réellement propre au rang 3 : la fermeture
 *
 * Ses ingrédients sont les gen 2, composées de gen 1 — les seules couleurs qu'on
 * achète, donc les seules qu'on réemploie par dizaines. En lisant chaque gen 2
 * comme une **arête** entre ses deux gen 1, le jeu retenu doit être une union
 * disjointe de cliques : un raté de `A × B` rend une gen 1 portant `[A, B]`, et
 * la réemployer face à un C fait rencontrer B et C, qui nomment `B-C`. Dans une
 * clique `B-C` est voulue et rien n'est perdu ; sinon la cible se dédouble et
 * 27 % de la masse utile s'en va.
 *
 * Un raté au rang 5 ou 7 ne rend pas une couleur achetable qu'on réemploie par
 * dizaines : il rend une composée qu'on a produite. La fermeture n'a donc de sens
 * qu'à cet étage, et elle y remplace la contrainte de route — les deux répondent
 * à la même question, « ces ingrédients se recoupent-ils comme il faut ».
 *
 * ## Le seuil « au moins deux cibles » a été retiré
 *
 * Il n'avait aucun commentaire, et il était incompatible avec le rang 3, qui se
 * contente d'une seule cible. Ce qu'il croyait dire est vrai mais se dit déjà
 * ailleurs : à une seule cible, un seul couple d'ingrédients est retenu, donc
 * `shared` — qui réclame un pivot partagé — n'a aucun candidat, et `disjoint` est
 * trivialement satisfait.
 *
 * Ce que le seuil ajoutait, en revanche, était faux : il **arrêtait la montée** là
 * où la route était seulement indéterminée. Le volkorne n'a qu'une gen 7, Doré,
 * dont les huit recettes emploient toutes deux gen 6 distinctes ; le seuil
 * refusait le rang 7 et le rang 9 n'était jamais tenté. Mesuré en le retirant :
 *
 * | famille | plan avant | plan après | sommet | travail par sommet |
 * | --- | --- | --- | --- | --- |
 * | dragodinde | 18 | 18 | inchangé | 222 |
 * | muldo | 30 | 30 | inchangé | 204 |
 * | volkorne | 16 | **28** | gen 5 → **gen 9** | 24 → 228 |
 *
 * La dragodinde et le muldo ne bougent pas : leurs rangs impairs ont tous deux
 * cibles. Le volkorne, lui, gagne deux étages — et son plan couronné se referme,
 * ce qu'il ne faisait pas tant que la montée s'arrêtait en gen 5. C'est
 * `check-ladder` qui le vérifie désormais, sur chacune des seize couronnes
 * posables.
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
  // Aucune cible : le rang n'existe pas, la montée s'arrête. Une seule suffit —
  // voir la doc ci-dessus pour ce que le seuil précédent coûtait au volkorne.
  if (targets.length === 0) return false;

  /** Les ingrédients de ce rang s'achètent-ils ? Alors la fermeture s'applique. */
  const closes = generation === BUYABLE_RUNG;

  // Ce que chaque gen 1 sert déjà, pour départager à coût égal. Vide au premier
  // barreau, qui est celui qui la remplit.
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

  /**
   * Les cliques d'un jeu d'ingrédients, ou `null` s'il n'est pas fermé.
   *
   * Chaque ingrédient est une arête entre ses deux constituants ; les blocs sont
   * les composantes connexes, qui sont donc les cliques.
   */
  const cliquesOf = (ingredients: string[]): string[][] | null => {
    const edges = new Set<string>();
    const vertices = new Set<string>();
    for (const colorId of ingredients) {
      const pair = constituents(byId.get(colorId));
      // Une composée de deux teintes identiques n'est pas une arête.
      if (!pair || pair[0] === pair[1]) return null;
      const [a, b] = [...pair].sort();
      edges.add(`${a}|${b}`);
      vertices.add(pair[0]);
      vertices.add(pair[1]);
    }

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
    if (!closed) return null;

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
    return blocks;
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
    blocks: string[][] | null;
  } | null = null;

  const total = options.reduce((product, recipes) => product * recipes.length, 1);

  for (let attempt = 0; attempt < total; attempt += 1) {
    const picked = pick(options, attempt);
    const ingredients = picked.flatMap((recipe) => [...recipe]).sort(byCatalogOrder(index));
    const distinct = [...new Set(ingredients)];

    let blocks: string[][] | null = null;
    if (closes) {
      blocks = cliquesOf(distinct);
      if (blocks === null) continue;
    } else {
      const shared = ingredients.length - distinct.length;
      // Cas 1 : au moins un pivot partagé. Cas 2 : aucun.
      if (route === 'shared' ? shared < 1 : shared !== 0) continue;
    }

    const work = distinct.reduce((sum, colorId) => sum + toll(colorId)[0], 0);
    const strain = distinct.reduce((sum, colorId) => sum + toll(colorId)[1], 0);

    const better =
      best === null ||
      work < best.work ||
      (work === best.work &&
        (strain < best.strain ||
          // Lexicographique et non longueur d'abord : c'est `&distinct` seul que
          // le Rust compare ici. Voir `smaller`.
          (strain === best.strain && smaller(distinct, best.ingredients, index))));
    if (better) best = { work, strain, ingredients: distinct, picked, blocks };
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
  if (best.blocks !== null) ladder.blocks = best.blocks;
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
  const index: Index = new Map(colors.map((color, position) => [color.id, position]));
  // Recalculée de zéro : la couronne déplace le sommet, donc les demandes d'avant
  // sont périmées et les cumuler les doublerait.
  ladder.demand.clear();
  for (const colorId of ladder.summit) ladder.demand.set(colorId, 1);

  // À génération égale, l'ordre du catalogue et non l'alphabet — c'est
  // `Reverse((generation, c))` côté Rust. L'ordre intra-génération ne peut rien
  // changer, les ingrédients d'une recette étant toujours d'une génération
  // strictement inférieure ; on l'aligne quand même, parce qu'un seul endroit du
  // module qui compare des identifiants textuels est un endroit de trop.
  const order = [...ladder.wanted].sort(
    (a, b) =>
      (generationOf.get(b) ?? 0) - (generationOf.get(a) ?? 0) || byCatalogOrder(index)(b, a)
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
/**
 * Clé : `route|climbMustGainGeneration`, et non la route seule.
 *
 * Le plan lui-même ne dépend pas du drapeau — il ne change que ce qu'`aimsAt`
 * admet — mais un plan mis en cache le **porte**, donc le premier appelant
 * fixerait la règle pour tous les suivants.
 */
const ladderCache = new WeakMap<BreedingColor[], Map<string, Ladder>>();

/**
 * Le plan de l'échelle pour cette famille.
 *
 * Ne dépend que de l'arbre, donc se calcule une fois : l'énumération des jeux de
 * gen 2 et de gen 4 est un produit cartésien, négligeable une fois mais pas à
 * chaque rendu.
 */
export const ladderOf = (
  colors: BreedingColor[],
  route: Route = DEFAULT_ROUTE,
  /**
   * La famille de cet arbre, quand l'appelant la connaît.
   *
   * Elle ne sert qu'à `climbMustGainGeneration`, donc elle est optionnelle : les
   * appelants qui ne construisent un plan que pour **chiffrer** ou pour afficher
   * une collection ne consultent jamais `aimsAt`, et le drapeau ne change aucun
   * autre champ. Le seul chemin qui décide d'un croisement — `stablePlan` — la
   * passe. Voir `CLIMB_MUST_GAIN_GENERATION`.
   *
   * **Elle entre dans la clé du cache**, et ce n'est pas de la prudence : le
   * premier appelant à demander cet arbre fixerait sinon le drapeau pour tous les
   * suivants. `costs.ts` chiffre un coût de revient sans famille au premier rendu,
   * `stablePlan` demande le même arbre juste après **avec** — et récupérerait un
   * plan qui n'applique pas la règle, sans que rien ne le dise.
   */
  family?: string | null
): Ladder => {
  const climbMustGainGeneration =
    family !== null && family !== undefined && CLIMB_MUST_GAIN_GENERATION.includes(family);
  const key = `${route}|${climbMustGainGeneration}`;

  let byRoute = ladderCache.get(colors);
  if (!byRoute) {
    byRoute = new Map();
    ladderCache.set(colors, byRoute);
  }
  const cached = byRoute.get(key);
  if (cached) return cached;

  const index: Index = new Map(colors.map((color, position) => [color.id, position]));
  const ladder = emptyLadder();
  ladder.climbMustGainGeneration = climbMustGainGeneration;

  // Le premier barreau porte la fermeture ; la route ne le concerne pas, mais
  // elle voyage avec pour que le poseur reste unique.
  if (!layRung(ladder, colors, index, BUYABLE_RUNG, route)) {
    byRoute.set(key, ladder);
    return ladder;
  }

  // On monte de deux en deux : les couleurs simples sont aux générations
  // impaires, et ce sont elles qui font les barreaux.
  const highest = colors.reduce((top, color) => Math.max(top, color.generation), 0);
  for (let rung = 5; rung <= highest; rung += 2) {
    if (layRung(ladder, colors, index, rung, route)) continue;
    // La route demandée peut n'avoir aucun candidat — chez le muldo, Prune et
    // Émeraude ne partagent aucune gen 6. On se rabat plutôt que de s'arrêter :
    // interrompre la montée fausserait la comparaison entre les routes.
    const fallback: Route = route === 'shared' ? 'disjoint' : 'shared';
    if (!layRung(ladder, colors, index, rung, fallback)) break;
  }

  spreadDemand(ladder, colors);
  byRoute.set(key, ladder);
  return ladder;
};

/* --------------------------------------------------------- la couronne -- */

/**
 * Une copie indépendante du plan.
 *
 * `ladderOf` mémoïse par catalogue et par route, parce que le plan ne dépend que
 * de l'arbre. La couronne, elle, dépend des **prix du jour** : couronner
 * l'exemplaire mémoïsé le figerait sur le marché du premier rendu et le rendrait
 * faux pour tous les suivants. On copie avant de tailler.
 */
const copyOf = (ladder: Ladder): Ladder => ({
  wanted: new Set(ladder.wanted),
  recipeOf: new Map(ladder.recipeOf),
  demand: new Map(ladder.demand),
  blocks: ladder.blocks.map((block) => [...block]),
  summit: [...ladder.summit],
  climbMustGainGeneration: ladder.climbMustGainGeneration,
});

/**
 * Pose une cible unique : sa recette la moins coûteuse, et les composées
 * qu'elle réclame. Même critère de travail accumulé que `layRung`.
 *
 * Un barreau ordinaire produit **les deux** couleurs de son étage ; la couronne
 * n'en veut qu'une, donc elle ne peut pas passer par `layRung`.
 */
const laySingle = (
  ladder: Ladder,
  colors: BreedingColor[],
  index: Index,
  target: string
): boolean => {
  const byId = new Map(colors.map((color) => [color.id, color]));
  const generationOf = (colorId: string) => byId.get(colorId)?.generation ?? 0;

  const work = (colorId: string): number => {
    const recipe = constituents(byId.get(colorId));
    if (!recipe) return Number.MAX_SAFE_INTEGER;
    return generationOf(recipe[0]) + generationOf(recipe[1]);
  };

  const recipes = [...(byId.get(target)?.recipes ?? [])].sort(
    (a, b) => byCatalogOrder(index)(a[0], b[0]) || byCatalogOrder(index)(a[1], b[1])
  );

  let chosen: readonly [string, string] | null = null;
  let bestWork = Number.MAX_SAFE_INTEGER;
  let bestPair: string[] = [];
  for (const recipe of recipes) {
    const pair = [...recipe].sort(byCatalogOrder(index));
    const cost = Math.min(work(recipe[0]) + work(recipe[1]), Number.MAX_SAFE_INTEGER);
    const better =
      chosen === null ||
      cost < bestWork ||
      (cost === bestWork && smaller(pair, bestPair, index));
    if (better) {
      chosen = recipe;
      bestWork = cost;
      bestPair = pair;
    }
  }
  if (!chosen) return false;

  for (const ingredient of chosen) {
    const inner = constituents(byId.get(ingredient));
    if (!inner) return false;
    ladder.wanted.add(ingredient);
    ladder.recipeOf.set(ingredient, inner);
  }
  ladder.wanted.add(target);
  ladder.recipeOf.set(target, chosen);
  return true;
};

/**
 * Les gen 10 que la couronne peut viser : une gen 9 et une gen 1 **achetable**.
 *
 * Une gen 1 s'achète à mille kamas, là où le second ingrédient d'une gen 10
 * pourrait être une autre gen 9 — c'est-à-dire toute une échelle à remonter. Et
 * elle doit être rattachée à un bloc, sans quoi la produire ferait sortir du jeu
 * de gen 1 fermé que le premier barreau a démontré.
 */
export const crownCandidates = (colors: BreedingColor[], blocks: string[][]): string[] => {
  const index: Index = new Map(colors.map((color, position) => [color.id, position]));
  const byId = new Map(colors.map((color) => [color.id, color]));
  const generationOf = (colorId: string) => byId.get(colorId)?.generation ?? 0;
  const top = colors.reduce((highest, color) => Math.max(highest, color.generation), 0);
  const inBlocks = new Set(blocks.flat());

  const found: string[] = [];
  for (const color of colors) {
    if (color.generation !== top) continue;
    const recipe = constituents(color);
    if (!recipe) continue;
    const [high, low] =
      generationOf(recipe[0]) > generationOf(recipe[1])
        ? [recipe[0], recipe[1]]
        : [recipe[1], recipe[0]];
    if (generationOf(high) !== top - 1 || generationOf(low) !== 1) continue;
    if (!inBlocks.has(low)) continue;
    found.push(color.id);
  }
  return found.sort(byCatalogOrder(index));
};

/**
 * La gen 10 à viser quand on choisit le **partenaire** avant le prix.
 *
 * Le partenaire retenu est la gen 1 que le plan emploie le plus, mesuré sur le
 * plan **avant** couronnement — le seul état disponible au moment du choix, et le
 * même pour toutes les candidates, donc il n'en favorise aucune. Parmi les
 * candidates qui le portent, on prend la mieux payée.
 *
 * C'est le critère par défaut du Rust (`Crowning::PartnerThenPrice`), et il vaut
 * `+3,12 M ± 0,31` sur mille graines appariées contre le prix seul. Il a aussi
 * l'avantage de tenir quand l'éleveur n'a saisi aucun prix de gen 10 : le
 * partenaire ne dépend pas du marché, et seul le départage final en dépend.
 */
export const bestPartnerCrown = (
  ladder: Ladder,
  colors: BreedingColor[],
  valueOf: (colorId: string) => number
): string | null => {
  const index: Index = new Map(colors.map((color, position) => [color.id, position]));
  const byId = new Map(colors.map((color) => [color.id, color]));
  const generationOf = (colorId: string) => byId.get(colorId)?.generation ?? 0;
  const rank = (colorId: string) => index.get(colorId) ?? 0;

  const candidates = crownCandidates(colors, ladder.blocks);
  if (candidates.length === 0) return null;

  /** La gen 1 partenaire d'une candidate : celle des deux qui n'est pas la gen 9. */
  const partnerOf = (colorId: string): string | null => {
    const recipe = constituents(byId.get(colorId));
    if (!recipe) return null;
    return generationOf(recipe[0]) > generationOf(recipe[1]) ? recipe[1] : recipe[0];
  };

  // Combien de recettes du plan emploient chaque gen 1. Le maximum décide, et
  // l'ordre du catalogue tranche les égalités pour rester déterministe.
  const uses = (partner: string) =>
    [...ladder.recipeOf.values()].filter(
      (recipe) => recipe[0] === partner || recipe[1] === partner
    ).length;

  let partner: string | null = null;
  for (const colorId of candidates) {
    const other = partnerOf(colorId);
    if (!other) continue;
    if (
      partner === null ||
      uses(other) > uses(partner) ||
      (uses(other) === uses(partner) && rank(other) < rank(partner))
    ) {
      partner = other;
    }
  }
  if (partner === null) return null;

  let best: string | null = null;
  for (const colorId of candidates) {
    if (partnerOf(colorId) !== partner) continue;
    if (
      best === null ||
      valueOf(colorId) > valueOf(best) ||
      (valueOf(colorId) === valueOf(best) && rank(colorId) < rank(best))
    ) {
      best = colorId;
    }
  }
  return best;
};

/**
 * La couronne : choisir **une** gen 9, la gen 10 qu'elle ouvre, et tailler le
 * reste.
 *
 * Les barreaux du dessous produisent toutes les couleurs de leur étage, parce que
 * la montée a besoin des deux. Le dernier ne suit pas cette règle : les quatre
 * gen 9 du muldo ouvrent chacune des gen 10, on n'en a besoin que d'une, et le
 * jeu a prévu que le choix compte — chaque gen 10 porte son propre prix.
 *
 * `choice` sert la mesure : forcer chaque candidate à tour de rôle et garder la
 * meilleure après coup donne le **plafond** d'une réorientation. Sans elle, la
 * mieux payée du jour.
 *
 * Ne fait rien si aucune candidate n'existe, si son partenaire n'est dans aucun
 * bloc, ou si la gen 9 visée ne se pose pas : un plan à moitié couronné serait
 * pire que le plan complet, et le Rust s'arrête au même endroit.
 */
/**
 * Ce qu'il reste de demande à une route que la couronne ne réclame plus.
 *
 * Un dixième : assez pour qu'une monture déjà en écurie trouve où monter, assez
 * peu pour que la composition serve la route couronnée d'abord. Zéro rend la
 * suppression d'avant. `SPARE_ROUTE_DEMAND` côté Rust.
 */
export const SPARE_ROUTE_DEMAND = 0.1;

/**
 * Ce que la couleur poursuivie gagne au **choix de la couronne**, en kamas.
 *
 * Miroir de `boost_couronne` dans `rust/economy.toml`, et les deux doivent bouger
 * ensemble : `check-ladder-parity` compare les couronnes.
 *
 * 400 000, et c'est mesuré : `bin/crown` compte la couleur poursuivie couronnée
 * **91,4 %** du temps à ce bonus, contre 40,6 % à 200 000 et 100 % à 800 000. Le
 * premier n'est pas une préférence — on ne l'obtient pas six fois sur dix — et le
 * dernier est l'imposition sous un autre nom.
 *
 * **Pourquoi pas `poids_couronne`** : il vaut cinq millions, quand tout l'écart de
 * la bande gen 10 — 300 000 à 1 000 000 — fait 700 000. Sept fois l'écart qu'il
 * devrait départager : la préférence gagnerait toujours, et ce serait l'imposition
 * sous un autre nom.
 */
export const CROWN_PREFERENCE = 400_000;

export const crownAt = (
  ladder: Ladder,
  colors: BreedingColor[],
  valueOf: (colorId: string) => number,
  choice?: string,
  /**
   * La couleur poursuivie, et ce qu'elle gagne au **choix** de la couronne.
   *
   * `project` la nomme, `crownPreference` dit de combien de kamas elle passe
   * devant. Elle l'emporte donc sauf si une autre gen 10 vaut plus qu'elle plus le
   * bonus — préférer, et non imposer.
   *
   * Zéro rend le tri au prix seul, à l'identique. Côté Rust c'est
   * `Economy::crown_preference`, et les deux doivent bouger ensemble.
   */
  project?: string | null,
  crownPreference = 0
): void => {
  const index: Index = new Map(colors.map((color, position) => [color.id, position]));
  const byId = new Map(colors.map((color) => [color.id, color]));
  const generationOf = (colorId: string) => byId.get(colorId)?.generation ?? 0;
  const top = colors.reduce((highest, color) => Math.max(highest, color.generation), 0);

  const candidates: { value: number; crown: string; target: string; partner: string }[] = [];
  for (const color of colors) {
    if (color.generation !== top) continue;
    const recipe = constituents(color);
    if (!recipe) continue;
    const [high, low] =
      generationOf(recipe[0]) > generationOf(recipe[1])
        ? [recipe[0], recipe[1]]
        : [recipe[1], recipe[0]];
    if (generationOf(high) !== top - 1 || generationOf(low) !== 1) continue;
    // La couleur poursuivie entre avec son bonus — **ici et pas dans `valueOf`**,
    // qui chiffre aussi la liquidation. Préférer et non imposer : voir
    // `Economy::crown_preference` côté Rust, et les deux côtés bougent ensemble.
    const preference = project === color.id ? crownPreference : 0;
    candidates.push({
      value: valueOf(color.id) + preference,
      crown: color.id,
      target: high,
      partner: low,
    });
  }
  candidates.sort((a, b) => b.value - a.value || byCatalogOrder(index)(a.crown, b.crown));

  // Imposée si on le demande, sinon la mieux payée. Une couronne imposée
  // introuvable est une erreur d'appelant, pas un cas à rattraper en silence : on
  // ne pose rien plutôt que de retomber sur un autre choix.
  const picked =
    choice === undefined
      ? candidates[0]
      : candidates.find((candidate) => candidate.crown === choice);
  if (!picked) return;
  // La gen 1 partenaire doit être achetable, donc rattachée à un bloc.
  if (!ladder.blocks.some((block) => block.includes(picked.partner))) return;
  if (!laySingle(ladder, colors, index, picked.target)) return;

  // La demande d'avant la couronne : c'est elle qu'on réduit au lieu de la
  // supprimer, voir plus bas.
  const before = new Map(ladder.demand);

  ladder.wanted.add(picked.crown);
  ladder.recipeOf.set(picked.crown, [picked.target, picked.partner]);
  ladder.summit = [picked.crown];
  spreadDemand(ladder, colors);

  // ## Réduire ce que la couronne ne réclame plus — sans le supprimer
  //
  // Les barreaux du dessous produisent **les deux** couleurs de leur étage, parce
  // qu'on ne savait pas encore laquelle servirait. La couronne tranche : Corail ne
  // se fait que par des gen 8 dérivées de Prune, donc Émeraude et ses gen 6
  // tombent à une demande de zéro.
  //
  // On les **supprimait**, au motif qu'un plan doit être exactement ce dont on a
  // besoin. Le motif tient pour les places et pas pour l'écurie : une gen 9 Corail
  // qu'on possède déjà devenait inemployable, sa route n'existant plus dans le
  // plan. On la garde donc à demande **réduite** — `SPARE_ROUTE_DEMAND` côté Rust,
  // et les deux côtés doivent bouger ensemble.
  const spare = [...ladder.wanted]
    .filter((colorId) => (ladder.demand.get(colorId) ?? 0) <= 0)
    .map((colorId) => [colorId, before.get(colorId) ?? 0] as const);
  for (const [colorId, previous] of spare) {
    if (previous > 0) {
      ladder.demand.set(colorId, previous * SPARE_ROUTE_DEMAND);
    } else {
      // Rien à garder : personne ne demandait cette couleur même avant.
      ladder.wanted.delete(colorId);
      ladder.recipeOf.delete(colorId);
      ladder.demand.delete(colorId);
    }
  }
};

/**
 * Cette couleur peut-elle porter la couronne de ce plan ?
 *
 * Les mêmes trois conditions que `crownAt` vérifie avant de poser : être une
 * gen 10 dont la recette marie une gen 9 à une gen 1, et voir cette gen 1
 * rattachée à un bloc — donc achetable. Vérifié **avant** d'imposer, parce que
 * `crownAt` ne pose rien du tout sur une couronne introuvable et qu'un plan non
 * couronné est plus large que celui que la politique applique.
 */
export const isCrownable = (
  ladder: Ladder,
  colors: BreedingColor[],
  colorId: string
): boolean => {
  const byId = new Map(colors.map((color) => [color.id, color]));
  const generationOf = (id: string) => byId.get(id)?.generation ?? 0;
  const top = colors.reduce((highest, color) => Math.max(highest, color.generation), 0);

  const color = byId.get(colorId);
  if (!color || color.generation !== top) return false;
  const recipe = constituents(color);
  if (!recipe) return false;
  const [high, low] =
    generationOf(recipe[0]) > generationOf(recipe[1])
      ? [recipe[0], recipe[1]]
      : [recipe[1], recipe[0]];
  if (generationOf(high) !== top - 1 || generationOf(low) !== 1) return false;
  return ladder.blocks.some((block) => block.includes(low));
};

/**
 * Le plan **couronné** : celui que la politique mesurée applique réellement.
 *
 * `ladderOf` s'arrête au dernier barreau impair et garde toutes ses couleurs ;
 * c'est le plan d'avant le choix du sommet, pas celui qu'on suit. La couronne le
 * ramène à une seule route, et c'est ce plan-là que `aimsAt` doit lire.
 *
 * Non mémoïsé, contrairement à `ladderOf` : il dépend des prix saisis, qui
 * changent d'un rendu à l'autre. Le coût est celui de `crownAt` seul — le produit
 * cartésien des recettes, lui, reste mémoïsé.
 */
export const crownedLadderOf = (
  colors: BreedingColor[],
  valueOf: (colorId: string) => number,
  route: Route = DEFAULT_ROUTE,
  /**
   * La gen 10 que l'éleveur **veut**, si elle est couronnable.
   *
   * Sans elle, la couronne se choisit sur le marché — et un marché sans prix de
   * gen 10 saisi les rend toutes égales, si bien que c'est le partenaire qui
   * tranche. L'éleveur, lui, poursuit peut-être autre chose : sur l'écurie du
   * 14/08 le projet demandait Azur-Doré depuis huit jours et le plan visait
   * Ambre-Doré, **sans que rien ne le dise**.
   *
   * Ce canal-là plutôt que le prix, et c'est le point : `breeding_color_prices`
   * est **partagé entre les joueurs**. Gonfler une gen 10 pour l'atteindre
   * fausserait le marché de tout le monde, et fausserait aussi les coûts
   * affichés — le prix sert à chiffrer autant qu'à départager. `breeding_projects`
   * est privé, donc viser et chiffrer redeviennent deux choses distinctes.
   *
   * Une cible qui n'est pas une gen 10 couronnable est **ignorée** plutôt que de
   * ne rien poser : `crownAt` refuse une couronne imposée introuvable, et un plan
   * non couronné serait plus large que celui que la politique applique — donc
   * `aimsAt` y admettrait des croisements que le Rust refuse.
   */
  wanted?: string | null,
  /** La famille, pour `climbMustGainGeneration`. Voir `ladderOf`. */
  family?: string | null
): Ladder => {
  const plan = copyOf(ladderOf(colors, route, family));
  const crownable = wanted !== null && wanted !== undefined && isCrownable(plan, colors, wanted);
  // À défaut de cible : **le prix seul**, et c'est un changement du 24/08.
  //
  // Le partenaire d'abord — `bestPartnerCrown` — était le défaut des deux côtés
  // depuis le 12/08, sur un relevé franc : +3,12 M ± 0,31, t = 10,05, mille
  // graines appariées. Le même harnais (`bin/crown`) inverse aujourd'hui le
  // signe : **−6,00 M ± 0,33, t = −18,11** dans le régime livré.
  //
  // Le mécanisme tient — le partenaire produit encore plus de gen 10 — mais ça ne
  // paie plus : à la moisson allumée les deux bras en tiennent 113,4 contre 121,0,
  // et le prix seul gagne quand même. La profondeur de marché plafonne ce qu'un
  // stock d'une seule couleur rend, la prime de collection ne paie qu'une fois par
  // couleur, et les prix de gen 10 tirés en cloche rendent « la mieux payée » plus
  // précieuse. Voir `Crowning` dans `ladder.rs` pour les deux tables.
  //
  // **Les deux côtés doivent bouger ensemble** : `Crowning::PriceOnly` y est
  // désormais le défaut, et `check-ladder-parity` compare les couronnes.
  //
  // ## Et la cible **pèse** au lieu d'imposer, depuis le 25/08
  //
  // Elle passait en `choice`, donc elle **remplaçait** le choix : le plan était coupé
  // sur elle quoi que valent les autres, et `crownAt` supprimait toutes les autres
  // routes. Une gen 9 Corail qu'on possédait déjà devenait alors inemployable — sa
  // route n'existait plus, donc aucun croisement ne pouvait la faire monter.
  //
  // Elle entre maintenant dans le tri avec `CROWN_PREFERENCE`, et les routes que la
  // couronne ne réclame plus gardent un dixième de demande. Elle l'emporte donc sauf
  // si une autre gen 10 vaut plus qu'elle plus le bonus.
  //
  // **Ce que ça peut faire, et qui doit se voir à l'écran** : la cible peut perdre.
  // Le relevé du 14/08 se plaignait exactement de ça — le projet demandait Azur-Doré
  // depuis huit jours et le plan visait Ambre-Doré « sans que rien ne le dise ». Le
  // remède n'est pas de forcer, c'est de l'afficher.
  crownAt(plan, colors, valueOf, undefined, crownable ? wanted : null, CROWN_PREFERENCE);
  return plan;
};

/**
 * La couleur qu'un couple vise, **s'il est admissible**.
 *
 * `null` dès qu'il ne **monte** pas — recopie ou plafond, deux fécondités
 * brûlées pour rester au même barreau — ou qu'une de ses cibles sort du plan.
 * Quand plusieurs couleurs voulues sont atteignables, on retient la plus
 * probable : `targetColors` est triée par poids décroissant.
 *
 * ## Pourquoi `climbs` et non « la cible n'est pas vide »
 *
 * Les deux disaient la même chose tant qu'un couple au plafond était refusé par
 * `pairOutlook`. Ils divergent depuis #185 : une gen 10 mariée à une gen 1 nomme
 * des couleurs gen 10 — dont la sienne, à 27,19 % — sans gagner un rang. Pour
 * une échelle, qui existe pour monter, c'est exactement le même gâchis qu'une
 * recopie.
 *
 * Ce n'est **pas** un jugement sur la valeur de ces croisements. Le forum en
 * décrit une boucle qui duplique les gen 10, et le plafond est précisément ce
 * qui la rend possible — une réussite y rend la génération qu'on vient de
 * dépenser au lieu de la suivante. Mais l'échelle chiffre une montée depuis
 * zéro, pas une exploitation du sommet ; l'y admettre en silence changerait la
 * politique sans que rien ne l'ait mesurée. C'est un plan à part.
 */
/**
 * Ce qu'on fait d'un croisement du sommet — celui qui ne peut plus monter.
 *
 * ## Pourquoi trois valeurs et non un booléen
 *
 * Le booléen confondait deux choses que la mesure sépare :
 *
 * - **`'all'`** est la boucle du forum, `Summit::Duplicate` côté Rust : accoupler
 *   n'importe quelle gen 10 avec n'importe quoi pour en refaire. Elle gagne 43 M
 *   dans le modèle et perd dans le jeu, parce que le modèle vend la 162ᵉ gen 10
 *   au prix de la première. Elle reste éteinte.
 * - **`'target'`** ne retient que les croisements qui nomment une couleur de
 *   `ladder.summit`, c'est-à-dire **ce pour quoi l'échelle a été construite**.
 *
 * La distinction n'est pas de degré. L'objection au sommet est une objection de
 * **marché** — on ne vend pas cent gen 10 — et elle ne dit rien de l'éleveur qui
 * en veut **une**, nommée, parce que c'est son projet. Refuser ces
 * croisements-là revenait à refuser la seule route vers la couleur que l'écran
 * affiche en cible.
 *
 * ## Ce que ça ouvrait, mesuré
 *
 * Sur l'écurie qui l'a fait remonter : cible Azur-Doré, dont la seule recette est
 * `Azur (g9) × Doré (g1)` — un Azur gen 9 que l'éleveur n'a pas. Il tient en
 * revanche deux gen 10 azurées, et **26 partenaires de son coffre** nomment
 * Azur-Doré avec elles, jusqu'à **13,95 %** sur une simple Doré gen 1. `climbs`
 * rendait `false` sur les 26 — une gen 10 ne monte pas — donc `aimsAt` rendait
 * `null`, donc la recherche ne les voyait pas et l'écran ne proposait aucune
 * tentative.
 *
 * ## Ce que ça n'ouvre pas
 *
 * Le reste du sommet. Un croisement qui ne nomme que d'autres gen 10 reste
 * refusé, donc la boucle qui accumule n'est toujours pas représentable. Et la
 * fécondité borne le débit d'elle-même : chaque tentative consomme la gen 10
 * qu'elle emploie.
 */
export type SummitRule =
  /** Rien. La fécondité d'une gen 10 se garde, faute de savoir quoi en faire. */
  | 'hold'
  /** Les croisements qui nomment une couleur de `ladder.summit`, et eux seuls. */
  | 'target'
  /** La boucle entière. Mesurée, écrite, prête — et éteinte. Voir `aimsAtSummit`. */
  | 'all';

export const aimsAt = (
  male: Mate,
  female: Mate,
  colors: BreedingColor[],
  generations: Map<string, number>,
  ladder: Ladder,
  /**
   * Ce qu'on accepte au **sommet**, là où le plafond interdit de monter. Voir
   * `aimsAtSummit`.
   *
   * `'target'` par défaut, comme `Summit::Target` côté Rust : les croisements qui
   * nomment la couleur **visée**, et eux seuls.
   *
   * Ça n'était pas le défaut, et le basculement de l'écran sur l'échelle l'a
   * rendu nécessaire : `policy.ts` passait `'target'` au champion, donc une gen 10
   * qui nomme la cible entrait dans la fournée. L'échelle retombait sur `'hold'`
   * et retirait ce comportement sans que rien ne le dise —
   * `summit-target.spec.ts` l'a attrapé. C'est ce que #225 et #236 avaient
   * ouvert : mesurer ou jouer dans un régime qui n'est pas celui de l'autre côté.
   *
   * `'all'` reste éteint : la boucle de duplication a été mesurée à −1,43 M sur
   * l'écurie de l'éleveur et retirée. Les deux défauts doivent bouger ensemble.
   */
  summit: SummitRule = 'target'
): string | null => {
  const outlook = pairOutlook(male, female, colors, generations);
  if (!outlook || outlook.targetColors.length === 0) return null;
  if (!climbs(outlook)) {
    if (summit === 'hold' || !aimsAtSummit(outlook, generations)) return null;
    if (summit === 'all') return outlook.targetColors[0].colorId;
    // `'target'` : on ne retient que ce qui nomme la couleur pour laquelle
    // l'échelle entière existe, et on rend **celle-là** plutôt que la plus
    // probable — c'est ce que la tentative vise, et ce que l'écran doit dire.
    return outlook.targetColors.find((t) => ladder.summit.includes(t.colorId))?.colorId ?? null;
  }
  // La règle par famille : gagner un rang, et pas seulement du coût de
  // construction.
  //
  // **Après** la porte du sommet ci-dessus, et c'est ce qui compte. Au plafond
  // `targetGeneration === ancestryGeneration` par construction — une gen 10
  // croisée avec une gen 1 vise la gen 10 — donc la poser plus haut refuserait
  // toutes les tentatives du sommet et viderait `'target'`, que l'app joue.
  // Le jumeau exact vit dans `aims_at`, `ladder.rs`.
  if (
    ladder.climbMustGainGeneration &&
    outlook.targetGeneration <= outlook.ancestryGeneration
  ) {
    return null;
  }
  if (!outlook.targetColors.every((target) => ladder.wanted.has(target.colorId))) return null;
  return outlook.targetColors[0].colorId;
};

/**
 * Un croisement du sommet : plafonné, et dont **toute** la cible est au plafond.
 *
 * C'est la boucle que le forum décrit et que #185 a rendue représentable —
 * accoupler une gen 10 avec une gen 1, réaccoupler le raté qui porte encore la
 * gen 10, et ne pas laisser le cloneur refondre les stériles. Le plan n'y entre
 * pas : au sommet il n'y a plus de route, il n'y a que la génération la plus
 * haute de l'arbre, et toutes ses couleurs sont ce qu'on peut posséder de mieux.
 *
 * ## Ce que la mesure a dit, et ce qu'elle a corrigé
 *
 * L'issue #185 annonce 1,16 gen 10 féconde par gen 10 consommée. C'est juste, et
 * ce n'était pas suffisant : jouée telle quelle, la boucle **perd 8,38 M** sur
 * 200 graines. Le terme « + 0,5 » de ce calcul est le clonage, et un clonage
 * détruit une monture pour rendre une fécondité — au sommet il refond deux gen 10
 * en une seule et mange la production de la boucle.
 *
 * Les deux règles ne valent donc rien séparément et beaucoup ensemble :
 *
 * | variante | score | gen 10 tenues |
 * | --- | --- | --- |
 * | dupliquer seul | −8,38 M | −4,38 |
 * | ne plus refondre le sommet, seul | 0,00 M | 0,00 |
 * | **les deux** | **+43,18 M** (200/200) | **+63,43** |
 *
 * ## Et pourtant c'est éteint par défaut
 *
 * Ces 43 M sont **justes selon le modèle et faux dans le jeu**. La simulation
 * valorise une gen 10 stérile à son prix d'HDV plein quel que soit le nombre
 * qu'on en tienne ; la boucle finit la partie avec 162 gen 10, et l'HDV n'en
 * absorbe pas autant. La profondeur du marché n'est pas modélisée, et c'est elle
 * qui décide ici.
 *
 * La boucle reste donc écrite, mesurée et prête, derrière `summit` — comme
 * `Summit::Hold` côté Rust. Elle s'allumera le jour où l'économie saura dire à
 * quel prix le centième exemplaire se vend.
 *
 * ## Le partenaire décide de quelle gen 10 sort
 *
 * La masse cible vaut le taux quel que soit le partenaire ; son **partage** non.
 * Sur une Ambre-Doré [Ambre, Doré], la marier à Doré — sa propre gen 1 — met
 * 100 % de la cible sur sa propre couleur, là où Ébène n'en met que 62,5 %
 * parce qu'`Ambre × Ébène` nomme une concurrente. Dupliquer une gen 10 précise
 * se joue entièrement là, à mille kamas pièce.
 */
export const aimsAtSummit = (
  outlook: PairOutlook,
  generations: Map<string, number>
): boolean => {
  const top = Math.max(...generations.values());
  return (
    outlook.targetGeneration >= top &&
    outlook.targetColors.every((target) => generations.get(target.colorId) === top)
  );
};

/**
 * Le couple monte-t-il d'un rang, plan mis à part ?
 *
 * C'est la moitié de la règle, et la seule qui vaille sur une écurie **qu'on n'a
 * pas montée à l'échelle** : le plan décrit une route depuis zéro, alors qu'un
 * éleveur arrive avec ce qu'il a. Refuser tout ce qui sort du plan lui
 * supprimerait des croisements qui, eux, gagnent bien une génération — voir
 * `admissibility` dans l'écran, qui choisit laquelle des deux lectures appliquer.
 */
export const namesSomething = (
  male: Mate,
  female: Mate,
  colors: BreedingColor[],
  generations: Map<string, number>
): boolean => {
  const outlook = pairOutlook(male, female, colors, generations);
  return outlook !== null && climbs(outlook);
};
