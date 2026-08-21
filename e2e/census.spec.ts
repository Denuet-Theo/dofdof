import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Le rapprochement avec le jeu : une question, des chiffres à confronter.
 *
 * ## Ce que ce fichier surveille, et pourquoi ça ne se voit pas ailleurs
 *
 * L'outil pose une question par écran et annonce « les chiffres **en jaune**
 * ci-dessous ». Toute la conversation tient sur ce contrat : la barre demande,
 * le panneau montre. `check-reconcile.mjs` mesure le **nombre** de questions et
 * ne peut rien dire de ce qui s'affiche ; `tsc` non plus.
 *
 * Il a été rompu dès la première question. Le total ne se lit sur aucune ligne à
 * cocher — c'est le nombre que l'écurie affiche à l'ouverture, sans un filtre
 * posé — et la teinture ne visait que les lignes de facette. L'écran demandait
 * donc de comparer un chiffre jaune qu'il ne montrait nulle part, et le KO
 * n'ouvrait aucun champ où le corriger.
 *
 * D'où deux tests, et deux seulement :
 *
 * - **l'invariant** — chaque question montre au moins un chiffre en jaune ;
 * - **le chemin du KO sur le total** — la case est dans le panneau, sur la ligne
 *   du Type, et ce qu'on y tape ressort à la fin.
 */

const openStocks = async (page: Page) => {
  const bouton = page.getByRole('button', { name: /montures ·/ });
  await expect(bouton).toBeVisible({ timeout: 30_000 });
  await bouton.click();
};

/** Les lignes dont l'effectif est demandé — les jaunes. */
const asked = (page: Page): Locator =>
  page.locator('[data-testid="filter-row"][data-tone="asked"]');

/** Combien de questions ont déjà été répondues, lu sur la barre. */
const answered = (page: Page, count: number) =>
  expect(page.getByTestId('census-bar')).toHaveAttribute('data-asked', String(count));

/**
 * L'effectif que l'app affiche sur une ligne.
 *
 * Le **dernier** nombre du libellé : « Génération 10 » en porte un qui n'est pas
 * un compte.
 */
const heldOn = async (row: Locator): Promise<number> => {
  const found = (await row.innerText()).match(/\d+/g);
  expect(found).not.toBeNull();
  return Number(found![found!.length - 1]);
};

const start = async (page: Page) => {
  await mockSupabase(page);
  await openBreeding(page);
  await openStocks(page);
  await page.getByTestId('census-start').click();
};

test.describe('comparer avec le jeu', () => {
  test('chaque question montre au moins un chiffre en jaune', async ({ page }) => {
    await start(page);

    const ok = page.getByTestId('census-ok');
    // Le plafond de `check-reconcile.mjs` : au-delà, l'outil ne tient plus sa
    // promesse et la boucle doit s'arrêter bruyamment plutôt que tourner.
    for (let question = 0; question < 12; question += 1) {
      if ((await ok.count()) === 0) break;
      await answered(page, question);
      // Le contrat, tel que la barre l'énonce. Sur la première question il n'y
      // avait rien à voir : zéro ligne teintée, et une consigne qui parlait de
      // chiffres jaunes.
      await expect(asked(page)).not.toHaveCount(0);
      await ok.click();
    }

    // L'écurie de la fixture est celle que l'app tient : répondre « pareil »
    // partout doit la déclarer saine, et en cinq questions — le total et les
    // quatre marges.
    await expect(page.getByTestId('census-bar')).toContainText('colle au jeu');
    await answered(page, 5);
    await expect(page.getByTestId('census-pinned')).toHaveCount(0);
  });

  test('le total se corrige sur la ligne du Type, et l’écart ressort', async ({ page }) => {
    await start(page);

    // Une seule ligne en jaune, et c'est celle du Type : le total n'a pas
    // d'autre endroit où se lire.
    const ligne = asked(page);
    await expect(ligne).toHaveCount(1);
    await expect(ligne).toContainText('Muldos');
    const total = await heldOn(ligne);
    expect(total).toBeGreaterThan(0);

    await page.getByTestId('census-ko').click();
    // La case vit dans le panneau, sur la ligne teintée — pas dans la barre, où
    // elle aurait été le seul champ du rapprochement à ne pas y être.
    const saisie = page.getByTestId('filter-seen');
    await expect(saisie).toHaveCount(1);
    await expect(ligne.getByTestId('filter-seen')).toHaveCount(1);
    await saisie.fill(String(total - 1));
    await page.getByTestId('census-submit').click();

    // Les quatre marges collent. Elles ne proposent plus « OK » : l'écart du
    // total est déclaré, et une colonne partitionne sa cellule, donc elles ne
    // peuvent pas toutes coller. On laisse les cases vides — ce qui vaut
    // « pareil » — et c'est justement la contradiction qui doit ressortir :
    // sans ça l'écran concluait « l'écurie colle au jeu » après avoir demandé,
    // pris et perdu le chiffre.
    for (const marge of [1, 2, 3, 4]) {
      await answered(page, marge);
      await expect(asked(page)).not.toHaveCount(0);
      await expect(page.getByTestId('census-ok')).toHaveCount(0);
      await page.getByTestId('census-submit').click();
    }

    const trouve = page.getByTestId('census-pinned');
    await expect(trouve).toHaveCount(1);
    await expect(trouve).toHaveAttribute('data-held', String(total));
    await expect(trouve).toHaveAttribute('data-seen', String(total - 1));
  });

  /**
   * Le cas rencontré en jeu : sous Fertile ⋅ Mâle, la fixture ne tient aucune
   * gen 10, le panneau affiche donc « Génération 10 — 0 », et le jeu en montre
   * une. La colonne n'énumérait que les valeurs **présentes dans la cellule** :
   * la ligne était là, en gris, sans case pour la corriger. Une monture que
   * l'app ignore entièrement était indéclarable, ce qui est exactement la
   * monture qu'on vient chercher.
   */
  test('une ligne que le croisement vide reste corrigeable', async ({ page }) => {
    await start(page);

    // Le total colle.
    await page.getByTestId('census-ok').click();

    // FERTILITÉ : un fertile de plus en jeu.
    await answered(page, 1);
    const fertile = asked(page).filter({ hasText: 'Fertile' });
    const fertiles = await heldOn(fertile);
    await page.getByTestId('census-ko').click();
    await fertile.getByTestId('filter-seen').fill(String(fertiles + 1));
    await page.getByTestId('census-submit').click();

    // SEXE, dans les fertiles. L'écart est déjà déclaré, donc plus de « OK » à
    // cliquer : les cases sont ouvertes et la barre dit ce qu'il reste à placer.
    await answered(page, 2);
    await expect(page.getByTestId('census-ok')).toHaveCount(0);
    await expect(page.getByTestId('census-left')).toHaveAttribute('data-left', '1');
    const males = asked(page).filter({ hasText: 'Monture mâle' });
    const male = await heldOn(males);
    await males.getByTestId('filter-seen').fill(String(male + 1));
    await expect(page.getByTestId('census-left')).toHaveAttribute('data-left', '0');
    await page.getByTestId('census-submit').click();

    // GÉNÉRATION, dans les fertiles mâles : la fixture n'en tient aucune en
    // gen 10, et c'est là que la monture manquante se déclare.
    await answered(page, 3);
    const gen10 = asked(page).filter({ hasText: 'Génération 10' });
    await expect(gen10).toHaveCount(1);
    expect(await heldOn(gen10)).toBe(0);
    await gen10.getByTestId('filter-seen').fill('1');
    await page.getByTestId('census-submit').click();

    // Le reste de l'écurie colle : on finit le balayage des marges.
    for (let question = 4; question < 12; question += 1) {
      if ((await page.getByTestId('census-ok').count()) === 0) break;
      await page.getByTestId('census-ok').click();
    }

    const trouve = page.getByTestId('census-pinned');
    await expect(trouve).toHaveCount(1);
    await expect(trouve).toContainText('Génération 10');
    await expect(trouve).toHaveAttribute('data-held', '0');
    await expect(trouve).toHaveAttribute('data-seen', '1');
    // Rien à ouvrir : la liste filtrée serait vide, il n'y a que des montures à
    // saisir.
    await expect(trouve.getByTestId('census-focus')).toHaveCount(0);
    await expect(trouve).toContainText('à ajouter');
  });
});
