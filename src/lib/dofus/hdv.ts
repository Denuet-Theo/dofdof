/**
 * L'hôtel de vente dans lequel un item se négocie.
 *
 * DofusDB porte l'information sur `/item-types.categoryId`, pas sur l'item.
 * Plutôt que d'ajouter une colonne au miroir (ce qui imposerait un `db:sync`
 * complet pour rétro-remplir 21 738 lignes), on déduit la catégorie du
 * `super_type_id` déjà stocké : la correspondance a été vérifiée sur la
 * totalité des 239 types et c'est une fonction, sans le moindre super-type à
 * cheval sur deux catégories.
 *
 * Le revers est qu'une mise à jour du jeu introduisant un super-type inédit ne
 * sera pas connue ici. D'où le repli sur `null` — pas d'étiquette plutôt qu'une
 * étiquette fausse, un item non catégorisé se signalant alors par son absence.
 */

/** Les catégories telles que DofusDB les numérote (`item-types.categoryId`). */
export const HDV_CATEGORIES = {
  0: 'Équipement',
  1: 'Consommables',
  2: 'Ressources',
  3: 'Objets de quête',
  4: 'Divers',
  5: 'Cosmétiques',
} as const;

export type HdvCategoryId = keyof typeof HDV_CATEGORIES;
export type HdvLabel = (typeof HDV_CATEGORIES)[HdvCategoryId];

/**
 * super_type_id → categoryId, relevé sur api.dofusdb.fr/item-types.
 * Le nom en commentaire est celui du super-type, pour que la ligne reste
 * relisible sans rouvrir l'API.
 */
const SUPER_TYPE_CATEGORY: Record<number, HdvCategoryId> = {
  1: 0, // Amulette
  2: 0, // Arme
  3: 0, // Anneau
  4: 0, // Ceinture
  5: 0, // Bottes
  6: 1, // Consommable
  7: 0, // Bouclier
  9: 2, // Ressource
  10: 0, // Chapeau
  11: 0, // Cape
  12: 0, // Familier
  13: 0, // Dofus / Trophée / Prysmaradite
  14: 3, // Objet de quête
  15: 4, // Mutation
  16: 4, // Nourriture
  17: 4, // Bénédiction
  18: 4, // Malédiction
  19: 4, // Bonus de jeu de rôle
  20: 4, // Suiveur
  22: 5, // Cosmétiques
  23: 0, // Compagnon
  25: 5, // Costume
  26: 4, // Certificat
  27: 0, // Certificat de monture
  69: 0, // Équipement de percepteur
  70: 1, // Consommables de combat
};

/**
 * L'étiquette d'HDV d'un item, ou `null` s'il n'est rattaché à aucune catégorie
 * connue — y compris pour `superTypeId` absent ou à 0, la valeur que le miroir
 * écrit quand DofusDB n'a pas résolu le type.
 */
export const getHdvLabel = (superTypeId?: number | null): HdvLabel | null => {
  if (!superTypeId) return null;
  const category = SUPER_TYPE_CATEGORY[superTypeId];
  return category === undefined ? null : HDV_CATEGORIES[category];
};
