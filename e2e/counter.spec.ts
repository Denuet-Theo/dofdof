import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { failureBanner } from './support/app';

/**
 * La grille de compteurs, et surtout : ce qu'elle fait quand la base refuse.
 *
 * Un compteur est de l'état purement local en apparence — un nombre qui monte
 * quand on clique — et c'est exactement la forme qu'avait la saisie de
 * naissance le 15 août : l'écran part devant, l'écriture suit, et si elle
 * n'arrive pas, rien à l'écran ne le dit. Le comptage est ici toute la valeur de
 * la page : un total qui n'est pas en base est perdu au prochain rechargement,
 * et l'éleveur ne le découvre qu'après avoir tué quarante bestioles.
 *
 * D'où les trois refus joués ci-dessous — un total refusé, une pose refusée, une
 * suppression refusée — plutôt qu'un parcours nominal qui serait vert quoi qu'il
 * arrive.
 *
 * Et un quatrième cas qui n'est pas un refus mais une perte tout aussi
 * définitive : le ❌ voisine le 🔙, et un compteur supprimé emporte son total.
 * Un seul clic ne doit donc rien supprimer.
 */

/**
 * Ce que la recherche rend, quel que soit le terme.
 *
 * Le miroir de catalogue vit dans une base que les tests n'ont pas : la route
 * est donc simulée, comme le reste de `/api/dofusdb/**` l'est déjà par
 * `mockSupabase`. Les trois catégories sont présentes parce que le choix entre
 * elles fait partie de ce qu'on teste.
 */
const TARGETS = {
  items: [{ kind: 'item', id: 289, name: 'Peau de Bouftou', img: '', hint: 'Ressource' }],
  monsters: [{ kind: 'monster', id: 31, name: 'Bouftou', img: '', hint: 'Niveaux 4 à 8' }],
  races: [{ kind: 'race', id: 12, name: 'Bouftous', img: '', hint: '8 ennemis' }],
};

const openCounter = async (page: Page) => {
  // Enregistrée après `mockSupabase`, donc prioritaire sur son `/api/dofusdb/**`.
  await page.route('**/api/dofusdb/counter-targets**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TARGETS) })
  );
  await page.goto('/counter');
  await expect(page.getByTestId('counter-cell')).toHaveCount(12, { timeout: 30_000 });
};

const cell = (page: Page, slot = 0) =>
  page.locator(`[data-testid="counter-cell"][data-slot="${slot}"]`);

const tallyOf = (page: Page, slot = 0) => cell(page, slot).getByTestId('counter-tally');

/** Cherche puis pose une cible sur une case vide. */
const place = async (page: Page, name: string, slot = 0) => {
  await cell(page, slot).getByTestId('counter-search').fill('bouftou');
  await page.locator(`[data-testid="counter-result"][data-name="${name}"]`).click();
  await expect(cell(page, slot)).toHaveAttribute('data-label', name);
};

/**
 * Clique l'icône `times` fois.
 *
 * Jamais une seule : l'écriture d'un total est différée pour ne pas partir à
 * chaque clic, et c'est précisément entre le premier et le deuxième clic que
 * cette temporisation peut perdre quelque chose.
 */
const bump = async (page: Page, times: number, slot = 0) => {
  for (let index = 0; index < times; index += 1) {
    await cell(page, slot).getByTestId('counter-bump').click();
  }
};

/**
 * Supprime une case : le ❌ arme, le « Oui » tranche.
 *
 * Les deux clics sont dans le geste parce qu'ils sont dans l'écran — un
 * compteur ne part qu'après confirmation, et un test qui n'en ferait qu'un ne
 * supprimerait rien.
 */
const removeCounter = async (page: Page, slot = 0) => {
  await cell(page, slot).getByTestId('counter-remove').click();
  await cell(page, slot).getByTestId('counter-remove-confirm').click();
};

/** Le total tel que la base le porte, pour la case demandée. */
const savedTally = (rows: Record<string, unknown>[], slot = 0) =>
  rows.find((row) => row.slot === slot)?.tally;

test.describe('les compteurs', () => {
  test('deux clics montent le total, et le total arrive en base', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openCounter(page);

    await place(page, 'Bouftou');
    await expect.poll(() => mock.rows('user_counters').length).toBe(1);

    await bump(page, 2);
    await expect(tallyOf(page)).toHaveText('2');
    await expect.poll(() => savedTally(mock.rows('user_counters'))).toBe(2);

    // Le rechargement est le seul juge : c'est lui qui a révélé les 22 poulains
    // manquants, et c'est lui qui dirait qu'un total n'était jamais parti.
    await page.reload();
    await expect(tallyOf(page)).toHaveText('2');
    await expect(cell(page)).toHaveAttribute('data-label', 'Bouftou');
  });

  test('un total refusé se voit, et n’est pas perdu pour autant', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openCounter(page);
    await place(page, 'Peau de Bouftou');

    mock.refuse({ table: 'user_counters', method: 'POST' });
    await bump(page, 2);

    await expect(failureBanner(page)).toBeVisible();
    await expect(cell(page).getByTestId('counter-unsaved')).toBeVisible();
    // Le comptage, lui, est juste : c'est son enregistrement qui a échoué. Le
    // rendre à zéro serait perdre ce qu'on vient de compter.
    await expect(tallyOf(page)).toHaveText('2');
    expect(savedTally(mock.rows('user_counters'))).toBe(0);

    // Et la marque s'efface dès qu'une écriture aboutit, sinon elle deviendrait
    // un décor qu'on cesse de lire.
    mock.allow();
    await bump(page, 1);
    await expect(cell(page).getByTestId('counter-unsaved')).toHaveCount(0);
    await expect.poll(() => savedTally(mock.rows('user_counters'))).toBe(3);
  });

  test('une pose refusée ne laisse pas de case fantôme', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openCounter(page);

    mock.refuse({ table: 'user_counters', method: 'POST' });
    await cell(page).getByTestId('counter-search').fill('bouftou');
    await page.locator('[data-testid="counter-result"][data-name="Bouftous"]').click();

    await expect(failureBanner(page)).toBeVisible();
    // La case redevient libre : un compteur absent de la base ne doit pas
    // s'afficher, sinon on compte dedans jusqu'au prochain rechargement.
    await expect(cell(page).getByTestId('counter-search')).toBeVisible();
    expect(mock.rows('user_counters')).toHaveLength(0);
  });

  test('🔙 retire un, ❌ vide la case — des deux côtés', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openCounter(page);
    await place(page, 'Bouftou');
    await bump(page, 2);
    await expect.poll(() => savedTally(mock.rows('user_counters'))).toBe(2);

    await cell(page).getByTestId('counter-back').click();
    await expect(tallyOf(page)).toHaveText('1');
    await expect.poll(() => savedTally(mock.rows('user_counters'))).toBe(1);

    await removeCounter(page);
    await expect(cell(page).getByTestId('counter-search')).toBeVisible();
    await expect.poll(() => mock.rows('user_counters').length).toBe(0);
  });

  test('un seul clic sur ❌ ne supprime rien', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openCounter(page);
    await place(page, 'Bouftou');
    await bump(page, 2);
    await expect.poll(() => savedTally(mock.rows('user_counters'))).toBe(2);

    await cell(page).getByTestId('counter-remove').click();

    // Rien n'est parti : la case est toujours là, son total aussi, et la base
    // n'a rien reçu. Un compteur à 200 est un après-midi de farm, et le ❌ est à
    // deux centimètres du 🔙.
    await expect(cell(page).getByTestId('counter-remove-confirm')).toBeVisible();
    await expect(cell(page)).toHaveAttribute('data-label', 'Bouftou');
    expect(mock.writes.filter((write) => write.method === 'DELETE')).toHaveLength(0);

    // « Non » referme la question et rend la bande à ce qu'elle était.
    await cell(page).getByTestId('counter-remove-cancel').click();
    await expect(cell(page).getByTestId('counter-back')).toBeVisible();
    expect(mock.rows('user_counters')).toHaveLength(1);

    // Et la question ne suit pas la case : une fois le compteur supprimé et un
    // autre posé au même endroit, la bande repart sur 🔙 et ❌.
    await removeCounter(page);
    await place(page, 'Peau de Bouftou');
    await expect(cell(page).getByTestId('counter-back')).toBeVisible();
    await expect(cell(page).getByTestId('counter-remove-confirm')).toHaveCount(0);
  });

  test('une suppression refusée rend la case', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openCounter(page);
    await place(page, 'Bouftou');
    await bump(page, 2);
    await expect.poll(() => savedTally(mock.rows('user_counters'))).toBe(2);

    mock.refuse({ table: 'user_counters', method: 'DELETE' });
    await removeCounter(page);

    await expect(failureBanner(page)).toBeVisible();
    // Le compteur existe encore en base : le faire disparaître de l'écran
    // laisserait une case libre par-dessus une ligne bien vivante, que la
    // première pose écraserait.
    await expect(cell(page)).toHaveAttribute('data-label', 'Bouftou');
    await expect(tallyOf(page)).toHaveText('2');
    expect(mock.rows('user_counters')).toHaveLength(1);
  });
});
