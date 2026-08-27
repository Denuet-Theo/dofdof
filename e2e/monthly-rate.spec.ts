import { expect, test } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Le rythme en millions de kamas par mois, à l'écran.
 *
 * C'est l'unité dans laquelle la politique a été choisie — le Rust joue un
 * calendrier, une fournée par jour, et imprime des mois — et elle n'arrivait pas
 * jusqu'à l'écran. L'éleveur lisait « 32 accouplements · 56/60 places » et devait
 * traduire lui-même en kamas pour savoir si sa journée valait la manipulation.
 *
 * ## Ce que ces tests tiennent
 *
 * **L'arithmétique, et pas la valeur.** Le montant dépend de l'écurie, des prix
 * saisis et du niveau conseillé ; le figer ferait rougir ce fichier au premier
 * changement de politique, sans rien dire de faux. Ce qui doit tenir est
 * l'identité : `perMonth = 30 × net`, et `net = génétons + ventes − frais`. Un
 * poste oublié dans le net casse la seconde ; un mois compté en semaines casse la
 * première.
 *
 * **Que le chiffre apparaisse du tout.** Il vit sur `fill.earnings`, que
 * `readPlan` remplit en cumulant les deltas des croisements **retenus**. Le piège
 * est là : les croisements refusés — stériles, hors plan — passent par `continue`
 * avant le cumul, et les compter aurait annoncé des génétons que la fournée ne
 * touchera pas.
 *
 * ## Comment ils échouent sans le code
 *
 * Mesuré. En retirant `earnings` de `readPlan`, `tsc` refuse le fichier et les
 * deux tests ne trouvent plus `policy-earnings`. En comptant le cumul **avant**
 * les deux portes de `readPlan` — donc en incluant les refusés — le second test
 * voit un net qui ne recolle plus à la somme de ses postes.
 */

/** Une monture nommée, telle que la base la porte. */
const mount = (
  n: number,
  colorId: string,
  sex: 'M' | 'F',
  parents: [string, string],
  name: string
) => ({
  id: `6017-0000-0000-0000-${String(n).padStart(12, '0')}`,
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
 * Une écurie qui croise **et** qui vend.
 *
 * Les deux moitiés du net doivent être non nulles ou l'identité se vérifierait à
 * moitié : des gen 2 pour que la fournée croise et rende des génétons, et une gen 4
 * hors plan pour que `settle` la sacrifie et que les ventes comptent.
 */
const stable = () => [
  mount(1, 'indigo_dore', 'M', ['indigo', 'dore'], 'G2 IND-DO M'),
  mount(2, 'indigo_dore', 'F', ['indigo', 'dore'], 'G2 IND-DO F'),
  mount(3, 'ebene_pourpre', 'M', ['ebene', 'pourpre'], 'G2 EBE-POU M'),
  mount(4, 'ebene_pourpre', 'F', ['ebene', 'pourpre'], 'G2 EBE-POU F'),
  mount(5, 'indigo', 'M', ['indigo', 'indigo'], 'G1 IND M'),
  mount(6, 'dore', 'F', ['dore', 'dore'], 'G1 DO F'),
];

/** Le titre porte la décomposition ; on la relit pour vérifier la somme. */
const partsOf = (title: string) => {
  const kamas = (label: string) => {
    const found = new RegExp(`${label} (-?[\\d\\s ]+|-?[\\d,]+ M)`).exec(title);
    if (!found) return 0;
    const raw = found[1].trim();
    return raw.endsWith('M')
      ? Math.round(Number(raw.replace(' M', '').replace(',', '.')) * 1e6)
      : Number(raw.replace(/[\s ]/g, ''));
  };
  return {
    genetons: kamas('Génétons'),
    sales: kamas('\\+ ventes'),
    load: kamas('− chargement'),
    purchases: kamas('− achats'),
  };
};

/**
 * Le géneton prisé, pour l'autre moitié du test.
 *
 * `bestGenetonValue` prend le **meilleur** rapport parmi les contreparties, donc
 * un seul parchemin suffit à donner un prix au géneton. Le Petit Parchemin
 * d'Agilité en vaut dix : à 15 000 kamas, le géneton vaut 1 500.
 */
const PARCHEMIN = {
  item_id: 798,
  item_name: "Petit Parchemin d'Agilité",
  icon_url: 'https://api.dofusdb.fr/img/items/798.png',
  price: '15000',
  updated_at: '2026-08-27T10:00:00.000Z',
  updated_by: '00000000-0000-0000-0000-0000000000e2',
};

test.describe('le rythme mensuel', () => {
  test('le mois vaut trente fois la fournée', async ({ page }) => {
    const mock = await mockSupabase(page);
    mock.tables.user_breeding_individuals = stable() as never;
    await openBreeding(page);

    const line = page.getByTestId('policy-earnings');
    await expect(line).toBeVisible();

    // Trente fournées par mois, une par jour — la contrainte de la Mangeoire.
    //
    // Les deux moitiés de la phrase sont rendues séparément : le mois en millions
    // au centième, la fournée à l'unité. C'est ce qui rend la comparaison utile —
    // dériver l'une de l'autre ici ne vérifierait que la division qu'on vient de
    // faire. L'attribut porte le chiffre exact, hors arrondi d'affichage.
    const perMonth = Number(await line.getAttribute('data-per-month'));
    const shown = (await line.innerText()).replace(/\s+/g, ' ');
    expect(Number.isFinite(perMonth)).toBe(true);
    expect(shown).toContain('par mois à ce rythme');

    const monthShown = /(-?[\d,]+) M par mois/.exec(shown);
    const batchShown = /— (-?[\d  ]+|-?[\d,]+ M) par fournée/.exec(shown);
    expect(monthShown).not.toBeNull();
    expect(batchShown).not.toBeNull();

    const asKamas = (raw: string) =>
      raw.trim().endsWith('M')
        ? Number(raw.replace(' M', '').replace(',', '.')) * 1e6
        : Number(raw.replace(/[\s ]/g, ''));

    // Le mois affiché est bien le mois calculé, au centième de million près.
    expect(Math.abs(asKamas(`${monthShown![1]} M`) - perMonth)).toBeLessThan(5_000);
    // Et la fournée affichée en est le trentième. Un facteur faux d'un côté — une
    // semaine, un mois de 31 jours — écarte les deux chiffres l'un de l'autre.
    expect(Math.abs(asKamas(batchShown![1]) - perMonth / 30)).toBeLessThan(5_000);
  });

  test('le net est la somme de ses postes, et rien d’autre', async ({ page }) => {
    const mock = await mockSupabase(page);
    mock.tables.user_breeding_individuals = stable() as never;
    await openBreeding(page);

    const line = page.getByTestId('policy-earnings');
    await expect(line).toBeVisible();

    const title = (await line.getAttribute('title')) ?? '';
    const parts = partsOf(title);
    const perMonth = Number(await line.getAttribute('data-per-month'));
    const net = perMonth / 30;

    // Les recettes sont réelles : une fournée qui ne croise ni ne vend vérifierait
    // l'identité par 0 = 0, ce qui ne dirait rien du cumul.
    expect(parts.genetons + parts.sales).toBeGreaterThan(0);
    // Le chargement se paie dès qu'un accouplement est proposé — même condition
    // que le test de solvabilité de `settle`, sans quoi l'écran annoncerait un
    // gain sur une fournée que la politique refuse faute de kamas.
    expect(parts.load).toBeGreaterThan(0);

    const sum = parts.genetons + parts.sales - parts.load - parts.purchases;
    // Tolérance d'un kama par poste : le titre est arrondi à l'unité, pas le calcul.
    expect(Math.abs(net - sum)).toBeLessThan(5);
  });

  /**
   * Un zéro faute de prix n'est pas un zéro de recette.
   *
   * `genetonValue` vaut `valuePerGeneton ?? 0`, et sans saisie de l'éleveur le poste
   * `genetons` est nul. Sur la fixture ce seul zéro fait passer le rythme de
   * positif à **-1,56 M par mois** : affiché sec, il se lit comme une politique qui
   * perd de l'argent, alors qu'il dit qu'une recette n'a pas été chiffrée.
   *
   * C'est la règle du dépôt appliquée à un chiffre plutôt qu'à une écriture : un
   * état qu'on n'a pas pu lire n'est pas un état connu.
   *
   * Sans le correctif — en retirant le bloc `genetonsPriced` du panneau — la
   * première moitié échoue : la mention n'existe pas et le -1,56 M reste seul.
   */
  test('un géneton sans prix se dit, au lieu de compter zéro', async ({ page }) => {
    const mock = await mockSupabase(page);
    mock.tables.user_breeding_individuals = stable() as never;
    await openBreeding(page);

    const line = page.getByTestId('policy-earnings');
    await expect(line).toBeVisible();
    await expect(page.getByTestId('earnings-no-geneton')).toBeVisible();
    const withoutPrice = Number(await line.getAttribute('data-per-month'));
    expect(partsOf((await line.getAttribute('title')) ?? '').genetons).toBe(0);

    // Le même écurie, le même plan, un prix de plus. La mention doit tomber et la
    // recette apparaître — sinon le prix saisi ne sert à rien, ce qui serait le
    // symétrique du défaut.
    const priced = await mockSupabase(page);
    priced.tables.user_breeding_individuals = stable() as never;
    priced.tables.item_prices = [
      ...(priced.tables.item_prices as never as Record<string, unknown>[]),
      PARCHEMIN,
    ] as never;
    await openBreeding(page);

    const second = page.getByTestId('policy-earnings');
    await expect(second).toBeVisible();
    await expect(page.getByTestId('earnings-no-geneton')).toHaveCount(0);
    expect(partsOf((await second.getAttribute('title')) ?? '').genetons).toBeGreaterThan(0);
    // La recette entre dans le net, elle ne s'affiche pas à côté.
    expect(Number(await second.getAttribute('data-per-month'))).toBeGreaterThan(withoutPrice);
  });
});
