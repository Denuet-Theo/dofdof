import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding, failureBanner } from './support/breeding';

/**
 * Une fournée qu'on n'a **pas su lire** n'est pas une fournée absente.
 *
 * ## Le trou que l'audit du 23/08 a trouvé
 *
 * `useBreedingBatch` répondait à une lecture ratée par `setPens([])` et un
 * `console.error`. Deux conséquences, aucune visible :
 *
 * 1. l'écran repasse sur la **proposition vivante** — des enclos tout neufs,
 *    calculés sur l'écurie du jour — à la place de ceux qui tournent réellement
 *    dans le jeu ;
 * 2. le premier verrou posé là-dessus part de `proposed`, puisque `pens` est
 *    vide, et **écrase** la ligne qui décrivait le vrai contenu des enclos.
 *
 * Une seconde de réseau suffisait donc à effacer ce qu'on a mis des jours à
 * charger. C'est la même famille que #271 et #272 — un état qu'on ne sait pas
 * lire traité comme un état connu — mais du côté **lecture**, que
 * `scripts/check-writes.mjs` ne peut pas voir.
 *
 * Ce que ces tests tiennent : l'échec se dit, et rien n'est écrit par-dessus.
 */

const openLoad = async (page: Page) => {
  const tab = page.getByTestId('step-load');
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByTestId('pane-load')).toBeVisible();
};

/**
 * Fait échouer **la lecture** de la fournée, et elle seule.
 *
 * `mockSupabase.refuse` ne porte que sur les écritures : c'est ce qu'il a été
 * écrit pour faire. Ici il faut refuser un `GET`, donc une route posée par-dessus
 * — et posée **avant** celle du faux serveur, Playwright donnant la main à la
 * dernière enregistrée.
 */
const refuseBatchRead = async (page: Page) => {
  await page.route('**/rest/v1/breeding_batch*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'read timeout', details: null, hint: null, code: '57014' }),
    });
  });
};

type Pen = { units: { id: string }[]; lockedAt: string | null };
const storedPens = (mock: SupabaseMock) => (mock.rows('breeding_batch')[0]?.pens ?? []) as Pen[];

test.describe('fournée illisible', () => {
  test('elle se dit, au lieu de passer pour une fournée absente', async ({ page }) => {
    const mock = await mockSupabase(page);
    await refuseBatchRead(page);
    await openBreeding(page);

    await expect(failureBanner(page).first()).toBeVisible();
    expect(mock.rows('breeding_batch')).toHaveLength(0);
  });

  test('verrouiller par-dessus n’écrase pas la fournée qu’on n’a pas lue', async ({ page }) => {
    // Le cœur du défaut. La base **porte** une fournée de trois enclos ; la
    // lecture échoue ; l'écran propose donc la sienne. Un clic sur « verrouiller »
    // écrivait alors la proposition par-dessus les trois enclos réels, qui
    // tournent dans le jeu et que plus rien ne décrivait.
    const mock = await mockSupabase(page);

    // Une fournée déjà en cours, telle qu'elle serait après deux jours.
    const existing: Pen[] = [
      { units: [{ id: 'aaaaaaaa-0000-0000-0000-000000000001' }], lockedAt: '2026-08-21T09:00:00.000Z' },
      { units: [{ id: 'aaaaaaaa-0000-0000-0000-000000000002' }], lockedAt: '2026-08-22T09:00:00.000Z' },
      { units: [{ id: 'aaaaaaaa-0000-0000-0000-000000000003' }], lockedAt: null },
    ];
    mock.tables.breeding_batch = [{ family: 'muldo', pens: existing, updated_at: '2026-08-22T09:00:00.000Z' }];

    await refuseBatchRead(page);
    await openBreeding(page);
    await openLoad(page);

    await expect(failureBanner(page).first()).toBeVisible();

    // L'écran montre la proposition vivante — il n'a rien d'autre — donc le
    // bouton est là. Il ne doit rien écrire.
    const lock = page.getByTestId('lock-pen');
    if ((await lock.count()) > 0) {
      await lock.click();
      await page.waitForTimeout(1200);
    }

    // La fournée en base est **intacte** : trois enclos, les deux verrous d'origine.
    const after = storedPens(mock);
    expect(after).toHaveLength(3);
    expect(after.map((pen) => pen.lockedAt)).toEqual([
      '2026-08-21T09:00:00.000Z',
      '2026-08-22T09:00:00.000Z',
      null,
    ]);
    expect(after.flatMap((pen) => pen.units.map((unit) => unit.id))).toEqual([
      'aaaaaaaa-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000002',
      'aaaaaaaa-0000-0000-0000-000000000003',
    ]);
  });
});
