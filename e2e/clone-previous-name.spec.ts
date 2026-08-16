import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Le nom qu'on vient de garder reste lisible, et copiable.
 *
 * ## Le défaut
 *
 * La fenêtre demande de désigner la survivante, puis passe au clonage suivant —
 * emportant le seul renseignement dont l'éleveur a besoin **juste après** avoir
 * cliqué : le nom à chercher dans l'écurie du jeu. Relevé tel quel : « je viens
 * de cliquer sur mon choix sans avoir copié le nom, et je ne peux plus le
 * voir ».
 *
 * Un récapitulatif existait, mais en **bout de lot** : sur une fournée de douze
 * il fallait trancher ou passer les onze suivants pour l'atteindre, et refermer
 * la fenêtre l'emportait — `done` est un état de composant, remis à zéro à la
 * fermeture.
 *
 * ## Pourquoi deux clics et pas un
 *
 * Un bandeau qui n'afficherait que le **premier** choix passerait un test à un
 * clic. Ce qu'on vérifie est qu'il suit : au second clic il doit porter la
 * seconde monture, pas la première.
 */

const openCloning = async (page: Page) => {
  await page.getByRole('button', { name: 'Clonage' }).click();
  const open = page.getByRole('button', { name: /clonages? à faire/ });
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
};

/**
 * Tranche un côté et rend le nom de la monture désignée.
 *
 * `side` est un souhait et non une exigence : une paire indiscernable n'a
 * qu'une carte et qu'un bouton — voir `clone-twin` — et exiger deux côtés ferait
 * échouer le test sur un écran qui a raison.
 */
const keepOne = async (page: Page, side: number): Promise<string> => {
  const cartes = page.getByTestId('clone-card');
  await expect(cartes.first()).toBeVisible();
  const index = Math.min(side, (await cartes.count()) - 1);
  const nom = await cartes.nth(index).locator('code').innerText();

  const boutons = page.getByRole('button', { name: /C’est celle-ci qui est sortie|Enregistrer le clonage/ });
  await boutons.nth(Math.min(index, (await boutons.count()) - 1)).click();
  await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('clone-refusal')).toHaveCount(0);
  return nom;
};

test.describe('clonage — la monture précédente', () => {
  test('le nom gardé s’affiche en haut, copiable, et suit les clics', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://localhost:3100',
    });
    await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    // --- premier choix ------------------------------------------------------
    const premier = await keepOne(page, 0);

    const bandeau = page.getByTestId('clone-previous');
    await expect(bandeau).toBeVisible();
    await expect(bandeau).toContainText(premier);

    // Copiable, et sans trancher quoi que ce soit : c'est tout l'objet.
    const titre = page.getByRole('heading', { name: /^Clonage \d+ \/ \d+$/ });
    const avant = await titre.innerText();
    await bandeau.getByTestId('copyable').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(premier);
    await expect(titre).toHaveText(avant);

    // --- second choix, l'autre côté ----------------------------------------
    // Le bandeau doit suivre. Un bandeau figé sur le premier nom passerait un
    // test à un clic, et serait faux dès le deuxième — c'est-à-dire toujours.
    const second = await keepOne(page, 1);

    await expect(bandeau).toContainText(second);
    await expect(bandeau).not.toContainText(premier);
  });

  test('le récapitulatif de fin nomme les montures, il ne dit pas « Anonyme »', async ({
    page,
  }) => {
    /**
     * Le second défaut, de la même famille et plus ancien que le premier.
     *
     * L'écran de fin annonce « les noms à chercher dans l'écurie du jeu » puis
     * les relisait par `byId.get(id)`. Or `recordClonings` **insère le clone**
     * sous un identifiant neuf et **supprime les deux originales** : au retour
     * de l'écriture, l'identifiant gardé ne désigne plus rien, le `get` rend
     * `undefined`, et le repli affichait `Anonyme`. La seule chose que cet écran
     * doive rendre, il la perdait toute entière.
     *
     * Aucune anonyme n'entre plus dans un clonage, donc pas une seule mention ne
     * doit rester ici. Et on tranche **tout le lot**, pas un clic : c'est en le
     * finissant qu'on atteint le récapitulatif.
     */
    await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    let tranches = 0;
    for (let pas = 0; pas < 40; pas += 1) {
      const garder = page.getByRole('button', {
        name: /C’est celle-ci qui est sortie|Enregistrer le clonage/,
      });
      const cotes = await garder.count();
      if (cotes === 0) break;
      // Les deux côtés à tour de rôle quand il y en a deux — une paire
      // indiscernable n'en a qu'un, et c'est le bon nombre.
      await garder.nth(pas % cotes).click();
      await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByTestId('clone-refusal')).toHaveCount(0);
      tranches += 1;
    }
    expect(tranches).toBeGreaterThan(1);

    const recap = page.getByText('Les noms à chercher dans l’écurie du jeu');
    await expect(recap).toBeVisible();

    const fenetre = page.getByRole('dialog');
    await expect(fenetre).not.toContainText('Anonyme');
    // Autant de noms copiables que de clonages tranchés — un par clone à
    // retrouver, et le compte est ce qui distingue « ça affiche quelque chose »
    // de « ça affiche tout ».
    expect(await fenetre.getByTestId('copyable').count()).toBeGreaterThanOrEqual(tranches);
  });

  test('rien ne s’affiche tant qu’aucun choix n’est fait', async ({ page }) => {
    // Le pendant : un bandeau « monture précédente » sans monture précédente
    // dirait d'aller chercher quelque chose qui n'existe pas.
    await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    await expect(page.getByRole('heading', { name: /^Clonage 1 \/ \d+$/ })).toBeVisible();
    await expect(page.getByTestId('clone-previous')).toHaveCount(0);
  });
});
