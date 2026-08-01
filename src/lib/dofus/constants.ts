/**
 * `item-types.superTypeId = 2` regroupe toutes les armes (Arc, Épée, Marteau,
 * Lance, Arme magique… — 13 types au total).
 *
 * Hors périmètre en tant que décision produit, mais délibérément **pas** filtré à
 * l'ingestion : la recette « Quintaine » (resultId 19644, un objet de quête, donc
 * dans le périmètre) utilise « Fléau d'armes » (typeId 7, une arme) comme
 * ingrédient, et l'UI parcourt `recipe.ingredients` en lisant `quantities[index]`.
 * Retirer un ingrédient décalerait toutes les quantités suivantes et fausserait
 * silencieusement le coût de craft.
 *
 * L'exclusion est donc un filtre optionnel au service (`?excludeWeapons=1`), que
 * rien n'active pour l'instant. Il n'existe par ailleurs aucun type d'item
 * cosmétique dans ce jeu de données.
 */
export const WEAPON_SUPER_TYPE_ID = 2;

/** Garde-fou sur `limit` : /gauges demande jusqu'à ~170 recettes d'un coup. */
export const MAX_PAGE_SIZE = 1000;

/**
 * `resultIds` est sérialisé dans l'URL envoyée à PostgREST, qui a une limite de
 * taille de requête. 500 ids ≈ 3,5 Ko, ce qui laisse de la marge. Au-delà on
 * tronque **en le loggant**, plutôt que de laisser passer un 414 mystérieux.
 */
export const MAX_RESULT_IDS = 500;
