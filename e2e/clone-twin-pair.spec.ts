import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Deux exemplaires de la même monture : une carte et un « × 2 ».
 *
 * ## Ce que l'écran demandait
 *
 * `cloneOptions` apparie les **jumelles** en premier, et c'est sa meilleure
 * règle : deux stériles de même couleur et de même ascendance rendent le même
 * clone quel que soit le côté que le jeu tire, donc l'opération est certaine —
 * `keepChance` vaut 1, le sexe aussi.
 *
 * La fenêtre de saisie n'en savait rien. Elle posait deux cartes rigoureusement
 * identiques — même vignette, même couleur, même ascendance, même sexe, même nom
 * — sous la question « laquelle est sortie », avec deux boutons qui font
 * exactement la même chose. Une question sans réponse, qu'on relit deux fois
 * avant de comprendre qu'elle n'en attend pas.
 *
 * ## Ce que ces specs verrouillent
 *
 * Une seule carte, un seul bouton, et le « × 2 » à la place de la seconde. Le
 * nom reste copiable — c'est lui qu'on va chercher dans l'écurie du jeu, et la
 * seconde carte n'ajoutait que la quantité.
 */

const openCloning = async (page: Page) => {
  await page.getByRole('button', { name: 'Clonage' }).click();
  const open = page.getByRole('button', { name: /clonages? à faire/ });
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
};

/**
 * Avance dans le lot jusqu'à une paire indiscernable, sans rien enregistrer.
 *
 * « Passer » n'écrit pas — la paire reviendra à la prochaine ouverture — donc on
 * traverse le lot sans toucher à l'écurie.
 */
const untilTwin = async (page: Page): Promise<boolean> => {
  for (let pas = 0; pas < 40; pas += 1) {
    if ((await page.getByTestId('clone-twin').count()) > 0) return true;
    const passer = page.getByTestId('clone-skip');
    if ((await passer.count()) === 0) return false;
    await passer.click();
  }
  return false;
};

test.describe('clonage — paire indiscernable', () => {
  test('une seule carte, un « × 2 », un seul bouton', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    // Sans une paire de jumelles dans la fixture, ce test ne prouverait rien.
    expect(await untilTwin(page)).toBe(true);

    const twin = page.getByTestId('clone-twin');
    await expect(twin).toBeVisible();
    await expect(twin).toContainText('× 2');

    // La seconde carte a disparu, et son bouton avec — les deux faisaient déjà
    // la même chose.
    await expect(page.getByTestId('clone-card')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Enregistrer le clonage' })).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'C’est celle-ci qui est sortie' })
    ).toHaveCount(0);

    // Le nom reste là, et copiable : c'est ce qu'on va chercher en jeu.
    expect(await page.getByTestId('clone-card').getByTestId('copyable').count()).toBe(1);
  });

  test('le clonage s’enregistre quand même, et rend son nom', async ({ page }) => {
    // Retirer un bouton ne doit pas retirer le geste. On enregistre, et le
    // bandeau du haut rend le nom gardé — celui de la carte qui restait.
    await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    expect(await untilTwin(page)).toBe(true);

    const nom = await page.getByTestId('clone-card').locator('code').innerText();
    await page.getByRole('button', { name: 'Enregistrer le clonage' }).click();
    await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 20_000 });

    await expect(page.getByTestId('clone-refusal')).toHaveCount(0);
    await expect(page.getByTestId('clone-previous')).toContainText(nom);
  });
});
