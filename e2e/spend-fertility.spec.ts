import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Une féconde qu'on ne dépense pas.
 *
 * Un enclos payé, un cycle attendu, et la monture en ressort prête à
 * s'accoupler sans repasser par la case enclos. C'est le seul geste de cet écran
 * qui produise du gratuit. La politique n'y touchait pas : sur l'écurie qui l'a
 * fait remonter, 44 fécondes en stock, 8 dépensées, **un seul** accouplement
 * sans enclos là où la valeur myope en fait cinq.
 *
 * ## Pourquoi
 *
 * Le réseau compte une féconde comme un actif — ses poids sur `cycledMales` /
 * `cycledFemales` sont francs et positifs — et croiser en **retire** une du
 * recensement. Il paie donc pour en fabriquer et pour ne pas s'en servir. La
 * cause est celle de `pairedBanking` : le champion vient du tapis roulant, où la
 * fécondité tombe au hasard et ne s'achète pas, si bien que « plus de fécondes »
 * y était le signe d'une bonne écurie et jamais une décision.
 *
 * `UNSPENT_FERTILITY` retire au score ce que chaque féconde en stock immobilise.
 * Mesuré par `replay` sur 200 graines scellées : +2,55 M au score médian et
 * +4,9 gen 10 tenues, avec **moins** de croisements et **moins** d'achats.
 *
 * ## Comment ces tests échouent sans le correctif
 *
 * Mesuré, en retirant le terme de `policy.ts` : **4 reproductions contre
 * aucune**. Une écurie qui n'est **que** des montures prêtes à s'accoupler, et
 * l'écran répondait « aucun accouplement possible tout de suite ».
 *
 * ## Pourquoi la fixture du 15/08 n'est pas ici
 *
 * Elle y a été, et elle a été retirée : elle rendait 23 reproductions contre 18
 * quand ce correctif a été écrit, puis 20 **des deux côtés** une fois rebasée sur
 * `main`. Un test qui reste vert avec le défaut remis ne garde rien et coûte la
 * confiance qu'on met dans les autres — il vaut mieux une écurie fabriquée qui
 * tranche qu'une écurie réelle qui ne tranche plus.
 */

/** Une féconde nommée, prête à s'accoupler sans enclos. */
const cycledMount = (n: number, colorId: string, sex: 'M' | 'F') => ({
  id: `fec00000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  user_id: '00000000-0000-0000-0000-0000000000e2',
  family: 'muldo',
  color_id: colorId,
  sex,
  level: 100,
  fertile: true,
  parent_a_color: 'dore',
  parent_b_color: 'pourpre',
  parent_a_id: null,
  parent_b_id: null,
  created_at: '2026-08-17T10:00:00.000Z',
  updated_at: '2026-08-17T10:00:00.000Z',
  name: `G2 ${colorId.slice(0, 2).toUpperCase()} ${sex}${n}`,
  cycled: true,
});

/** Vingt fécondes, deux par couleur et par sexe. Rien d'autre : aucune excuse. */
const onlyCycled = () => {
  const rows = [];
  let n = 0;
  for (const colorId of ['dore', 'pourpre', 'indigo', 'ebene', 'orchidee']) {
    for (const sex of ['M', 'F'] as const) {
      for (let k = 0; k < 2; k += 1) rows.push(cycledMount((n += 1), colorId, sex));
    }
  }
  return rows;
};

/**
 * Les accouplements que l'écran propose **sans enclos**.
 *
 * `couplesToRecord` ne retient que les couples à zéro place : ce compteur est
 * donc exactement le nombre de fécondes appariées deux à deux, et rien d'autre.
 */
const matings = async (page: Page): Promise<number> => {
  await page.getByTestId('step-mate').click();
  const pane = page.getByTestId('pane-mate');
  await expect(pane).toBeVisible();
  const text = (await pane.innerText()).replace(/\s+/g, ' ');
  return Number(text.match(/(\d+)\s+reproductions?\s+à faire/)?.[1] ?? 0);
};

test.describe('dépenser la fécondité', () => {
  test('vingt fécondes ne restent pas au repos', async ({ page }) => {
    const mock = await mockSupabase(page);
    mock.tables.user_breeding_individuals = onlyCycled() as never;
    await openBreeding(page);

    // Dix couples possibles au plus ; on n'en exige pas dix — le choix du
    // partenaire reste celui de la politique — mais zéro n'est pas une réponse.
    expect(await matings(page)).toBeGreaterThanOrEqual(3);
  });

});
