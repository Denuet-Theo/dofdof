import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Le clonage : deux stériles entrent, une seule sort, et **c'est le jeu qui tire
 * laquelle**.
 *
 * Cette phrase est tout le sujet, et elle a été comprise à l'envers pendant
 * longtemps. Tant qu'on croyait que l'éleveur choisissait la survivante, la
 * protection contre la perte d'une lignée se posait sur l'écran — un bouton
 * désactivé, puis un refus au point d'écriture. Aucun des deux n'empêchait quoi
 * que ce soit : la paire dépareillée était toujours proposée, le clonage se
 * faisait en jeu, et le seul effet du garde était d'interdire d'**enregistrer**
 * un tirage défavorable, c'est-à-dire de faire mentir l'écurie le jour même où
 * elle perdait une génération.
 *
 * La règle est donc à l'appariement, et elle est sans exception : **on
 * n'apparie jamais deux ascendances de générations portées différentes**. Une
 * porteuse de gén. 3 face à une porteuse de gén. 1, c'est la gén. 3 perdue une
 * fois sur deux, et rien ne la rattrape.
 *
 * Deux listes la portent, produites indépendamment — `cloneOptions` pour ce que
 * l'écurie permet, `cloningsToRecord` pour ce que la recherche planifie — donc
 * deux specs, une par liste.
 *
 * Le reste tient à la lisibilité : sur l'écurie réelle les paires sont souvent
 * deux gen 1 anonymes de même couleur, et tout ce qui les distingue doit être à
 * l'écran — le sexe compris, que cette fenêtre était seule à taire.
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
/**
 * Toutes les stériles nommées, et **distinctement**.
 *
 * Ce fichier teste la carte de départage : deux montures, deux sexes, deux noms à
 * chercher dans l'écurie du jeu. Il lui faut donc une paire discernable.
 *
 * Le helper ne nommait que les anonymes et laissait les noms de la fixture, dont
 * certains sont portés par plusieurs montures d'ascendance identique. Depuis que
 * `cloneOptions` met les **doublons en tête** — ils se clonent cinq fois plus vite
 * en jeu, voir `indistinguishablePair` — la première paire du lot était l'une de
 * celles-là, affichée « × 2 » avec une seule carte. Les specs mesuraient alors le
 * rendu du doublon en croyant mesurer celui du départage.
 *
 * Les rendre toutes distinctes remet ces tests sur leur sujet. Le rendu « × 2 », lui,
 * a son fichier : `clone-twin-pair.spec.ts`.
 */
const nameEverySterile = (supabase: SupabaseMock) => {
  let numero = 0;
  for (const mount of supabase.rows(individus)) {
    if (mount.fertile === false) mount.name = `G1 ZZ M AA-BB ${++numero}`;
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

  test('aucune paire proposée à la saisie ne mêle deux générations portées', async ({
    page,
  }) => {
    /**
     * L'invariant du clonage, et il n'y en a pas d'autre qui compte.
     *
     * **Le jeu tire la survivante au hasard.** Apparier une porteuse de gén. 3
     * avec une porteuse de gén. 1 perd donc la gén. 3 une fois sur deux, et
     * aucun geste ne peut le rattraper une fois les deux montures engagées — ni
     * un bouton désactivé, ni un refus à la saisie, qui n'empêcheraient que
     * d'enregistrer ce que le jeu a déjà fait. La seule protection est de ne
     * **jamais proposer** la paire.
     *
     * On parcourt donc tout le lot, pas la première paire : c'est la quinzième
     * qu'on clique sans regarder.
     */
    await mockSupabase(page);
    await openBreeding(page);
    await openCloning(page);

    const titre = page.getByRole('heading', { name: /^Clonage \d+ \/ \d+$/ });
    let paires = 0;

    for (let pas = 0; pas < 20; pas += 1) {
      const paire = page.getByTestId('clone-pair');
      if ((await paire.count()) === 0) break;

      const porte = (await paire.getAttribute('data-carried'))!.split(',').map(Number);
      expect(porte).toHaveLength(2);
      expect(porte[0]).toBe(porte[1]);
      paires += 1;

      const passer = page.getByTestId('clone-skip');
      if ((await passer.count()) === 0) break;
      await passer.click();
      if ((await titre.count()) === 0) break;
    }

    // Sans une seule paire, le test ne prouverait rien.
    expect(paires).toBeGreaterThan(0);
  });

  test('aucun appariement conseillé ne mêle deux générations portées', async ({ page }) => {
    /**
     * La seconde liste, et elle compte autant.
     *
     * `cloneOptions` (« Ce que valent tes stériles ») et `cloningsToRecord` (la
     * fenêtre de saisie) sont produits **indépendamment** : la première décrit ce
     * que l'écurie permet, la seconde ce que la recherche planifie. Corriger
     * l'une sans l'autre laisse l'éleveur suivre un conseil qui lui coûte une
     * lignée — et c'est cette liste-là qu'il lit, puisqu'elle s'affiche sans
     * rien ouvrir.
     */
    await mockSupabase(page);
    await openBreeding(page);
    await page.getByRole('button', { name: 'Clonage' }).click();

    const lignes = page.getByTestId('clone-advice');
    await expect(lignes.first()).toBeVisible({ timeout: 30_000 });

    const total = await lignes.count();
    expect(total).toBeGreaterThan(0);

    for (let index = 0; index < total; index += 1) {
      const ligne = lignes.nth(index);
      const garde = Number(await ligne.getAttribute('data-keep-carried'));
      const partenaire = Number(await ligne.getAttribute('data-partner-carried'));
      expect(garde).toBe(partenaire);
    }
  });

  test('les deux côtés restent enregistrables, sur tout le lot', async ({ page }) => {
    /**
     * L'autre moitié de l'invariant, et elle compte autant.
     *
     * Le tirage est celui du jeu : l'éleveur doit pouvoir consigner **celui des
     * deux côtés** qui est réellement sorti. Un écran qui refuse la moitié des
     * résultats possibles ne protège rien — le clonage a déjà eu lieu — il
     * empêche seulement l'écurie de dire ce qu'elle contient. C'est ce que
     * faisaient le bouton désactivé puis le refus à l'écriture, tous deux
     * retirés.
     *
     * On tranche donc tout le lot, en alternant les deux côtés, et pas un refus
     * ne doit apparaître. Sur tout le lot et non sur un clic : la fournée se
     * recalcule à chaque écriture — deux stériles en moins, les paires suivantes
     * se reforment — donc un désaccord apparaîtrait tard, pas au premier clic.
     */
    const supabase = await mockSupabase(page);
    nameEverySterile(supabase);
    await openBreeding(page);
    await openCloning(page);

    const avant = supabase.rows(individus).length;
    let tranches = 0;

    for (let pas = 0; pas < 15; pas += 1) {
      const garder = page.getByRole('button', { name: 'C’est celle-ci qui est sortie' });
      if ((await garder.count()) === 0) break;
      // Les deux côtés à tour de rôle : le tirage du jeu ne privilégie ni l'un
      // ni l'autre, et un écran qui n'accepterait qu'un côté passerait pour bon
      // tant qu'on ne cliquerait que celui-là.
      await expect(garder).toHaveCount(2);
      await garder.nth(pas % 2).click();
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

  test('le clone naît au niveau 1, pas à celui de la stérile consommée', async ({ page }) => {
    /*
     * Le jeu ne rend pas une monture expérimentée : il rend une monture
     * **neuve** qui porte le nom et l'ascendance de celle qu'on a sacrifiée.
     * Jauges à zéro, niveau à zéro. Vérifié en jeu par l'éleveur.
     *
     * `recordClonings` recopiait `mount.level` — donc typiquement 48, une
     * stérile a vécu. Et le niveau n'est pas décoratif : `targetGenerationRate`
     * vaut `0,3 + 0,0015 × (niveauA + niveauB)`, si bien que deux clones ainsi
     * surévalués s'annonçaient à 44,4 % là où le jeu en donne 30,3 %. La
     * politique choisissait donc des croisements pour une sûreté qu'ils
     * n'avaient pas.
     */
    const supabase = await mockSupabase(page);
    nameEverySterile(supabase);
    await openBreeding(page);
    await openCloning(page);

    const avant = new Map(supabase.rows(individus).map((row) => [row.id, row]));

    const garder = page.getByRole('button', { name: 'C’est celle-ci qui est sortie' });
    await expect(garder).toHaveCount(2);
    await garder.first().click();
    await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId('clone-refusal')).toHaveCount(0);

    const insere = supabase.writes.find(
      (write) => write.table === individus && write.method === 'POST'
    );
    const lignes = (Array.isArray(insere?.body) ? insere.body : [insere?.body]) as {
      level: number;
    }[];
    expect(lignes).toHaveLength(1);
    expect(lignes[0].level).toBe(1);

    // Et la stérile consommée était bien au-dessus : sans ça le test passerait
    // au vert sur une écurie où 1 est la bonne réponse par accident.
    const consommees = supabase.writes
      .filter((write) => write.table === individus && write.method === 'DELETE')
      .flatMap((write) => [...write.query.matchAll(/[0-9a-f-]{36}/g)].map((match) => match[0]));
    expect(consommees.length).toBeGreaterThan(0);
    expect(
      consommees.some((id) => Number((avant.get(id) as { level?: number } | undefined)?.level) > 1)
    ).toBe(true);
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
    await page.getByRole('button', { name: 'C’est celle-ci qui est sortie' }).first().click();

    await expect(page.getByTestId('clone-refusal')).toBeVisible();
    await expect(page.locator('[role="alert"]').filter({ hasText: 'Pas enregistré' })).toBeVisible();
    expect(supabase.rows(individus)).toHaveLength(lignes);
    // Et le clonage est toujours celui qu'on avait sous les yeux.
    await expect(titre).toHaveText(avant);
  });
});
