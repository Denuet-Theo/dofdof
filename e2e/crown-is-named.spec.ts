import { expect, test } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Le plan dit **quelle** gen 10 il vise.
 *
 * ## La plainte que ça ferme
 *
 * Relevé du 14/08 : le projet demandait Azur-Doré depuis huit jours et le plan
 * visait Ambre-Doré, « **sans que rien ne le dise** ». À l'époque le remède choisi
 * fut d'imposer la couronne du projet — et imposer coupait le plan sur cette seule
 * route, si bien qu'une gen 9 d'une autre couleur devenait inemployable.
 *
 * Le projet **pèse** maintenant au lieu d'imposer : il entre dans le tri avec
 * `CROWN_PREFERENCE` et remporte la couronne 91,4 % du temps, mesuré sur 500
 * tirages de prix. Neuf fois sur dix, pas dix. Il faut donc que l'écran dise
 * laquelle a été retenue, sans quoi on a rendu le silence possible à nouveau.
 *
 * ## Ce que ce test ne couvre pas, et pourquoi
 *
 * Le cas où le projet **perd**. Le faux serveur ne porte aucune table de prix de
 * couleur, donc toutes les gen 10 valent pareil, donc le bonus du projet gagne
 * toujours et la branche « tu demandais X » n'est jamais rendue.
 *
 * La couvrir demanderait d'ajouter les prix au mock et d'en poser un au-dessus de
 * `prix du projet + 400 000` — un vrai travail de fixture, pas une ligne. C'est dit
 * ici plutôt que laissé à deviner : cette branche-là n'est tenue que par `tsc`.
 */
test.describe('la couronne retenue', () => {
  test('le plan nomme la gen 10 qu’il vise', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await page.getByTestId('step-load').click();
    await expect(page.getByTestId('pane-load')).toBeVisible();

    const crown = page.getByTestId('policy-crown');
    await expect(crown).toBeVisible();
    // Le plan vise une couleur **nommée** : la phrase ne doit jamais rester creuse.
    await expect(crown).toContainText(/Le plan vise\s+\S+/);
  });

  test('quand c’est le projet qui est visé, il le confirme', async ({ page }) => {
    // La fixture porte le projet du 15/08, `azur_dore`. Sans prix de couleur
    // saisis, toutes les gen 10 se valent et le bonus du projet l'emporte : le plan
    // doit donc viser Azur-Doré **et le dire**.
    await mockSupabase(page);
    await openBreeding(page);
    await page.getByTestId('step-load').click();
    await expect(page.getByTestId('pane-load')).toBeVisible();

    const crown = page.getByTestId('policy-crown');
    await expect(crown).toContainText(/comme ton projet le demande/);
  });
});
