import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { clampInt, parseIdList } from '@/lib/dofus/catalog';
import { ELEMENTS, type Element } from '@/lib/supabase/types';
import type { FarmTarget } from '@/lib/supabase/types';

// Sert le classement des cibles de farm depuis le miroir local, via la fonction
// `farm_targets` (migration 20260802210000). Le tri agrège
// dofus_drops × dofus_items × item_prices : c'est du SQL, pas une requête
// PostgREST, d'où le rpc plutôt qu'un `.from().select()`.

/** `?flag=1` ou `?flag=0` ; absent = valeur par défaut côté SQL. */
const parseFlag = (raw: string | null): boolean | undefined => {
  if (raw === null || raw === '') return undefined;
  return raw === '1' || raw === 'true';
};

/**
 * `?elements=fire,water` → éléments connus uniquement.
 *
 * Le filtrage sur ELEMENTS n'est pas cosmétique : la fonction SQL fait un `case`
 * sur ces libellés et renvoie null pour un inconnu, ce qui ferait taire le
 * filtre au lieu de le signaler. Une saisie invalide vaut mieux ignorée ici,
 * explicitement, qu'appliquée à moitié.
 */
const parseElements = (raw: string | null): Element[] | undefined => {
  if (raw === null) return undefined;
  const known = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is Element => (ELEMENTS as readonly string[]).includes(part));
  return known.length > 0 ? known : undefined;
};

const parseNumber = (raw: string | null): number | undefined => {
  if (raw === null || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const GET = async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams;
  const limit = clampInt(searchParams.get('limit'), 50, 1, 200);

  const rawSubareas = searchParams.get('subareaIds');
  const subareaIds = rawSubareas === null ? undefined : parseIdList(rawSubareas);

  // Chaque paramètre absent est omis plutôt qu'envoyé à null : les valeurs par
  // défaut vivent dans la signature SQL, un seul endroit à lire pour savoir ce
  // que fait la route sans filtre.
  const args = {
    p_min_level: parseNumber(searchParams.get('minLevel')),
    p_max_level: parseNumber(searchParams.get('maxLevel')),
    p_subarea_ids: subareaIds && subareaIds.length > 0 ? subareaIds : undefined,
    p_area_id: parseNumber(searchParams.get('areaId')),
    p_exclude_boss: parseFlag(searchParams.get('excludeBoss')),
    p_exclude_mini_boss: parseFlag(searchParams.get('excludeMiniBoss')),
    p_exclude_quest: parseFlag(searchParams.get('excludeQuest')),
    p_exclude_bounty: parseFlag(searchParams.get('excludeBounty')),
    p_exclude_hidden: parseFlag(searchParams.get('excludeHidden')),
    p_min_percent: parseNumber(searchParams.get('minPercent')),
    p_prospecting: parseNumber(searchParams.get('prospecting')),
    p_priced_only: parseFlag(searchParams.get('pricedOnly')),
    p_crafted_only: parseFlag(searchParams.get('craftedOnly')),
    // Actif par défaut côté SQL : `?excludeQuestDrops=0` pour les réintégrer.
    p_exclude_quest_drops: parseFlag(searchParams.get('excludeQuestDrops')),
    p_unconditional_only: parseFlag(searchParams.get('unconditionalOnly')),
    p_elements: parseElements(searchParams.get('elements')),
    p_max_resistance: parseNumber(searchParams.get('maxResistance')),
    p_limit: limit,
  };

  const defined = Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined)
  );

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('farm_targets', defined);

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
