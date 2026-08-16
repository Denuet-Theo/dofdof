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
    await expect(page.getByTestId('clone-card')).toHaveCount(2);
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

  test('aucune paire sans ascendance des deux côtés n’est proposée', async ({ page }) => {
    // Un clonage entre deux stériles sans ascendance rend une gen 1 nue :
    // exactement ce qui s'achète au filet pour trois fois rien. Le calcul y
    // voyait un gain, l'éleveur y voyait vingt allers-retours en jeu.
    await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    // Le compteur d'anonymes a disparu avec elles.
    await expect(page.getByTestId('clone-anonymous-note')).toHaveCount(0);

    // Et chaque paire encore proposée porte au moins un nom — c'est-à-dire au
    // moins une ascendance, puisque l'un ne va pas sans l'autre.
    const cartes = page.getByTestId('clone-card');
    if ((await cartes.count()) > 0) {
      expect(await cartes.getByTestId('copyable').count()).toBeGreaterThan(0);
    }
  });

  test('on ne peut pas garder la monture qui porte le moins', async ({ page }) => {
    // Deux gen 1 appariables peuvent porter l'une un 1, l'autre un 2 : garder
    // celle qui porte le 1 détruit le 2, définitivement.
    await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    const avertissement = page.getByTestId('clone-would-destroy');
    const titre = page.getByRole('heading', { name: /^Clonage \d+ \/ \d+$/ });

    // On avance jusqu'à une paire dépareillée — elles existent sur cette écurie.
    for (let pas = 0; pas < 12 && (await avertissement.count()) === 0; pas += 1) {
      const passer = page.getByTestId('clone-skip');
      if ((await passer.count()) === 0) break;
      await passer.click();
      await expect(titre).toBeVisible();
    }
    expect(await avertissement.count()).toBe(1);

    // Un seul des deux boutons reste cliquable : celui qui garde la plus haute.
    const boutons = page.getByRole('button', { name: /Garder celle-ci|Perdrait la gén/ });
    await expect(boutons).toHaveCount(2);
    await expect(boutons.filter({ hasText: 'Garder celle-ci' })).toBeEnabled();
    await expect(boutons.filter({ hasText: 'Perdrait la gén' })).toBeDisabled();
  });

  test('sur tout le lot, jamais la génération basse n’est cliquable', async ({ page }) => {
    /**
     * L'invariant sur la fournée entière, et non sur la première paire.
     *
     * Le test précédent en vérifie une. Celle-là est la plus facile : c'est la
     * quinzième qu'on clique sans regarder, après vingt allers-retours en jeu.
     * On parcourt donc **tous** les arbitrages du lot, et pour chacun on relit
     * les deux générations portées telles que les cartes les annoncent — puis on
     * vérifie que le bouton du côté le plus bas est mort.
     *
     * Ce qu'on ne peut pas tester ici, et il vaut mieux le dire : forcer le clic
     * sur le bouton désactivé. React décide d'appeler `onClick` d'après ses
     * **props**, pas d'après le DOM, donc retirer l'attribut `disabled` dans la
     * page ne réveille pas le gestionnaire — mesuré, le clic ne part pas. Le
     * garde posé dans `recordClonings` n'est donc pas atteignable depuis cette
     * fenêtre : il couvre les appelants suivants, pas celui-ci.
     */
    const supabase = await mockSupabase(page);
    nameEverySterile(supabase);
    await openBreeding(page);
    await openCloning(page);

    const titre = page.getByRole('heading', { name: /^Clonage \d+ \/ \d+$/ });
    let dépareillées = 0;

    for (let pas = 0; pas < 15; pas += 1) {
      const passer = page.getByTestId('clone-skip');
      if ((await passer.count()) === 0) break;

      const avertissement = page.getByTestId('clone-would-destroy');
      if ((await avertissement.count()) > 0) {
        dépareillées += 1;

        // Ce que la carte annonce : « porte une gén. X face à une gén. Y ».
        const texte = await avertissement.innerText();
        const [portee, face] = [...texte.matchAll(/gén\.\s*(\d+)/g)].map((m) => Number(m[1]));
        expect(portee).toBeLessThan(face);

        // Un seul bouton vivant, et c'est celui qui garde la plus haute.
        const perdant = page.getByRole('button', { name: /Perdrait la gén/ });
        const gardant = page.getByRole('button', { name: 'Garder celle-ci' });
        await expect(perdant).toHaveCount(1);
        await expect(perdant).toBeDisabled();
        await expect(perdant).toHaveText(`Perdrait la gén. ${face}`);
        await expect(gardant).toHaveCount(1);
        await expect(gardant).toBeEnabled();
      }

      await passer.click();
      if ((await titre.count()) === 0) break;
    }

    // Sans une seule paire dépareillée, le test ne prouverait rien.
    expect(dépareillées).toBeGreaterThan(0);
    // Passer n'écrit rien : le lot entier a défilé sans toucher à l'écurie.
    expect(supabase.writes.filter((write) => write.table === individus)).toHaveLength(0);
  });

  test('le garde ne bloque aucun clonage légitime, sur tout le lot', async ({ page }) => {
    /**
     * L'autre moitié de l'invariant, et elle compte autant.
     *
     * Un garde posé au point d'écriture peut refuser trop : il suffirait qu'il
     * lise l'ascendance autrement que la fenêtre pour bloquer des clonages
     * parfaitement bons, et l'éleveur se retrouverait devant un écran qui dit
     * non à tout. On tranche donc **tout le lot** par le bouton que la fenêtre
     * laisse cliquable, et pas un refus ne doit apparaître.
     *
     * Sur tout le lot et non sur un clic : la fournée se recalcule à chaque
     * écriture — deux stériles en moins, les paires suivantes se reforment — et
     * c'est au quinzième clic qu'un désaccord entre la fenêtre et le garde
     * apparaîtrait, pas au premier.
     */
    const supabase = await mockSupabase(page);
    nameEverySterile(supabase);
    await openBreeding(page);
    await openCloning(page);

    const avant = supabase.rows(individus).length;
    let tranches = 0;

    for (let pas = 0; pas < 15; pas += 1) {
      const garder = page.getByRole('button', { name: 'Garder celle-ci' });
      if ((await garder.count()) === 0) break;
      await garder.first().click();
      await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 20_000 });
      tranches += 1;
      // Le refus est vérifié à **chaque** tour, pas seulement à la fin : sinon
      // un refus au troisième clic passerait pour un lot plus court.
      await expect(page.getByTestId('clone-refusal')).toHaveCount(0);
    }

    expect(tranches).toBeGreaterThan(1);
    // Un clone écrit par arbitrage tranché, deux stériles retirées à chaque fois.
    expect(supabase.rows(individus)).toHaveLength(avant + tranches - 2 * tranches);
  });

  test('« Passer » écarte un arbitrage sans rien écrire', async ({ page }) => {
    // Le lot est figé à l'ouverture, le jeu ne l'est pas : une paire proposée
    // peut ne plus exister. Sans sortie, l'écran restait planté dessus et le
    // seul geste possible était de la déclarer faite — donc d'écrire en base un
    // clonage qui n'a pas eu lieu.
    const supabase = await mockSupabase(page);
    nameEverySterile(supabase);
    await openBreeding(page);
    await openCloning(page);

    const titre = page.getByRole('heading', { name: /^Clonage \d+ \/ \d+$/ });
    const avant = await titre.innerText();
    const cartes = await page.getByTestId('clone-card').allInnerTexts();
    const lignes = supabase.rows(individus).length;

    await page.getByTestId('clone-skip').click();

    // On passe au suivant : d'autres montures, et rien de plus en base.
    await expect(page.getByTestId('clone-card').first()).not.toHaveText(cartes[0]);
    expect(supabase.rows(individus)).toHaveLength(lignes);
    expect(supabase.writes).toHaveLength(0);

    // Et l'écarté ne se compte pas comme enregistré.
    await expect(titre).not.toHaveText(avant);
    await expect(page.getByText(/0 \/ \d+ enregistré/)).toBeVisible();
    await expect(page.getByText(/1 passé/)).toBeVisible();
  });

  test('un clonage refusé ne quitte pas le lot', async ({ page }) => {
    // La règle de toute la maison : ce que l'écran retire du lot est ce que la
    // base a pris. Un refus laisse le clonage à faire, et le dit.
    const supabase = await mockSupabase(page);
    nameEverySterile(supabase);
    await openBreeding(page);
    await openCloning(page);

    const titre = page.getByRole('heading', { name: /^Clonage \d+ \/ \d+$/ });
    const avant = await titre.innerText();
    const lignes = supabase.rows(individus).length;

    supabase.refuse({ table: individus, method: 'POST' });
    await page.getByRole('button', { name: 'Garder celle-ci' }).first().click();

    await expect(page.getByTestId('clone-refusal')).toBeVisible();
    await expect(page.locator('[role="alert"]').filter({ hasText: 'Pas enregistré' })).toBeVisible();
    expect(supabase.rows(individus)).toHaveLength(lignes);
    // Et le clonage est toujours celui qu'on avait sous les yeux.
    await expect(titre).toHaveText(avant);
  });
});
