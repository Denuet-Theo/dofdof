// Bloc Unicode « Combining Diacritical Marks » : ce que `normalize('NFD')`
// détache des lettres accentuées. Écrit en échappements plutôt qu'en caractères
// littéraux, qui seraient invisibles et dépendants de l'encodage du fichier.
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Découpe un terme de recherche en mots normalisés, à comparer à `slug_fr`.
 *
 * DofusDB fournit déjà `slug.fr` sans accents et en minuscules
 * (« Chaussures Lepon-Davignon » → « chaussures lepon-davignon »), et le miroir
 * le stocke tel quel : seule la *requête* a besoin d'être normalisée.
 *
 * Conserver `'` et `-` colle à la convention des slugs. Tout retirer d'autre
 * élimine au passage `%` et `_`, qui seraient sinon interprétés comme des jokers
 * par le `LIKE` côté Postgres — c'est ce qui rend sûr l'envoi direct des mots
 * dans le filtre.
 *
 * Reprend à l'identique la normalisation que faisait la route items avant le
 * passage au miroir, pour que les résultats de recherche ne bougent pas.
 */
export const normalizeSearchTerms = (query: string): string[] =>
  query
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
