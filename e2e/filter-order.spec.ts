import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';

/**
 * Les filtres qui listent des noms les listent par ordre alphabétique.
 *
 * ## Pourquoi c'est un comportement et pas une préférence
 *
 * Le menu Métier sortait dans l'ordre des identifiants DofusDB — celui dans
 * lequel le jeu a ajouté les métiers. Trouver « Sculpteur » dans quinze entrées
 * non triées demande de les lire toutes, et le menu n'a pas de barre de
 * recherche. Même chose pour les six jauges d'enclos et les cinq éléments, qui
 * sortaient dans l'ordre où quelqu'un les avait écrits.
 *
 * ## Ce que ce fichier ne surveille pas, et pourquoi
 *
 * Les listes **ordinales** gardent leur ordre : niveaux, tailles de lot, bandes
 * de jauge, rangs de carburant, générations — ces dernières dans l'ordre du jeu,
 * qui est celui des chaînes (1, 10, 2…) et sert à lire les deux écrans en
 * vis-à-vis. Les menus « Trier par » non plus : leurs trois entrées sont des
 * commandes, pas des valeurs à retrouver, et la première est le défaut.
 */

/** Les intitulés d'un `<select>`, le premier — « Tous les… » — retiré. */
const optionsOf = async (select: Locator): Promise<string[]> => {
  const labels = await select.locator('option').allInnerTexts();
  return labels.slice(1).map((label) => label.trim());
};

const sortedFr = (labels: string[]) => [...labels].sort((a, b) => a.localeCompare(b, 'fr'));

const open = async (page: Page, path: string) => {
  await mockSupabase(page);
  await page.goto(path);
};

test.describe('l’ordre des filtres', () => {
  test('les métiers sont alphabétiques', async ({ page }) => {
    await open(page, '/recipes');
    const metier = page.locator('select').filter({ hasText: 'Tous les métiers' });
    await expect(metier).toBeVisible({ timeout: 30_000 });

    const labels = await optionsOf(metier);
    expect(labels.length, 'les quinze métiers').toBe(15);
    expect(labels, 'les métiers doivent descendre par ordre alphabétique').toEqual(
      sortedFr(labels)
    );
    // L'accent ne renvoie pas en fin de liste : « Éleveur » se range à E.
    expect(labels.indexOf('Éleveur')).toBeLessThan(labels.indexOf('Forgeron'));
  });

  test('les jauges d’enclos sont alphabétiques', async ({ page }) => {
    await open(page, '/gauges');
    const chips = page.locator('button', { hasText: /^(Abreuvoir|Baffeur|Caresseur|Dragofesse|Foudroyeur|Mangeoire)$/ });
    await expect(chips).toHaveCount(6, { timeout: 30_000 });

    const labels = (await chips.allInnerTexts()).map((label) => label.trim());
    expect(labels).toEqual(sortedFr(labels));
  });

  test('les éléments sont alphabétiques', async ({ page }) => {
    await open(page, '/farm');
    await page.getByRole('button', { name: 'Filtres' }).click();

    const chips = page.locator('button', { hasText: /^(Air|Eau|Feu|Neutre|Terre)$/ });
    await expect(chips).toHaveCount(5, { timeout: 30_000 });

    const labels = (await chips.allInnerTexts()).map((label) => label.trim());
    expect(labels).toEqual(sortedFr(labels));
  });
});
