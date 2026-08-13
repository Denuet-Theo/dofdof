// Extrait les données utilisateur de Supabase, en vue d'une reprise sur une autre
// base (voir README, « Sortir de Supabase »).
//
// Usage :
//   npm run db:export              écrit ./data-export/
//   npm run db:export:dry          compte les lignes, n'écrit aucun fichier
//   node scripts/export-user-data.mjs --out /chemin/ailleurs
//
// Lit via SUPABASE_DB_URL (connexion Postgres directe), comme les migrations et
// la synchro du catalogue : une clé anon est soumise aux RLS et ne verrait que
// les lignes de l'utilisateur connecté — donc rien, hors requête HTTP authentifiée.
//
// ## Ce qui est extrait, et ce qui ne l'est pas
//
// Les 18 tables se coupent en deux, et une seule moitié constitue une donnée à
// sauver :
//
//   - le miroir du catalogue (`dofus_*`) est **régénérable**. C'est le gros du
//     volume — ~21 700 items, ~4 900 recettes, ~5 100 monstres et leurs drops —
//     et `scripts/sync-dofusdb.mjs` le reconstruit depuis DofusDB en ~10 s.
//     L'extraire serait recopier un cache : on le resynchronise sur la nouvelle
//     base, et on obtient au passage un catalogue à jour plutôt que figé.
//
//   - tout le reste est saisi par l'utilisateur et **irremplaçable** : ventes,
//     stocks, prix relevés à l'HDV, projets d'élevage, montures, généalogies.
//     C'est ce que ce script sort.
//
// ## Pourquoi les colonnes ne sont pas codées en dur
//
// Le schéma a bougé 32 fois, dont une dizaine d'`alter table ... add column`.
// Une liste de colonnes figée ici prendrait silencieusement du retard au premier
// ajout suivant : l'export passerait au vert en laissant une colonne derrière
// lui. Les colonnes sont donc relues dans `information_schema` à chaque
// exécution, dans l'ordre du schéma.

import pg from 'pg';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { clientConfig, describeTarget, requireDbUrl } from './lib/db-url.mjs';

// `auth.users` appartient à Supabase et porte une quarantaine de colonnes dont
// la plupart ne décrivent que sa propre mécanique (jetons de récupération,
// métadonnées SSO, changements d'e-mail en cours). On ne reprend que l'identité
// et de quoi se reconnecter.
//
// `encrypted_password` est un hachage bcrypt : le reprendre tel quel évite de
// réinitialiser les mots de passe, n'importe quelle vérification bcrypt le relit.
// C'est aussi ce qui rend le fichier produit sensible — cf. l'avertissement en
// fin d'exécution.
const AUTH_USER_COLUMNS = [
  'id',
  'email',
  'encrypted_password',
  'created_at',
  'email_confirmed_at',
  'last_sign_in_at',
];

// Les tables à extraire, dans un ordre où toute clé étrangère pointe vers une
// table déjà écrite. L'importeur peut donc rejouer les fichiers dans cet ordre.
//
// Une exception, signalée dans le manifeste : `user_breeding_individuals` se
// référence elle-même (`parent_a_id`, `parent_b_id` — la généalogie), et aucun
// ordre de lignes ne satisfait ce cycle. L'import doit différer le contrôle des
// clés étrangères le temps de la reprise.
//
// Une table absente de la base n'est pas une erreur : `breeding_project_stock`
// par exemple a existé un temps avant d'être remplacée par
// `user_breeding_mounts`. C'est l'inverse qui est fatal — une table présente en
// base et absente des deux listes, cf. assertEveryTableClassified.
const USER_TABLES = [
  // Les comptes d'abord : presque tout le reste porte un `user_id` qui pointe ici.
  { schema: 'auth', table: 'users', columns: AUTH_USER_COLUMNS },
  { schema: 'public', table: 'item_prices' },
  { schema: 'public', table: 'breeding_color_prices' },
  { schema: 'public', table: 'user_sales' },
  { schema: 'public', table: 'user_item_stock' },
  { schema: 'public', table: 'user_farm_filters' },
  { schema: 'public', table: 'user_breeding_settings' },
  { schema: 'public', table: 'user_breeding_mounts' },
  { schema: 'public', table: 'user_breeding_individuals' },
  { schema: 'public', table: 'user_breeding_availability' },
  { schema: 'public', table: 'breeding_projects' },
  { schema: 'public', table: 'breeding_timeline' },
];

// Régénérable depuis DofusDB : délibérément non extrait. Cette liste n'est pas
// documentaire, elle est vérifiée — voir assertEveryTableClassified.
const CATALOG_TABLES = [
  'dofus_areas',
  'dofus_drops',
  'dofus_items',
  'dofus_monsters',
  'dofus_recipes',
  'dofus_subareas',
  // L'état de fraîcheur du miroir. Reprendre ses horodatages sur une base dont
  // le catalogue n'est pas encore synchronisé le déclarerait frais à tort.
  'dofus_sync_state',
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

const outArgIndex = process.argv.indexOf('--out');
const outDir = path.resolve(
  outArgIndex !== -1 && process.argv[outArgIndex + 1]
    ? process.argv[outArgIndex + 1]
    : 'data-export'
);

const log = (msg) => console.log(`[export] ${msg}`);
const warn = (msg) => console.warn(`[export] ${msg}`);

/**
 * Vérifie que chaque table de `public` est classée, soit à extraire soit
 * régénérable.
 *
 * Une table apparue depuis la dernière relecture de ce script tomberait sinon
 * dans aucune des deux listes et serait ignorée sans bruit — un export au vert
 * auquel il manque une table est pire qu'un export qui échoue, parce qu'on ne
 * découvre le trou qu'après avoir coupé l'ancienne base.
 */
async function assertEveryTableClassified(client) {
  const { rows } = await client.query(`
    select table_name
      from information_schema.tables
     where table_schema = 'public'
       and table_type = 'BASE TABLE'
     order by table_name
  `);

  const known = new Set([
    ...USER_TABLES.filter((t) => t.schema === 'public').map((t) => t.table),
    ...CATALOG_TABLES,
  ]);
  const unknown = rows.map((r) => r.table_name).filter((name) => !known.has(name));

  if (unknown.length > 0) {
    console.error(
      `[export] Ces tables ne sont classées ni « à extraire » ni « régénérable » : ` +
        `${unknown.join(', ')}.\n` +
        '[export] Ajoutez-les à USER_TABLES (données saisies, à sauver) ou à ' +
        'CATALOG_TABLES (miroir DofusDB, resynchronisable) dans ce script, puis ' +
        'relancez. Refus d\'exporter une base dont une table serait laissée derrière.'
    );
    process.exit(1);
  }

  const missing = [...known].filter(
    (name) => !rows.some((r) => r.table_name === name)
  );
  if (missing.length > 0) {
    // Non fatal : une table absente est le cas normal d'une base sur laquelle
    // les dernières migrations n'ont pas encore tourné.
    warn(`Tables attendues mais absentes de la base : ${missing.join(', ')}.`);
  }

  return new Set(rows.map((r) => r.table_name));
}

/**
 * Colonnes d'une table, dans l'ordre du schéma, hors colonnes générées.
 *
 * Une colonne `generated always as ... stored` est calculée par Postgres à
 * l'écriture : l'exporter produirait une valeur que l'import devrait ensuite
 * refuser d'insérer.
 */
async function columnsOf(client, schema, table) {
  const { rows } = await client.query(
    `select column_name, data_type, udt_name
       from information_schema.columns
      where table_schema = $1
        and table_name = $2
        and is_generated = 'NEVER'
      order by ordinal_position`,
    [schema, table]
  );
  return rows;
}

const quoteIdent = (name) => `"${name.replace(/"/g, '""')}"`;

/**
 * Extrait une table en NDJSON — une ligne JSON par enregistrement.
 *
 * NDJSON plutôt qu'un tableau JSON : le fichier se relit ligne à ligne, donc un
 * import n'a pas à charger la table entière en mémoire, et un `wc -l` suffit à
 * recompter ce qui est sorti.
 *
 * Le curseur descend la table par tranches plutôt qu'en un seul `select`. Ces
 * tables sont petites aujourd'hui — c'est le catalogue qui est volumineux, et il
 * n'est pas extrait — mais `item_prices` grandit d'une ligne par item dont on
 * relève le prix, et rien ne le borne.
 */
async function exportTable(client, { schema, table, columns }, destination) {
  const cols = columns.map((c) => quoteIdent(c.column_name ?? c)).join(', ');
  const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;

  const { rows: countRows } = await client.query(`select count(*)::int as n from ${qualified}`);
  const total = countRows[0].n;

  if (dryRun) return { rows: total, written: 0 };

  // Un curseur côté serveur : `declare` puis `fetch` par tranches, dans une
  // transaction en lecture seule pour que l'export voie un instantané cohérent
  // même si l'app écrit pendant ce temps.
  const CHUNK = 2_000;
  const cursor = `export_${table}`;
  await client.query('begin read only');
  await client.query(`declare ${quoteIdent(cursor)} cursor for select ${cols} from ${qualified}`);

  const stream = createWriteStream(destination, { encoding: 'utf8' });
  let written = 0;
  try {
    for (;;) {
      const { rows } = await client.query(`fetch ${CHUNK} from ${quoteIdent(cursor)}`);
      if (rows.length === 0) break;
      const chunk = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
      if (!stream.write(chunk)) {
        await new Promise((resolve) => stream.once('drain', resolve));
      }
      written += rows.length;
    }
    stream.end();
    await new Promise((resolve, reject) => {
      stream.once('finish', resolve);
      stream.once('error', reject);
    });
  } finally {
    await client.query(`close ${quoteIdent(cursor)}`).catch(() => {});
    await client.query('commit').catch(() => {});
  }

  return { rows: total, written };
}

async function main() {
  const dbUrl = requireDbUrl('export', 'Nothing to export without a database.');

  log(`Lecture de ${describeTarget(dbUrl)}${dryRun ? ' (à blanc)' : ''}...`);

  const client = new pg.Client(clientConfig(dbUrl));
  await client.connect();

  const manifest = {
    // Horodatage de l'extraction, pour savoir ce que la reprise a raté si l'app
    // a continué de tourner après coup.
    exported_at: new Date().toISOString(),
    source: describeTarget(dbUrl),
    // L'ordre des fichiers est un ordre d'import : les clés étrangères d'une
    // table pointent toujours vers une table qui la précède.
    import_order: [],
    // `user_breeding_individuals` se référence elle-même via parent_a_id /
    // parent_b_id, cycle qu'aucun ordre de lignes ne résout.
    defer_foreign_keys: ['user_breeding_individuals'],
    // Comment relire les valeurs. node-postgres ne rend pas tous les types en
    // JSON natif, et l'importeur ne doit pas avoir à le deviner.
    wire_format: {
      bigint: 'chaîne décimale — les kamas dépassent Number.MAX_SAFE_INTEGER',
      numeric: 'chaîne décimale — ne jamais relire en flottant',
      timestamptz: 'chaîne ISO 8601 en UTC',
      uuid: 'chaîne',
      jsonb: 'valeur JSON native',
      'integer[]': 'tableau JSON',
    },
    tables: {},
    not_exported: {
      reason:
        'Miroir du catalogue DofusDB : régénérable par `npm run db:sync` sur la ' +
        'base cible, qui produit au passage un catalogue à jour plutôt que figé.',
      tables: CATALOG_TABLES,
    },
  };

  try {
    const present = await assertEveryTableClassified(client);

    if (!dryRun) await mkdir(outDir, { recursive: true });

    for (const spec of USER_TABLES) {
      if (spec.schema === 'public' && !present.has(spec.table)) continue;

      const discovered = await columnsOf(client, spec.schema, spec.table);
      if (discovered.length === 0) {
        warn(`${spec.schema}.${spec.table} est introuvable — ignorée.`);
        continue;
      }

      // `auth.users` est la seule table dont on choisit les colonnes ; partout
      // ailleurs on prend ce que le schéma porte, pour ne rien laisser derrière.
      const columns = spec.columns
        ? discovered.filter((c) => spec.columns.includes(c.column_name))
        : discovered;

      if (spec.columns) {
        const absent = spec.columns.filter(
          (name) => !discovered.some((c) => c.column_name === name)
        );
        if (absent.length > 0) {
          warn(`${spec.schema}.${spec.table} : colonnes demandées absentes — ${absent.join(', ')}.`);
        }
      }

      const name = `${spec.schema}.${spec.table}`;
      const file = `${spec.schema}.${spec.table}.ndjson`;
      const { rows, written } = await exportTable(
        client,
        { ...spec, columns },
        path.join(outDir, file)
      );

      // Un compte pris avant l'extraction et un compte de lignes écrites : la
      // transaction en lecture seule garantit qu'ils concordent, donc un écart
      // signale une extraction tronquée et non une écriture concurrente.
      if (!dryRun && written !== rows) {
        throw new Error(
          `${name} : ${rows} lignes annoncées, ${written} écrites. Export incomplet.`
        );
      }

      manifest.import_order.push(file);
      manifest.tables[name] = {
        file,
        rows,
        columns: columns.map((c) => ({
          name: c.column_name,
          type: c.data_type === 'ARRAY' ? `${c.udt_name.replace(/^_/, '')}[]` : c.data_type,
        })),
      };

      log(`${name} — ${rows} ligne${rows === 1 ? '' : 's'}${dryRun ? '' : ` → ${file}`}`);
    }

    if (!dryRun) {
      await writeFile(
        path.join(outDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n',
        'utf8'
      );
    }
  } finally {
    await client.end();
  }

  const totalRows = Object.values(manifest.tables).reduce((sum, t) => sum + t.rows, 0);

  if (dryRun) {
    log(`À blanc : ${totalRows} lignes sur ${Object.keys(manifest.tables).length} tables, rien écrit.`);
    return;
  }

  log(`${totalRows} lignes sur ${Object.keys(manifest.tables).length} tables → ${outDir}`);
  log(`Catalogue non extrait (régénérable) : ${CATALOG_TABLES.join(', ')}.`);
  warn(
    'auth.users.ndjson contient les hachages bcrypt des mots de passe. Le dossier ' +
      'est ignoré par git (.gitignore) — ne le commitez pas, ne le passez pas par ' +
      'un canal non chiffré, et supprimez-le une fois la reprise vérifiée.'
  );
}

const executedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  main().catch((error) => {
    console.error(`[export] Échec : ${error.message}`);
    process.exit(1);
  });
}

export { USER_TABLES, CATALOG_TABLES };
