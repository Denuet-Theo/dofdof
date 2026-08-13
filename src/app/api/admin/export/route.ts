import { createClient } from '@/lib/supabase/server';
// `pg` est un export par défaut (une valeur), pas un namespace : le type du
// client s'importe séparément, il ne s'écrit pas `pg.Client` en position de type.
import pg, { type Client as PgClient } from 'pg';

// Déverse la base entière en NDJSON, pour récupérer les données sans avoir la
// chaîne de connexion sous la main — le service déployé la porte déjà dans son
// environnement (`SUPABASE_DB_URL`, exigée par les migrations au démarrage).
//
// **Usage** : connecté à l'app, ouvrir `/api/admin/export` dans le navigateur. La
// réponse est un attachement, le fichier se télécharge. Rien d'autre à faire —
// la session est déjà dans les cookies.
//
// ## Ceci est une porte de sortie de données, et elle se referme
//
// La réponse contient tout : ventes, stocks, prix, élevage, et les hachages
// bcrypt des mots de passe. Trois verrous :
//
//   1. Une session valide. `src/proxy.ts` refuse déjà tout `/api` sans session ;
//      cette route le revérifie plutôt que de s'y fier, parce qu'une porte de
//      sortie de données ne doit pas dépendre d'un `matcher` qu'un futur
//      remaniement du proxy pourrait resserrer sans qu'on y pense.
//   2. Une adresse inscrite dans ALLOWED_EMAILS ci-dessous. Une session ordinaire
//      ne suffit pas : sans cela, n'importe quel compte de l'app emporterait les
//      données de tous les autres, hachages compris.
//   3. Aucune mise en cache, à aucun niveau (cf. `dynamic` et `Cache-Control`).
//
// **À supprimer une fois la reprise vérifiée.** Ce n'est pas une fonctionnalité,
// c'est un fourgon de déménagement.
//
// ## Pourquoi une liste en clair et non une variable d'environnement
//
// Le tableau de bord de l'hébergeur n'est pas accessible : poser une variable est
// impossible, seul un déploiement depuis le dépôt l'est. Une adresse e-mail n'est
// pas un secret, donc l'inscrire ici ne divulgue rien — contrairement à un jeton,
// qui resterait dans l'historique git après le retrait de la route.
//
// Vide, la route répond 503 — c'est l'état dans lequel ce fichier doit revenir si
// jamais il survit à la reprise.
const ALLOWED_EMAILS: string[] = ['aedius.filmania@gmail.com'];

// `pg` est un module Node : pas de runtime edge.
export const runtime = 'nodejs';
// Une réponse mise en cache serait un dump de la base servi à qui repasse.
// `force-dynamic` interdit tout pré-rendu et toute réutilisation.
export const dynamic = 'force-dynamic';

// Le miroir du catalogue DofusDB, régénérable par `npm run db:sync` et de loin le
// plus volumineux (~21 700 items, ~4 900 recettes, ~5 100 monstres et leurs
// drops). Exclu par défaut : le recopier allongerait l'export de plusieurs
// dizaines de mégaoctets pour livrer un catalogue figé, là qu'une resynchronisation
// en donne un à jour. `?catalog=1` le réintègre.
const CATALOG_PREFIX = 'dofus_';

/**
 * Les tables sont découvertes dans le catalogue système, pas listées ici.
 *
 * Le schéma a bougé 32 fois. Une liste figée dans le code prendrait du retard au
 * premier `create table` suivant, et un export de sauvetage auquel il manque une
 * table ne se découvre qu'après la fermeture de la base. Découvrir, c'est
 * exporter par défaut ce qu'on ne connaissait pas — le bon sens de la
 * défaillance ici.
 */
async function discoverTables(client: PgClient, includeCatalog: boolean) {
  const { rows } = await client.query<{ table_name: string }>(`
    select table_name
      from information_schema.tables
     where table_schema = 'public'
       and table_type = 'BASE TABLE'
     order by table_name
  `);

  return rows
    .map((r) => r.table_name)
    .filter((name) => includeCatalog || !name.startsWith(CATALOG_PREFIX));
}

/**
 * Ordonne les tables pour que toute clé étrangère pointe vers une table déjà
 * écrite, afin que l'import puisse rejouer le flux tel quel.
 *
 * Les arêtes viennent de `pg_constraint`, donc l'ordre reste juste quand le
 * schéma change. Les tables prises dans un cycle sont renvoyées à part :
 * `user_breeding_individuals` se référence elle-même via `parent_a_id` /
 * `parent_b_id` (la généalogie), et aucun ordre de lignes ne résout ça — l'import
 * doit différer le contrôle des clés étrangères.
 */
async function importOrder(client: PgClient, tables: string[]) {
  const known = new Set(tables);
  const { rows: edges } = await client.query<{ child: string; parent: string }>(`
    select distinct child.relname as child, parent.relname as parent
      from pg_constraint c
      join pg_class child on child.oid = c.conrelid
      join pg_class parent on parent.oid = c.confrelid
      join pg_namespace ns on ns.oid = child.relnamespace
     where c.contype = 'f'
       and ns.nspname = 'public'
  `);

  // Nombre de parents restant à écrire avant chaque table, et l'index inverse.
  const pending = new Map(tables.map((t) => [t, 0]));
  const children = new Map<string, string[]>();

  for (const { child, parent } of edges) {
    // Une auto-référence n'est pas une contrainte d'ordre entre tables : elle ne
    // se résout pas par un ordre, seulement par des clés étrangères différées.
    if (child === parent) continue;
    if (!known.has(child) || !known.has(parent)) continue;
    pending.set(child, (pending.get(child) ?? 0) + 1);
    children.set(parent, [...(children.get(parent) ?? []), child]);
  }

  const ordered: string[] = [];
  const ready = tables.filter((t) => pending.get(t) === 0);
  while (ready.length > 0) {
    const table = ready.shift()!;
    ordered.push(table);
    for (const child of children.get(table) ?? []) {
      const left = (pending.get(child) ?? 0) - 1;
      pending.set(child, left);
      if (left === 0) ready.push(child);
    }
  }

  // Ce qui reste appartient à un cycle entre tables distinctes. On l'exporte tout
  // de même, en fin de flux, plutôt que de le laisser sur place.
  const cyclic = tables.filter((t) => !ordered.includes(t));

  // Les tables qui se référencent elles-mêmes, à signaler à l'import.
  const selfReferencing = [
    ...new Set(edges.filter((e) => e.child === e.parent).map((e) => e.child)),
  ].filter((t) => known.has(t));

  return { ordered: [...ordered, ...cyclic], cyclic, selfReferencing };
}

/**
 * Colonnes d'une table, hors colonnes générées.
 *
 * `dofus_drops.percent_max` est un `generated always as ... stored` : Postgres le
 * calcule à l'écriture, donc l'exporter produirait une valeur qu'un import devrait
 * refuser d'insérer.
 */
async function columnsOf(client: PgClient, schema: string, table: string) {
  const { rows } = await client.query<{
    column_name: string;
    data_type: string;
    udt_name: string;
  }>(
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

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

const refuse = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
  if (ALLOWED_EMAILS.length === 0) {
    return refuse(
      503,
      'Export disabled: ALLOWED_EMAILS is empty in src/app/api/admin/export/route.ts. ' +
        'Add the address of the account allowed to download the data, deploy, then ' +
        'remove this route once the data has been recovered.'
    );
  }

  // Revérifié ici plutôt que délégué au proxy : cf. l'en-tête de ce fichier.
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return refuse(401, 'Unauthorized');

  const email = user.email?.toLowerCase() ?? '';
  if (!ALLOWED_EMAILS.some((allowed) => allowed.toLowerCase() === email)) {
    // Volontairement muet sur la raison : inutile d'apprendre à un compte
    // ordinaire qu'il existe une liste, ni qui s'y trouve.
    return refuse(403, 'Forbidden');
  }

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    return refuse(
      500,
      'SUPABASE_DB_URL is not set on this service. It is the direct Postgres ' +
        'connection string; the anon key cannot read auth.users or bypass RLS.'
    );
  }

  const url = new URL(request.url);
  const includeCatalog = url.searchParams.get('catalog') === '1';
  // Les hachages bcrypt partent par défaut : sans eux il faudra faire
  // réinitialiser les mots de passe, et un export de sauvetage incomplet ne se
  // rejoue pas une fois la base fermée. `?passwords=0` pour s'en passer.
  const includePasswords = url.searchParams.get('passwords') !== '0';

  // Réduite à l'identité : `auth.users` porte une quarantaine de colonnes dont la
  // plupart ne décrivent que la mécanique interne de Supabase Auth (jetons de
  // récupération, métadonnées SSO, changements d'e-mail en cours), sans objet
  // hors de Supabase.
  const authUserColumns = [
    'id',
    'email',
    ...(includePasswords ? ['encrypted_password'] : []),
    'created_at',
    'email_confirmed_at',
    'last_sign_in_at',
  ];

  const client = new pg.Client({
    connectionString: dbUrl,
    // Supabase n'accepte que TLS et node-postgres ne l'active pas seul ; le
    // certificat est signé par une AC absente du magasin de Node, d'où
    // `rejectUnauthorized: false` — transport chiffré, chaîne non validée. Même
    // raisonnement que scripts/lib/db-url.mjs.
    ...(/[?&]sslmode=/i.test(dbUrl) ? {} : { ssl: { rejectUnauthorized: false } }),
  });

  try {
    await client.connect();
  } catch (error) {
    return refuse(502, `Could not reach the database: ${(error as Error).message}`);
  }

  const encoder = new TextEncoder();
  let closed = false;

  const release = async () => {
    if (closed) return;
    closed = true;
    await client.end().catch(() => {});
  };

  const stream = new ReadableStream({
    async start(controller) {
      const line = (value: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(value) + '\n'));

      try {
        const tables = await discoverTables(client, includeCatalog);
        const { ordered, cyclic, selfReferencing } = await importOrder(client, tables);

        // Un instantané cohérent : l'app peut continuer d'écrire pendant que
        // l'export descend les tables une à une.
        await client.query('begin isolation level repeatable read read only');

        const columns: Record<string, { name: string; type: string }[]> = {};
        for (const table of ordered) {
          columns[`public.${table}`] = (await columnsOf(client, 'public', table)).map((c) => ({
            name: c.column_name,
            type: c.data_type === 'ARRAY' ? `${c.udt_name.replace(/^_/, '')}[]` : c.data_type,
          }));
        }
        const authColumns = (await columnsOf(client, 'auth', 'users'))
          .filter((c) => authUserColumns.includes(c.column_name))
          .map((c) => ({ name: c.column_name, type: c.data_type }));

        // Première ligne : le manifeste. Ce qui suit se relit sans le deviner.
        line({
          kind: 'manifest',
          exported_at: new Date().toISOString(),
          // Les comptes d'abord : presque tout porte un `user_id` qui pointe ici.
          import_order: ['auth.users', ...ordered.map((t) => `public.${t}`)],
          defer_foreign_keys: [
            ...selfReferencing.map((t) => `public.${t}`),
            ...cyclic.map((t) => `public.${t}`),
          ],
          catalog_included: includeCatalog,
          passwords_included: includePasswords,
          wire_format: {
            bigint: 'chaîne décimale — les kamas dépassent Number.MAX_SAFE_INTEGER',
            numeric: 'chaîne décimale — ne jamais relire en flottant',
            timestamptz: 'chaîne ISO 8601 en UTC',
            uuid: 'chaîne',
            jsonb: 'valeur JSON native',
            'integer[]': 'tableau JSON',
          },
          columns: { 'auth.users': authColumns, ...columns },
        });

        const dump = async (schema: string, table: string, cols: string[]) => {
          // Une table sans colonne lisible produirait un `select from` invalide.
          // Le cas se présente si `auth.users` est absente — une base Postgres qui
          // n'est pas (ou plus) un projet Supabase.
          if (cols.length === 0) {
            line({
              kind: 'table_end',
              table: `${schema}.${table}`,
              rows: 0,
              skipped: 'no readable column',
            });
            return;
          }

          const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;
          const selection = cols.map(quoteIdent).join(', ');
          const cursor = quoteIdent(`export_${schema}_${table}`);

          await client.query(`declare ${cursor} cursor for select ${selection} from ${qualified}`);
          let rows = 0;
          try {
            for (;;) {
              // Par tranches : le flux ne doit jamais charger une table entière en
              // mémoire, et l'instance qui sert cette route est petite.
              const chunk = await client.query(`fetch 1000 from ${cursor}`);
              if (chunk.rows.length === 0) break;
              for (const row of chunk.rows) line({ t: `${schema}.${table}`, r: row });
              rows += chunk.rows.length;
            }
          } finally {
            await client.query(`close ${cursor}`).catch(() => {});
          }
          // Une borne par table : elle permet de vérifier un fichier tronqué,
          // qu'une coupure réseau au milieu d'un dump rendrait sinon plausible.
          line({ kind: 'table_end', table: `${schema}.${table}`, rows });
        };

        await dump(
          'auth',
          'users',
          authColumns.map((c) => c.name)
        );
        for (const table of ordered) {
          await dump(
            'public',
            table,
            columns[`public.${table}`].map((c) => c.name)
          );
        }

        await client.query('commit').catch(() => {});

        // Dernière ligne. Son absence signale un export incomplet, y compris
        // quand le transfert s'est interrompu après un code HTTP 200.
        line({ kind: 'end', exported_at: new Date().toISOString() });
        controller.close();
      } catch (error) {
        // Le statut est déjà parti : on ne peut plus signaler l'échec par un code
        // HTTP, seulement par une ligne que le lecteur trouvera à la place du
        // `{"kind":"end"}` attendu.
        try {
          line({ kind: 'error', error: (error as Error).message });
        } catch {
          // Flux déjà fermé côté client.
        }
        controller.error(error);
      } finally {
        await release();
      }
    },
    // Transfert interrompu (onglet fermé, réseau perdu) : la connexion Postgres ne
    // doit pas rester ouverte avec un curseur dans une transaction.
    async cancel() {
      await release();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': 'attachment; filename="dofdof-export.ndjson"',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      // Sans cela un proxy intermédiaire peut mettre le flux en tampon, et un
      // export long ressemble alors à une requête qui ne répond pas.
      'X-Accel-Buffering': 'no',
    },
  });
}
