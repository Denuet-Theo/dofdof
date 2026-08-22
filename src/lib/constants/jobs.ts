/**
 * Les métiers, tels que les filtres les proposent.
 *
 * Ils étaient rangés par identifiant DofusDB — l'ordre dans lequel le jeu les a
 * ajoutés, qui ne veut rien dire pour qui lit le menu. Chercher « Sculpteur »
 * dans quinze entrées non triées, c'est les lire toutes.
 *
 * Le tri est fait **ici** et pas dans chacun des quatre écrans qui affichent la
 * liste : une entrée ajoutée en fin de tableau, comme on le fait naturellement,
 * ne peut donc pas défaire l'ordre.
 */
const BY_ID = [
  // Le métier 1 s'appelle « Base » chez DofusDB — ce sont les recettes
  // craftables sans métier, renommées ici pour que le filtre reste lisible.
  { id: 1, name: 'Sans métier' },
  { id: 2, name: 'Bûcheron' },
  { id: 11, name: 'Forgeron' },
  { id: 13, name: 'Sculpteur' },
  { id: 15, name: 'Cordonnier' },
  { id: 16, name: 'Bijoutier' },
  { id: 24, name: 'Mineur' },
  { id: 26, name: 'Alchimiste' },
  { id: 27, name: 'Tailleur' },
  { id: 28, name: 'Paysan' },
  { id: 36, name: 'Pêcheur' },
  { id: 41, name: 'Chasseur' },
  { id: 60, name: 'Façonneur' },
  { id: 65, name: 'Bricoleur' },
  { id: 79, name: 'Éleveur' },
];

/**
 * `localeCompare('fr')` et non l'ordre des points de code : sans lui « Éleveur »
 * et « Pêcheur » partiraient après « Tailleur », leurs accents les rangeant
 * au-delà de « z ».
 */
export const JOBS = [...BY_ID].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
