import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBirthDialog, openBreeding, panels, recordBirthOn } from './support/breeding';

/**
 * L'onglet Succès : la collection des couleurs déjà nées.
 *
 * ## Ce que ce fichier surveille en priorité
 *
 * **Le chemin d'écriture.** La collection ne se remplit que par une naissance
 * saisie — ni déduction depuis l'écurie, ni case à cocher — donc si cette
 * écriture-là se perd, le succès n'avance jamais et rien à l'écran ne le dit. Le
 * compteur reste à 0/120, ce qui est exactement ce qu'il affiche au départ : une
 * panne indistinguable de l'état normal, la famille de bugs qui a coûté 22
 * montures.
 *
 * Le test enregistre donc une vraie naissance, lit ce qui part en base et vérifie
 * que la table le porte. Il **rougit** quand on retire cette écriture.
 *
 * ## Et la stratégie bloquée
 *
 * Les trois modes sont affichés et aucun ne se clique : la politique ne les lit
 * pas encore. Le test vérifie qu'ils sont inertes **et** qu'aucun réglage ne part
 * en base — un sélecteur qui écrirait un champ que rien ne lit est exactement la
 * panne que #181 et #216 ont corrigée.
 */

const openSuccess = async (page: Page) => {
  await openBreeding(page);
  await page.getByTestId('step-success').click();
  await expect(page.getByTestId('pane-success')).toBeVisible();
};

test.describe('onglet Succès', () => {
  test('la collection part de zéro et liste ce qui manque', async ({ page }) => {
    await mockSupabase(page);
    await openSuccess(page);

    // La fixture ne porte aucune ligne de collection : rien n'a encore été saisi
    // comme né, donc le compteur est à zéro et les 120 couleurs sont à faire.
    const progress = page.getByTestId('success-progress');
    await expect(progress).toHaveAttribute('data-done', '0');
    await expect(progress).toHaveAttribute('data-total', '120');
    expect(await page.getByTestId('success-missing').count()).toBe(120);
  });

  test('la stratégie est montrée mais bloquée', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openSuccess(page);

    const modes = page.getByTestId('success-mode');
    await expect(modes).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expect(modes.nth(index)).toHaveAttribute('aria-disabled', 'true');
    }

    // Cliquer dessus n'écrit rien : il n'y a pas de réglage derrière.
    await modes.first().click({ force: true });
    await modes.nth(2).click({ force: true });
    expect(
      mock.writes.filter((write) => write.table === 'user_breeding_settings')
    ).toHaveLength(0);
  });

  test('une naissance saisie entre dans la collection', async ({ page }) => {
    // Le cœur du fichier : c'est le seul chemin qui remplit la collection.
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openBirthDialog(page);

    const panel = panels(page).first();
    await recordBirthOn(panel, '♂');

    const written = mock.writes.filter((write) => write.table === 'user_breeding_hatched');
    expect(written, 'la naissance doit entrer dans la collection').not.toHaveLength(0);
    const rows = mock.rows('user_breeding_hatched');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.family).toBe('muldo');
      expect(typeof row.color_id).toBe('string');
    }
  });

  test('le compteur suit la naissance, sans recharger', async ({ page }) => {
    // La collection est aussi un état local : l'écrire en base sans l'ajouter au
    // `Set` laisserait le compteur à zéro jusqu'au prochain chargement.
    await mockSupabase(page);
    await openBreeding(page);
    await openBirthDialog(page);
    await recordBirthOn(panels(page).first(), '♂');

    await page.keyboard.press('Escape');
    await page.getByTestId('step-success').click();
    await expect(page.getByTestId('pane-success')).toBeVisible();
    expect(
      Number(await page.getByTestId('success-progress').getAttribute('data-done'))
    ).toBeGreaterThan(0);
  });

  test('une couleur déjà collectionnée se lit comme acquise', async ({ page }) => {
    // Le succès demande « au moins une fois » : une ligne suffit, et la couleur
    // quitte la liste des manquantes.
    const mock = await mockSupabase(page);
    mock.tables.user_breeding_hatched = [
      { user_id: '00000000-0000-0000-0000-0000000000e2', family: 'muldo', color_id: 'dore' },
    ];
    await openSuccess(page);

    await expect(page.getByTestId('success-progress')).toHaveAttribute('data-done', '1');
    expect(await page.getByTestId('success-missing').count()).toBe(119);
  });
});
