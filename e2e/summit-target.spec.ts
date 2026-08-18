import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Les tentatives sur la cible, quand la cible est une gen 10.
 *
 * L'éleveur vise Azur-Doré et n'en voyait jamais une seule tentative. La raison
 * n'était pas le champion : `aimsAt` refusait les croisements **avant** que la
 * recherche les voie. Une gen 10 ne monte plus — `climbs` rend `false` par
 * construction — donc tout croisement qui l'emploie était classé comme une
 * recopie et écarté du plan.
 *
 * Or Azur-Doré n'a qu'une recette, `Azur (g9) × Doré (g1)`, et l'éleveur n'a pas
 * d'Azur gen 9. Ses deux gen 10 azurées, elles, la nomment : sur son écurie, 26
 * partenaires de son coffre donnaient Azur-Doré, jusqu'à 13,95 % avec une simple
 * Doré gen 1. Aucun n'était proposable.
 *
 * ## Trois portes, et il fallait les ouvrir ensemble
 *
 * `admissible` dans la recherche, `aimsAt` de nouveau dans `readPlan`, et
 * `aimedAt` qui refusait de nommer une cible sur un couple qui ne monte pas.
 * N'en ouvrir que la première ferait composer un croisement que l'affichage
 * jetterait ensuite — le défaut que `SearchConfig.admissible` documente déjà.
 *
 * ## Ce qui reste fermé
 *
 * La boucle du forum, qui accumule des gen 10 pour les vendre (`'all'`, mesurée
 * à +43 M dans le modèle et fausse au marché). Seuls passent les croisements qui
 * nomment une couleur de `ladder.summit` — ce pour quoi l'échelle existe. Le
 * deuxième test tient cette frontière.
 *
 * ## Comment ces tests échouent sans le correctif
 *
 * Mesuré, en repassant `'target'` à `'hold'` dans `policy.ts` : la gen 10
 * disparaît de la fournée, et le premier test ne trouve plus sa ligne.
 */

/** Une monture nommée, telle que la base la porte. */
const mount = (
  n: number,
  colorId: string,
  sex: 'M' | 'F',
  parents: [string, string],
  name: string
) => ({
  id: `5017-0000-0000-0000-${String(n).padStart(12, '0')}`,
  user_id: '00000000-0000-0000-0000-0000000000e2',
  family: 'muldo',
  color_id: colorId,
  sex,
  level: 100,
  fertile: true,
  parent_a_color: parents[0],
  parent_b_color: parents[1],
  parent_a_id: null,
  parent_b_id: null,
  created_at: '2026-08-17T10:00:00.000Z',
  updated_at: '2026-08-17T10:00:00.000Z',
  name,
  cycled: false,
});

/**
 * Une écurie courte, et c'est délibéré : la fixture du 15/08 porte 203 montures
 * et de quoi occuper soixante places sans jamais avoir besoin d'une gen 10. On
 * ne teste pas ici ce que le champion **préfère** — c'est son affaire — mais ce
 * qu'il a le droit de proposer. Une écurie où il reste des places dit ça sans
 * ambiguïté.
 */
const stableWith = (top: { colorId: string; parents: [string, string]; name: string }) => {
  const rows = [mount(1, top.colorId, 'F', top.parents, top.name)];
  let n = 10;
  for (const color of ['dore', 'pourpre', 'indigo', 'ebene']) {
    for (const sex of ['M', 'F'] as const) {
      for (let k = 0; k < 2; k += 1) {
        n += 1;
        rows.push(
          mount(n, color, sex, ['dore', 'pourpre'], `G2 ${color.slice(0, 2).toUpperCase()} ${sex}${n}`)
        );
      }
    }
  }
  return rows;
};

/** Toutes les lignes de la fournée, enclos par enclos — on verrouille pour avancer. */
const wholeBatch = async (page: Page): Promise<string[]> => {
  const all: string[] = [];
  for (let pen = 0; pen < 6; pen += 1) {
    if ((await page.getByTestId('current-pen').count()) === 0) break;
    const current = page.getByTestId('current-pen');
    all.push(
      ...(await current.getByTestId('load-named').allInnerTexts()),
      ...(await current.getByTestId('load-anonymous').allInnerTexts())
    );
    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen').nth(pen)).toBeVisible();
  }
  return all.map((line) => line.replace(/\s+/g, ' ').trim());
};

const batchWith = async (
  page: Page,
  top: { colorId: string; parents: [string, string]; name: string }
) => {
  const mock = await mockSupabase(page);
  mock.tables.user_breeding_individuals = stableWith(top) as never;
  await openBreeding(page);
  await page.getByTestId('step-load').click();
  await expect(page.getByTestId('pane-load')).toBeVisible();
  return wholeBatch(page);
};

test.describe('tentatives au sommet', () => {
  test('une gen 10 qui nomme la cible entre dans la fournée', async ({ page }) => {
    // Azur-Turquoise porte [Azur, Turquoise] : mariée à ce qui apporte du Doré,
    // elle nomme Azur-Doré, la cible du projet de la fixture.
    const lines = await batchWith(page, {
      colorId: 'azur_turquoise',
      parents: ['azur', 'pourpre'],
      name: 'G10 AZTU F AZ-PO',
    });

    expect(lines.filter((line) => line.includes('G10 AZTU'))).toHaveLength(1);
  });

  test('une gen 10 qui ne nomme pas la cible reste au coffre', async ({ page }) => {
    // Ambre-Corail ne porte pas d'Azur : aucune recombinaison ne donne Azur-Doré.
    // C'est la boucle du forum, et elle doit rester fermée.
    const lines = await batchWith(page, {
      colorId: 'ambre_corail',
      parents: ['ambre', 'corail'],
      name: 'G10 AMCO F AM-CO',
    });

    expect(lines.filter((line) => line.includes('G10 AMCO'))).toHaveLength(0);
  });
});
