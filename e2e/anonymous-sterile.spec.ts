import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Une anonyme ne peut pas être stérile.
 *
 * ## Pourquoi cet état n'existe pas
 *
 * Une monture est anonyme parce qu'elle n'a **pas d'ascendance** à porter :
 * achetée ou capturée, donc gen 1 — voir `naming.ts`. Et une gen 1 fertile sans
 * ascendance appartient au compteur de vrac, pas aux montures suivies. Il ne
 * reste donc, parmi les anonymes individuelles, que la **féconde**.
 *
 * La stérile, elle, ne peut rien : le jeu n'extrait pas les gen 1, et le clonage
 * ne prend pas les anonymes, qui ne se désignent pas dans l'écurie du jeu. Ce
 * n'est pas une monture qu'on aurait oublié de nommer, c'est un reste — et il
 * gonfle le seul chiffre que l'éleveur compare au jeu. L'écurie en a porté
 * **cinquante-sept d'un coup** : 255 annoncées contre 198 au recensement du
 * 16/08.
 *
 * ## Les trois portes sur la même table
 *
 * « Mes stocks », l'import de liste et l'ajout monture par monture écrivent tous
 * les trois dans `user_breeding_individuals`. Fermer une seule d'entre elles
 * laisserait les deux autres refabriquer ce que la première refuse.
 */

const openStocks = async (page: Page) => {
  const bouton = page.getByRole('button', { name: /montures ·/ });
  await expect(bouton).toBeVisible({ timeout: 30_000 });
  await bouton.click();
};

const individus = 'user_breeding_individuals';

test.describe('anonymes stériles', () => {
  test('l’écurie les compte et les retire en une écriture', async ({ page }) => {
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    const bandeau = page.getByTestId('phantom-notice');
    await expect(bandeau).toBeVisible();

    // La fixture est l'écurie réelle du 15/08 : elle en porte pour de bon, et
    // sans ça le test ne prouverait rien.
    const restes = supabase
      .rows(individus)
      .filter((row) => !row.name && row.fertile === false).length;
    expect(restes).toBeGreaterThan(0);
    await expect(bandeau).toContainText(String(restes));

    const avant = supabase.rows(individus).length;
    await bandeau.getByRole('button', { name: /Retirer/ }).click();
    await expect(bandeau).toHaveCount(0);

    // Une seule écriture pour tout le lot : soixante-dix suppressions séparées
    // laisseraient un état que personne ne peut décrire si l'une d'elles échoue.
    const suppressions = supabase.writes.filter(
      (write) => write.table === individus && write.method === 'DELETE'
    );
    expect(suppressions).toHaveLength(1);
    expect(supabase.rows(individus)).toHaveLength(avant - restes);
    expect(
      supabase.rows(individus).filter((row) => !row.name && row.fertile === false)
    ).toHaveLength(0);
  });

  test('une suppression refusée remet les montures à l’écran', async ({ page }) => {
    // La règle de toute la maison : ce que l'écran retire est ce que la base a
    // pris. Un refus qui vide l'écran ressuscite les montures au rechargement
    // suivant, sans que rien n'ait prévenu.
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    const bandeau = page.getByTestId('phantom-notice');
    await expect(bandeau).toBeVisible();
    const avant = supabase.rows(individus).length;

    supabase.refuse({ table: individus, method: 'DELETE' });
    await bandeau.getByRole('button', { name: /Retirer/ }).click();

    await expect(page.locator('[role="alert"]').filter({ hasText: 'Pas enregistré' })).toBeVisible();
    await expect(bandeau).toBeVisible();
    expect(supabase.rows(individus)).toHaveLength(avant);
  });

  test('le bouton « Stérile » est fermé sur une anonyme', async ({ page }) => {
    // La porte de « Mes stocks ». Sans elle, on retire les restes d'un côté et
    // on les refabrique de l'autre, d'un clic.
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    const anonymes = page.getByTestId('stock-mount').filter({ has: page.locator('[data-anonymous="true"]') })
      .or(page.locator('[data-testid="stock-mount"][data-anonymous="true"]'));
    await expect(anonymes.first()).toBeVisible();

    const total = Math.min(await anonymes.count(), 12);
    expect(total).toBeGreaterThan(0);
    for (let index = 0; index < total; index += 1) {
      await expect(anonymes.nth(index).getByRole('button', { name: 'Stérile' })).toBeDisabled();
    }

    // Le pendant : une nommée garde ses trois états. Sans ça, « désactivé »
    // pourrait vouloir dire « désactivé partout », ce qui casserait la saisie.
    const nommees = page.locator('[data-testid="stock-mount"][data-anonymous="false"]');
    if ((await nommees.count()) > 0) {
      await expect(nommees.first().getByRole('button', { name: 'Stérile' })).toBeEnabled();
    }

    // Et rien n'est parti en base : un bouton désactivé n'écrit pas.
    await anonymes.first().getByRole('button', { name: 'Stérile' }).click({ force: true });
    expect(supabase.writes.filter((write) => write.method === 'PATCH')).toHaveLength(0);
  });
});
