import { expect, test } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Les onglets de « Ce que fait la politique », et l'étanchéité qui leur manquait.
 *
 * L'onglet ne changeait que l'en-tête et son bouton. En dessous, le même bloc
 * déroulait toujours **tout** : la fournée découpée en enclos, les fécondations,
 * les clonages, la liste à sortir du coffre. Choisir « Accouplement » affichait
 * donc cinq enclos à charger, et l'écran donnait quatre consignes simultanées à
 * un joueur qui n'a qu'une fenêtre de jeu ouverte devant lui.
 *
 * Chaque geste se fait dans le jeu, une monture à la fois, en cherchant un nom.
 * Un onglet montre ce geste-là, et rien d'autre.
 */

test.describe('onglets de la politique', () => {
  test('un onglet à la fois, jamais deux panneaux', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);

    const panes = ['pane-mate', 'pane-clone', 'pane-load', 'pane-extract'] as const;
    const tabs = ['step-mate', 'step-clone', 'step-load', 'step-extract'] as const;

    for (let index = 0; index < tabs.length; index += 1) {
      await page.getByTestId(tabs[index]).click();
      for (let other = 0; other < panes.length; other += 1) {
        await expect(page.getByTestId(panes[other])).toHaveCount(other === index ? 1 : 0);
      }
    }
  });

  test('« Accouplement » ne montre aucun enclos', async ({ page }) => {
    // Le symptôme exact : cinq enclos à charger sous l'onglet des croisements.
    await mockSupabase(page);
    await openBreeding(page);

    await page.getByTestId('step-mate').click();
    await expect(page.getByTestId('current-pen')).toHaveCount(0);
    await expect(page.getByTestId('load-named')).toHaveCount(0);
    await expect(page.getByTestId('load-anonymous')).toHaveCount(0);
    await expect(page.getByTestId('lock-pen')).toHaveCount(0);
  });

  test('« Fournée » ne montre ni clonages ni extraction', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);

    await page.getByTestId('step-load').click();
    const pane = page.getByTestId('pane-load');
    await expect(pane).toBeVisible();

    const texte = (await pane.innerText()).toLowerCase();
    expect(texte).not.toContain('clonage');
    expect(texte).not.toContain('extraction');
  });

  test('« Ma journée » et la timeline ont quitté l’écran', async ({ page }) => {
    // Le préréglage de disponibilité n'entrait dans aucun calcul — l'ordonnanceur
    // ne sait pas encore viser une durée — et la timeline datait un parc simulé,
    // pas les enclos réellement chargés. Deux compteurs contradictoires devant le
    // même enclos.
    await mockSupabase(page);
    await openBreeding(page);

    await expect(page.getByTestId('policy-panel')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Ma journée')).toHaveCount(0);
    await expect(page.getByText('Les 12 prochaines heures')).toHaveCount(0);
  });
});
