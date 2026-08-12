import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { farmLimit, parseFarmArgs } from '@/lib/dofus/farm';
import type { FarmTarget } from '@/lib/supabase/types';

// Sert le classement des cibles de farm depuis le miroir local, via la fonction
// `farm_targets` (migration 20260802210000). Le tri agrège
// dofus_drops × dofus_items × item_prices : c'est du SQL, pas une requête
// PostgREST, d'où le rpc plutôt qu'un `.from().select()`.
//
// Le classement **par sous-zone** est servi par `./zones`, sur la même sélection
// et les mêmes paramètres : voir `parseFarmArgs`.

/** Le classement se lit d'un coup d'œil : au-delà, on affine les filtres. */
const DEFAULT_LIMIT = 50;

export const GET = async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams;
  const limit = farmLimit(searchParams, DEFAULT_LIMIT);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'farm_targets',
    parseFarmArgs(searchParams, DEFAULT_LIMIT)
  );

  if (error) {
    console.error('[catalog] farm_targets query failed:', error);
    return Response.json(
      { error: 'Erreur lors du calcul des cibles de farm', code: 'FARM_QUERY_FAILED' },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as FarmTarget[];

  // Vide et sans filtre restrictif = miroir des monstres jamais synchronisé.
  // Distinguer ce cas d'un « aucun résultat » légitime évite de faire chercher
  // un bug de filtre là où il manque juste un `npm run db:sync`.
  if (rows.length === 0) {
    const { data: state } = await supabase
      .from('dofus_sync_state')
      .select('resource, row_count')
      .in('resource', ['monsters', 'drops']);

    if (!state || state.length < 2 || state.some((row) => row.row_count === 0)) {
      return Response.json(
        {
          error:
            'Bestiaire DofusDB indisponible : le miroir local est vide. ' +
            'Lancer `npm run db:sync`.',
          code: 'CATALOG_UNAVAILABLE',
        },
        { status: 503 }
      );
    }
  }

  // Pas de `catalogResponse` ici, et c'est tout l'objet de la distinction : son
  // `max-age=300, stale-while-revalidate=3600` convient au catalogue, qui ne
  // bouge qu'aux patchs du jeu, mais ce classement dépend aussi d'`item_prices`,
  // que les joueurs corrigent à la main. Servi depuis le cache navigateur, un
  // prix qu'on vient de changer restait invisible sur les monstres pendant cinq
  // minutes, et jusqu'à une heure par la revalidation en arrière-plan — soit
  // exactement le geste que la page existe pour rendre.
  return Response.json(
    { total: rows.length, limit, skip: 0, data: rows },
    { headers: { 'Cache-Control': 'no-store' } }
  );
};
