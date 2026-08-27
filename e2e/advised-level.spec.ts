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
    /*
     * Et **où** l'écrire, parce que l'app tient deux réservoirs de prix.
     *
     * Le 22/08 : ce message a envoyé saisir 600 000 kamas sur l'item « Muldo
     * Azur » de la page Items & Prix — un prix bien enregistré, dans le
     * réservoir que l'élevage ne lit pas. Nommer ce qui manque sans dire où
     * l'écrire coûte plus cher que se taire : ça fait travailler pour rien.
     */
    await expect(advised).toContainText('Saisir les prix');
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

  /**
   * Le conseil suit le **rythme de l'éleveur**, pas la durée d'un cycle.
   *
   * ## Ce que ce test ferme
   *
   * `tunedLevel` divisait par `cycleHours + climbHours` : il traitait les heures
   * d'enclos comme la rareté, donc il fuyait une montée longue comme si elle
   * retirait des fournées. Sous cette hypothèse il conseillait **23**.
   *
   * L'éleveur lance **une fournée par jour** — il dort et il travaille. La
   * Mangeoire tourne pendant son absence et ne lui coûte donc aucune fournée. Le
   * diviseur est `max(cycle + montée, HOURS_BETWEEN_LOADS)`.
   *
   * Mesuré sur son écurie réelle, 90 fournées, apparié sur 200 marchés :
   * l'optimum est autour de **100**, plateau de 80 à 105, et le niveau 60 coûte
   * 4,7 M sur un trimestre (t = −6,06). Le seuil de 50 retenu ici est donc large
   * à dessein : il tient tant que le rythme de l'éleveur est le diviseur, et il
   * tombe si quelqu'un remet les heures d'enclos à sa place — vu rouge à 23 sans
   * le correctif.
   */
  test('le niveau conseillé suit la fournée par jour, pas le cycle', async ({ page }) => {
    const mock = await mockSupabase(page);
    (mock.tables.breeding_color_prices as Record<string, unknown>[]).push(CROWN_PRICE);
    await openBreeding(page);

    const advised = page.getByTestId('advised-level');
    await expect(advised).toBeVisible({ timeout: 30_000 });
    const level = Number((await advised.innerText()).match(/(\d+)/)?.[1] ?? 0);

    expect(level).toBeGreaterThanOrEqual(50);
  });
});

/**
 * Le prix de l'item du certificat vaut prix de couleur, faute de mieux.
 *
 * Chaque couleur porte l'item de son certificat — `azur_dore` → 33286, « Muldo
 * Azur et Doré » — et cet item se tarifie déjà sur Items & Prix, avec les
 * parchemins et les carburants. `breeding_color_prices` en tenait un autre,
 * saisi ailleurs, et les deux ne se parlaient pas : le 22/08, un prix bien
 * enregistré sur l'item laissait l'élevage annoncer « il manque le prix ».
 *
 * Une saisie que l'app a sous la main et refuse de lire n'est pas une donnée
 * manquante.
 */
test.describe('le prix d’item comble le prix de couleur', () => {
  /** « Muldo Azur et Doré » : l'item du certificat de la gen 10 visée. */
  const CROWN_ITEM = {
    item_id: 33286,
    item_name: 'Muldo Azur et Doré',
    icon_url: 'https://api.dofusdb.fr/img/items/97328.png',
    price: '4000000',
    updated_at: '2026-08-22T10:00:00Z',
    updated_by: '00000000-0000-0000-0000-0000000000e2',
  };

  test('un prix d’item suffit au niveau conseillé', async ({ page }) => {
    const mock = await mockSupabase(page);
    // Aucun prix de couleur sur la cible — seulement celui de son item.
    (mock.tables.item_prices as Record<string, unknown>[]).push(CROWN_ITEM);
    await openBreeding(page);

    const advised = page.getByTestId('advised-level');
    await expect(advised).toBeVisible({ timeout: 30_000 });
    await expect(advised).not.toContainText('il manque');
    const level = Number((await advised.innerText()).match(/(\d+)/)?.[1] ?? 0);
    expect(level).toBeGreaterThan(0);
    expect(level).toBeLessThan(200);
  });

  test('le champ reste vide, et le prix hérité s’affiche en repère', async ({ page }) => {
    const mock = await mockSupabase(page);
    (mock.tables.item_prices as Record<string, unknown>[]).push(CROWN_ITEM);
    await openBreeding(page);

    await page.getByRole('button', { name: /montures ·/ }).click();
    await page.getByRole('button', { name: 'Saisir les prix' }).click();
    await page.getByPlaceholder('Filtrer par nom').fill('Azur-Dore');

    // Rien n'est enregistré sur la couleur : le champ est vide. Le pré-remplir
    // se lirait « c'est saisi », et l'éleveur ne saurait plus lequel des deux
    // réservoirs il regarde.
    const champ = page.locator('input[data-inherited]');
    await expect(champ).toHaveCount(1);
    await expect(champ).toHaveValue('');
    // `\D` et non un espace : `toLocaleString('fr-FR')` sépare les milliers par
    // une espace fine insécable, qu'on ne veut pas voir écrite dans un test.
    await expect(champ).toHaveAttribute('placeholder', /4\D000\D000 · item/);
  });
});
