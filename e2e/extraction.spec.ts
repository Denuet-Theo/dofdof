import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * L'onglet Extraction : par où commencer à vider l'écurie.
 *
 * ## Le défaut que ces specs verrouillent
 *
 * Les gen 1 y étaient listées, marquées « ne s'extrait pas ». C'était vrai — le
 * jeu ne les extrait pas — et c'était le pire endroit pour le dire. La liste est
 * triée par valeur de reproduction **croissante**, et une gen 1 est ce qu'il y a
 * de moins précieux : elles occupaient donc tout le haut de l'écran. Sur l'écurie
 * réelle, des dizaines de lignes qui ne rendent rien devant les quelques-unes qui
 * rapportent, sur le seul écran dont la question est « qu'est-ce que je vide
 * d'abord ».
 *
 * Elles ne disparaissent pas de l'app : une gen 1 stérile s'apparie, et l'onglet
 * Clonage la propose. C'est là qu'elle a quelque chose à faire — et le dernier
 * test le vérifie, parce que « on les retire d'ici » ne doit pas vouloir dire
 * « on les oublie ».
 */

const openExtraction = async (page: Page) => {
  const tab = page.getByTestId('step-extract');
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByTestId('pane-extract')).toBeVisible();
};

test.describe('extraction', () => {
  test('aucune gen 1 dans la liste', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openExtraction(page);

    const lignes = page.getByTestId('extraction-row');
    await expect(lignes.first()).toBeVisible();

    const total = await lignes.count();
    expect(total).toBeGreaterThan(0);

    for (let index = 0; index < total; index += 1) {
      const generation = Number(await lignes.nth(index).getAttribute('data-generation'));
      expect(generation).toBeGreaterThan(1);
    }
  });

  test('plus une ligne ne dit « ne s’extrait pas »', async ({ page }) => {
    // Le symptôme exact : la mention existait, donc la ligne aussi.
    await mockSupabase(page);
    await openBreeding(page);
    await openExtraction(page);

    await expect(page.getByTestId('pane-extract')).not.toContainText('ne s’extrait pas');
    await expect(page.getByTestId('pane-extract')).not.toContainText("ne s'extrait pas");
  });

  test('chaque ligne rend quelque chose', async ({ page }) => {
    // La conséquence utile : le haut de la liste est actionnable. C'est ce qu'on
    // vient chercher — par où commencer à vider — et c'est ce que les gen 1
    // enterraient.
    await mockSupabase(page);
    await openBreeding(page);
    await openExtraction(page);

    const lignes = page.getByTestId('extraction-row');
    const total = await lignes.count();

    for (let index = 0; index < total; index += 1) {
      const unites = Number(await lignes.nth(index).getAttribute('data-units'));
      expect(unites).toBeGreaterThan(1);
    }
  });

  test('les gen 1 stériles restent proposées au clonage', async ({ page }) => {
    // Le pendant, et il compte autant : les retirer de l'extraction ne doit pas
    // les faire disparaître de l'app. Une gen 1 stérile s'apparie, et c'est le
    // rang le plus fourni en clonages à ascendance certaine.
    await mockSupabase(page);
    await openBreeding(page);

    await page.getByTestId('step-clone').click();
    const lignes = page.getByTestId('clone-advice');
    await expect(lignes.first()).toBeVisible({ timeout: 30_000 });

    let gen1 = 0;
    for (let index = 0; index < (await lignes.count()); index += 1) {
      if ((await lignes.nth(index).getAttribute('data-generation')) === '1') gen1 += 1;
    }
    expect(gen1).toBeGreaterThan(0);
  });
});
