import { expect, test } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import {
  bornOn,
  failureBanner,
  openBirthDialog,
  openBreeding,
  panels,
  progressOf,
  recordBirthOn,
} from './support/breeding';

/**
 * La saisie de naissance — l'écran qui a coûté 22 montures.
 *
 * Chaque test ici correspond à une panne **qui s'est produite**, pas à une
 * inquiétude. Dans l'ordre où elles sont arrivées :
 *
 * 1. 15/08, 12:44 — l'insertion des 22 poulains échoue, la stérilisation des
 *    parents passe quand même, la fenêtre annonce le succès et efface la
 *    saisie. 44 parents stériles, zéro poulain, rien à l'écran.
 * 2. Correctif de la 1 — la saisie enregistre au clic, mais chaque écriture
 *    change l'écurie, donc la fournée se recalcule entre deux clics et les
 *    naissances déjà saisies changent de panneau.
 *
 * Les deux ont passé `tsc`, `eslint` et une relecture. Seul un navigateur qui
 * clique deux fois les voit.
 */

const individus = 'user_breeding_individuals';

test.describe('saisie de naissance', () => {
  test('une insertion refusée ne consomme pas les parents', async ({ page }) => {
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openBirthDialog(page);

    const panel = panels(page).first();
    const avant = supabase.rows(individus).length;

    supabase.refuse({ table: individus, method: 'POST' });
    await panel.locator('button').filter({ hasText: /^♂$/ }).first().click();

    // Le refus se voit, deux fois : sur le panneau où il faut recliquer, et
    // dans la bannière qui suit l'éleveur d'un écran à l'autre.
    await expect(failureBanner(page)).toBeVisible();
    await expect(panel).toContainText('Pas enregistré');
    await expect(panel.getByText('row-level security')).toBeVisible();

    // Et surtout : **rien** n'a bougé en base. C'est tout le correctif.
    expect(await progressOf(panel)).toMatchObject({ done: 0 });
    expect(await bornOn(panel)).toEqual([]);
    expect(supabase.rows(individus)).toHaveLength(avant);
    expect(supabase.writes.filter((write) => write.method === 'PATCH')).toHaveLength(0);
  });

  test('la bannière d’échec ne disparaît pas toute seule', async ({ page }) => {
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openBirthDialog(page);

    supabase.refuse({ table: individus, method: 'POST' });
    await panels(page).first().locator('button').filter({ hasText: /^♂$/ }).first().click();
    await expect(failureBanner(page)).toBeVisible();

    // Une alerte qui expire est une alerte ratée en regardant le jeu à côté.
    await page.waitForTimeout(8_000);
    await expect(failureBanner(page)).toBeVisible();
  });

  test('un clic écrit sa naissance, et fermer ne perd rien', async ({ page }) => {
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openBirthDialog(page);

    const panel = panels(page).first();
    const avant = supabase.rows(individus).length;
    await recordBirthOn(panel);

    const [ne] = await bornOn(panel);
    expect(ne).toMatch(/^G\d+ [A-Z]+ [MF] [A-Z]+-[A-Z]+$/);
    expect(supabase.rows(individus)).toHaveLength(avant + 1);

    // Les deux parents sont consommés dans la foulée, et seulement après.
    const patchs = supabase.writes.filter((write) => write.method === 'PATCH');
    expect(patchs).toHaveLength(1);
    expect(patchs[0].body).toMatchObject({ fertile: false, cycled: false });
    const ordre = supabase.writes.map((write) => write.method);
    expect(ordre.indexOf('POST')).toBeLessThan(ordre.indexOf('PATCH'));

    // Il n'y a pas de brouillon à perdre : la fermeture n'est plus un risque.
    // `.last()` : la croix de la fenêtre porte le même nom accessible.
    await page.getByRole('button', { name: 'Fermer' }).last().click();
    await expect(page.getByRole('heading', { name: 'Ce qui est né' })).toBeHidden();
    expect(supabase.rows(individus)).toHaveLength(avant + 1);
  });

  test('un seul croisement à l’écran, jamais la pile', async ({ page }) => {
    // La fenêtre empilait tous les croisements de la fournée : sept panneaux
    // hauts d'un écran chacun, donc plusieurs mètres de défilement. On saisit
    // en allers-retours avec le jeu, et on revenait les yeux sur une fenêtre qui
    // avait bougé — pour cliquer sur le panneau d'à-côté, qui s'affiche pareil.
    await mockSupabase(page);
    await openBreeding(page);
    await openBirthDialog(page);

    await expect(panels(page)).toHaveCount(1);
    await expect(page.getByText(/Croisement 1 \/ \d+/)).toBeVisible();
    // Le premier croisement n'a pas de précédent : le bouton est là, inerte.
    await expect(page.getByTestId('prev-cross')).toBeDisabled();
  });

  test('plusieurs saisies restent chacune sur leur croisement', async ({ page }) => {
    // La régression de #195 : chaque écriture change l'écurie, la politique
    // repropose une autre fournée, et les naissances déjà saisies suivaient les
    // indices de l'ancienne liste. Un seul clic ne le montre pas.
    //
    // Avec une carte à la fois, la propriété est la même mais se vérifie en
    // **revenant** : on saisit trois croisements d'affilée, puis on remonte les
    // trois — chacun doit retrouver sa naissance, pas celle du voisin.
    await mockSupabase(page);
    await openBreeding(page);
    await openBirthDialog(page);

    const combien = Number(
      (await page.getByText(/Croisement \d+ \/ \d+/).innerText()).match(/\/ (\d+)/)![1]
    );
    expect(combien).toBeGreaterThan(2);

    const attendus: string[][] = [];
    for (const index of [0, 1, 2]) {
      const panel = panels(page).first();
      await recordBirthOn(panel);
      attendus[index] = await bornOn(panel);

      // La fournée ne bouge pas sous les doigts pendant la saisie : ni son
      // effectif, ni le rang de la carte affichée.
      await expect(page.getByText(`Croisement ${index + 1} / ${combien}`)).toBeVisible();
      if (index < 2) await page.getByTestId('next-cross').click();
    }

    // On remonte : aucun croisement n'a récupéré la naissance d'un autre.
    for (const index of [1, 0]) {
      await page.getByTestId('prev-cross').click();
      await expect(page.getByText(`Croisement ${index + 1} / ${combien}`)).toBeVisible();
      expect(await bornOn(panels(page).first())).toEqual(attendus[index]);
    }

    // Chaque naissance porte le nom de **ses** parents : les trois croisements
    // sont distincts, donc les suffixes le sont aussi.
    const suffixes = attendus.flat().map((nom) => nom.split(' ').pop());
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });

  test('annuler retire le poulain et rend leur état aux parents', async ({ page }) => {
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openBirthDialog(page);

    const panel = panels(page).first();
    // Les identifiants, et non les noms : un nom dicté n'est pas unique — la
    // fixture porte déjà plusieurs `G3 RO M DOIN-PO`, ce qui est normal, deux
    // poulains du même croisement et du même sexe s'appellent pareil.
    const idsAvant = new Set(supabase.rows(individus).map((row) => row.id));
    await recordBirthOn(panel);
    expect(await bornOn(panel)).toHaveLength(1);

    const ne = supabase.rows(individus).find((row) => !idsAvant.has(row.id));
    expect(ne).toBeDefined();

    await panel.getByRole('button', { name: 'annuler le dernier' }).click();
    await expect(panel.getByTestId('birth-chip')).toHaveCount(0);

    // Le poulain est parti pour de bon, pas seulement de l'écran.
    expect(supabase.rows(individus).map((row) => row.id)).not.toContain(ne!.id);
    expect(supabase.rows(individus)).toHaveLength(idsAvant.size);

    // Les parents retrouvent leur **fécondité**, pas seulement leur fertilité :
    // une féconde annulée ne doit pas redevoir un cycle d'enclos.
    const rendus = supabase.writes.filter(
      (write) => write.method === 'PATCH' && (write.body as { fertile?: boolean })?.fertile === true
    );
    expect(rendus).toHaveLength(2);
    for (const rendu of rendus) expect(rendu.body).toMatchObject({ fertile: true, cycled: true });
  });
});
