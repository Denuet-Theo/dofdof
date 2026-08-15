import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Le clonage : deux stériles entrent, une seule sort, et c'est l'éleveur qui
 * choisit laquelle.
 *
 * Un choix ne vaut que si les deux termes se distinguent. Sur l'écurie réelle,
 * les paires proposées sont très souvent deux gen 1 **anonymes de même couleur
 * et sans ascendance** — le fond du parc, acheté par dizaines. Elles ne se
 * départagent pas, et elles ne se déroulent donc plus une par une : elles se
 * comptent en tête, avec le rappel de ne pas les oublier en jeu.
 *
 * Restent celles où il y a quelque chose à trancher. Là, tout ce qui distingue
 * les deux montures doit être à l'écran — le sexe compris, que cette fenêtre
 * était seule à taire.
 */

const individus = 'user_breeding_individuals';

/**
 * Nomme toutes les stériles avant le chargement.
 *
 * Sans ça la fixture ne propose que des paires anonymes, donc aucun arbitrage,
 * donc aucune carte à vérifier. Nommer est plus honnête que de faire défiler la
 * liste jusqu'à tomber sur une paire nommée : le test dépendrait alors d'un
 * ordre de tri qui n'a rien à voir avec ce qu'il vérifie.
 */
const nameEverySterile = (supabase: SupabaseMock) => {
  let numero = 0;
  for (const mount of supabase.rows(individus)) {
    if (mount.fertile === false && !mount.name) mount.name = `G1 ZZ M AA-BB ${++numero}`;
  }
};

const openCloning = async (page: Page) => {
  await page.getByRole('button', { name: 'Clonage' }).click();
  const open = page.getByRole('button', { name: /clonages? à faire/ });
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
};

test.describe('clonage', () => {
  test('les paires anonymes sont comptées, pas déroulées', async ({ page }) => {
    // Elles n'ont ni nom, ni ascendance, ni rien qui les sépare : « laquelle
    // gardes-tu » n'a pas de réponse. Vingt écrans demandaient de choisir entre
    // une chose et elle-même.
    await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    const note = page.getByTestId('clone-anonymous-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText(/\d+ clonages? entre anonymes/);
    // Le rappel, qui est tout ce qu'on lui demande de dire.
    await expect(note).toContainText('oublie');
  });

  test('chaque monture à départager porte son sexe', async ({ page }) => {
    const supabase = await mockSupabase(page);
    nameEverySterile(supabase);
    await openBreeding(page);
    await openCloning(page);

    await expect(page.getByRole('heading', { name: /^Clonage \d+ \/ \d+$/ })).toBeVisible();

    // Deux cartes, deux sexes lisibles. Sans eux, deux montures de même couleur
    // sont deux blocs identiques et le choix ne se reporte pas en jeu.
    const sexes = page.getByTestId('clone-sex');
    await expect(sexes).toHaveCount(2);
    for (const glyphe of await sexes.allInnerTexts()) expect(['♂', '♀']).toContain(glyphe);
  });

  test('les deux cartes ne sont jamais identiques', async ({ page }) => {
    const supabase = await mockSupabase(page);
    nameEverySterile(supabase);
    await openBreeding(page);
    await openCloning(page);

    await expect(page.getByTestId('clone-card')).toHaveCount(2);
    const [gauche, droite] = await page.getByTestId('clone-card').allInnerTexts();
    expect(gauche).not.toBe(droite);
  });

  test('cliquer le texte d’une carte ne tranche rien', async ({ page }) => {
    // La plainte d'origine : toute la carte était un bouton, donc viser le nom
    // pour l'attraper à la souris choisissait cette monture-là.
    const supabase = await mockSupabase(page);
    nameEverySterile(supabase);
    await openBreeding(page);
    await openCloning(page);

    const titre = page.getByRole('heading', { name: /^Clonage \d+ \/ \d+$/ });
    const avant = await titre.innerText();

    for (const cible of ['clone-sex', 'clone-card']) {
      await page.getByTestId(cible).first().click({ position: { x: 5, y: 5 } });
    }
    await expect(titre).toHaveText(avant);
    await expect(page.getByRole('button', { name: 'Garder celle-ci' })).toHaveCount(2);
  });

  test('le nom se copie sans trancher le clonage', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://localhost:3100',
    });
    const supabase = await mockSupabase(page);
    nameEverySterile(supabase);
    await openBreeding(page);
    await openCloning(page);

    const titre = page.getByRole('heading', { name: /^Clonage \d+ \/ \d+$/ });
    const copie = page.getByTestId('clone-card').getByTestId('copyable');
    await expect(copie).toHaveCount(2);

    const avant = await titre.innerText();
    const attendu = await copie.first().locator('code').innerText();
    await copie.first().click();

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(attendu);
    await expect(titre).toHaveText(avant);
  });

  test('« Fait » retire un clonage anonyme du lot, et l’écrit', async ({ page }) => {
    // C'est la moitié qui compte : les sortir de l'arbitrage ne doit pas les
    // sortir de la base. Sans ça l'écurie garderait des stériles que le jeu n'a
    // plus, et le compte repartirait de travers — 203 contre 225.
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    const note = page.getByTestId('clone-anonymous-note');
    const compte = async () =>
      Number((await note.innerText()).match(/(\d+) clonages? entre anonymes/)![1]);

    const avant = await compte();
    expect(avant).toBeGreaterThan(1);
    const lignes = supabase.rows(individus).length;

    await note.getByRole('button', { name: /^Fait/ }).click();

    // Un clonage consomme deux stériles et rend une fertile : le solde est −1.
    await expect.poll(() => supabase.rows(individus).length).toBe(lignes - 1);
    await expect.poll(compte).toBe(avant - 1);

    // Et il n'y revient pas : le lot restant est ce qui reste à faire en jeu.
    await note.getByRole('button', { name: /^Fait/ }).click();
    await expect.poll(compte).toBe(avant - 2);
    await expect.poll(() => supabase.rows(individus).length).toBe(lignes - 2);
  });

  test('un clonage refusé ne quitte pas le lot', async ({ page }) => {
    // La règle de toute la maison : ce que l'écran retire du lot est ce que la
    // base a pris. Un refus laisse le clonage à faire, et le dit.
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    const note = page.getByTestId('clone-anonymous-note');
    const avant = Number((await note.innerText()).match(/(\d+) clonages? entre anonymes/)![1]);
    const lignes = supabase.rows(individus).length;

    supabase.refuse({ table: individus, method: 'POST' });
    await note.getByRole('button', { name: /^Fait/ }).click();

    await expect(page.getByTestId('clone-refusal')).toBeVisible();
    await expect(page.locator('[role="alert"]').filter({ hasText: 'Pas enregistré' })).toBeVisible();
    expect(supabase.rows(individus)).toHaveLength(lignes);
    expect(Number((await note.innerText()).match(/(\d+) clonages? entre anonymes/)![1])).toBe(avant);
  });
});
