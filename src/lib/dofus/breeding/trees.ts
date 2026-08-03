import trees from './trees.json';
import type { BreedingFamily, BreedingItem, GenetonExchangeRow } from './costs';

/**
 * Accès aux arbres de croisement figés par
 * `scripts/extract-breeding-trees.mjs`.
 *
 * Séparé de `costs.ts` pour que le calcul reste une fonction pure de ses
 * arguments : il se teste alors sans charger le fichier de données, et une
 * famille de test se substitue à la vraie sans détour.
 */

const data = trees as {
  geneton: BreedingItem;
  genetonExchange: GenetonExchangeRow[];
  families: BreedingFamily[];
};

export const BREEDING_FAMILIES = data.families;

/** Ce qu'Eugène éton donne contre des génétons, et à quel prix en jetons. */
export const GENETON_EXCHANGE = data.genetonExchange;

/**
 * Le généton, co-produit de tout accouplement. Commun aux trois familles —
 * contrairement à la ressource de sacrifice, qui vit sur chaque famille.
 */
export const GENETON_ITEM = data.geneton;

/** Tous les items dont il faut connaître le prix pour valoriser les co-produits. */
export const BYPRODUCT_ITEM_IDS = [
  GENETON_ITEM.id,
  ...BREEDING_FAMILIES.map((family) => family.sacrificeItem.id),
];

export const findFamily = (id: string) => BREEDING_FAMILIES.find((family) => family.id === id);

export const findColor = (family: BreedingFamily, colorId: string) =>
  family.colors.find((color) => color.id === colorId);
