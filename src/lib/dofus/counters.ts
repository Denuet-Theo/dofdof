import type { CounterKind } from '@/lib/supabase/types';

/**
 * Ce qu'un compteur peut viser, et comment on le trouve.
 *
 * Partagé par la route de recherche et par l'écran : la cible traverse le
 * réseau telle quelle, et c'est elle qu'on recopie dans `user_counters` au
 * moment du choix.
 */

/** Douze cases, quatre par ligne. La grille est fixe : au-delà, on en supprime une. */
export const COUNTER_SLOTS = 12;

/** Une cible choisissable, telle que la recherche la rend. */
export type CounterTarget = {
  kind: CounterKind;
  id: number;
  name: string;
  img: string;
  /**
   * La ligne de contexte qui départage deux homonymes : le type d'un item, le
   * niveau d'un monstre, l'effectif d'une famille. « Bouftou » est à la fois un
   * ennemi, une famille et le début de six items.
   */
  hint: string;
};

/** Ce que la route rend : trois listes séparées, parce que l'écran les affiche ainsi. */
export type CounterSearchResult = {
  items: CounterTarget[];
  monsters: CounterTarget[];
  races: CounterTarget[];
  /**
   * Le miroir des familles n'a jamais été synchronisé.
   *
   * Sans ce drapeau, une base migrée mais pas resynchronisée rendrait « aucune
   * famille » pour toute recherche, ce qui se lit comme « cette famille
   * n'existe pas ». Le silence est le pire des deux, cf. `catalogUnavailable`.
   */
  racesUnavailable?: boolean;
};

/** Sur une case : ce que compte ce compteur-là. */
export const KIND_LABEL: Record<CounterKind, string> = {
  item: 'Item',
  monster: 'Ennemi',
  race: 'Famille',
};

/** En tête de groupe, dans les résultats de recherche. */
export const KIND_GROUP: Record<CounterKind, string> = {
  item: 'Items',
  monster: 'Ennemis',
  race: 'Familles',
};

/**
 * Le rang d'un résultat : exact, puis préfixe, puis le reste.
 *
 * Les trois tables sont interrogées avec un `like '%mot%'` par mot, qui ne
 * classe rien — « Bouftou » y arrive après « Gelée Bouftou Royal » aussi bien
 * qu'avant, au gré de l'ordre des ids. Sur une liste de six lignes, la cible
 * exacte doit être la première, sinon la recherche par nom ne sert à rien.
 */
export const relevance = (slug: string, query: string): number => {
  if (slug === query) return 0;
  if (slug.startsWith(query)) return 1;
  return 2;
};

/** Classe une liste de cibles déjà lues, la plus pertinente d'abord. */
export const rankTargets = <T extends { slug: string; name: string }>(
  rows: T[],
  query: string
): T[] =>
  [...rows].sort(
    (a, b) =>
      relevance(a.slug, query) - relevance(b.slug, query) ||
      // À pertinence égale, le nom le plus court est le plus générique — donc
      // celui qu'on cherchait en tapant deux syllabes.
      a.name.length - b.name.length ||
      a.name.localeCompare(b.name, 'fr')
  );
