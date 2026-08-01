import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, DofusDBResponse } from '@/lib/supabase/types';
import { MAX_PAGE_SIZE } from './constants';

type Client = SupabaseClient<Database>;

/** Borne un paramètre numérique de l'URL, en retombant sur `fallback` si absent/invalide. */
export const clampInt = (raw: string | null, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
};

export const parsePageSize = (raw: string | null, fallback: number) =>
  clampInt(raw, fallback, 1, MAX_PAGE_SIZE);

/** Liste d'ids séparés par des virgules → entiers, en ignorant les entrées vides. */
export const parseIdList = (raw: string): number[] =>
  raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter(Number.isFinite);

/**
 * Le miroir n'a jamais été rempli — les tables existent mais sont vides.
 *
 * Impossible en production : `prestart` fait échouer le démarrage sur Render
 * quand le catalogue est vide (cf. PR #28). Reste le cas d'un environnement de
 * dev où les migrations ont tourné mais pas `npm run db:sync` : un 503 explicite
 * y vaut infiniment mieux qu'une page « aucun résultat » silencieuse.
 *
 * N'est appelé que lorsqu'une requête ne renvoie rien, donc jamais sur le chemin
 * chaud ; et `dofus_sync_state` fait deux lignes.
 */
const isMirrorEmpty = async (supabase: Client) => {
  const { data, error } = await supabase
    .from('dofus_sync_state')
    .select('resource, row_count')
    .in('resource', ['items', 'recipes']);

  if (error || !data) return false; // Dans le doute, ne pas transformer un vide légitime en panne.
  return data.length < 2 || data.some((row) => row.row_count === 0);
};

const catalogUnavailable = () =>
  NextResponse.json(
    {
      error:
        'Catalogue DofusDB indisponible : le miroir local est vide. ' +
        'Lancer `npm run db:sync`.',
      code: 'CATALOG_UNAVAILABLE',
    },
    { status: 503 }
  );

const queryFailed = (scope: string, error: unknown) => {
  console.error(`[catalog] ${scope} query failed:`, error);
  return NextResponse.json(
    { error: 'Erreur lors de la lecture du catalogue', code: 'CATALOG_QUERY_FAILED' },
    { status: 500 }
  );
};

/**
 * Réponse au format Feathers `{ total, limit, skip, data }`, celui que servait
 * la route proxy — les composants clients n'ont donc rien à changer.
 *
 * Le catalogue ne bouge qu'aux patchs du jeu et est identique pour tous les
 * utilisateurs connectés, mais la route est derrière l'authentification : d'où
 * `private`, qui autorise le cache navigateur sans cache partagé.
 */
export const catalogResponse = <T>(body: DofusDBResponse<T>) =>
  NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=3600' },
  });

/**
 * Traduit le résultat d'une requête catalogue en réponse HTTP.
 *
 * Distingue trois cas que l'ancienne route confondait : erreur de requête (500),
 * miroir jamais synchronisé (503), et absence légitime de résultats (200 vide).
 */
export const respondWithRows = async <Row, Out>(
  supabase: Client,
  scope: string,
  result: { data: Row[] | null; error: unknown; count: number | null },
  limit: number,
  skip: number,
  map: (rows: Row[]) => Promise<Out[]> | Out[]
) => {
  if (result.error || !result.data) return queryFailed(scope, result.error);

  if (result.data.length === 0 && (await isMirrorEmpty(supabase))) {
    return catalogUnavailable();
  }

  return catalogResponse({
    total: result.count ?? 0,
    limit,
    skip,
    data: await map(result.data),
  });
};
