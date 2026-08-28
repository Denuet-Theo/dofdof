import { expect, test } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Les Optimakina qui se remboursent, **avant** d'ouvrir la fenêtre du jeu.
 *
 * ## La plainte que ça ferme
 *
 * Une Optimakina achète dix points de réussite pour un prix fixe, et le calcul
 * savait déjà dire lesquelles valent le geste — `fixedParentLevel` rend
 * `useOptimakina` depuis toujours. Mais la réponse ne sortait pas de `costs.ts` :
 * l'éleveur ne pouvait ni savoir laquelle préparer avant la fournée, ni la voir
 * au moment d'accoupler. Une fois devant l'enclos, partir en acheter coûte le
 * geste qu'on venait faire.
 *
 * ## Le seuil, et ce qu'il compte
 *
 * Dix pour cent de ce qu'un succès rapporte, et un succès rapporte **deux**
 * choses : l'avancement vers la couronne, amorti sur les barreaux qui restent, et
 * les génétons des deux parents. Omettre les génétons rejetait des Optimakina qui
 * se remboursent — sur le relevé du 27/08, le plafond de la gen 6 passe de
 * ~12 000 à 14 940 une fois les 30 génétons comptés.
 *
 * ## Ce que ce test ne couvre pas, et pourquoi
 *
 * La liste « à fabriquer ». Elle demande les recettes des neuf items, que le faux
 * serveur ne porte pas : `fetchRecipesForItems` sort à vide, donc `craft` reste
 * `null` et la source la moins chère est toujours l'achat. Couvrir l'autre
 * branche demanderait de monter une recette et ses ingrédients dans le mock —
 * un vrai travail de fixture, pas une ligne. C'est dit ici plutôt que laissé à
 * deviner : cette branche-là n'est tenue que par `tsc`.
 */

/** Le prix de la gen 10 visée : sans lui, aucun plafond ne se calcule. */
const CROWN_PRICE = {
  family: 'muldo',
  color_id: 'azur_dore',
  mount_level: 0,
  price: '4000000',
  updated_at: '2026-08-18T10:00:00Z',
  updated_by: '00000000-0000-0000-0000-0000000000e2',
};

/**
 * L'Optimakina de gen 2, à un prix dérisoire.
 *
 * Dérisoire **exprès** : le test porte sur « la liste paraît et nomme la
 * génération », pas sur la frontière du seuil. Un prix collé au plafond rendrait
 * l'assertion dépendante du prix de la couronne et du barème des génétons, donc
 * cassante pour une raison sans rapport.
 */
const OPTIMAKINA_GEN2 = {
  item_id: 33335,
  item_name: 'Optimakina Muldo de Génération 2',
  icon_url: 'https://api.dofusdb.fr/img/items/97328.png',
  price: '1000',
  updated_at: '2026-08-27T10:00:00Z',
  updated_by: '00000000-0000-0000-0000-0000000000e2',
};

test.describe('les Optimakina conseillées', () => {
  test('la liste nomme celle qui se rembourse, et sa source', async ({ page }) => {
    const mock = await mockSupabase(page);
    (mock.tables.breeding_color_prices as Record<string, unknown>[]).push(CROWN_PRICE);
    (mock.tables.item_prices as Record<string, unknown>[]).push(OPTIMAKINA_GEN2);
    await openBreeding(page);

    await page.getByTestId('step-mate').click();
    const advice = page.getByTestId('optimakina-advice');
    await expect(advice).toBeVisible({ timeout: 30_000 });

    // La source, puis la génération : les deux, parce qu'une liste qui dit
    // « gen 2 » sans dire quoi en faire renvoie chercher l'information ailleurs.
    await expect(advice).toContainText('À acheter');
    await expect(advice).toContainText('gen 2');
    // Le prix **unitaire** vit désormais dans l'infobulle, et la ligne porte le
    // total : elle sert à savoir combien sortir à l'hôtel de vente, pas à comparer
    // une enchère. Les deux comptent, donc les deux sont vérifiés.
    const ligne = advice.getByTestId('optimakina-line').filter({ hasText: 'gen 2' });
    // `\s` et non un espace : `toLocaleString('fr-FR')` sépare les milliers par
    // une espace **insécable étroite**, invisible à la relecture et qui fait
    // échouer un motif littéral.
    await expect(ligne).toHaveAttribute('title', /1\s000 kamas pièce/);
    const attendu = Number(await ligne.getAttribute('data-quantity')) * 1000;
    await expect(ligne).toContainText(new RegExp(String(attendu).replace(/\B(?=(\d{3})+(?!\d))/g, '\\s')));
  });

  /**
   * Le seuil **rejette** ce qui ne se rembourse pas.
   *
   * ## Pourquoi le même écran est chargé deux fois
   *
   * L'anti-vacuité de cette spec reposait sur les quatre Optimakina que la fixture
   * tarife — gen 5 à 15 000, gen 6 à 16 000, gen 7 à 23 000, gen 8 à 35 000 : la
   * liste paraissait de toute façon, donc l'absence de la gen 2 disait quelque
   * chose.
   *
   * Elle ne paraît plus. Depuis que le conseil ne retient que les générations que
   * la fournée **vise**, ces quatre-là disparaissent — aucun accouplement immédiat
   * ne les vise — et « la gen 2 n'y est pas » redeviendrait vrai sur un écran vide.
   *
   * D'où deux chargements de la **même** écurie, où seul le prix de la gen 2
   * change : à 1 000 elle est conseillée, à dix millions elle ne l'est plus. Les
   * croisements sont les mêmes des deux côtés, donc c'est bien le prix qui
   * tranche, et rien d'autre. Gen 2 parce que c'est le plafond le plus bas : deux
   * génétons et le plus long chemin restant vers la couronne.
   */
  test('une Optimakina hors de prix n’est pas conseillée', async ({ page }) => {
    const abordable = await mockSupabase(page);
    (abordable.tables.breeding_color_prices as Record<string, unknown>[]).push(CROWN_PRICE);
    (abordable.tables.item_prices as Record<string, unknown>[]).push(OPTIMAKINA_GEN2);
    await openBreeding(page);
    await page.getByTestId('step-mate').click();
    await expect(page.getByTestId('optimakina-advice')).toBeVisible({ timeout: 30_000 });
    // Le témoin : à 1 000 kamas, la fournée la réclame.
    await expect(
      page.getByTestId('optimakina-line').filter({ hasText: 'gen 2' })
    ).toHaveCount(1);

    const horsDePrix = await mockSupabase(page);
    (horsDePrix.tables.breeding_color_prices as Record<string, unknown>[]).push(CROWN_PRICE);
    (horsDePrix.tables.item_prices as Record<string, unknown>[]).push({
      ...OPTIMAKINA_GEN2,
      price: '10000000',
    });
    await openBreeding(page);
    await page.getByTestId('step-mate').click();
    // Les mêmes croisements, dix mille fois le prix : dix pour cent de ce qu'un
    // succès de gen 2 rapporte n'atteint pas cette somme, de très loin.
    await expect(
      page.getByTestId('optimakina-line').filter({ hasText: 'gen 2' })
    ).toHaveCount(0);
  });
});
