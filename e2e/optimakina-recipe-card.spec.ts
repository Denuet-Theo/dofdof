import { expect, test } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * La carte de recette d'une Optimakina, ouverte depuis la puce qui la conseille.
 *
 * ## La demande, et pourquoi elle n'est pas cosmétique
 *
 * La puce annonce « fabrication 600 » sur des prix d'ingrédients saisis un jour
 * quelconque. Rien ne disait **lequel**, ni de quand : un relevé d'il y a trois
 * semaines et un d'il y a une heure donnaient le même chiffre, avec la même
 * assurance. « Il faudrait pouvoir afficher la carte de craft pour vérifier si
 * les prix ont changé » — l'éleveur, 28/08.
 *
 * La carte porte déjà cette colonne : `RecipeDetails` imprime
 * `formatTimeAgo(updated_at)` sous chaque ingrédient. Il manquait le chemin pour
 * l'atteindre depuis l'écran d'élevage.
 *
 * ## Ce que la seconde spec tient, et qui ne se voit qu'au deuxième geste
 *
 * Corriger un prix depuis la carte doit **rendre la main à la puce**. Sans
 * `applyItemPrice`, l'écriture partait, la base l'acceptait, et le conseil
 * restait sur l'ancien coût jusqu'au rechargement — c'est-à-dire que la
 * vérification qu'on venait faire ne se voyait nulle part. Le défaut n'apparaît
 * qu'après le second geste : ouvrir, corriger, refermer, relire.
 */

const CROWN_PRICE = {
  family: 'muldo',
  color_id: 'azur_dore',
  mount_level: 0,
  price: '4000000',
  updated_at: '2026-08-18T10:00:00Z',
  updated_by: '00000000-0000-0000-0000-0000000000e2',
};

const OPTIMAKINA_GEN2 = {
  item_id: 33335,
  item_name: 'Optimakina Muldo de Génération 2',
  icon_url: 'https://api.dofusdb.fr/img/items/97328.png',
  price: '1000',
  updated_at: '2026-08-27T10:00:00Z',
  updated_by: '00000000-0000-0000-0000-0000000000e2',
};

/**
 * L'ingrédient, tarifé **et daté d'il y a longtemps**.
 *
 * La date est le sujet : c'est elle qui répond à « est-ce que les prix ont
 * changé ». Un relevé du jour afficherait « il y a quelques secondes » et ne
 * prouverait pas que la colonne dit l'âge réel de la saisie.
 */
const INGREDIENT = {
  item_id: 900001,
  item_name: 'Poudre de test',
  icon_url: 'https://api.dofusdb.fr/img/items/900001.png',
  price: '300',
  updated_at: '2020-01-15T10:00:00Z',
  updated_by: '00000000-0000-0000-0000-0000000000e2',
};

/** 2 × 300 = 600, contre 1 000 à l'hôtel de vente : la fabrication l'emporte. */
const RECETTE_GEN2 = {
  id: 1,
  resultId: OPTIMAKINA_GEN2.item_id,
  resultTypeId: 0,
  resultLevel: 1,
  ingredientIds: [INGREDIENT.item_id],
  quantities: [2],
  jobId: 0,
  skillId: 0,
  resultName: { fr: OPTIMAKINA_GEN2.item_name },
  result: { id: OPTIMAKINA_GEN2.item_id, name: { fr: OPTIMAKINA_GEN2.item_name }, img: OPTIMAKINA_GEN2.icon_url },
  // `ingredients` et non les seuls ids : `RecipeDetails` lit les noms et les
  // icônes là-dedans, et sans lui la carte s'ouvre sur zéro ligne.
  ingredients: [
    {
      id: INGREDIENT.item_id,
      name: { fr: INGREDIENT.item_name },
      img: INGREDIENT.icon_url,
    },
  ],
};

/** L'écurie, ses prix et la recette, posés d'un coup. */
const monterEcurie = async (page: import('@playwright/test').Page) => {
  const mock = await mockSupabase(page);
  (mock.tables.breeding_color_prices as Record<string, unknown>[]).push(CROWN_PRICE);
  (mock.tables.item_prices as Record<string, unknown>[]).push(OPTIMAKINA_GEN2, INGREDIENT);
  // Enregistrée après `mockSupabase`, donc prioritaire sur son `/api/dofusdb/**`.
  await page.route('**/api/dofusdb/recipes**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total: 1, limit: 50, skip: 0, data: [RECETTE_GEN2] }),
    })
  );
  await openBreeding(page);
  await page.getByTestId('step-mate').click();
  return mock;
};

test.describe('la carte de recette d’une Optimakina', () => {
  test('la puce l’ouvre, et la carte date chaque prix', async ({ page }) => {
    await monterEcurie(page);

    const ligne = page.getByTestId('optimakina-line').filter({ hasText: 'gen 2' });
    await expect(ligne).toHaveCount(1, { timeout: 30_000 });
    // Le témoin : la puce conseille bien la fabrication à 600 avant qu'on ouvre.
    await expect(ligne.getByTestId('optimakina-comparison')).toContainText(/fabrication\s+600/);

    await ligne.click();

    const carte = page.getByRole('dialog').filter({ hasText: 'Recette' });
    await expect(carte).toBeVisible();
    // L'ingrédient, sa quantité, et **son âge** : c'est cette dernière colonne
    // qui répond à la question posée, les deux autres ne font que la situer.
    await expect(carte).toContainText('Poudre de test');
    await expect(carte).toContainText('× 2');
    await expect(carte).toContainText(/il y a|ans?|mois/);
    // Et le total de la carte est celui de la puce : deux chiffres pour une
    // question serait pire que pas de carte du tout.
    await expect(carte).toContainText(/600/);
  });

  test('corriger un prix depuis la carte recalcule le conseil', async ({ page }) => {
    const mock = await monterEcurie(page);

    const ligne = page.getByTestId('optimakina-line').filter({ hasText: 'gen 2' });
    await expect(ligne).toHaveCount(1, { timeout: 30_000 });
    await ligne.click();

    const carte = page.getByRole('dialog').filter({ hasText: 'Recette' });
    await expect(carte).toBeVisible();
    // La ligne de l'ingrédient ouvre la saisie de son prix.
    await carte.getByText('Poudre de test').click();

    const saisie = page.getByRole('dialog').filter({ hasText: 'Ajuster le prix' });
    await expect(saisie).toBeVisible();
    await saisie.getByLabel('Prix (kamas)').fill('400');
    await saisie.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(saisie).toBeHidden();

    // Ce que le faux serveur porte après coup, et non seulement ce qui est
    // parti : une écriture perdue laisserait toutes les assertions d'écran
    // ci-dessous vertes sur un prix jamais enregistré.
    await expect
      .poll(() => {
        const rows = mock.tables.item_prices as Record<string, unknown>[];
        return rows.find((row) => row.item_id === INGREDIENT.item_id)?.price;
      })
      .toBe(400);

    // Fermer la carte, relire la puce : 2 × 400 = 800, et c'est encore moins
    // cher que les 1 000 de l'hôtel de vente, donc la source ne bascule pas.
    await page.keyboard.press('Escape');
    await expect(carte).toBeHidden();

    const comparaison = ligne.getByTestId('optimakina-comparison');
    await expect(comparaison).toContainText(/fabrication\s+800/);
    await expect(comparaison).toContainText(/HDV\s+1\s000/);
    // 800 contre 1 000 : l'économie tombe de 40 % à 20 %.
    await expect(comparaison).toContainText(/[−–-]20\s%/);
  });
});
