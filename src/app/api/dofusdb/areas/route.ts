import { createClient } from '@/lib/supabase/server';
import { catalogResponse } from '@/lib/dofus/catalog';
import type { DofusAreaRow } from '@/lib/supabase/types';

type Area = Pick<DofusAreaRow, 'id' | 'name_fr'>;

// Les 69 régions du miroir, pour alimenter le sélecteur de zone de /farm.
//
// Les sous-zones (562) ne sont volontairement pas servies ici : `farm_targets`
// accepte déjà `p_area_id` et élargit lui-même à toutes les sous-zones de la
// région, ce qui est la granularité utile pour choisir où aller farmer. Une
// liste de 562 entrées dans un menu déroulant ne l'aurait pas été.
export const GET = async () => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('dofus_areas')
    .select('id, name_fr')
    .order('name_fr', { ascending: true });

  if (error) {
    console.error('[catalog] areas query failed:', error);
    return Response.json(
      { error: 'Erreur lors de la lecture des zones', code: 'CATALOG_QUERY_FAILED' },
      { status: 500 }
    );
  }

  // Certaines régions du jeu n'ont pas de libellé français côté DofusDB ; sans
  // nom, une entrée de menu ne veut rien dire.
  const areas = (data ?? []).filter((area): area is Area => Boolean(area.name_fr));

  return catalogResponse({ total: areas.length, limit: areas.length, skip: 0, data: areas });
};
