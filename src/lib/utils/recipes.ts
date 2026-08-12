import { DofusDBRecipe, ItemPrice } from '@/lib/supabase/types';

export const HDV_TAX_RATE = 0.02;
export const PRICE_EDIT_TAX_RATE = 0.01;

/** Ce qu'il faut d'une recette pour la chiffrer, et rien de plus. */
export type CostableRecipe = Pick<
  DofusDBRecipe,
  'resultId' | 'ingredientIds' | 'quantities'
>;

/**
 * Les recettes connues, indexées par l'item qu'elles produisent.
 *
 * C'est ce qui permet à un ingrédient d'être chiffré autrement qu'au prix de
 * l'hôtel de vente. Un index vide n'est pas une erreur : le coût retombe alors
 * sur l'achat seul, c'est-à-dire le comportement d'avant.
 */
export type RecipeIndex = Map<number, CostableRecipe>;

export const indexRecipes = (recipes: CostableRecipe[]): RecipeIndex =>
  new Map(recipes.map((recipe) => [recipe.resultId, recipe]));

/**
 * Jusqu'où on descend dans l'arbre de craft.
 *
 * La garde de cycle suffit à garantir la terminaison ; ce plafond borne le
 * *travail*. Les arbres réels font deux à trois niveaux — une rune craftée d'un
 * minerai crafté — donc huit laisse largement la place sans qu'une donnée
 * pathologique fasse ramer un rendu.
 */
export const MAX_CRAFT_DEPTH = 8;

/** D'où vient le coût unitaire retenu pour un item. */
export type CostSource = 'buy' | 'craft' | 'none';

export type UnitCost = {
  /** Le moins cher des deux, ou 0 quand rien ne permet de le chiffrer. */
  cost: number;
  source: CostSource;
  /** Prix HDV, 0 s'il n'est pas saisi. */
  buy: number;
  /** Coût de fabrication, `null` si l'item n'a pas de recette chiffrable. */
  craft: number | null;
};

const UNPRICED: UnitCost = { cost: 0, source: 'none', buy: 0, craft: null };

/**
 * Ce que coûte **une unité** d'un item : le moins cher entre l'acheter et le
 * fabriquer.
 *
 * C'est la réponse à l'issue #123 — à haut niveau, les composants sont eux-mêmes
 * craftés, et payer le prix HDV d'une rune qu'on fabrique pour moitié fausse
 * toutes les marges au-dessus.
 *
 * ## Les deux pièges, et comment ils sont tenus
 *
 * **Les cycles.** Le miroir ne garantit pas un graphe acyclique : rien
 * n'empêcherait A d'exiger B et B d'exiger A. Sans garde, la descente ne rendrait
 * jamais la main et figerait l'onglet. `path` porte donc les items en cours de
 * calcul, et retomber sur l'un d'eux rend le craft indisponible **pour cette
 * branche** — on se rabat sur l'achat, ce qui est exactement ce qu'un éleveur
 * ferait.
 *
 * **La mémoïsation empoisonnée.** C'est le bug non évident. Un item dont le craft
 * a été supprimé parce qu'il était sur le chemin courant a un coût *plus élevé*
 * que sa vraie valeur ; le mettre en cache tel quel le rendrait faux pour toutes
 * les autres branches, et le résultat dépendrait de l'ordre de parcours. On ne
 * met donc en cache que les calculs dont **aucun** sous-arbre n'a rencontré de
 * cycle ni de plafond de profondeur — d'où le drapeau `tainted`.
 */
const unitCostIn = (
  itemId: number,
  prices: Map<number, ItemPrice>,
  index: RecipeIndex,
  path: Set<number>,
  cache: Map<number, UnitCost>,
  depth: number
): { value: UnitCost; tainted: boolean } => {
  const cached = cache.get(itemId);
  if (cached !== undefined) return { value: cached, tainted: false };

  const buy = prices.get(itemId)?.price || 0;
  const recipe = index.get(itemId);

  // Pas de recette, ou on ne peut pas descendre : l'achat est le seul chiffre.
  if (!recipe || depth >= MAX_CRAFT_DEPTH || path.has(itemId)) {
    const value: UnitCost =
      buy > 0 ? { cost: buy, source: 'buy', buy, craft: null } : UNPRICED;
    // `tainted` dès que c'est la garde qui a coupé, et non l'absence de recette :
    // le chiffre est bon ici mais ne vaut pas pour les autres branches.
    const cut = Boolean(recipe) && (depth >= MAX_CRAFT_DEPTH || path.has(itemId));
    if (!cut) cache.set(itemId, value);
    return { value, tainted: cut };
  }

  path.add(itemId);
  let craft = 0;
  let craftable = recipe.ingredientIds.length > 0;
  let tainted = false;

  recipe.ingredientIds.forEach((ingredientId, at) => {
    if (!craftable) return;
    const quantity = recipe.quantities[at] || 0;
    const below = unitCostIn(ingredientId, prices, index, path, cache, depth + 1);
    tainted = tainted || below.tainted;
    // Un seul ingrédient non chiffrable rend toute la recette non chiffrable :
    // additionner ce qu'on connaît rendrait un coût **sous-évalué**, donc une
    // marge flatteuse. Mieux vaut ne rien annoncer.
    if (below.value.source === 'none') {
      craftable = false;
      return;
    }
    craft += below.value.cost * quantity;
  });
  path.delete(itemId);

  const craftCost = craftable ? craft : null;
  let value: UnitCost;
  if (craftCost !== null && (buy <= 0 || craftCost < buy)) {
    value = { cost: craftCost, source: 'craft', buy, craft: craftCost };
  } else if (buy > 0) {
    value = { cost: buy, source: 'buy', buy, craft: craftCost };
  } else {
    value = { ...UNPRICED, craft: craftCost };
  }

  if (!tainted) cache.set(itemId, value);
  return { value, tainted };
};

/**
 * Le coût unitaire d'un item, achat contre craft.
 *
 * `cache` est optionnel et se partage entre appels sur les mêmes prix et le même
 * index — un ingrédient revient dans beaucoup de recettes, et le recalculer à
 * chaque carte se voit sur une liste de trente.
 */
export const unitCostOf = (
  itemId: number,
  prices: Map<number, ItemPrice>,
  index: RecipeIndex = new Map(),
  cache: Map<number, UnitCost> = new Map()
): UnitCost => unitCostIn(itemId, prices, index, new Set(), cache, 0).value;

/**
 * Le coût de fabrication d'une recette.
 *
 * Chaque ingrédient est compté au moins cher de l'achat et de son propre craft
 * (#123). Sans `index`, il n'y a aucune recette d'ingrédient connue et le calcul
 * retombe terme pour terme sur l'ancien : la somme des prix HDV.
 */
export const computeCraftCost = (
  recipe: Pick<DofusDBRecipe, 'ingredientIds' | 'quantities'>,
  prices: Map<number, ItemPrice>,
  index: RecipeIndex = new Map(),
  cache: Map<number, UnitCost> = new Map()
) =>
  recipe.ingredientIds.reduce((sum, ingId, at) => {
    const quantity = recipe.quantities[at] || 0;
    return sum + unitCostOf(ingId, prices, index, cache).cost * quantity;
  }, 0);

export const computeMargin = (resultPrice: number, craftCost: number) => {
  const hdvTax = Math.floor(resultPrice * HDV_TAX_RATE);
  const margin = resultPrice - craftCost - hdvTax;
  const marginPercent =
    craftCost > 0 ? Math.round((margin / craftCost) * 100) : 0;
  return { hdvTax, margin, marginPercent };
};

/**
 * La recette est-elle entièrement chiffrable ?
 *
 * Un ingrédient sans prix HDV mais dont la recette, elle, est complète **compte
 * désormais comme chiffré** : c'est la contrepartie de #123, et sans elle une
 * recette calculable resterait marquée « prix manquants ».
 */
export const recipeHasAllPrices = (
  recipe: Pick<DofusDBRecipe, 'resultId' | 'ingredientIds'>,
  prices: Map<number, ItemPrice>,
  index: RecipeIndex = new Map(),
  cache: Map<number, UnitCost> = new Map()
) => {
  const resultPrice = prices.get(recipe.resultId)?.price || 0;
  if (resultPrice <= 0) return false;
  return recipe.ingredientIds.every(
    (id) => unitCostOf(id, prices, index, cache).source !== 'none'
  );
};

export type ProfitableRecipe = {
  recipe: DofusDBRecipe;
  craftCost: number;
  sellPrice: number;
  margin: number;
  marginPercent: number;
};

/** Les chiffres d'une recette, ou `null` si elle n'est pas (encore) exploitable. */
const profitabilityOf = (
  recipe: DofusDBRecipe,
  prices: Map<number, ItemPrice>,
  index: RecipeIndex,
  cache: Map<number, UnitCost>
): ProfitableRecipe | null => {
  if (!recipeHasAllPrices(recipe, prices, index, cache)) return null;

  const sellPrice = prices.get(recipe.resultId)?.price || 0;
  const craftCost = computeCraftCost(recipe, prices, index, cache);
  const { margin, marginPercent } = computeMargin(sellPrice, craftCost);

  return margin > 0 ? { recipe, craftCost, sellPrice, margin, marginPercent } : null;
};

/**
 * Les recettes qu'une saisie de prix vient de rendre rentables : celles qui ne
 * l'étaient pas avec `before` et le sont avec `after`. Couvre les deux cas
 * utiles — la recette débloquée parce qu'il lui manquait ce prix, et celle qui
 * repasse en marge positive parce que le prix a bougé.
 *
 * Deux caches, un par jeu de prix : un coût unitaire ne vaut que pour les prix
 * qui l'ont produit, et les partager rendrait le « avant » égal au « après ».
 */
export const findNewlyProfitable = (
  recipes: DofusDBRecipe[],
  before: Map<number, ItemPrice>,
  after: Map<number, ItemPrice>,
  index: RecipeIndex = new Map()
): ProfitableRecipe[] => {
  const beforeCache = new Map<number, UnitCost>();
  const afterCache = new Map<number, UnitCost>();

  return recipes.reduce<ProfitableRecipe[]>((unlocked, recipe) => {
    if (profitabilityOf(recipe, before, index, beforeCache)) return unlocked;

    const now = profitabilityOf(recipe, after, index, afterCache);
    if (now) unlocked.push(now);
    return unlocked;
  }, []);
};
