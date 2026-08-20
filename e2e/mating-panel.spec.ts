import { expect, test } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { bornOn, openBirthDialog, openBreeding, panels, recordBirthOn } from './support/breeding';

/**
 * Le panneau d'accouplement, sur les deux points où il se lit **en même temps
 * que le jeu** : de quel côté est chaque monture, et ce que le clic met dans le
 * presse-papier.
 *
 * Les deux sont des propriétés d'écran, pas des détails de rendu. Le côté
 * décide de la monture qu'on charge dans l'enclos ; le presse-papier décide du
 * nom qu'on colle sur le poulain, et un poulain mal nommé ne se retrouve plus
 * dans une écurie où tout s'appelle « Anonyme ».
 *
 * Chaque test clique **deux fois**, sur deux croisements : la première saisie
 * change l'écurie sous les doigts, et c'est la deuxième qui a trouvé les
 * régressions de cet écran (voir `birth-recording.spec.ts`).
 */

const individus = 'user_breeding_individuals';

/** Les sexes des deux fiches d'un panneau, dans l'ordre du DOM. */
const sidesOf = (panel: ReturnType<typeof panels>) =>
  panel.getByTestId('mate-card').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-sex') ?? '')
  );

test.describe('panneau d’accouplement', () => {
  test('la femelle est à gauche, le mâle à droite', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openBirthDialog(page);

    for (const rang of [1, 2]) {
      const panel = panels(page).first();
      expect(await sidesOf(panel), `croisement ${rang}`).toEqual(['F', 'M']);

      // Et « à gauche » au sens de l'écran, pas seulement du DOM : une classe
      // `order-*` suffirait à retourner les deux fiches sans toucher au source.
      const cartes = panel.getByTestId('mate-card');
      const gauche = (await cartes.nth(0).boundingBox())!;
      const droite = (await cartes.nth(1).boundingBox())!;
      expect(gauche.x, `croisement ${rang}`).toBeLessThan(droite.x);

      // Le côté ne doit pas dépendre du croisement affiché : les deux
      // orientations d'une même recette forment deux panneaux distincts, et
      // c'est justement pour pouvoir désigner un côté juste dans les deux.
      if (rang === 1) await page.getByTestId('next-cross').click();
    }
  });

  test('le clic sur une issue met le nom du poulain dans le presse-papier', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://localhost:3100',
    });
    await mockSupabase(page);
    await openBreeding(page);
    await openBirthDialog(page);

    // Deux croisements d'affilée : le presse-papier doit suivre le **dernier**
    // clic, pas garder le premier nom — c'est le nom qu'on va coller dans le
    // jeu juste après, et le poulain d'avant est déjà renommé.
    for (const rang of [1, 2]) {
      const panel = panels(page).first();
      await recordBirthOn(panel);

      const nes = await bornOn(panel);
      const dernier = nes[nes.length - 1];
      expect(dernier, `croisement ${rang}`).toMatch(/^G\d+ [A-Z]+ [MF] [A-Z]+-[A-Z]+$/);

      expect(await page.evaluate(() => navigator.clipboard.readText()), `croisement ${rang}`).toBe(
        dernier
      );

      // L'écran le dit aussi : sans ça, rien ne distingue un presse-papier
      // chargé d'un presse-papier resté sur le poulain précédent.
      const note = panel.getByTestId('clipboard-note');
      await expect(note).toHaveAttribute('data-ok', 'true');
      await expect(note).toContainText(dernier);

      if (rang === 1) await page.getByTestId('next-cross').click();
    }
  });

  test('une naissance refusée par la base copie quand même le nom', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://localhost:3100',
    });
    const supabase = await mockSupabase(page);
    await openBreeding(page);
    await openBirthDialog(page);

    // Le poulain est né **dans le jeu** quoi qu'en dise la base : il faut le
    // renommer maintenant, et le nom ne dépend pas de l'écriture. Le refus se
    // reclique, et recopie la même chose.
    const panel = panels(page).first();
    // `refuseOnce` : le deuxième clic doit passer, c'est la moitié du test.
    supabase.refuseOnce({ table: individus, method: 'POST' });
    await panel.locator('button').filter({ hasText: /^♂$/ }).first().click();

    await expect(panel).toContainText('Pas enregistré');
    const note = panel.getByTestId('clipboard-note');
    await expect(note).toHaveAttribute('data-ok', 'true');
    const copie = await page.evaluate(() => navigator.clipboard.readText());
    expect(copie).toMatch(/^G\d+ [A-Z]+ [MF] [A-Z]+-[A-Z]+$/);
    await expect(note).toContainText(copie);
    // Rien n'est né : la copie ne raconte pas que l'écriture a eu lieu.
    expect(await bornOn(panel)).toEqual([]);

    // Deuxième clic, celui qui passe : le nom est le même, et il est de nouveau
    // dans le presse-papier.
    await recordBirthOn(panel);
    expect(await bornOn(panel)).toEqual([copie]);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(copie);
  });
});
