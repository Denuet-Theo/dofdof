import { expect, test } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Le clonage : deux stériles entrent, une seule sort, et c'est l'éleveur qui
 * choisit laquelle.
 *
 * Un choix ne vaut que si les deux termes se distinguent. Sur l'écurie réelle,
 * les deux montures proposées sont très souvent deux gen 1 **anonymes de même
 * couleur et sans ascendance** — c'est le fond du parc, acheté par dizaines.
 * La fenêtre affichait alors deux cartes rigoureusement identiques : même
 * vignette, même « Doré », même « sans ascendance connue », même « Anonyme ».
 *
 * Il restait le sexe, que la fenêtre était seule à ne pas afficher — et c'est
 * précisément le seul tri disponible en jeu devant un tas d'Anonymes.
 */

test.describe('clonage', () => {
  test('chaque monture à départager porte son sexe', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);

    await page.getByRole('button', { name: 'Clonage' }).click();
    const open = page.getByRole('button', { name: /clonages? à faire/ });
    await expect(open).toBeVisible({ timeout: 30_000 });
    await open.click();

    await expect(page.getByRole('heading', { name: /^Clonage \d+ \/ \d+$/ })).toBeVisible();

    // Deux cartes, deux sexes lisibles. Sans eux, deux anonymes de même couleur
    // sont deux boutons identiques et le choix ne se reporte pas en jeu.
    const sexes = page.getByTestId('clone-sex');
    await expect(sexes).toHaveCount(2);
    for (const glyphe of await sexes.allInnerTexts()) expect(['♂', '♀']).toContain(glyphe);
  });

  test('deux anonymes de même couleur restent distinguables', async ({ page }) => {
    // Le cas qui a motivé le correctif : tout est identique **sauf** le sexe.
    await mockSupabase(page);
    await openBreeding(page);

    await page.getByRole('button', { name: 'Clonage' }).click();
    const open = page.getByRole('button', { name: /clonages? à faire/ });
    await expect(open).toBeVisible({ timeout: 30_000 });
    await open.click();

    const cartes = page.getByTestId('clone-sex');
    await expect(cartes).toHaveCount(2);

    // Le texte entier des deux cartes ne doit jamais être le même : c'est la
    // propriété que l'écran doit garantir, quelle que soit la paire proposée.
    const [gauche, droite] = await page.getByTestId('clone-card').allInnerTexts();
    expect(gauche).not.toBe(droite);
  });

  test('cliquer le texte d’une carte ne tranche rien', async ({ page }) => {
    // La plainte d'origine : toute la carte était un bouton, donc viser le nom
    // pour l'attraper à la souris choisissait cette monture-là. Le choix a
    // maintenant son propre bouton, et le reste de la carte se lit.
    await mockSupabase(page);
    await openBreeding(page);

    await page.getByRole('button', { name: 'Clonage' }).click();
    const open = page.getByRole('button', { name: /clonages? à faire/ });
    await expect(open).toBeVisible({ timeout: 30_000 });
    await open.click();

    const titre = page.getByRole('heading', { name: /^Clonage \d+ \/ \d+$/ });
    const avant = await titre.innerText();

    // Le nom de couleur, la généalogie, la vignette : rien de tout ça ne décide.
    for (const cible of ['clone-sex', 'clone-card']) {
      await page.getByTestId(cible).first().click({ position: { x: 5, y: 5 } });
    }
    await expect(titre).toHaveText(avant);
    await expect(page.getByRole('button', { name: 'Garder celle-ci' })).toHaveCount(2);
  });

  test('le nom se copie sans trancher le clonage', async ({ page, context }) => {
    // Le geste qui manquait : toute la carte était un bouton, donc attraper le
    // nom pour le recopier en jeu revenait à choisir cette monture-là.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://localhost:3100',
    });
    const supabase = await mockSupabase(page);

    // On nomme toutes les stériles avant de charger la page, plutôt que de
    // chercher une paire nommée dans ce que la politique propose : elle apparie
    // d'abord le fond du parc, anonyme, et les vingt premiers clonages n'en
    // contiennent aucune. Chercher plus loin rendrait le test dépendant d'un
    // ordre de tri qui n'a rien à voir avec ce qu'il vérifie.
    let numero = 0;
    for (const mount of supabase.rows('user_breeding_individuals')) {
      if (mount.fertile === false && !mount.name) mount.name = `G1 ZZ M AA-BB ${++numero}`;
    }

    await openBreeding(page);

    await page.getByRole('button', { name: 'Clonage' }).click();
    const open = page.getByRole('button', { name: /clonages? à faire/ });
    await expect(open).toBeVisible({ timeout: 30_000 });
    await open.click();

    const titre = page.getByRole('heading', { name: /^Clonage \d+ \/ \d+$/ });
    const copie = page.getByTestId('clone-card').getByTestId('copyable');

    // On avance jusqu'à une paire **nommée** : une anonyme n'a pas de nom à
    // copier, par définition, et sauter le test faute d'en trouver une ne
    // prouverait rien. Vingt clonages sont proposés ; les premiers sont le fond
    // du parc, anonyme, et les nommés viennent ensuite.
    // Toutes les stériles portent un nom : les deux cartes en ont donc un à
    // copier, quelle que soit la paire proposée.
    await expect(copie).toHaveCount(2);

    const avant = await titre.innerText();
    const attendu = await copie.first().locator('code').innerText();
    await copie.first().click();

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(attendu);
    // Et le clonage n'a pas avancé d'un cran.
    await expect(titre).toHaveText(avant);
  });
});
