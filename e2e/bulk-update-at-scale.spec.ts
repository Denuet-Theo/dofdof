import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding, failureBanner } from './support/breeding';

/**
 * La correction en lot à l'échelle où elle sert.
 *
 * `bulk-update.spec.ts` la pilote sur cinq montures. Cinq ne prouve presque
 * rien : le geste existe pour cinquante — c'est le nombre de montures restées
 * fausses après la fournée du 23/08 — et il se déclenche par « cocher les N
 * affichées », pas par cinquante clics. Deux choses changent avec le nombre :
 *
 * 1. **La requête grossit.** Les identifiants voyagent dans l'URL, en
 *    `?id=in.(uuid,uuid,…)`. Cinquante font 1 857 caractères ; les 203 de la
 *    fixture en font 7 518, et une écurie de 229 dépasse les 8 Ko qu'un proxy
 *    laisse habituellement passer sur une ligne de requête. C'est pour ça que
 *    l'écriture se découpe, et ce test mesure le découpage.
 * 2. **Le lot dépasse ce qu'on voit.** « Cocher les affichées » ne doit toucher
 *    que le filtre courant, jamais l'écurie entière.
 */

const openStocks = async (page: Page) => {
  const stock = page.getByRole('button', { name: /montures ·/ });
  await expect(stock).toBeVisible({ timeout: 30_000 });
  await stock.click();
  await expect(page.getByTestId('stock-list')).toBeVisible();
};

const patchesOn = (mock: SupabaseMock) =>
  mock.writes.filter(
    (write) => write.table === 'user_breeding_individuals' && write.method === 'PATCH'
  );

/** Les identifiants qu'une requête `?id=in.(…)` porte. */
const idsIn = (query: string) => {
  const match = query.match(/id=in\.%28([^&]*)%29|id=in\.\(([^&]*)\)/);
  const body = decodeURIComponent(match?.[1] ?? match?.[2] ?? '');
  return body.split(',').map((id) => id.replace(/"/g, '')).filter(Boolean);
};

test.describe('correction en lot, à l’échelle', () => {
  test('cocher les 203 affichées les corrige toutes, sans en oublier ni en inventer', async ({
    page,
  }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    const total = mock.rows('user_breeding_individuals').length;
    expect(total).toBeGreaterThan(50);

    await page.getByTestId('bulk-select-all').click();
    await expect(page.getByTestId('bulk-count')).toHaveAttribute('data-count', String(total));

    await page.getByTestId('bulk-status-feconde').click();
    await page.getByTestId('bulk-level').fill('44');

    const before = patchesOn(mock).length;
    await page.getByTestId('bulk-apply').click();
    await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 30_000 });

    const sent = patchesOn(mock).slice(before);
    // Chaque requête reste sous la taille qu'un proxy accepte, et les tranches
    // couvrent le lot **exactement** : aucun identifiant en double, aucun oublié.
    const carried = sent.flatMap((write) => idsIn(write.query));
    expect(new Set(carried).size).toBe(carried.length);
    expect(carried.length).toBe(total);
    for (const write of sent) expect(write.query.length).toBeLessThan(4000);

    // Et la base porte le résultat, ligne pour ligne.
    const rows = mock.rows('user_breeding_individuals');
    expect(rows.filter((row) => row.level === 44 && row.cycled === true)).toHaveLength(total);
    await expect(failureBanner(page)).toHaveCount(0);
    await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
  });

  test('cocher les affichées ne touche que le filtre courant', async ({ page }) => {
    // Le danger du geste : appliquer à ce qu'on ne voit pas. « Les affichées »
    // doit vouloir dire les affichées.
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    const search = page.getByPlaceholder(/nom/i).first();
    await expect(search).toBeVisible();
    await search.fill('G4');
    const shown = await page.getByTestId('stock-mount').count();
    expect(shown).toBeGreaterThan(3);
    expect(shown).toBeLessThan(mock.rows('user_breeding_individuals').length);

    await page.getByTestId('bulk-select-all').click();
    await expect(page.getByTestId('bulk-count')).toHaveAttribute('data-count', String(shown));
    // Rien n'est coché hors de vue : la mention ne s'affiche pas.
    await expect(page.getByTestId('bulk-count')).not.toContainText('hors filtre');

    // Un niveau que la fixture ne porte nulle part : il rend le « avant » et le
    // « après » lisibles sans compter les montures déjà à 44.
    await page.getByTestId('bulk-level').fill('137');
    const before = patchesOn(mock).length;
    const untouched = new Map(
      mock.rows('user_breeding_individuals').map((row) => [row.id as string, row.level])
    );
    await page.getByTestId('bulk-apply').click();
    await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 30_000 });

    const carried = new Set(
      patchesOn(mock)
        .slice(before)
        .flatMap((write) => idsIn(write.query))
    );
    expect(carried.size).toBe(shown);

    // Les affichées ont bougé, et **elles seules** : c'est tout le contrat du
    // bouton, et le danger du geste.
    for (const row of mock.rows('user_breeding_individuals')) {
      if (carried.has(row.id as string)) expect(row.level).toBe(137);
      else expect(row.level).toBe(untouched.get(row.id as string));
    }
  });

  test('une tranche refusée défait le lot entier', async ({ page }) => {
    // Le découpage ne doit pas rouvrir ce que le `.in()` fermait : un lot à
    // moitié écrit est un état que personne ne peut décrire. Si une tranche
    // tombe, l'écran revient d'un bloc et le compte de ce qui est passé se dit.
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    await page.getByTestId('bulk-select-all').click();
    const levels = await page
      .getByTestId('stock-mount')
      .locator('input[type="number"]')
      .evaluateAll((nodes) => nodes.slice(0, 5).map((node) => (node as HTMLInputElement).value));

    // La **deuxième** tranche est refusée : la première est donc déjà partie, et
    // c'est ce cas-là — écrit à moitié — que le retour arrière doit couvrir.
    let seen = 0;
    await page.route('**/rest/v1/user_breeding_individuals*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      seen += 1;
      if (seen < 2) return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'statement timeout', details: null, hint: null, code: '57014' }),
      });
    });

    await page.getByTestId('bulk-status-feconde').click();
    await page.getByTestId('bulk-level').fill('44');
    await page.getByTestId('bulk-apply').click();
    await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 30_000 });

    await expect(failureBanner(page).first()).toBeVisible();
    await expect(page.getByTestId('bulk-error')).toBeVisible();

    // L'écran est revenu où il était, y compris sur les lignes de la tranche
    // qui, elle, était passée.
    const after = await page
      .getByTestId('stock-mount')
      .locator('input[type="number"]')
      .evaluateAll((nodes) => nodes.slice(0, 5).map((node) => (node as HTMLInputElement).value));
    expect(after).toEqual(levels);
    // La sélection reste : le geste est à reprendre.
    await expect(page.getByTestId('bulk-bar')).toBeVisible();
  });
});
