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
 * ## La comparaison, et pourquoi elle est à l'écran
 *
 * La liste donnait la source retenue et son prix, sans dire à quoi il se
 * comparait. Devant l'hôtel de vente ça ne se vérifie pas : on voit une enchère
 * et rien pour savoir si elle bat sa propre recette. Les deux prix, l'écart et le
 * plafond sont donc rendus sous la puce — le plafond en particulier, qui était
 * dans l'infobulle, c'est-à-dire nulle part au moment de comparer.
 *
 * ## La branche « fabrication » est couverte depuis
 *
 * Elle ne l'était pas, et l'en-tête de cette spec le disait : le faux serveur
 * répondait à vide sur `/api/dofusdb/**`, donc `craft` restait `null` et l'achat
 * gagnait toujours. Il suffisait d'une route plus précise, enregistrée après
 * `mockSupabase` — la recette ci-dessous et son unique ingrédient tarifé. La
 * descente d'ingrédients ne part pas : sans `hasRecipe`, `craftableIngredientIds`
 * ne rend rien.
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

/** L'unique ingrédient de la recette ci-dessous, tarifé : deux à 300. */
const INGREDIENT = {
  item_id: 900001,
  item_name: 'Poudre de test',
  icon_url: 'https://api.dofusdb.fr/img/items/900001.png',
  price: '300',
  updated_at: '2026-08-27T10:00:00Z',
  updated_by: '00000000-0000-0000-0000-0000000000e2',
};

/**
 * La recette de la gen 2 : 2 × 300 = 600, contre 1 000 à l'hôtel de vente.
 *
 * 600 et 1 000 passent tous deux le plafond — sinon on ne testerait pas « la
 * moins chère gagne » mais « l'autre est rejetée », ce que la spec voisine fait
 * déjà. `ingredients` est omis exprès : `craftableIngredientIds` lit `hasRecipe`,
 * et sans lui la descente d'ingrédients ne part pas.
 */
const RECETTE_GEN2 = {
  id: 1,
  resultId: OPTIMAKINA_GEN2.item_id,
  resultTypeId: 0,
  resultLevel: 1,
  ingredientIds: [INGREDIENT.item_id],
  quantities: [2],
  jobId: 0,
  skillId: 0,
  resultName: { fr: OPTIMAKINA_GEN2.item_name },
};

/** Les milliers d'un nombre séparés comme `toLocaleString('fr-FR')` le fait. */
const espaces = (value: number): string =>
  String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '\\s');

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
    await expect(ligne).toContainText(new RegExp(espaces(attendu)));

    const comparaison = ligne.getByTestId('optimakina-comparison');
    // Le prix retenu et **celui qu'on évite**, à l'écran. Ici la fabrication n'est
    // pas chiffrée — ce test-ci ne sert aucune recette — et c'est dit plutôt que
    // laissé en blanc : « fabrication non chiffrable » se corrige en tarifant un
    // ingrédient, un vide ne se corrige pas.
    await expect(comparaison).toContainText(/HDV\s+1\s000/);
    await expect(comparaison).toContainText('fabrication non chiffrable');

    // Le plafond **sur la ligne**, et non dans l'infobulle : c'est le seul des
    // quatre nombres qui vaille pour demain — les deux prix sont ceux du jour —
    // et une infobulle ne se lit pas devant une enchère qu'on n'avait pas prévue.
    const plafond = Number(await comparaison.getAttribute('data-ceiling'));
    // Anti-vacuité : sans un plafond au-dessus de 1 000, cette ligne n'existerait
    // pas du tout, et l'assertion suivante passerait sur n'importe quel nombre.
    expect(plafond).toBeGreaterThan(1000);
    await expect(comparaison).toContainText(
      new RegExp(`rentable jusqu’à\\s${espaces(plafond)}`)
    );
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

  /**
   * La recette moins chère l'emporte, **et l'écran montre l'enchère qu'elle bat**.
   *
   * Les deux moitiés comptent. La première tient la branche que cette spec
   * déclarait non couverte : à 1 000 à l'hôtel de vente contre 600 en atelier, la
   * liste doit basculer de « À acheter » à « À fabriquer ». La seconde est ce que
   * l'éleveur a demandé — le prix évité à côté du prix payé, sans quoi la
   * recommandation est à croire et non à vérifier.
   *
   * L'anti-vacuité est la bascule elle-même : le test voisin charge la **même**
   * écurie sans recette et y lit « À acheter ». Seule la recette change ici, donc
   * c'est bien elle qui tranche.
   */
  test('la fabrication l’emporte, et la ligne montre le prix évité', async ({ page }) => {
    const mock = await mockSupabase(page);
    (mock.tables.breeding_color_prices as Record<string, unknown>[]).push(CROWN_PRICE);
    (mock.tables.item_prices as Record<string, unknown>[]).push(OPTIMAKINA_GEN2, INGREDIENT);
    // Enregistrée après `mockSupabase`, donc prioritaire sur son `/api/dofusdb/**`
    // qui répond à vide — c'est ce vide qui laissait la fabrication non testée.
    await page.route('**/api/dofusdb/recipes**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 1, limit: 50, skip: 0, data: [RECETTE_GEN2] }),
      })
    );
    await openBreeding(page);
    await page.getByTestId('step-mate').click();

    const advice = page.getByTestId('optimakina-advice');
    await expect(advice).toBeVisible({ timeout: 30_000 });
    const ligne = advice.getByTestId('optimakina-line').filter({ hasText: 'gen 2' });
    await expect(ligne).toHaveCount(1);

    // La bascule : la même gen 2, la même enchère, et l'atelier gagne.
    await expect(advice).toContainText('À fabriquer');
    await expect(advice).not.toContainText('À acheter');

    const comparaison = ligne.getByTestId('optimakina-comparison');
    await expect(comparaison).toHaveAttribute('data-source', 'fabrication');
    // Les deux prix et l'écart : 600 payés, 1 000 évités, 40 % de moins.
    await expect(comparaison).toContainText(/fabrication\s+600/);
    await expect(comparaison).toContainText(/HDV\s+1\s000/);
    await expect(comparaison).toContainText(/[−–-]40\s%/);

    // Le total de la puce suit la source retenue, pas l'enchère : c'est la somme
    // à sortir, et la sortir en kamas d'hôtel de vente serait la mauvaise.
    const quantite = Number(await ligne.getAttribute('data-quantity'));
    await expect(ligne).toContainText(new RegExp(espaces(quantite * 600)));
  });
});
