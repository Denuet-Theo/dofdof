import type { Element } from '@/lib/supabase/types';

/**
 * Libellés français des cinq éléments, dans l'ordre d'`ELEMENTS`.
 *
 * Les clés viennent de DofusDB (`fireResistance`…) et servent aussi de valeur au
 * paramètre `elements` de /api/dofusdb/farm : elles ne sont pas traduisibles, ce
 * sont des identifiants. Seul l'affichage l'est.
 */
export const ELEMENT_LABELS: Record<Element, string> = {
  earth: 'Terre',
  air: 'Air',
  fire: 'Feu',
  water: 'Eau',
  neutral: 'Neutre',
};

/** Teinte par élément, alignée sur les couleurs du jeu. */
export const ELEMENT_COLORS: Record<Element, string> = {
  earth: 'text-amber-500',
  air: 'text-emerald-400',
  fire: 'text-red-400',
  water: 'text-sky-400',
  neutral: 'text-dark-300',
};
