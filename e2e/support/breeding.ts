import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Les gestes de l'écran d'élevage, nommés une fois.
 *
 * Les sélecteurs passent par `data-testid` partout où c'est possible. Ce n'est
 * pas une préférence de style : cette suite existe pour surveiller un
 * **comportement** — ce qui part en base, dans quel ordre — et elle doit
 * survivre à la réécriture des libellés, qui est fréquente ici et sans rapport.
 */

/** Ouvre l'écran d'élevage et attend que l'écurie soit chargée. */
export const openBreeding = async (page: Page) => {
  await page.goto('/breeding');
  // Le compteur de stock est le premier signe que la lecture a abouti.
  await expect(page.getByRole('button', { name: /montures ·/ })).toBeVisible({ timeout: 30_000 });
};

/**
 * Ouvre « Ce qui est né » sur la fournée proposée.
 *
 * Le bouton ne s'affiche qu'avec un planning chargé — la fournée vit sous le
 * ruban — et la fixture en porte un, celui du 15/08.
 */
export const openBirthDialog = async (page: Page) => {
  const button = page.getByRole('button', { name: /reproductions? à faire/ });
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
  await expect(page.getByRole('heading', { name: 'Ce qui est né' })).toBeVisible();
};

export const panels = (page: Page): Locator => page.getByTestId('mating-panel');

/** `{ done, total }` lu sur l'en-tête d'un panneau. */
export const progressOf = async (panel: Locator): Promise<{ done: number; total: number }> => {
  const text = await panel.getByTestId('panel-progress').innerText();
  const [done, total] = text.match(/(\d+)\/(\d+)/)!.slice(1).map(Number);
  return { done, total };
};

/** Les noms dictés que ce panneau affiche comme nés. */
export const bornOn = async (panel: Locator): Promise<string[]> =>
  panel.getByTestId('birth-chip').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-mount-name') ?? '')
  );

/**
 * Saisit une naissance sur un panneau : première issue de la génération cible,
 * du sexe demandé.
 *
 * Attend le retour de l'écriture — les boutons se rouvrent quand elle est
 * revenue, et enchaîner sans attendre testerait l'anti-double-clic plutôt que
 * ce qu'on vise.
 */
export const recordBirthOn = async (panel: Locator, sex: '♂' | '♀' = '♂') => {
  const button = panel.locator('button').filter({ hasText: new RegExp(`^${sex}$`) }).first();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(panel.getByText('enregistrement…')).toHaveCount(0, { timeout: 20_000 });
};

/** La bannière d'écriture perdue, celle de `WriteFailureAlerts`. */
export const failureBanner = (page: Page): Locator =>
  page.locator('[role="alert"]').filter({ hasText: 'Pas enregistré' });
