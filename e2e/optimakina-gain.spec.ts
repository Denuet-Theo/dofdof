import { expect, test } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding, openBirthDialog } from './support/breeding';

/**
 * Ce que l'Optimakina ajoute est **plat, et se lit sur le taux du couple**.
 *
 * ## Le relevé qui l'a réfuté
 *
 * Deux fenêtres d'accouplement sur le même couple, en jeu, 28/08 : « Génération
 * cible · Turquoise 49,8 % » sans Optimakina, « 59,8 % » avec. Dix points pile.
 * La pastille de l'app annonçait **+5,2 pts** sur ce même croisement.
 *
 * ## Pourquoi 5,2 et pas 10
 *
 * `rateWith` arrivait tout calculé dans la prop, sur le **niveau conseillé** —
 * `targetGenerationRate(level, level)` — et la vue en soustrayait le taux du
 * couple, qui vient de ses deux parents réels. Deux bases, une soustraction : la
 * différence des deux niveaux, plus dix points, moins ce que le couple a de
 * moins. Le bonus lui-même n'a jamais été faux : `OPTIMAKINA_BONUS` vaut 0,1 et
 * s'ajoute partout ailleurs correctement.
 *
 * Le correctif fait entrer le calcul dans la vue, sur la seule base qui y est en
 * portée. C'est ce que ce test tient : le gain affiché doit être **exactement**
 * dix points tant que le couple est sous 90 %, et le plafond à 100 % au-dessus.
 */

const CROWN_PRICE = {
  family: 'muldo',
  color_id: 'azur_dore',
  mount_level: 0,
  price: '4000000',
  updated_at: '2026-08-18T10:00:00Z',
  updated_by: '00000000-0000-0000-0000-0000000000e2',
};

/** Dérisoire exprès : le sujet est le gain affiché, pas la frontière du seuil. */
const OPTIMAKINA_GEN2 = {
  item_id: 33335,
  item_name: 'Optimakina Muldo de Génération 2',
  icon_url: 'https://api.dofusdb.fr/img/items/97328.png',
  price: '1000',
  updated_at: '2026-08-27T10:00:00Z',
  updated_by: '00000000-0000-0000-0000-0000000000e2',
};

test('la pastille annonce les dix points que le jeu donne', async ({ page }) => {
  const mock = await mockSupabase(page);
  (mock.tables.breeding_color_prices as Record<string, unknown>[]).push(CROWN_PRICE);
  (mock.tables.item_prices as Record<string, unknown>[]).push(OPTIMAKINA_GEN2);
  await openBreeding(page);
  await openBirthDialog(page);

  // Le premier croisement qui porte une Optimakina : c'est le seul écran où le
  // gain est chiffré, et il ne paraît que là où une Optimakina se rembourse.
  const pastille = page.getByTestId('mate-optimakina').first();
  await expect(pastille).toBeVisible({ timeout: 30_000 });
  const panneau = page.getByTestId('mating-panel').filter({ has: pastille }).first();

  const affiche = await panneau.getByTestId('mate-success-rate').innerText();
  const taux = Number(affiche.replace('%', '').replace(',', '.').trim());
  // Anti-vacuité, deux fois. Un taux nul rendrait la suite vraie sans rien dire,
  // et un taux au-dessus de 90 % ferait de « dix points » la mauvaise réponse —
  // le plafond mordrait, et le test passerait pour une raison fausse.
  expect(taux).toBeGreaterThan(0);
  expect(taux).toBeLessThan(90);

  // Dix points, plats. C'est le relevé en jeu, et c'est ce que la pastille doit
  // dire : ni la différence de deux niveaux, ni un écart au niveau conseillé.
  await expect(pastille).toContainText('+10.0 pts');
});
