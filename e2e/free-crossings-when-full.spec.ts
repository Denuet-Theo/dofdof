import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Le parc plein n'éteint pas les accouplements gratuits.
 *
 * ## Le défaut, tel que l'éleveur le vit
 *
 * « Je viens de sortir 60 montures de la fournée, et l'onglet est passé de 0 à
 * 4. » Puis, la fournée suivante chargée : « ça me donne 0 accouplement ». Ses
 * 74 fécondes étaient au coffre, l'écurie de l'app correspondait au jeu, et
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
 * Mesuré sur l'export de l'éleveur du 27/08 — 74 fécondes, 38 ♂ et 36 ♀,
 * 254 paires admissibles par l'échelle couronnée sur Azur-Doré :
 *
 * | places libres | avant | après |
 * | --- | --- | --- |
 * | 60 (parc vide) | 4 | 24 |
 * | 20 | 3 | 31 |
 * | 0 (parc plein) | **0** | **32** |
 *
 * ## Comment ce test échoue sans le correctif
 *
 * Mesuré, en retirant la passe `composeFree` de `ladder-policy.ts` : la fixture
 * porte 75 fécondes et 5 enclos, sa fournée en occupe 48 sur 50, et une fois les
 * cinq enclos verrouillés il reste **2** places. À cette capacité-là, le plan
 * tombe à 2 croisements et **0** à saisir — le bouton « reproductions à faire »
 * disparaît, et le premier test échoue sur `toBeGreaterThan(0)`. Avec la passe :
 * 26 croisements et 24 à saisir.
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

test.describe('parc plein', () => {
  test('les couples de fécondes restent proposés', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);

    // Parc vide : la liste existe, c'est le point de départ.
    const empty = await matings(page);
    expect(empty).toBeGreaterThan(0);

    const pens = await lockEveryPen(page);
    expect(pens).toBeGreaterThan(0);

    // Parc plein : elle doit être là **aussi**. C'était zéro.
    const full = await matings(page);
    expect(full).toBeGreaterThan(0);
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
