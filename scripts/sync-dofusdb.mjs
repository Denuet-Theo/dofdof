// Synchronise le miroir local du catalogue DofusDB (voir la migration
// 20260801090000_dofus_catalog_mirror.sql).
//
// Pourquoi un miroir complet plutôt qu'un cache TTL : le catalogue ne bouge
// qu'aux patchs du jeu, 21 738 items + 4 858 recettes tiennent dans ~30 Mo, et
// une requête locale se mesure en millisecondes contre ~200 ms chez DofusDB.
//
// Usage :
//   npm run db:sync              synchro complète, échec = code de sortie non nul
//   npm run db:sync:dry          récupère et mappe tout, ne touche aucune base
//   node scripts/sync-dofusdb.mjs --if-stale    utilisé par `prestart`
//
// Écrit via SUPABASE_DB_URL (connexion Postgres directe, propriétaire des
// tables) plutôt que via une clé service-role : la variable existe déjà pour les
// migrations, elle a déjà plus de privilèges qu'une clé service-role, et seule
// une vraie connexion Postgres permet l'échange transactionnel ci-dessous.

import pg from 'pg';
import { describeTarget, isRender, requireDbUrl } from './lib/db-url.mjs';

const API = 'https://api.dofusdb.fr';
// DofusDB plafonne $limit à 50 quoi qu'on demande.
const PAGE_SIZE = 50;
// Poli avec une API publique et sans clé : 5 requêtes en vol suffisent à
// descendre les 435 pages d'items en ~15 s.
const CONCURRENCY = 5;
const BATCH_ROWS = 500;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
// superTypeId 2 = armes. Utilisé ici uniquement pour la ligne de log : le
// filtrage est volontairement fait au service, pas à l'ingestion (cf. migration).
const WEAPON_SUPER_TYPE_ID = 2;

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const ifStale = args.has('--if-stale');
const maxAgeHours = Number(process.env.DOFUSDB_SYNC_MAX_AGE_HOURS ?? 168);

/**
 * Supabase n'accepte que des connexions TLS, et node-postgres ne l'active pas de
 * lui-même — contrairement à la CLI Supabase qu'utilise run-migrations.mjs, qui
 * s'en charge seule. Le certificat est signé par une AC absente du magasin par
 * défaut de Node, d'où `rejectUnauthorized: false` : le transport est chiffré,
 * la chaîne n'est pas validée. Une chaîne de connexion qui précise déjà
 * `sslmode` est laissée telle quelle.
 */
const clientConfig = (connectionString) => ({
  connectionString,
  ...(/[?&]sslmode=/i.test(connectionString) ? {} : { ssl: { rejectUnauthorized: false } }),
});

const log = (msg) => console.log(`[sync] ${msg}`);
const warn = (msg) => console.warn(`[sync] ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

let retryCount = 0;
// Renseigné par le mode --if-stale ; décide si un échec doit bloquer le démarrage.
let freshness = 'cold';

// ---------------------------------------------------------------- récupération

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    // 4xx (hors 429) = requête invalide de notre part : réessayer ne changera rien.
    if (!res.ok && res.status < 500 && res.status !== 429) {
      throw Object.assign(new Error(`HTTP ${res.status} on ${url}`), { fatal: true });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.fatal || attempt >= MAX_ATTEMPTS) throw err;
    retryCount++;
    // Backoff exponentiel + jitter, pour ne pas resynchroniser les 5 workers
    // sur la même milliseconde après un 429.
    await sleep(2 ** attempt * 250 + Math.random() * 250);
    return fetchJson(url, attempt + 1);
  }
}

/** Descend une collection Feathers page par page, `CONCURRENCY` requêtes en vol. */
async function fetchAll(resource, query, label) {
  const probe = await fetchJson(`${API}/${resource}?${query}&$limit=1`);
  const total = probe.total ?? 0;

  const skips = [];
  for (let skip = 0; skip < total; skip += PAGE_SIZE) skips.push(skip);

  const pages = new Array(skips.length);
  let cursor = 0;
  let done = 0;
  // Un log tous les ~25 %, pour que le déploiement ne noie pas la sortie.
  const logEvery = Math.max(1, Math.ceil(skips.length / 4));

  const worker = async () => {
    while (cursor < skips.length) {
      const index = cursor++;
      pages[index] = (
        await fetchJson(`${API}/${resource}?${query}&$limit=${PAGE_SIZE}&$skip=${skips[index]}`)
      ).data;
      done++;
      if (done % logEvery === 0 || done === skips.length) {
        const rows = Math.min(done * PAGE_SIZE, total);
        log(`${label} ${rows}/${total} (${Math.round((rows / total) * 100)}%)`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { rows: pages.flat(), total };
}

const ITEM_FIELDS = [
  'id', 'typeId', 'iconId', 'level', 'name',
  'description', 'slug', 'hasRecipe', 'effects', 'img',
];
// $sort[id]=1 rend la pagination stable : sans ordre explicite, un $skip profond
// peut sauter ou dupliquer des lignes entre deux pages.
const ITEMS_QUERY = `$sort[id]=1&${ITEM_FIELDS.map((f) => `$select[]=${f}`).join('&')}`;
// $populate=false fait passer une page de recettes de ~2 Mo à ~25 Ko : sans lui,
// DofusDB renvoie chaque ingrédient sous forme d'objet item complet. $select ne
// suffit pas, seul $populate=false coupe l'hydratation.
const RECIPES_QUERY = '$sort[id]=1&$populate=false';

// ------------------------------------------------------------------- mapping

const toItemRow = (item, types) => {
  const type = types.get(item.typeId);
  return {
    id: item.id,
    type_id: item.typeId ?? 0,
    super_type_id: type?.superTypeId ?? 0,
    icon_id: item.iconId ?? 0,
    level: item.level ?? 0,
    name_fr: item.name?.fr ?? '',
    type_name_fr: type?.nameFr ?? '',
    description_fr: item.description?.fr ?? '',
    slug_fr: item.slug?.fr ?? '',
    has_recipe: Boolean(item.hasRecipe),
    effects: item.effects ?? [],
    img: item.img ?? '',
  };
};

const toRecipeRow = (recipe, types, jobs) => {
  const type = types.get(recipe.resultTypeId);
  const job = jobs.get(recipe.jobId);
  return {
    id: recipe.id,
    result_id: recipe.resultId,
    result_type_id: recipe.resultTypeId ?? 0,
    result_super_type_id: type?.superTypeId ?? 0,
    result_level: recipe.resultLevel ?? 0,
    result_name_fr: recipe.resultName?.fr ?? '',
    ingredient_ids: recipe.ingredientIds ?? [],
    quantities: recipe.quantities ?? [],
    job_id: recipe.jobId ?? 0,
    job_name_fr: job?.nameFr ?? '',
    job_img: job?.img ?? '',
    skill_id: recipe.skillId ?? 0,
  };
};

// -------------------------------------------------------------------- écriture

const ITEM_COLUMNS =
  'id, type_id, super_type_id, icon_id, level, name_fr, type_name_fr, ' +
  'description_fr, slug_fr, has_recipe, effects, img';
const ITEM_RECORDSET =
  'id int, type_id int, super_type_id int, icon_id int, level int, name_fr text, ' +
  'type_name_fr text, description_fr text, slug_fr text, has_recipe boolean, ' +
  'effects jsonb, img text';

const RECIPE_COLUMNS =
  'id, result_id, result_type_id, result_super_type_id, result_level, ' +
  'result_name_fr, ingredient_ids, quantities, job_id, job_name_fr, job_img, skill_id';
const RECIPE_RECORDSET =
  'id int, result_id int, result_type_id int, result_super_type_id int, ' +
  'result_level int, result_name_fr text, ingredient_ids int[], quantities int[], ' +
  'job_id int, job_name_fr text, job_img text, skill_id int';

/**
 * Remplit une table de staging TEMP, puis upsert + purge les ids disparus.
 *
 * Écrire dans une table TEMP ne verrouille rien de public.*, et si le process
 * meurt en route la table temp disparaît : le miroir précédent reste intact. La
 * reprise, c'est relancer la commande — pas de checkpointing pour un job de 30 s.
 *
 * Impose la connexion *directe* (pas le pooler) : une table TEMP ne survit pas
 * au pooling en mode transaction. SUPABASE_DB_URL est déjà documenté comme directe.
 */
async function swapTable(client, table, columns, recordset, rows) {
  const stage = `stage_${table}`;
  await client.query(
    `create temp table ${stage} (like public.${table} including defaults) on commit drop`
  );

  for (let i = 0; i < rows.length; i += BATCH_ROWS) {
    await client.query(
      `insert into ${stage} (${columns})
       select ${columns} from jsonb_to_recordset($1::jsonb) as x(${recordset})`,
      [JSON.stringify(rows.slice(i, i + BATCH_ROWS))]
    );
  }

  const assignments = columns
    .split(', ')
    .filter((column) => column !== 'id')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');

  const upserted = await client.query(
    `insert into public.${table} (${columns}) select ${columns} from ${stage}
     on conflict (id) do update set ${assignments}, synced_at = now()`
  );
  const pruned = await client.query(
    `delete from public.${table} d where not exists (select 1 from ${stage} s where s.id = d.id)`
  );

  return { upserted: upserted.rowCount, pruned: pruned.rowCount };
}

const recordState = (client, resource, rowCount, upstreamTotal) =>
  client.query(
    `insert into public.dofus_sync_state
       (resource, last_success_at, last_attempt_at, row_count, upstream_total, last_error)
     values ($1, now(), now(), $2, $3, null)
     on conflict (resource) do update set
       last_success_at = now(), last_attempt_at = now(),
       row_count = excluded.row_count, upstream_total = excluded.upstream_total,
       last_error = null`,
    [resource, rowCount, upstreamTotal]
  );

// ------------------------------------------------------------------ fraîcheur

/** @returns {'cold' | 'stale' | 'fresh'} */
async function readFreshness(dbUrl) {
  const client = new pg.Client(clientConfig(dbUrl));
  await client.connect();
  try {
    const { rows } = await client.query(
      `select resource, last_success_at, row_count from public.dofus_sync_state`
    );
    const byResource = new Map(rows.map((row) => [row.resource, row]));

    for (const resource of ['items', 'recipes']) {
      const state = byResource.get(resource);
      if (!state || !state.last_success_at || state.row_count === 0) return 'cold';
      const ageHours = (Date.now() - new Date(state.last_success_at).getTime()) / 3_600_000;
      if (ageHours > maxAgeHours) return 'stale';
    }
    return 'fresh';
  } catch (err) {
    // 42P01 = relation inexistante : les migrations n'ont pas encore tourné.
    if (err.code === '42P01') return 'cold';
    throw err;
  } finally {
    await client.end();
  }
}

// ----------------------------------------------------------------------- main

async function main() {
  const startedAt = Date.now();

  const dbUrl = dryRun
    ? null
    : requireDbUrl('sync', 'Refusing to start with an empty DofusDB catalog.');

  if (ifStale && !dryRun) {
    freshness = await readFreshness(dbUrl);
    if (freshness === 'fresh') {
      log(`Catalog is fresh (< ${maxAgeHours}h) — skipping.`);
      return;
    }
    log(`Catalog is ${freshness} — running a full sync.`);
  }

  // Référentiels : 239 types et 23 métiers, dénormalisés sur les lignes plutôt
  // que stockés dans leurs propres tables (deux tables et deux jointures de moins).
  const { rows: rawTypes } = await fetchAll('item-types', '$sort[id]=1', 'item-types');
  const types = new Map(
    rawTypes.map((type) => [type.id, { superTypeId: type.superTypeId ?? 0, nameFr: type.name?.fr ?? '' }])
  );
  const weaponTypes = rawTypes.filter((type) => type.superTypeId === WEAPON_SUPER_TYPE_ID).length;
  log(`item-types: ${types.size} types (${weaponTypes} weapon types, superTypeId=${WEAPON_SUPER_TYPE_ID})`);

  const { rows: rawJobs } = await fetchAll('jobs', '$sort[id]=1', 'jobs');
  const jobs = new Map(
    rawJobs.map((job) => [job.id, { nameFr: job.name?.fr ?? '', img: job.img ?? '' }])
  );
  log(`jobs: ${jobs.size}`);

  const { rows: rawItems, total: itemsTotal } = await fetchAll('items', ITEMS_QUERY, 'items');
  const items = rawItems.map((item) => toItemRow(item, types));

  const { rows: rawRecipes, total: recipesTotal } = await fetchAll('recipes', RECIPES_QUERY, 'recipes');
  const allRecipes = rawRecipes.map((recipe) => toRecipeRow(recipe, types, jobs));

  // Deux invariants vérifiés sur 250 recettes échantillonnées ; ils tiennent
  // aujourd'hui et seraient des désastres silencieux s'ils cessaient de tenir.
  // Une recette désalignée violerait de toute façon la contrainte CHECK et ferait
  // échouer toute la transaction : mieux vaut l'écarter bruyamment.
  const recipes = allRecipes.filter(
    (recipe) => recipe.ingredient_ids.length === recipe.quantities.length
  );
  const misaligned = allRecipes.length - recipes.length;
  if (misaligned > 0) {
    warn(`${misaligned} recipe(s) have ingredientIds/quantities of different lengths — skipped.`);
  }
  const idMismatch = recipes.filter((recipe) => recipe.id !== recipe.result_id).length;
  if (idMismatch > 0) {
    warn(`${idMismatch} recipe(s) have id <> resultId — the mirror assumes they match.`);
  }

  const missingType = items.filter((item) => !item.type_name_fr).length;
  if (missingType > 0) warn(`${missingType} item(s) reference an unknown typeId.`);

  if (dryRun) {
    log(`DRY RUN — nothing written.`);
    log(`items:   ${items.length}/${itemsTotal}`);
    log(`recipes: ${recipes.length}/${recipesTotal}`);
    log(`sample item:   ${JSON.stringify(items[0])}`);
    log(`sample recipe: ${JSON.stringify(recipes[0])}`);
    log(`Done in ${seconds(Date.now() - startedAt)} (${retryCount} retries).`);
    return;
  }

  log(`Mirroring into ${describeTarget(dbUrl)}...`);
  const client = new pg.Client(clientConfig(dbUrl));
  await client.connect();

  try {
    // Les deux tables basculent dans la même transaction : on ne veut jamais un
    // miroir d'items d'un patch et un miroir de recettes d'un autre.
    await client.query('begin');
    const itemStats = await swapTable(client, 'dofus_items', ITEM_COLUMNS, ITEM_RECORDSET, items);
    const recipeStats = await swapTable(client, 'dofus_recipes', RECIPE_COLUMNS, RECIPE_RECORDSET, recipes);
    await recordState(client, 'items', items.length, itemsTotal);
    await recordState(client, 'recipes', recipes.length, recipesTotal);
    await client.query('commit');

    log(`items:   ${itemStats.upserted} upserted, ${itemStats.pruned} pruned`);
    log(`recipes: ${recipeStats.upserted} upserted, ${recipeStats.pruned} pruned`);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    // Best-effort : si la table d'état est elle-même inaccessible, l'erreur
    // d'origine reste la seule qui compte.
    await client
      .query(
        `insert into public.dofus_sync_state (resource, last_attempt_at, last_error)
         values ('items', now(), $1), ('recipes', now(), $1)
         on conflict (resource) do update set last_attempt_at = now(), last_error = excluded.last_error`,
        [String(err.message ?? err).slice(0, 500)]
      )
      .catch(() => {});
    throw err;
  } finally {
    await client.end();
  }

  log(`Done in ${seconds(Date.now() - startedAt)} (${retryCount} retries).`);
}

main().catch((err) => {
  console.error(`[sync] Sync failed: ${err.message ?? err}`);

  // Un catalogue *périmé* reste parfaitement utilisable : bloquer le démarrage
  // parce que DofusDB est momentanément indisponible serait pire que la panne.
  // Un catalogue *vide* fait répondre 503 à toutes les routes de l'app, et un
  // déploiement au vert dans cet état est le pire résultat possible — donc sur
  // Render c'est fatal (même raisonnement que le commit 1479192).
  if (ifStale && (freshness === 'stale' || !isRender())) {
    warn('Continuing boot with the existing catalog.');
    process.exit(0);
  }
  process.exit(1);
});
