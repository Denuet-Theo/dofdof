import { expect, test } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Le niveau auquel monter les montures, et le prix qui manque pour le dire.
 *
 * `optimalParentLevel` choisit déjà un niveau par recette, pour chiffrer un
 * croisement — mais il ne compte que des kamas, et son propre commentaire le
 * dit. Or monter les parents achète du taux de réussite, donc des heures
 * d'enclos, et rien à l'écran ne répondait « à quel niveau dois-je monter ? ».
 *
 * ## Les deux moitiés du test, et pourquoi la seconde compte autant
 *
 * Le calcul refuse de répondre sans le prix de la cible : sans lui, on ne sait
 * pas ce qu'une réussite vaut. Un espace vide se lirait « le calcul dit non »
 * alors qu'il dit « il me manque une donnée » — c'est la panne #179, où un
 * réglage bloqué s'était lu comme un marché difficile. L'écran nomme donc ce qui
 * manque, et c'est ça qu'on vérifie d'abord.
 *
 * ## Comment ces tests échouent sans le correctif
 *
 * Il n'y a pas de « avant » : la ligne n'existait pas. Ce qu'ils tiennent, c'est
 * qu'elle ne se remette pas à sortir un nombre sans prix — et le nombre lui-même
 * a coûté deux corrections que rien n'aurait signalées :
 *
 * - sans le **temps** de la montée, la Mangeoire est à 0,13 kama le point d'XP
 *   et le plafond gagne toujours : l'écran disait « 200 » à tous les horizons ;
 * - la frontière comptée sur la meilleure monture de l'écurie plutôt que sur la
 *   route donnait 10 chez un éleveur qui tient une gen 10 hors plan, donc un
 *   amortissement sur un seul barreau, donc « 200 » encore.
 */

const CROWN_PRICE = {
  family: 'muldo',
  color_id: 'azur_dore',
  mount_level: 0,
  price: '4000000',
  updated_at: '2026-08-18T10:00:00Z',
  updated_by: '00000000-0000-0000-0000-0000000000e2',
};

test.describe('niveau conseillé', () => {
  test('sans prix sur la cible, il dit lequel manque', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);

    const advised = page.getByTestId('advised-level');
    await expect(advised).toBeVisible({ timeout: 30_000 });
    // La fixture vise Azur-Doré et ne porte aucun prix de gen 10.
    await expect(advised).toContainText('il manque le prix de');
    await expect(advised).toContainText('Azur-Dore');
  });

  test('avec le prix, il donne un niveau et non le plafond', async ({ page }) => {
    const mock = await mockSupabase(page);
    (mock.tables.breeding_color_prices as Record<string, unknown>[]).push(CROWN_PRICE);
    await openBreeding(page);

    const advised = page.getByTestId('advised-level');
    await expect(advised).toBeVisible({ timeout: 30_000 });
    const level = Number((await advised.innerText()).match(/(\d+)/)?.[1] ?? 0);

    expect(level).toBeGreaterThan(0);
    // Le plafond est le symptôme des deux défauts cités en tête : il sort dès
    // qu'un terme du coût manque. Qu'il soit atteignable ne le rend pas
    // suspect — qu'il sorte *toujours*, si.
    expect(level).toBeLessThan(200);
  });
});
