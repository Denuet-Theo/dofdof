import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WEAPON_SUPER_TYPE_ID } from '@/lib/dofus/constants';
import { catalogResponse, parseIdList, parsePageSize, clampInt, respondWithRows } from '@/lib/dofus/catalog';
import { ITEM_COLUMNS, toDofusDBItem } from '@/lib/dofus/mappers';
import { normalizeSearchTerms } from '@/lib/dofus/search';

// Sert le miroir local du catalogue (table `dofus_items`) au lieu de proxifier
// api.dofusdb.fr. Le contrat d'URL et l'enveloppe `{ total, limit, skip, data }`
// sont inchangés, donc les composants clients n'ont rien à modifier.
export const GET = async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q') || '';
  const limit = parsePageSize(searchParams.get('limit'), 20);
  const skip = clampInt(searchParams.get('skip'), 0, 0, 100_000);
  const typeIds = parseIdList(searchParams.get('typeId') || '');
  // Les mots sont normalisés (accents retirés, jokers `%`/`_` supprimés) avant
  // d'atterrir dans un `LIKE`, cf. normalizeSearchTerms.
  const words = query.length >= 2 ? normalizeSearchTerms(query) : [];

  // Contrat inchangé : sans terme exploitable ni typeId, on ne liste pas tout le
  // catalogue. Un typeId seul reste valide (parcours d'une catégorie entière).
  if (words.length === 0 && typeIds.length === 0) {
    return catalogResponse({ total: 0, limit, skip, data: [] });
  }

  const supabase = await createClient();
  let dbQuery = supabase
    .from('dofus_items')
    .select(ITEM_COLUMNS, { count: 'exact' })
    // Ordre explicite : /gauges pagine avec skip et a besoin d'un ordre stable
    // entre deux pages, ce que l'API upstream ne garantissait qu'implicitement.
    .order('id', { ascending: true })
    .range(skip, skip + limit - 1);

  if (typeIds.length > 0) dbQuery = dbQuery.in('type_id', typeIds);

  // Filtres répétés sur la même colonne = AND côté PostgREST : reproduit le
  // `(?=.*mot1)(?=.*mot2)` que l'ancienne route envoyait à DofusDB, donc l'ordre
  // des mots reste indifférent.
  for (const word of words) dbQuery = dbQuery.like('slug_fr', `%${word}%`);

  if (searchParams.get('excludeWeapons') === '1') {
    dbQuery = dbQuery.neq('super_type_id', WEAPON_SUPER_TYPE_ID);
  }

  const { data, error, count } = await dbQuery;

  return respondWithRows(supabase, 'items', { data, error, count }, limit, skip, (rows) =>
    rows.map(toDofusDBItem)
  );
};
