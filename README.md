This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Database migrations

Schema changes live as timestamped SQL files in `supabase/migrations/`, applied via the
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
(already a project dependency — invoke it with `npx supabase` or the `npm run db:*` scripts
below).

One-time setup, per environment you deploy to:

```bash
npm run db:link -- --project-ref <your-project-ref>
```

To apply pending migrations to that linked project:

```bash
npm run db:push
```

To create a new migration:

```bash
npm run db:migration:new <name>
```

This creates an empty `supabase/migrations/<timestamp>_<name>.sql` file — write the schema
change there, then `npm run db:push` it. Never hand-edit a migration that has already been
pushed to a shared environment; add a new one instead.

### Migrations on startup (Render)

`npm start` runs the `prestart` hook first, which applies any pending migrations via
`scripts/run-migrations.mjs` and then refreshes the DofusDB catalog mirror via
`scripts/sync-dofusdb.mjs --if-stale`, before `next start` serves traffic. Render runs the
app as a single long-lived process, so this happens once per deploy.

#### Render service configuration

The build and start phases must stay separate. Render sets `NODE_ENV=production` at
**runtime only**, and npm treats that as `--omit=dev` — so an `npm install` in the *Start
Command* prunes the devDependencies the build installed, deleting the Supabase CLI (and
`typescript`, and `tailwindcss`) from `node_modules`.

| Setting | Value |
| --- | --- |
| Build Command | `npm install && npm run build` |
| Start Command | `npm run start` |

Do not put `npm install` or `npm run build` in the Start Command. Use `&&` rather than `;`
so a failed step actually stops the deploy instead of continuing to the next one.

#### Environment

| Variable | Value |
| --- | --- |
| `SUPABASE_DB_URL` | Direct Postgres connection string from **Project Settings → Database → Connection string → URI** |

Notes:

- Use the **direct** connection (`db.<ref>.supabase.co:5432`), not the transaction-mode
  pooler — migrations run DDL in a transaction and the pooler will not handle it correctly.
- The password must be **percent-encoded** in the URI (the CLI requires this), so a `@` in
  the password becomes `%40`.
- This is a privileged credential and is deliberately separate from the app's own
  `NEXT_PUBLIC_SUPABASE_*` vars — those are an anon key and cannot run DDL. Keep it out of
  any `NEXT_PUBLIC_` variable, which would ship it to the browser.

Behaviour:

- **Unset `SUPABASE_DB_URL` on Render** (detected via Render's `RENDER=true`) — startup is
  aborted. A deployed service that skipped its migrations would otherwise look green while
  serving a stale schema, which is the worst possible outcome.
- **Unset `SUPABASE_DB_URL` locally** — migrations are skipped with a warning and the app
  boots, so a plain local `npm start` still works.
- **Migration fails** — startup is aborted with a non-zero exit, so the deploy fails rather
  than serving requests against an unexpected schema.

The script prints exactly one `[migrate] ...` line per boot, so the startup logs always say
which of these happened. No `[migrate]` line at all means the `prestart` hook never ran —
check that the Start Command goes through npm.

Migrations run *before* the catalog sync, so a migration that adds a column is always in
place before the sync tries to fill it.

To dry-run the same step locally without starting the server:

```bash
SUPABASE_DB_URL=<uri> npm run db:migrate
```

### DofusDB catalog mirror

Item and recipe data comes from the public `api.dofusdb.fr`. Rather than proxying every page
load, the catalog is mirrored into our own Postgres — it only changes when the game patches,
and it is small (21 738 items, 4 858 recipes, ~30 MB with indexes).

```bash
npm run db:sync       # full sync (needs SUPABASE_DB_URL)
npm run db:sync:dry   # fetch + map everything, touch no database
```

A cold sync takes about 10 seconds. `scripts/sync-dofusdb.mjs` pages the API 5 requests at a
time with retry and backoff, then swaps both tables in **one transaction** via a temporary
staging table: if it dies partway, the previous mirror is untouched and the fix is to re-run
it. This requires the *direct* connection, not the pooler — a `TEMP` table does not survive
transaction-mode pooling.

It writes through `SUPABASE_DB_URL` rather than a service-role key. That variable already
exists for migrations and already carries more privilege than a service-role key would, so
adding one would be a second secret to rotate for no extra capability.

#### On startup

`prestart` runs `sync-dofusdb.mjs --if-stale` after the migrations. That mode reads
`dofus_sync_state` first and classifies the mirror:

| State | Meaning | On success | If the sync fails |
| --- | --- | --- | --- |
| **fresh** | synced less than `DOFUSDB_SYNC_MAX_AGE_HOURS` ago (default 168 h / 7 days) | skips in ~50 ms, one log line | — |
| **stale** | older than that | full sync, ~10 s | **boots anyway** with a warning |
| **cold** | table empty, or migrations have not run yet | full sync, ~10 s | **aborts startup on Render** |

The asymmetry is the point. A *stale* catalog is still perfectly usable, so blocking a deploy
because DofusDB is briefly unreachable would be worse than the outage itself. A *cold*
catalog makes every catalog-backed route fail, and a deploy that goes green in that state is
the worst possible outcome — the same reasoning as the migration step above.

So the steady-state cost is one indexed query on a two-row table per boot, and a real sync
runs at most once a week. It delays the new instance binding its port by ~10 s when it does
run; Render holds the old instance until then, so this delays cutover rather than causing
downtime.

| Variable | Default | Effect |
| --- | --- | --- |
| `DOFUSDB_SYNC_MAX_AGE_HOURS` | `168` | How old the mirror may get before a boot re-syncs it |
| `DOFUSDB_SYNC_ON_BOOT` | unset | Set to `0` to skip the boot sync entirely — an escape hatch if a DofusDB outage ever wedges a deploy. Does not affect an explicit `npm run db:sync`. |

**Weapons and cosmetics are out of scope, but nothing is filtered at ingest.** Weapons appear
as *ingredients* of in-scope recipes — «&nbsp;Quintaine&nbsp;» (`resultId 19644`, an *objet de
quête*) needs «&nbsp;Fléau d'armes&nbsp;» (`typeId 7`) — and the UI maps `recipe.ingredients`
into `recipe.quantities` **by array index**, so dropping one silently shifts every later
quantity and corrupts the craft cost. Instead each row carries `super_type_id`, and exclusion
is an opt-in filter at query time. (There is no cosmetic item type in this dataset at all.)

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
