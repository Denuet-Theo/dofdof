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

// Render sets RENDER=true on every service. Locally, a missing connection string is
// a normal state (plain `npm start`) and shouldn't block boot — but on a deployed
// service it is a misconfiguration, and skipping silently would leave the app
// serving a stale schema while the deploy still looks green. That silent-success
// case is the worst outcome, so on Render it's a hard failure.
const onRender = process.env.RENDER === 'true';

if (!dbUrl) {
  if (onRender) {
    console.error(
      '[migrate] SUPABASE_DB_URL is not set, but this is a Render deploy. Refusing ' +
        'to start with an unmigrated schema. Set it in the Render dashboard ' +
        '(Environment), using the direct connection string, not the pooler.'
    );
    process.exit(1);
  }
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
    '[migrate] The Supabase CLI is not installed. It is a devDependency, and npm ' +
      'omits (and prunes) those whenever NODE_ENV=production. Render sets that at ' +
      'runtime, so an `npm install` in the Start Command will delete the CLI that ' +
      'the build installed. Install deps in the Build Command instead, and keep the ' +
      'Start Command to `npm run start`.'
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
