import type {
  DofusDBItem,
  DofusDBRecipe,
  DofusItemRow,
  DofusRecipeRow,
} from '@/lib/supabase/types';

// Colonnes sélectionnées côté PostgREST. `synced_at` est délibérément absent :
// c'est de la métadonnée de synchronisation, jamais servie au client.
//
// Ces deux constantes doivent rester des littéraux d'une seule pièce, sans
// espaces : supabase-js analyse la chaîne au niveau des *types* pour en déduire
// la forme des lignes. Une concaténation (`'a' + 'b'`) l'élargit en `string` et
// un espace après la virgule casse l'analyse — dans les deux cas le résultat
// dégénère en `GenericStringError` et plus rien ne typecheck.
export const ITEM_COLUMNS =
  'id,type_id,super_type_id,icon_id,level,name_fr,type_name_fr,description_fr,slug_fr,has_recipe,effects,img';

export const RECIPE_COLUMNS =
  'id,result_id,result_type_id,result_super_type_id,result_level,result_name_fr,ingredient_ids,quantities,job_id,job_name_fr,job_img,skill_id';

type ItemRow = Omit<DofusItemRow, 'synced_at'>;
type RecipeRow = Omit<DofusRecipeRow, 'synced_at'>;

/** Reconstruit la forme `DofusDBItem` que les composants consomment déjà. */
export const toDofusDBItem = (row: ItemRow): DofusDBItem => ({
  id: row.id,
  typeId: row.type_id,
  superTypeId: row.super_type_id,
  iconId: row.icon_id,
  level: row.level,
  name: { fr: row.name_fr },
  description: { fr: row.description_fr },
  img: row.img,
  slug: { fr: row.slug_fr },
  type: { id: row.type_id, name: { fr: row.type_name_fr } },
  hasRecipe: row.has_recipe,
  effects: row.effects ?? [],
});

/**
 * Ingrédient absent du miroir : on renvoie quand même une *entrée*.
 *
 * RecipeCard et GaugeItemCard parcourent `recipe.ingredients` en lisant
 * `quantities[index]`. Filtrer un ingrédient introuvable décalerait toutes les
 * quantités suivantes et fausserait le coût de craft sans la moindre erreur
 * visible — mieux vaut une case « Item #123 » sans icône.
 *
 * En pratique le cas ne se produit pas : la synchro miroite l'intégralité du
 * catalogue, ingrédients compris (vérifié — zéro recette orpheline).
 */
export const placeholderItem = (id: number, nameFr?: string): DofusDBItem => ({
  id,
  typeId: 0,
  // 0 = inconnu : `getHdvLabel` n'affichera aucune étiquette plutôt qu'une fausse.
  superTypeId: 0,
  iconId: 0,
  level: 0,
  name: { fr: nameFr ?? `Item #${id}` },
  description: { fr: '' },
  img: '',
  slug: { fr: '' },
  type: { id: 0, name: { fr: '' } },
  hasRecipe: false,
  effects: [],
});

/**
 * Réhydrate une recette avec son résultat et ses ingrédients.
 *
 * DofusDB renvoyait ces objets peuplés d'office ; le miroir ne stocke que les
 * ids, et l'appelant fournit la table d'items correspondante (une seule requête
 * sur la clé primaire).
 */
export const toDofusDBRecipe = (
  row: RecipeRow,
  itemsById: Map<number, DofusDBItem>
): DofusDBRecipe => ({
  id: row.id,
  resultId: row.result_id,
  resultTypeId: row.result_type_id,
  resultLevel: row.result_level,
  ingredientIds: row.ingredient_ids,
  quantities: row.quantities,
  jobId: row.job_id,
  skillId: row.skill_id,
  resultName: { fr: row.result_name_fr },
  result: {
    ...(itemsById.get(row.result_id) ?? placeholderItem(row.result_id, row.result_name_fr)),
    // `result.price` vient d'upstream et n'est lu nulle part dans l'app : les
    // prix viennent de la table item_prices, pas du catalogue.
    price: 0,
  },
  ingredients: row.ingredient_ids.map((id) => itemsById.get(id) ?? placeholderItem(id)),
  job: { id: row.job_id, name: { fr: row.job_name_fr }, img: row.job_img },
});

/** Ids d'items nécessaires pour réhydrater un lot de recettes, dédupliqués. */
export const collectItemIds = (rows: RecipeRow[]): number[] => [
  ...new Set(rows.flatMap((row) => [row.result_id, ...row.ingredient_ids])),
];
