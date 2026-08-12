import { clampInt, parseIdList } from '@/lib/dofus/catalog';
import { ELEMENTS, type Element, type FarmArgs } from '@/lib/supabase/types';

/**
 * La traduction des paramètres d'URL en arguments de `farm_targets` / `farm_zones`.
 *
 * Extraite parce que les deux fonctions SQL partagent leur signature terme pour
 * terme — c'est un choix de la migration 20260812100000, pas une coïncidence. Les
 * deux routes n'ont donc rien à traduire, et un filtre ajouté plus tard n'a qu'un
 * endroit à suivre au lieu de deux qui divergeraient au premier oubli.
 */

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

/**
 * Les arguments à passer au rpc, ceux laissés au défaut SQL étant omis.
 *
 * `defaultLimit` diffère selon le mode : cinquante monstres tiennent dans un
 * coup d'œil, mais une sous-zone est une ligne courte et il y en a 562 — on en
 * sert davantage sans que la page devienne illisible.
 */
export const parseFarmArgs = (
  searchParams: URLSearchParams,
  defaultLimit: number
): FarmArgs => {
  const limit = clampInt(searchParams.get('limit'), defaultLimit, 1, 200);

  const rawSubareas = searchParams.get('subareaIds');
  const subareaIds = rawSubareas === null ? undefined : parseIdList(rawSubareas);

  const args: FarmArgs = {
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

  // Chaque paramètre absent est omis plutôt qu'envoyé à null : les valeurs par
  // défaut vivent dans la signature SQL, un seul endroit à lire pour savoir ce
  // que fait la route sans filtre.
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined)
  ) as FarmArgs;
};

/** Le `limit` effectivement appliqué, pour que la réponse le rende. */
export const farmLimit = (searchParams: URLSearchParams, defaultLimit: number): number =>
  clampInt(searchParams.get('limit'), defaultLimit, 1, 200);
