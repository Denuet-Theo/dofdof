import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MAX_RESULT_IDS, WEAPON_SUPER_TYPE_ID } from '@/lib/dofus/constants';
import { catalogResponse, clampInt, parseIdList, parsePageSize, respondWithRows } from '@/lib/dofus/catalog';
import {
  ITEM_COLUMNS,
  RECIPE_COLUMNS,
  collectItemIds,
  toDofusDBItem,
  toDofusDBRecipe,
} from '@/lib/dofus/mappers';
import type { DofusDBItem } from '@/lib/supabase/types';

// Sert le miroir local (`dofus_recipes`) au lieu de proxifier api.dofusdb.fr.
// Upstream renvoyait `result`, `ingredients[]` et `job` déjà peuplés ; ici on
// stocke les ids et on réhydrate en une requête sur la clé primaire des items.
export const GET = async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams;
  const limit = parsePageSize(searchParams.get('limit'), 50);
  const skip = clampInt(searchParams.get('skip'), 0, 0, 100_000);

  const supabase = await createClient();
  let dbQuery = supabase
    .from('dofus_recipes')
    .select(RECIPE_COLUMNS, { count: 'exact' })
    .order('id', { ascending: true })
    .range(skip, skip + limit - 1);

  const jobId = searchParams.get('jobId');
  if (jobId) dbQuery = dbQuery.eq('job_id', Number(jobId));

  const minLevel = searchParams.get('minLevel');
  if (minLevel) dbQuery = dbQuery.gte('result_level', Number(minLevel));

  const maxLevel = searchParams.get('maxLevel');
  if (maxLevel) dbQuery = dbQuery.lte('result_level', Number(maxLevel));

  const rawResultIds = searchParams.get('resultIds');
  if (rawResultIds !== null) {
    const ids = parseIdList(rawResultIds);
    // Une liste explicite mais vide veut dire « aucune recette demandée », et
    // non « toutes » : sans ce court-circuit on renverrait le catalogue entier.
    if (ids.length === 0) {
      return catalogResponse({ total: 0, limit, skip, data: [] });
    }
    if (ids.length > MAX_RESULT_IDS) {
      console.warn(`[catalog] recipes: resultIds truncated from ${ids.length} to ${MAX_RESULT_IDS}`);
    }
    dbQuery = dbQuery.in('result_id', ids.slice(0, MAX_RESULT_IDS));
  }

  if (searchParams.get('excludeWeapons') === '1') {
    dbQuery = dbQuery.neq('result_super_type_id', WEAPON_SUPER_TYPE_ID);
  }

  const { data, error, count } = await dbQuery;

  return respondWithRows(supabase, 'recipes', { data, error, count }, limit, skip, async (rows) => {
    const itemIds = collectItemIds(rows);
    const itemsById = new Map<number, DofusDBItem>();

    if (itemIds.length > 0) {
      const { data: items, error: itemsError } = await supabase
        .from('dofus_items')
        .select(ITEM_COLUMNS)
        .in('id', itemIds);

      // Une réhydratation ratée ne doit pas faire échouer la page : les mappers
      // produisent des ingrédients de repli qui préservent l'alignement des
      // quantités, donc les coûts de craft restent justes même sans icônes.
      if (itemsError) console.error('[catalog] recipe hydration failed:', itemsError);
      (items ?? []).forEach((item) => itemsById.set(item.id, toDofusDBItem(item)));
    }

    return rows.map((row) => toDofusDBRecipe(row, itemsById));
  });
};
