import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Les accouplements sans enclos ne dépendent pas de l'état du parc.
 *
 * ## Le défaut, tel que l'éleveur le vit
 *
 * « Je viens de sortir 60 montures de la fournée, et l'onglet est passé de 0 à
 * 4. » Puis, la fournée suivante chargée : « ça me donne 0 accouplement ». Ses
 * 74 fécondes étaient au coffre, l'écurie de l'app d'accord avec le jeu, et
 * l'écran ne proposait rien pendant toute la durée du cycle.
 *
 * ## La cause
 *
 * `ladderPlan` composait sous une seule borne, les places d'enclos. C'est la
 * bonne borne pour tout ce qui doit encore un cycle. Mais un couple dont les
 * **deux** parents ont déjà cyclé n'occupe aucune place — `placesFor` le chiffre
 * à zéro, c'est un clic en jeu — donc la capacité n'avait rien à en dire. Elle
 * les bornait quand même : parc plein, la boucle d'étages ne tournait pas du
 * tout, et pas un seul accouplement ne sortait.
 *
 * ## L'invariant que ce fichier tient
 *
 * **Remplir le parc n'enlève aucun accouplement.**
 *
 * Pas « le même nombre » : parc plein il peut y en avoir **plus**, et c'est
 * normal — une féconde que la boucle d'étages aurait mariée à une fertile reste
 * disponible pour une autre féconde quand il n'y a plus de place à dépenser. Ce
 * qu'on interdit est la seule direction qui coûte à l'éleveur : en perdre.
 *
 * C'est ce qui compte pour lui, parce qu'il accouple **avant** de charger — un
 * poulain né du croisement de ce matin doit pouvoir entrer dans l'enclos de ce
 * midi, et une gen 9 qui attend la fournée du lendemain est une journée perdue.
 *
 * ## Comment ce test échoue sans les correctifs
 *
 * Mesuré au navigateur sur cette fixture — 75 fécondes, 5 enclos :
 *
 * | | parc vide | parc plein | |
 * | --- | --- | --- | --- |
 * | sans rien | 14 | **0** | rouge |
 * | passe du plan seule | 21 | 24 | passe |
 * | passe du plan, moisson non corrigée | 25 | **24** | rouge |
 * | les deux | 25 | 26 | vert |
 *
 * Sans la passe, le bouton « reproductions à faire » disparaît une fois les
 * enclos verrouillés : `0 >= 14` échoue, puis `toBeGreaterThan(2)` reçoit `0`.
 * Avec la passe du plan mais la moisson encore bornée par la capacité, il
 * manque exactement le croisement gratuit que la moisson n'a pas pu composer :
 * `24 >= 25` échoue.
 *
 * ## Ce que ce fichier ne couvre pas
 *
 * Que la passe tourne **avant** la distribution des places plutôt qu'après. La
 * ligne 2 du tableau passe : parc plein 24, parc vide 21, l'invariant tient
 * quand même. Le gain de l'ordre se lit sur le parc vide — 21 contre 25 — et
 * l'épingler demanderait un compte absolu, ce que ce dépôt a déjà payé cher
 * (voir `banked-mounts` : « 17 avant, 18 après » était le compte du champion).
 * Il est donc mesuré dans le corps de la PR, pas ici.
 *
 * ## Pourquoi le second test saisit deux naissances
 *
 * Une seule prouverait que la liste existe, pas qu'elle survit à ce qu'on en
 * fait. Un accouplement stérilise ses deux parents : la passe doit recomposer
 * sur une écurie qui a bougé sous elle, et c'est au deuxième geste que ça se
 * voit — le premier lisait encore le plan d'avant.
 */

/**
 * Les accouplements que l'écran propose **sans enclos**.
 *
 * Même lecture que `spend-fertility.spec.ts` : `couplesToRecord` ne retient que
 * les couples à zéro place, donc ce compteur ne parle que de fécondes appariées.
 */
const matings = async (page: Page): Promise<number> => {
  await page.getByTestId('step-mate').click();
  const pane = page.getByTestId('pane-mate');
  await expect(pane).toBeVisible();
  const text = (await pane.innerText()).replace(/\s+/g, ' ');
  return Number(text.match(/(\d+)\s+reproductions?\s+à faire/)?.[1] ?? 0);
};

/**
 * Charge et verrouille tous les enclos, et rend leur nombre.
 *
 * C'est le geste qui remplit le parc, donc celui qui armait le défaut. On
 * verrouille jusqu'à ce que la fournée n'ait plus d'enclos en cours — la borne
 * est un garde-fou contre une boucle infinie, pas un compte attendu.
 */
const lockEveryPen = async (page: Page): Promise<number> => {
  await page.getByTestId('step-load').click();
  await expect(page.getByTestId('pane-load')).toBeVisible();

  let locked = 0;
  for (let pen = 0; pen < 12; pen += 1) {
    if ((await page.getByTestId('current-pen').count()) === 0) break;
    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen').nth(pen)).toBeVisible();
    locked += 1;
  }
  return locked;
};

test.describe('accoupler avant de charger', () => {
  test('la liste est la même parc vide et parc plein', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);

    const empty = await matings(page);
    expect(empty).toBeGreaterThan(0);

    const pens = await lockEveryPen(page);
    expect(pens).toBeGreaterThan(0);

    // L'invariant : remplir le parc ne retire aucun accouplement, parce
    // qu'aucun de ceux-là n'a jamais eu besoin d'une place. Il peut en ajouter,
    // et c'est sain — les fécondes que la boucle d'étages n'a plus de place pour
    // marier à une fertile se marient entre elles.
    expect(await matings(page)).toBeGreaterThanOrEqual(empty);
  });

  test('et elle survit aux deux premières saisies', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await lockEveryPen(page);

    const before = await matings(page);
    expect(before).toBeGreaterThan(2);

    await page
      .getByTestId('pane-mate')
      .getByRole('button', { name: /reproductions? à faire/ })
      .click();
    await expect(page.getByRole('heading', { name: 'Ce qui est né' })).toBeVisible();

    // Deux naissances, sur le premier croisement puis le suivant : chacune
    // stérilise ses deux parents, donc l'écurie n'est plus celle du plan lu.
    for (let birth = 0; birth < 2; birth += 1) {
      const sexes = page
        .getByTestId('mating-panel')
        .locator('button')
        .filter({ hasText: /^[♂♀]$/ });
      await expect(sexes.first()).toBeEnabled();
      await sexes.first().click();
      await expect(page.getByText('enregistrement…')).toHaveCount(0, { timeout: 20_000 });

      const next = page.getByTestId('next-cross');
      if ((await next.count()) > 0 && (await next.isEnabled())) await next.click();
    }

    await page.getByRole('button', { name: 'Fermer' }).last().click();

    // Toujours quelque chose à proposer, et strictement moins qu'avant : la
    // passe a bien recomposé sur l'écurie d'après, elle n'a pas resservi la
    // liste d'avant.
    const after = await matings(page);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });
});
