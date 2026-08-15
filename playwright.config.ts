import { defineConfig, devices } from '@playwright/test';

/**
 * Les tests de bout en bout, sur un vrai navigateur et un vrai serveur Next.
 *
 * `npm run test:e2e`. Le serveur est démarré par Playwright lui-même, avec le
 * garde d'authentification levé — voir `authBypassedForTests` dans
 * `src/lib/supabase/middleware.ts`, qui explique les deux verrous.
 *
 * Pas de variables Supabase : `getSupabaseEnv` retombe alors sur son hôte de
 * remplacement, que `e2e/support/supabase.ts` intercepte. Aucun test ne touche
 * donc à une base, réelle ou locale.
 *
 * `workers: 1`, et ce n'est pas de la prudence : chaque test pilote une écurie
 * entière et le serveur de dev recompile à la demande. Deux navigateurs en
 * parallèle ne vont pas plus vite et rendent les échecs illisibles.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  // Un test qui échoue sur cette suite doit être cru. Le rejouer masquerait
  // exactement la classe de défauts qu'elle existe pour attraper : une écriture
  // perdue une fois sur deux reste une écriture perdue.
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    // Le préréglage d'abord : il porte son propre `viewport`, et le poser
    // après écraserait celui qu'on veut. L'écran est large parce que la
    // fenêtre de saisie affiche deux fiches côte à côte au-delà de 640 px, et
    // c'est cette disposition-là qu'on teste.
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3100',
    viewport: { width: 1500, height: 1200 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // Port distinct du 3000 des sessions de développement : lancer la suite ne
    // doit pas exiger d'arrêter le serveur sur lequel on travaille.
    command: 'npm run dev -- --port 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DOFDOF_TEST_BYPASS_AUTH: '1',
      NODE_ENV: 'development',
    },
  },
});
