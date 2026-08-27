import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * « À féconder sans croiser » — la moitié d'un enclos pour rien.
 *
 * Un éleveur l'a remonté sur une capture : dix montures dans l'enclos 4, cinq
 * marquées « à féconder sans croiser ». Ce geste-là prépare un accouplement du
 * tour suivant ; il en faut zéro ou un par fournée, pas la moitié d'un enclos.
 *
 * ## D'où ça venait
 *
 * Le champion embarqué vient du tapis roulant, qui tourne à `capacity: 0`. Or
 * `randomAction` n'offre `cycle` que si `places < capacity` : **la fécondation
 * n'a jamais été proposable pendant sa sélection**. Ses poids sur `cycledMales`
 * / `cycledFemales` sont pourtant nettement positifs — sur une écurie qu'il note
 * 9,92, banquer une gen 2 mâle vaut +0,64, une gen 4 mâle +1,48, et occuper une
 * place n'en coûte que 0,009. Toute fécondation tirée faisait donc strictement
 * mieux que rien, et la montée en prenait jusqu'à épuiser les places, en
 * concurrence directe avec les croisements. `fillSparePlaces` bouchait le reste
 * sans vérifier qu'un partenaire existe.
 *
 * ## Comment ce test échoue sans le correctif
 *
 * Mesuré, en retirant `pairedBanking` de `policy.ts` :
 *
 * | écurie | avec | sans |
 * | --- | --- | --- |
 * | 15/08 (la fixture) | 0 fécondation · 18 accouplements | 3 · 17 |
 * | avancée (ci-dessous) | 0 | 8 |
 *
 * Les deux cas comptent. La fixture du 15/08 est une écurie de début — beaucoup
 * de gen 1, la politique y trouve de quoi accoupler — et le défaut n'y met que
 * trois montures en banque. C'est l'écurie **avancée** qui le montre en grand,
 * et c'est celle de la capture : des gen 2 à 4 portées, que le réseau paie le
 * plus cher. Un test qui ne couvrirait que la première laisserait passer le
 * retour du défaut sur les écuries qui en souffrent.
 */

/** Les gen 2 muldo, qui servent d'ascendance à l'écurie avancée. */
const GEN2 = [
  'dore_pourpre',
  'indigo_pourpre',
  'ebene_pourpre',
  'dore_indigo',
  'ebene_indigo',
  'dore_ebene',
  'orchidee_pourpre',
];

/** Ce que porte l'écurie avancée : des couleurs nées de gen 2, donc gen 3 et 4 portées. */
const COLORS = [
  'roux',
  'amande',
  'indigo_pourpre',
  'dore_pourpre',
  'ebene_indigo',
  'dore_indigo',
  'indigo',
  'dore',
  'pourpre',
];

/**
 * Une écurie d'éleveur avancé : 36 nommées, toutes fertiles, aucune féconde.
 *
 * Aucune n'a payé son cycle — c'est **le** régime où la question se pose, et
 * celui de la capture : chaque monture est fécondable, donc chaque place peut
 * être dépensée à banquer plutôt qu'à croiser. L'ascendance est faite de gen 2,
 * ce qui donne les générations portées que le réseau paie le plus.
 */
const advancedStable = () => {
  const rows: Record<string, unknown>[] = [];
  let count = 0;
  for (const colorId of COLORS) {
    for (let index = 0; index < 4; index += 1) {
      const a = GEN2[(count * 3 + index) % GEN2.length];
      const b = GEN2[(count * 5 + index + 2) % GEN2.length];
      count += 1;
      rows.push({
        id: `adv00000-0000-0000-0000-${String(count).padStart(12, '0')}`,
        user_id: '00000000-0000-0000-0000-0000000000e2',
        family: 'muldo',
        color_id: colorId,
        sex: index % 2 === 0 ? 'M' : 'F',
        level: 1,
        fertile: true,
        parent_a_color: a,
        parent_b_color: b,
        parent_a_id: null,
        parent_b_id: null,
        created_at: '2026-08-17T10:00:00.000Z',
        updated_at: '2026-08-17T10:00:00.000Z',
        name: `A${count} ${colorId.slice(0, 3).toUpperCase()}`,
        cycled: false,
      });
    }
  }
  return rows;
};

/** Ouvre l'onglet « Fournée ». */
const openLoadTab = async (page: Page) => {
  const tab = page.getByTestId('step-load');
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByTestId('pane-load')).toBeVisible();
};

/**
 * Les fécondations de la fournée **entière**, et non du seul enclos affiché.
 *
 * L'écran n'en montre qu'un à la fois ; c'est sur les cinq que le geste se juge,
 * et c'est pour ça que l'en-tête porte le total.
 */
const bankedTotal = async (page: Page): Promise<number> => {
  const summary = page.getByTestId('pane-load').getByTestId('load-banked');
  if ((await summary.count()) === 0) return 0;
  return Number(await summary.getAttribute('data-banked'));
};

/** Les fécondations que l'enclos en cours affiche, ligne à ligne. */
const bankedInCurrentPen = async (page: Page): Promise<number> => {
  const pen = page.getByTestId('current-pen');
  await expect(pen).toBeVisible();
  const lines = [
    ...(await pen.getByTestId('load-named').allInnerTexts()),
    ...(await pen.getByTestId('load-anonymous').allInnerTexts()),
  ];
  return lines
    .filter((line) => line.includes('à féconder sans croiser'))
    .reduce((total, line) => total + Number(line.match(/×\s*(\d+)/)?.[1] ?? 1), 0);
};

test.describe('fécondations sans croisement', () => {
  test('une écurie avancée ne part pas en banque', async ({ page }) => {
    const mock = await mockSupabase(page);
    mock.tables.user_breeding_individuals = advancedStable() as never;
    await openBreeding(page);
    await openLoadTab(page);

    // Le symptôme exact de la capture : la moitié d'un enclos en fécondations.
    expect(await bankedInCurrentPen(page)).toBeLessThanOrEqual(1);
    // Et sur la fournée entière — sans ce total, cinq enclos à une fécondation
    // chacun passeraient pour un enclos sain.
    expect(await bankedTotal(page)).toBeLessThanOrEqual(2);
  });

  test('la fournée du 15/08 dépense ses places en accouplements', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    expect(await bankedTotal(page)).toBeLessThanOrEqual(2);

    /*
     * La contrepartie : les places rendues **repartent en croisements** au lieu
     * d'être mises en banque.
     *
     * Le compte absolu — « 17 avant, 18 après » — était celui du champion, et il
     * est tombé à 14 quand l'écran est passé à l'échelle. Ce n'était pas une
     * régression : la garde du dessus (`bankedTotal <= 2`) dit déjà que rien ne
     * part en fécondation, et une politique a le droit de composer une fournée
     * autrement.
     *
     * On épingle donc la **relation** et non le nombre : la fournée remplit le
     * parc, et elle le remplit d'accouplements. Ça tient quelle que soit la
     * politique, là où un total ne survit pas au premier changement d'avis.
     */
    await page.getByTestId('step-mate').click();
    const mate = await page.getByTestId('pane-mate').innerText();
    const count = Number(mate.match(/(\d+)\s+reproductions? à faire/)?.[1] ?? 0);
    expect(count).toBeGreaterThan(0);

    const summary = await page.getByTestId('policy-summary').innerText();
    const [, used, free] = summary.match(/(\d+)\/(\d+) places/)!;
    // Le parc est employé, sans exiger qu'il soit plein.
    //
    // « À deux places près » était le bon seuil tant que chaque croisement
    // coûtait une place ou deux. Les croisements entre deux fécondes n'en
    // coûtent aucune, et ils se composent maintenant en premier : la fournée
    // sert donc la même demande avec moins de places, et la boucle d'achat
    // s'arrête d'elle-même quand plus aucune gen 2 n'est en retard — 45 sur 50
    // au lieu de 48. Ce qu'il resterait à combler ne vaut plus l'achat qui le
    // comblerait : refaire une couleur qu'on vient d'obtenir gratuitement.
    //
    // Le seuil garde donc ce qu'il gardait vraiment — le parc à moitié vide de
    // #189, « 7 places sur 40 », qui échoue toujours ici — et cesse d'épingler
    // un taux de remplissage que la politique a le droit de faire baisser en
    // faisant mieux.
    expect(Number(used)).toBeGreaterThan(Number(free) * 0.8);
  });

  /**
   * Deux enclos, pas un. Le premier verrou fige la fournée et retire ses
   * montures de l'entrée de la politique : l'enclos suivant est donc calculé sur
   * une écurie **plus petite et plus pauvre en partenaires**, exactement la
   * situation où banquer redevient tentant. Un test qui s'arrête au premier
   * enclos ne prouve rien sur la fournée.
   */
  test('le deuxième enclos ne banque pas davantage', async ({ page }) => {
    const mock = await mockSupabase(page);
    mock.tables.user_breeding_individuals = advancedStable() as never;
    await openBreeding(page);
    await openLoadTab(page);

    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen').first()).toBeVisible();

    expect(await bankedInCurrentPen(page)).toBeLessThanOrEqual(1);
  });
});
