// Applies pending Supabase migrations before the server boots (see `prestart`).
//
// Invoked by `npm start`, so on Render the container applies `supabase/migrations/`
// to the remote database once per deploy, before `next start` serves any traffic.
//
// Requires SUPABASE_DB_URL — a *direct* Postgres connection string with DDL rights.
// The NEXT_PUBLIC_SUPABASE_* vars the app itself uses are an anon key and cannot
// run DDL, so they deliberately play no part here.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dbUrl = process.env.SUPABASE_DB_URL;

// No connection string is a normal state — a plain local `npm start`, or a preview
// environment pointed at an already-migrated database. Boot the app rather than
// blocking it; a *failed* push below is what deserves a hard stop.
if (!dbUrl) {
  console.warn('[migrate] SUPABASE_DB_URL is not set — skipping migrations.');
  process.exit(0);
}

// The connection string carries the database password, so never log it back out.
function describeTarget(url) {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname}`;
  } catch {
    return 'the configured database';
  }
}

console.log(`[migrate] Applying pending migrations to ${describeTarget(dbUrl)}...`);

// Resolve the CLI's Node wrapper directly instead of relying on `supabase` being on
// PATH: that keeps the call shell-free, so the connection string is passed as a
// single argv entry and never goes through cmd.exe/sh quoting.
let cliPath;
try {
  cliPath = require.resolve('supabase/dist/supabase.js');
} catch {
  console.error(
    '[migrate] The Supabase CLI is not installed. It is a devDependency, so make ' +
      'sure the deploy installs devDependencies (e.g. `npm ci --include=dev`).'
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [cliPath, 'db', 'push', '--db-url', dbUrl, '--workdir', projectRoot, '--yes'],
  { stdio: 'inherit' }
);

if (result.error) {
  console.error(`[migrate] Could not run the Supabase CLI: ${result.error.message}`);
  process.exit(1);
}

// Serving requests against a schema the code doesn't expect is worse than not
// booting, so a failed push aborts `npm start` and fails the deploy.
if (result.status !== 0) {
  console.error(`[migrate] Migration failed (exit code ${result.status}). Aborting startup.`);
  process.exit(result.status ?? 1);
}

console.log('[migrate] Migrations up to date.');
