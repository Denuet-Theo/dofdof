---
name: browser-test
description: How to launch and drive this app (dofdof) in a real headless browser to verify a change before reporting it done. Covers bypassing the Supabase auth gate locally (there's no .env.local / real Supabase project in this sandbox), installing Playwright in an isolated scratchpad, mocking the Supabase REST endpoint for price-save flows, and the mandatory cleanup. Use whenever asked to "run the app", "try it in a browser", or "verify it works" for a UI change.
---

# Testing dofdof in a browser

This sandbox has no `.env.local` and no real Supabase project, so every
`(protected)` page and every `/api/*` route normally 401s or redirects to
`/login`. This skill is the verified way to get past that far enough to
actually click around, without touching anything that ends up committed.

## 1. Why the normal dev server alone isn't enough

Auth is enforced in `src/proxy.ts` → `src/lib/supabase/middleware.ts`
(`updateSession`). Note the filename: this repo pins a pre-release Next.js
where `proxy.ts` replaces the conventional `middleware.ts` — see
`AGENTS.md` before assuming standard Next.js conventions elsewhere too.

Without `NEXT_PUBLIC_SUPABASE_URL`/`_ANON_KEY` set, `isSupabaseConfigured()`
is false, `user` stays `null`, and `updateSession` unconditionally 401s
`/api/*` and redirects everything else to `/login`. There is no dev-mode
flag for this in the app itself.

## 2. Temporarily bypass auth (and always revert it)

Add an env-gated early return at the very top of `updateSession` in
`src/lib/supabase/middleware.ts`:

```ts
export const updateSession = async (request: NextRequest) => {
  // TEMP-TEST-BYPASS: local-only, reverted before commit. See conversation.
  if (process.env.DOFDOF_TEST_BYPASS_AUTH === '1') {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });
  // ...rest of the function unchanged
```

Rules:
- This is the **only** file you patch for this. Never touch the bypass
  condition to be broader than an exact env var check.
- Revert it with `git checkout -- src/lib/supabase/middleware.ts`
  **before** you finish the turn — not just before committing. Verify
  with `git status -s` that it shows no diff for that file.
- If a later Bash call in the same turn gets rejected/interrupted, check
  `git status -s` immediately — the Edit may have already landed even
  though the following command didn't run. Revert it right away rather
  than leaving it dangling into the next turn.

## 3. Start the dev server with the bypass on

`.claude/settings.local.json` already grants this:

```
"Bash(DOFDOF_TEST_BYPASS_AUTH=1 npm run dev*)"
```

It is a **prefix** rule: it only matches when the command *starts* with exactly
that string. So run it bare, with `run_in_background: true`:

```bash
DOFDOF_TEST_BYPASS_AUTH=1 npm run dev
```

Wrapped in a subshell, redirected, or chained after a `netstat`, the prefix stops
matching and the auto-mode classifier refuses it — as does the PowerShell form
(`$env:… ; npm run dev`), which the Bash rule does not cover. The permission has
been there all along; two PRs once shipped without a browser pass because this
was misread as "permission denied". Start it bare, then poll in a **separate**
call:

```bash
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/gauges)
  echo "attempt $i: $code"
  if [ "$code" = "200" ]; then break; fi
  sleep 1
done
```

A stale server from a previous turn is the most common failure mode
(`Another next dev server is already running` in the log, and it silently
falls back to port 3001). Check and clear it first:

```bash
netstat -ano | grep ":3000" | grep LISTENING
taskkill //PID <pid> //F
```

## 4. Drive it with Playwright

Playwright is **not** in this project's `node_modules` — installing it
there would touch `package-lock.json` for a repo dependency the app
doesn't actually need. Install it once per session into the scratchpad
instead:

```bash
mkdir -p "$SCRATCHPAD/pw" && cd "$SCRATCHPAD/pw"
npm init -y >/dev/null 2>&1
npm install playwright
npx playwright install chromium --with-deps
```

(`$SCRATCHPAD` is the session scratchpad directory from the system
prompt.) This is a one-time cost per session — reuse the same `pw/`
directory for every script in the same turn/session instead of
reinstalling.

Write one throwaway `.mjs` script per verification pass (`chromium-cli` is
not available in this environment, so drive Playwright directly):

```js
import { chromium } from 'playwright';

const main = async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto('http://localhost:3000/gauges', { waitUntil: 'networkidle' });
  // ...interact: click(), fill(), getByRole(), getByPlaceholder()...
  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-state.png`, fullPage: true });

  console.log(consoleErrors.length ? consoleErrors.join('\n') : '(no console errors)');
  await browser.close();
};
main().catch((err) => { console.error(err); process.exit(1); });
```

Run with `node script.mjs`, then read the screenshot back with the `Read`
tool to actually look at it — don't just trust that the script exited 0.

## 5. Mocking Supabase for price-save / price-read flows

The client falls back to a placeholder host
(`https://dofdof.onrender.com`, see `src/lib/supabase/env.ts`) when env
vars are missing. Real requests to it fail CORS preflight — that's
expected and is caught by the app's own try/catch, so it won't crash the
page. But to verify anything that depends on `item_prices` (rentability
ratios, "best value" highlighting, price editing), intercept it:

```js
await page.route('https://dofdof.onrender.com/rest/v1/item_prices**', async (route) => {
  if (route.request().method() === 'GET') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { item_id: 33309, item_name: 'X', icon_url: null, price: 500, updated_at: new Date().toISOString(), updated_by: null },
      ]),
    });
  } else {
    // upsert — echo back what was sent so onPriceSaved fires
    const body = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body : [body]) });
  }
});
```

### Honour `offset` / `limit`, or the page never loads

Returning the same rows on every call makes `fetchAllRows` **loop** until its
guard trips — « Pagination interrompue après 500 requêtes » — and the page stays
blank with the error in the console, not on screen.

`supabase-js` `.range(from, to)` sends pagination as **query params**
(`?offset=0&limit=1000`), **not** as a `Range` header, so a mock that inspects
`request.headers()['range']` sees nothing and believes it is always on page one.
Count calls per table and only serve rows on the first
(`seen.individuals === 1 ? ROWS : []`), or read `offset=` out of the URL. The
paginated tables in `useBreeding` are `item_prices`, `user_breeding_individuals`
and `user_item_stock`.

Do this on a `context`, not just a `page`, if you also need clipboard
permissions:

```js
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:3000' });
const page = await context.newPage();
// later: await page.evaluate(() => navigator.clipboard.readText())
```

## 6. Clean up, every time, before reporting done

```bash
git checkout -- src/lib/supabase/middleware.ts
git status -s   # must show no middleware.ts diff
netstat -ano | grep ":3000" | grep LISTENING   # find the PID
taskkill //PID <pid> //F
```

Only commit/push the actual feature files — never the bypass.

## Le faux serveur **doit** honorer `offset` et `limit`

Un gestionnaire qui ignore la pagination convient pour `item_prices` seul et
**casse toutes les tables que `fetchAllRows` lit** : il reçoit une page pleine à
chaque fois, redemande l'offset suivant sans fin, et
`src/lib/supabase/pagination.ts` finit par abandonner —

> Pagination interrompue après 500 requêtes (470000 lignes) : le serveur ne semble
> pas honorer les bornes de pagination.

**L'échec est muet à l'écran.** La page s'affiche quand même : elle montre
`DEFAULT_SETTINGS` — 6 enclos, 0 monture — comme si l'utilisateur n'avait aucune
donnée, ce qui se lit comme un problème d'authentification mockée et non de
pagination. On cherche alors très loin de la cause.

Même famille que l'`order` oublié dans `NOT_A_FILTER` (voir AGENTS.md) : **un faux
serveur qui ignore une partie de la requête verdit exactement ce qu'on lui
demandait de surveiller.** Servir la tranche demandée, toujours.
