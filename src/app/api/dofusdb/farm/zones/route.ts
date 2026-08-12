import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { farmLimit, parseFarmArgs } from '@/lib/dofus/farm';
import type { FarmZone } from '@/lib/supabase/types';

// Le même classement que `../` mais par **sous-zone**, via `farm_zones`
// (migration 20260812100000).
//
// ## Pourquoi une route et non un paramètre de la première
//
// Les deux rendent des lignes de forme différente — un monstre porte ses drops et
// ses résistances, une zone porte une moyenne et un effectif. Une route unique
// rendrait une union que l'appelant devrait discriminer sur un champ, alors que
// c'est le mode qui la détermine et qu'il le sait avant d'appeler. Les paramètres
// de sélection, eux, sont bien partagés : `parseFarmArgs` est le seul endroit qui
// les lit.
//
// ## Pourquoi l'agrégation n'est pas côté client
//
// `farm_targets` est plafonnée à `limit`. Agréger sa sortie ne moyennerait que
// les meilleurs monstres du classement, pas ceux de la zone — une zone sans
// aucun monstre dans ce top n'apparaîtrait pas, et une zone qui en place un
// serait notée sur lui seul.

/**
 * Une sous-zone tient sur une ligne courte, et il y en a 562 : on en sert plus
 * que de monstres sans que la page devienne illisible.
 */
const DEFAULT_LIMIT = 80;

export const GET = async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams;
  const limit = farmLimit(searchParams, DEFAULT_LIMIT);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    'farm_zones',
    parseFarmArgs(searchParams, DEFAULT_LIMIT)
  );

  if (error) {
    console.error('[catalog] farm_zones query failed:', error);
    return Response.json(
      { error: 'Erreur lors du calcul des zones de farm', code: 'FARM_QUERY_FAILED' },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as FarmZone[];

  // Vide et sans filtre restrictif = miroir des monstres jamais synchronisé.
  // Même diagnostic que la route par monstre, et pour la même raison : distinguer
  // ce cas d'un « aucun résultat » légitime évite de faire chercher un bug de
  // filtre là où il manque un `npm run db:sync`.
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

  // `no-store` et non `catalogResponse` : le classement dépend d'`item_prices`,
  // que les joueurs corrigent à la main, donc un prix qu'on vient de changer doit
  // se voir au reclassement suivant. Même raisonnement que la route par monstre.
  return Response.json(
    { total: rows.length, limit, skip: 0, data: rows },
    { headers: { 'Cache-Control': 'no-store' } }
  );
};
