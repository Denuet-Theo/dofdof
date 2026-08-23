import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  CATALOG_CACHE_HEADERS,
  catalogUnavailable,
  clampInt,
  mirrorEmpty,
  queryFailed,
} from '@/lib/dofus/catalog';
import { normalizeSearchTerms } from '@/lib/dofus/search';
import { rankTargets, type CounterSearchResult, type CounterTarget } from '@/lib/dofus/counters';

// La recherche de l'écran /counter : un terme, trois miroirs.
//
// Une seule route plutôt que trois : la case vide d'un compteur cherche à
// chaque frappe, et « Bouftou » se cherche indifféremment comme item, comme
// ennemi ou comme famille. Trois appels par frappe pour une liste de six lignes
// coûteraient trois fois plus au réseau pour un résultat qui, lui, s'affiche
// d'un bloc.

/** Une cible et le slug sur lequel on la classe, avant de rendre la première sans le second. */
type Ranked = CounterTarget & { slug: string };

/** Ce qu'on affiche par catégorie. Six lignes tiennent sous une case sans la noyer. */
const PER_KIND = 6;

/**
 * Ce qu'on lit avant de classer.
 *
 * Le `like` de Postgres ne classe rien : sans cette marge, les six premières
 * lignes seraient les six plus petits ids, et « Bouftou » sortirait après
 * « Bouftou Royal » une fois sur deux. On descend large, on classe, on coupe.
 */
const POOL = 40;

export const GET = async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q') || '';
  const limit = clampInt(searchParams.get('limit'), PER_KIND, 1, 20);
  const words = query.length >= 2 ? normalizeSearchTerms(query) : [];

  const empty: CounterSearchResult = { items: [], monsters: [], races: [] };

  // Même contrat que la route items : sans terme exploitable, on ne liste pas
  // le catalogue entier.
  if (words.length === 0) {
    return NextResponse.json(empty, { headers: CATALOG_CACHE_HEADERS });
  }

  const supabase = await createClient();

  // Les mots normalisés partent tels quels dans le `like` : `normalizeSearchTerms`
  // en a retiré `%` et `_`, cf. son commentaire.
  const [items, monsters, races] = await Promise.all([
    words
      .reduce(
        (builder, word) => builder.like('slug_fr', `%${word}%`),
        supabase.from('dofus_items').select('id,name_fr,slug_fr,type_name_fr,img')
      )
      .order('id', { ascending: true })
      .limit(POOL),
    words
      .reduce(
        (builder, word) => builder.like('slug_fr', `%${word}%`),
        supabase
          .from('dofus_monsters')
          .select('id,name_fr,slug_fr,level_min,level_max,img')
          // Les monstres masqués du bestiaire sont des doublons de donjon et des
          // entrées de test : rien qu'un éleveur compte.
          .eq('hide_in_bestiary', false)
      )
      .order('id', { ascending: true })
      .limit(POOL),
    words
      .reduce(
        (builder, word) => builder.like('slug_fr', `%${word}%`),
        supabase
          .from('dofus_monster_races')
          .select('id,name_fr,slug_fr,monster_count,img')
          // Une famille dont aucun monstre n'est miroité ne se compte pas : elle
          // n'a ni icône ni effectif à afficher.
          .gt('monster_count', 0)
      )
      .order('id', { ascending: true })
      .limit(POOL),
  ]);

  const failed = [items, monsters, races].find((result) => result.error);
  if (failed) return queryFailed('counter-targets', failed.error);

  const joined = words.join(' ');

  /** Le slug n'a servi qu'au classement : il ne traverse pas le réseau. */
  const strip = ({ kind, id, name, img, hint }: Ranked): CounterTarget => ({
    kind,
    id,
    name,
    img,
    hint,
  });
  const cut = (rows: Ranked[]): CounterTarget[] =>
    rankTargets(rows, joined).slice(0, limit).map(strip);

  const result: CounterSearchResult = {
    items: cut(
      (items.data ?? []).map(
        (row): Ranked => ({
          kind: 'item',
          id: row.id,
          name: row.name_fr,
          img: row.img,
          hint: row.type_name_fr,
          slug: row.slug_fr,
        })
      )
    ),
    monsters: cut(
      (monsters.data ?? []).map(
        (row): Ranked => ({
          kind: 'monster',
          id: row.id,
          name: row.name_fr,
          img: row.img,
          hint:
            row.level_min === row.level_max
              ? `Niveau ${row.level_min}`
              : `Niveaux ${row.level_min} à ${row.level_max}`,
          slug: row.slug_fr,
        })
      )
    ),
    races: cut(
      (races.data ?? []).map(
        (row): Ranked => ({
          kind: 'race',
          id: row.id,
          name: row.name_fr,
          img: row.img,
          hint: `${row.monster_count} ennemi${row.monster_count > 1 ? 's' : ''}`,
          slug: row.slug_fr,
        })
      )
    ),
  };

  // Rien nulle part : soit le terme ne dit rien à personne, soit le miroir n'a
  // jamais été rempli. Les deux se ressemblent à l'écran et ne demandent pas du
  // tout le même geste — d'où la lecture de l'état de synchro, qui ne coûte
  // qu'ici, jamais sur le chemin passant.
  if (result.items.length === 0 && result.monsters.length === 0 && result.races.length === 0) {
    if (await mirrorEmpty(supabase, ['items', 'monsters'])) return catalogUnavailable();
  }

  // Les familles sont arrivées après le reste du miroir : une base migrée mais
  // pas resynchronisée les rendrait introuvables en silence.
  if (result.races.length === 0 && (await mirrorEmpty(supabase, ['races']))) {
    result.racesUnavailable = true;
  }

  return NextResponse.json(result, { headers: CATALOG_CACHE_HEADERS });
};
