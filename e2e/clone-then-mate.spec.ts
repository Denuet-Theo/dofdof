import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Faire les clonages ne fait pas repousser la liste d'accouplements.
 *
 * ## Ce qui s'est passé le 17/08
 *
 * 18 naissances saisies, puis 24 clonages, puis un rafraîchissement — et
 * l'écran proposait **4 accouplements de plus**. Ils étaient réels : quatre
 * paires de fécondes que la base n'avait jamais vues s'accoupler. Mais le jeu
 * était fermé, et l'éleveur a lu ça comme la liste qui repousse, c'est-à-dire
 * le défaut de #165 revenu par une autre porte.
 *
 * Il n'était pas revenu. `couplesToRecordAll` boucle bien jusqu'au point fixe —
 * saisir les sept qu'elle rend en propose zéro au tour suivant, vérifié sur
 * l'écurie du 17/08. Ce que la boucle ne garantit qu'à **écurie constante**,
 * c'est tout ce qu'elle garantit : l'onglet d'à côté demandait vingt clonages,
 * qui retirent quarante stériles et rendent vingt fertiles, et la politique est
 * une optimisation sur l'écurie entière. Elle réaffectait ses fécondes et
 * publiait des couples gratuits qu'elle avait laissés de côté.
 *
 * Mesuré sur l'export de l'éleveur, à fécondes identiques : **3 accouplements
 * avant les clonages, 7 après**. Un clone ressort fertile et non fécond — il ne
 * peut s'accoupler avec personne — donc les clonages n'avaient rien rendu
 * possible. Ils avaient fait changer d'avis la politique.
 *
 * ## Ce que cette spec verrouille
 *
 * La liste d'accouplements se calcule maintenant sur l'écurie **d'après** les
 * clonages proposés (`afterClonings`). Les exécuter ne doit donc plus rien y
 * changer : même compte, mêmes couples, avant et après.
 *
 * Elle clique les clonages **un par un**, comme l'éleveur, et non par un
 * raccourci d'état : le défaut se joue entre deux écritures, sur une écurie que
 * chaque clic déplace sous les doigts.
 */

const individus = 'user_breeding_individuals';

/**
 * Nomme toutes les stériles avant le chargement — même raison que dans
 * `cloning.spec.ts` : `cloneOptions` n'apparie aucune anonyme, et la fixture
 * n'en propose alors pas assez pour déplacer le plan.
 */
const nameEverySterile = (supabase: SupabaseMock) => {
  let numero = 0;
  for (const mount of supabase.rows(individus)) {
    if (mount.fertile === false && !mount.name) mount.name = `G1 ZZ M AA-BB ${++numero}`;
  }
};

/** Le compte affiché sur un onglet des gestes du jour. */
const stepCount = async (page: Page, step: 'mate' | 'clone'): Promise<number> => {
  const text = await page.getByTestId(`step-${step}`).innerText();
  return Number(text.match(/(\d+)/)![1]);
};

/** Les couples proposés, tels que l'onglet Accouplement les liste. */
const matePairs = async (page: Page): Promise<string[]> => {
  await page.getByTestId('step-mate').click();
  await expect(page.getByTestId('pane-mate')).toBeVisible();
  return page.getByTestId('pane-mate').innerText().then((text) => text.split('\n'));
};

test.describe('clonages puis accouplements', () => {
  test('exécuter les clonages ne change pas la liste d’accouplements', async ({ page }) => {
    const supabase = await mockSupabase(page);
    nameEverySterile(supabase);
    await openBreeding(page);

    const avant = await stepCount(page, 'mate');
    const clonages = await stepCount(page, 'clone');
    const couplesAvant = await matePairs(page);

    // Sans ces deux-là, la spec passerait au vert sur un écran vide.
    expect(avant).toBeGreaterThan(0);
    expect(clonages).toBeGreaterThan(0);

    await page.getByTestId('step-clone').click();
    await page.getByRole('button', { name: /clonages? à faire/ }).click();
    await expect(page.getByRole('heading', { name: /^Clonage 1 \/ \d+$/ })).toBeVisible();

    // Un clic par clonage, et l'attente du retour de l'écriture : enchaîner sans
    // attendre testerait l'anti-double-clic plutôt que ce qu'on vise.
    for (let fait = 0; fait < clonages; fait += 1) {
      const bouton = page
        .getByTestId('clone-card')
        .first()
        .getByRole('button', { name: /celle-ci qui est sortie|Enregistrer le clonage/ });
      if ((await bouton.count()) === 0) break;
      await bouton.click();
      await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 20_000 });
    }

    await page.keyboard.press('Escape');

    // Les clonages ont bien été écrits : sans ça, « rien n'a changé » ne prouve
    // rien du tout.
    expect(await stepCount(page, 'clone')).toBe(0);

    // Et la liste d'accouplements n'a pas bougé — ni le compte, ni les couples.
    expect(await stepCount(page, 'mate')).toBe(avant);
    expect(await matePairs(page)).toEqual(couplesAvant);
  });
});
