import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { failureBanner, openBreeding } from './support/breeding';

/**
 * Le relevé d'écurie : ce qui ne tient pas debout, et ce qu'il faut confronter
 * au jeu.
 *
 * Les règles et leur raisonnement sont dans `stable-audit.ts`. Ce qui se vérifie
 * ici est que l'écran rassemble les bonnes lignes, que ses corrections partent
 * réellement en base, et qu'un refus ne coche rien.
 *
 * ## Ce que la fixture donne, et pourquoi ça compte
 *
 * L'écurie du 15/08 porte **trois** fertiles au-dessus du niveau 1 — deux au
 * niveau 42, une au niveau 44, dont `G10 PO F AZTU-DO`, une gen 10 — et
 * cinquante-huit anonymes stériles. Ce ne sont pas des lignes fabriquées pour le
 * test : ce sont exactement celles que le panneau existe pour montrer, et les
 * trois premières ont été écrites par `recordClonings` du temps où il recopiait
 * le niveau de la stérile consommée. Un test bâti sur une écurie inventée
 * n'aurait rien dit de l'écurie réelle.
 *
 * Les deux règles que la fixture n'exerce pas — un nom périmé, une fertile
 * doublée par le vrac — s'éprouvent en abîmant une copie, comme le fait
 * `scripts/check-stable-audit.mjs`.
 */

const individus = 'user_breeding_individuals';

const openStocks = async (page: Page) => {
  const bouton = page.getByRole('button', { name: /montures ·/ });
  await expect(bouton).toBeVisible({ timeout: 30_000 });
  await bouton.click();
};

/**
 * Le relevé, déplié.
 *
 * Il s'ouvre **de lui-même** dès qu'il porte un défaut, et la fixture en porte
 * cinquante-huit — les anonymes stériles du 15/08. On ne clique donc pas sur le
 * chevron : ça le refermerait. C'est justement la propriété qu'on veut, et le
 * premier test la vérifie explicitement.
 */
const openAudit = async (page: Page): Promise<Locator> => {
  const panneau = page.getByTestId('stable-audit');
  await expect(panneau).toBeVisible();
  await expect(page.getByTestId('phantom-notice')).toBeVisible();
  return panneau;
};

const patches = (supabase: Awaited<ReturnType<typeof mockSupabase>>) =>
  supabase.writes.filter((write) => write.table === individus && write.method === 'PATCH');

test.describe('relevé d’écurie', () => {
  test('un défaut déplie le relevé de lui-même ; il se replie à la main', async ({ page }) => {
    /*
     * La bannière des anonymes stériles était **toujours visible** quand il y
     * avait un reste, et c'était juste : 255 montures annoncées contre 198 en
     * jeu ne se découvre pas en dépliant un tiroir. L'absorber dans un panneau
     * replié aurait troqué un compte perdu contre un compte caché.
     */
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    const restes = supabase
      .rows(individus)
      .filter((row) => !row.name && row.fertile === false).length;
    expect(restes).toBeGreaterThan(0);

    // Déplié sans qu'on ait rien cliqué, et le défaut est là. Le compte porte
    // sur **toutes** les classes de défaut, pas seulement les anonymes : c'est
    // ce que le panneau existe pour rassembler.
    const impossibles = supabase
      .rows(individus)
      .filter((row) => row.fertile === true && row.cycled === false && (row.level as number) > 1)
      .length;
    const panneau = page.getByTestId('stable-audit');
    await expect(panneau).toHaveAttribute('data-defects', String(restes + impossibles));
    await expect(page.getByTestId('phantom-notice')).toBeVisible();

    // Et il se referme quand même : un relevé qu'on ne peut pas ranger est un
    // bandeau, et un bandeau finit par ne plus se lire.
    await page.getByTestId('stable-audit-toggle').click();
    await expect(page.getByTestId('phantom-notice')).toHaveCount(0);
  });

  test('un nom qui ne décrit plus sa monture est compté, et se rectifie', async ({ page }) => {
    /*
     * La façon dont ça arrive vraiment : on corrige le sexe d'une monture dans
     * « Mes stocks », et le nom — qui encode le sexe — ment dès la seconde
     * d'après. Le signal existait déjà, en petit bouton ambre au fil d'une liste
     * de deux cents lignes : présent, et introuvable.
     */
    const supabase = await mockSupabase(page);
    const cible = supabase
      .rows(individus)
      .find((row) => row.name && row.parent_a_color && row.parent_b_color)!;
    const nomPorte = cible.name as string;
    cible.sex = cible.sex === 'M' ? 'F' : 'M';

    await openBreeding(page);
    await openStocks(page);

    const ligne = page.locator(`[data-testid="stale-name"][data-mount-id="${cible.id}"]`);
    await expect(ligne).toBeVisible();
    const attendu = await ligne.getAttribute('data-expected');
    expect(attendu).not.toBe(nomPorte);
    // Le nom attendu porte bien le sexe qu'on vient de poser : c'est ce qui
    // rend la monture retrouvable dans l'écurie du jeu.
    expect(attendu).toContain(` ${cible.sex} `);

    await ligne.getByTestId('stale-name-fix').click();
    await expect(page.getByTestId('stable-audit-refusal')).toHaveCount(0);
    expect(supabase.rows(individus).find((row) => row.id === cible.id)?.name).toBe(attendu);
  });

  test('une fertile sans ascendance que le vrac tient déjà se signale', async ({ page }) => {
    /*
     * La porte par laquelle les cinquante-sept fantômes sont entrés : le
     * compteur de vrac ne porte **que** des fertiles sans ascendance, donc une
     * monture suivie de même couleur et de même sexe est peut-être la même,
     * comptée deux fois.
     *
     * Elle va dans les affirmations et non dans les défauts : deux montures
     * distinctes peuvent parfaitement exister, et c'est le compte du jeu qui
     * tranche. Le test le vérifie aussi — un faux positif rangé parmi les
     * certitudes ferait supprimer une monture bien réelle.
     */
    const supabase = await mockSupabase(page);
    const vrac = supabase.rows('user_breeding_mounts')[0];
    vrac.males = 4;
    supabase.rows(individus).push({
      ...supabase.rows(individus)[0],
      id: 'sonde-double-compte',
      color_id: vrac.color_id,
      sex: 'M',
      name: null,
      parent_a_color: null,
      parent_b_color: null,
      fertile: true,
      cycled: false,
      level: 1,
    });

    await openBreeding(page);
    await openStocks(page);

    const ligne = page.locator('[data-testid="double-counted"][data-mount-id="sonde-double-compte"]');
    await expect(ligne).toBeVisible();
    await expect(ligne).toHaveAttribute('data-bulk', '4');

    // Rangée du bon côté : dans les affirmations, pas dans les défauts. C'est
    // la propriété qui compte — un faux positif rangé parmi les certitudes
    // ferait supprimer une monture bien réelle.
    const panneau = page.getByTestId('stable-audit');
    await expect(panneau).toHaveAttribute('data-claims', '1');
    const defauts = Number(await panneau.getAttribute('data-defects'));
    const attendus = supabase
      .rows(individus)
      .filter(
        (row) =>
          (!row.name && row.fertile === false) ||
          (row.fertile === true && row.cycled === false && (row.level as number) > 1)
      ).length;
    expect(defauts).toBe(attendus);

    // Et l'écarter n'écrit rien : ce n'est pas une correction, c'est un constat.
    await ligne.getByTestId('double-counted-ok').click();
    expect(supabase.writes.filter((write) => write.table === individus)).toHaveLength(0);
  });

  test('les fertiles au-dessus du niveau 1 sont listées, et se remettent au niveau 1', async ({
    page,
  }) => {
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    // Ce que la fixture porte vraiment — calculé ici plutôt que codé en dur,
    // sinon le test surveillerait un nombre et non une règle.
    const impossibles = supabase
      .rows(individus)
      .filter((row) => row.fertile === true && row.cycled === false && (row.level as number) > 1);
    expect(impossibles.length).toBeGreaterThan(0);

    await openAudit(page);
    await expect(page.getByTestId('impossible-level')).toHaveCount(impossibles.length);

    // Une féconde est fertile **et** couramment au niveau 48 : c'est l'état
    // ordinaire d'une monture qui a fait son cycle d'enclos. La compter ici
    // remplirait la liste de toute l'écurie prête à s'accoupler.
    const fecondes = supabase
      .rows(individus)
      .filter((row) => row.fertile === true && row.cycled === true);
    expect(fecondes.length).toBeGreaterThan(0);
    for (const feconde of fecondes.slice(0, 5)) {
      await expect(
        page.locator(`[data-testid="impossible-level"][data-mount-id="${feconde.id}"]`)
      ).toHaveCount(0);
    }

    // Le rattrapage courant : ces lignes viennent d'un clonage saisi quand
    // l'app croyait qu'un clone gardait le niveau de la stérile consommée.
    const ligne = page.getByTestId('impossible-level').first();
    const id = await ligne.getAttribute('data-mount-id');
    await ligne.getByTestId('impossible-level-fix').click();
    await expect(ligne.getByTestId('audit-fixed')).toBeVisible();
    expect(supabase.rows(individus).find((row) => row.id === id)?.level).toBe(1);

    // Rangée dans les défauts et non dans les affirmations : c'est faux quoi que
    // dise la partie, et ça ne demande pas d'ouvrir le jeu.
    const panneau = page.getByTestId('stable-audit');
    expect(Number(await panneau.getAttribute('data-claims'))).toBe(0);
  });

  test('une fertile montée peut avoir été achetée : on l’écarte sans rien écrire', async ({
    page,
  }) => {
    /*
     * La seule exception à la règle, et elle est réelle : une monture achetée
     * déjà montée est fertile au-dessus du niveau 1 sans que rien ne soit faux.
     * L'écarter d'un clic vaut mieux que de reléguer toute la règle dans les
     * incertitudes, où elle se serait fait ignorer avec le reste.
     */
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);
    await openAudit(page);

    const ligne = page.getByTestId('impossible-level').first();
    const id = await ligne.getAttribute('data-mount-id');
    const avant = supabase.rows(individus).find((row) => row.id === id)?.level;

    await ligne.getByTestId('impossible-level-bought').click();

    expect(supabase.writes.filter((write) => write.table === individus)).toHaveLength(0);
    expect(supabase.rows(individus).find((row) => row.id === id)?.level).toBe(avant);
  });

  test('« le clonage n’a pas eu lieu » repasse la ligne stérile, en base', async ({ page }) => {
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);
    await openAudit(page);

    const ligne = page.getByTestId('impossible-level').first();
    const id = await ligne.getAttribute('data-mount-id');
    expect(id).toBeTruthy();

    await ligne.getByTestId('impossible-level-uncloned').click();
    await expect(ligne.getByTestId('audit-fixed')).toBeVisible();

    // Ce que la base porte, et non ce que l'écran annonce. C'est toute la
    // différence que cette suite existe pour tenir.
    const apres = supabase.rows(individus).find((row) => row.id === id);
    expect(apres?.fertile).toBe(false);
    expect(apres?.cycled).toBe(false);

    // La seconde stérile n'est pas devinée : le clonage l'a supprimée, la paire
    // n'est consignée nulle part, et fabriquer une jumelle plausible rangerait
    // une invention au milieu de faits. L'écran le dit au lieu de le faire.
    await expect(ligne.getByTestId('audit-fixed')).toContainText(/partenaire/i);
    expect(
      supabase.writes.filter((write) => write.table === individus && write.method === 'POST')
    ).toHaveLength(0);
  });

  test('une correction refusée ne coche rien, le dit, et laisse la ligne en place', async ({
    page,
  }) => {
    /*
     * La règle de toute la maison, et la seule raison pour laquelle ce fichier
     * touche `updateIndividual` : l'écran ne peut annoncer que ce que la base a
     * pris. La correction partait en optimiste **sans retour arrière et sans
     * message** — l'état local gardait la stérilisation, la base gardait la
     * fertile, et les deux ne se départageaient qu'au rechargement suivant.
     *
     * C'est exactement la forme qui a coûté 22 montures à la saisie de
     * naissance : une écriture perdue derrière un écran qui dit « c'est fait ».
     */
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);
    await openAudit(page);

    const ligne = page.getByTestId('impossible-level').first();
    const id = await ligne.getAttribute('data-mount-id');

    supabase.refuse({ table: individus, method: 'PATCH' });
    await ligne.getByTestId('impossible-level-uncloned').click();

    await expect(page.getByTestId('stable-audit-refusal')).toBeVisible();
    await expect(failureBanner(page)).toBeVisible();
    // Rien de coché : la ligne garde ses trois issues, donc le geste se refait.
    await expect(ligne.getByTestId('audit-fixed')).toHaveCount(0);
    await expect(ligne.getByTestId('impossible-level-uncloned')).toBeVisible();

    // Et la base n'a pas bougé — ni l'écran, qui doit la refléter.
    const apres = supabase.rows(individus).find((row) => row.id === id);
    expect(apres?.fertile).toBe(true);
    await expect(
      page.locator(`[data-testid="impossible-level"][data-mount-id="${id}"]`)
    ).toBeVisible();

    // Puis ça repasse une fois la base rouverte : le refus n'a pas laissé
    // l'écran dans un état d'où l'on ne peut plus rien faire.
    supabase.allow();
    await ligne.getByTestId('impossible-level-uncloned').click();
    await expect(ligne.getByTestId('audit-fixed')).toBeVisible();
    expect(supabase.rows(individus).find((row) => row.id === id)?.fertile).toBe(false);
  });

  test('« le jeu montre un autre nom » réécrit l’identité de la ligne', async ({ page }) => {
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);
    await openAudit(page);

    const ligne = page.getByTestId('impossible-level').first();
    const id = await ligne.getAttribute('data-mount-id');
    const avant = supabase.rows(individus).find((row) => row.id === id)!;

    await ligne.getByTestId('impossible-level-recast').click();

    // Un nom illisible ne corrige rien : le même chemin que l'import d'une
    // liste, donc le même refus. Sans ça, une faute de frappe écrirait une
    // ascendance inventée sur une monture qui existe.
    await ligne.getByTestId('impossible-level-name').fill('pas un nom');
    await expect(ligne.getByTestId('impossible-level-unreadable')).toBeVisible();
    await expect(ligne.getByTestId('impossible-level-recast-save')).toBeDisabled();
    expect(patches(supabase)).toHaveLength(0);

    // Le nom que le jeu affiche sur la survivante. Il porte à lui seul la
    // couleur, le sexe et les deux parents — c'est pour ça qu'il est la clé de
    // réparation, et non un libellé.
    await ligne.getByTestId('impossible-level-name').fill('G2 DOPO M DO-PO');
    await expect(ligne.getByTestId('impossible-level-preview')).toBeVisible();
    await ligne.getByTestId('impossible-level-recast-save').click();
    await expect(ligne.getByTestId('audit-fixed')).toBeVisible();

    const apres = supabase.rows(individus).find((row) => row.id === id)!;
    expect(apres.name).toBe('G2 DOPO M DO-PO');
    expect(apres.color_id).toBe('dore_pourpre');
    expect(apres.sex).toBe('M');
    expect([apres.parent_a_color, apres.parent_b_color].sort()).toEqual(['dore', 'pourpre']);

    // La ligne est **corrigée**, pas remplacée : l'identifiant tient, donc les
    // enfants qui la référencent aussi, et la date d'entrée avec. Voir la
    // compétence `ecurie-en-jeu`, qui pose la règle après un recensement entier.
    expect(apres.id).toBe(avant.id);
    expect(apres.created_at).toBe(avant.created_at);
    expect(
      supabase.writes.filter((write) => write.table === individus && write.method === 'DELETE')
    ).toHaveLength(0);
  });

  test('deux corrections d’affilée partent chacune sur sa propre ligne', async ({ page }) => {
    /*
     * Le second clic, celui qui trouve les régressions. La liste se recalcule
     * sous les doigts — une ligne corrigée cesse d'être un clone — et une
     * correction qui viserait « la première ligne » plutôt que la sienne
     * écraserait la voisine. Une fournée de clonages en compte une douzaine ;
     * un test à un seul clic n'en prouve rien.
     */
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);
    await openAudit(page);

    const lignes = page.getByTestId('impossible-level');
    expect(await lignes.count()).toBeGreaterThanOrEqual(2);
    const premier = await lignes.nth(0).getAttribute('data-mount-id');
    const second = await lignes.nth(1).getAttribute('data-mount-id');
    expect(premier).not.toBe(second);

    await lignes.nth(0).getByTestId('impossible-level-uncloned').click();
    await expect(lignes.nth(0).getByTestId('audit-fixed')).toBeVisible();

    await lignes.nth(1).getByTestId('impossible-level-recast').click();
    await lignes.nth(1).getByTestId('impossible-level-name').fill('G4 AM F DO-DOAM');
    await lignes.nth(1).getByTestId('impossible-level-recast-save').click();
    await expect(lignes.nth(1).getByTestId('audit-fixed')).toBeVisible();

    const un = supabase.rows(individus).find((row) => row.id === premier)!;
    const deux = supabase.rows(individus).find((row) => row.id === second)!;
    // Chacune a reçu la sienne, et rien n'a débordé sur l'autre.
    expect(un.fertile).toBe(false);
    expect(un.name).not.toBe('G4 AM F DO-DOAM');
    expect(deux.name).toBe('G4 AM F DO-DOAM');
    expect(deux.fertile).toBe(true);
  });
});
