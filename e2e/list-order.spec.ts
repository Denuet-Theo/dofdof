import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBirthDialog, openBreeding, panels } from './support/breeding';

/**
 * L'ordre des gestes du jour : par génération cible croissante.
 *
 * L'éleveur descend ses accouplements puis ses clonages en jeu, une monture à la
 * fois, et il les fait dans l'ordre où l'écran les donne. Les prendre par
 * génération croissante lui fait remonter son arbre du bas vers le haut, ce qui
 * est l'ordre dans lequel les montures deviennent disponibles.
 *
 * ## Ce que cet ordre déplace
 *
 * Il passe **devant** deux règles qui décidaient avant lui : « les immédiats
 * d'abord » dans `policy.ts`, et « ce qui sert le projet passe devant » dans
 * `cloning.ts`. Les deux sont devenues des départages. Une gen 2 à acheter passe
 * donc maintenant devant une gen 8 gratuite, et c'est le prix de l'ordre demandé.
 */
const openTab = async (page: Page, step: string) => {
  await openBreeding(page);
  await page.getByTestId(`step-${step}`).click();
  await expect(page.getByTestId(`pane-${step}`)).toBeVisible();
};

test.describe('l’ordre des gestes du jour', () => {
  test('les accouplements sont par génération cible croissante', async ({ page }) => {
    // Les panneaux vivent dans « Ce qui est né », et leur ordre descend de celui
    // que `stablePlan` pose sur `couples`.
    await mockSupabase(page);
    await openBreeding(page);
    await openBirthDialog(page);

    const generations = await page
      .getByTestId('mating-panel')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-generation')).filter(Boolean).map(Number)
      );
    // Au moins un panneau, et la liste ne redescend jamais. Le `> 1` serait plus
    // fort et la fixture ne peut pas le donner : ses vingt accouplements sont de la
    // **même forme**, donc `byKind` les replie en un seul panneau. C'est l'ordre des
    // clonages, plus bas, qui éprouve réellement le tri — et il a échoué avant le
    // correctif, sur la liste que l'onglet lit vraiment.
    expect(generations.length, 'la fournée doit porter un accouplement').toBeGreaterThan(0);
    expect(generations, 'la liste ne doit jamais redescendre').toEqual(
      [...generations].sort((a, b) => a - b)
    );
  });

  test('les clonages sont par génération croissante', async ({ page }) => {
    // Ils sortaient dans l'ordre de la recherche, c'est-à-dire dans aucun ordre :
    // la liste changeait de disposition d'un rendu à l'autre.
    await mockSupabase(page);
    await openTab(page, 'clone');

    const generations = await page
      .getByTestId('clone-advice')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-generation'))));
    expect(generations.length, 'la fixture doit porter plusieurs rangs').toBeGreaterThan(1);
    expect(generations, 'la liste doit monter').toEqual([...generations].sort((a, b) => a - b));
  });
});
