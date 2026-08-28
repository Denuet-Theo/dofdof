import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Les Optimakina qu'il faut se procurer, et **combien**.
 *
 * ## Ce que l'écran disait, et ce qu'il en coûtait
 *
 * Le conseil listait toutes les générations dont l'Optimakina se rembourse, sans
 * regarder si la fournée en visait une seule. On y lisait « gen 10 » sans avoir
 * un seul croisement de gen 10 à faire, et sans savoir combien en prendre — il
 * fallait compter les couples soi-même, dans un autre onglet, avant d'aller à
 * l'hôtel de vente. Demande de l'éleveur, 28/08 : « la quantité correspondant aux
 * reproductions qu'il reste à faire, par exemple pas d'achat d'Optimakina gen 10
 * s'il n'y en a pas de prévu ».
 *
 * ## Le compte porte sur les accouplements **immédiats**
 *
 * Et non sur la fournée entière : l'Optimakina se pose dans la fenêtre de jeu
 * qu'on ouvre maintenant, et les croisements qui attendent la sortie d'enclos se
 * rachèteront à leur tour. Acheter d'avance pour eux immobilise des kamas sur un
 * plan qui aura changé d'ici là.
 *
 * ## Le rang compté est celui de la **paire**, pas celui du plan
 *
 * Les deux diffèrent, et s'aligner sur le mauvais fait se contredire les deux
 * écrans. Relevé sur l'écurie du 28/08 : `turquoise_dore × indigo_pourpre` vise la
 * gen 6 sur deux couleurs et ne rend **aucun géneton** — le rang ne monte pas,
 * `leap` vaut −1 — donc `readPlan` l'annonce comme une recopie. L'échelle le joue
 * quand même, parce qu'il baisse le coût de construction vers la couronne, et la
 * fenêtre d'accouplement y propose donc une Optimakina.
 *
 * Compter sur le rang du plan donnait « n'en achète aucune » pendant que la
 * fenêtre affichait « pose-en une ». Arbitré par l'éleveur le 28/08 : c'est le
 * plan qui décide, pas les génétons — donc le conseil suit la fenêtre, et
 * `CoupleLine.pairTargetGeneration` existe pour ça.
 *
 * **Ce choix-là n'est pas gardé ici, et il faut le dire.** Sur l'écurie construite
 * ci-dessous les quatre croisements gagnent un vrai rang — gen 2 × gen 2 vers la
 * gen 3 — donc les deux champs coïncident et le test reste vert quand on prend le
 * mauvais : vérifié en remettant `line.targetGeneration`, les trois passent. La
 * divergence demande une ascendance qui porte déjà le rang visé, et la reproduire
 * a échoué : la paire de l'éleveur, posée seule en fixture, ne fait proposer aucun
 * accouplement — c'est le reste de son écurie qui la fait entrer dans la fournée.
 * Ce qui est gardé ici est donc la **cohérence des deux écrans**, pas la raison
 * pour laquelle elle tient.
 *
 * ## Comment ces tests échouent sans le code
 *
 * Mesuré en retirant le filtre par quantité : le premier reçoit deux lignes au
 * lieu d'une — `[{gen 3, ×4}, {gen 8, ×0}]` — et le second voit la gen 8
 * apparaître alors qu'aucun croisement ne la vise. Sans les icônes ni les
 * quantités, l'ancienne ligne n'affichait que « gen N » et un prix, et le premier
 * ne trouve alors ni `data-quantity` ni `img`.
 */

const USER = '00000000-0000-0000-0000-0000000000e2';

/**
 * Les quatre gen 2 qui s'apparient deux à deux, et **elles seules**.
 *
 * `dore_pourpre × dore_orchidee` nomme `roux`, `indigo_pourpre × ebene_orchidee`
 * nomme `amande` : deux recettes de **gen 3**, disjointes. Avec un mâle et une
 * femelle de chaque couleur, quatre couples immédiats visent la gen 3 et aucun ne
 * vise autre chose. C'est ce qui rend la quantité comptable à la main.
 */
const GEN2: [string, [string, string]][] = [
  ['dore_pourpre', ['dore', 'pourpre']],
  ['dore_orchidee', ['dore', 'orchidee']],
  ['indigo_pourpre', ['indigo', 'pourpre']],
  ['ebene_orchidee', ['ebene', 'orchidee']],
];

const ecurie = () => {
  const rows: Record<string, unknown>[] = [];
  for (const [colorId, parents] of GEN2) {
    for (const sex of ['M', 'F'] as const) {
      rows.push({
        id: `8017-0000-0000-0000-${String(rows.length + 1).padStart(12, '0')}`,
        user_id: USER,
        family: 'muldo',
        color_id: colorId,
        sex,
        level: 100,
        fertile: true,
        parent_a_color: parents[0],
        parent_b_color: parents[1],
        parent_a_id: null,
        parent_b_id: null,
        created_at: '2026-08-15T12:00:00.000Z',
        updated_at: '2026-08-15T12:00:00.000Z',
        name: `G2 ${colorId.slice(0, 3).toUpperCase()} ${sex}`,
        // Fécondes : leurs croisements ne coûtent aucune place, donc ils sont
        // **immédiats** et c'est eux que la quantité compte.
        cycled: true,
      });
    }
  }
  return rows;
};

/**
 * Le prix de la couronne, sans lequel il n'y a pas de conseil du tout.
 *
 * `advisedLevel` rend « il manque le prix de Azur-Doré » faute de quoi, et
 * l'Optimakina s'adosse à ce que vaut un succès. La fixture du dépôt ne tarife pas
 * la gen 10 — c'est ce qui interdit de tester ceci sans l'ajouter ici.
 */
const prixCouronne = (colorId: string) => [
  { family: 'muldo', color_id: colorId, mount_level: 0, price: '650000',
    updated_at: '2026-08-28T10:00:00.000Z', updated_by: USER },
  { family: 'muldo', color_id: colorId, mount_level: 200, price: '900000',
    updated_at: '2026-08-28T10:00:00.000Z', updated_by: USER },
];

/** Une Optimakina tarifée à l'hôtel de vente, avec son icône. */
const prixOptimakina = (itemId: number, generation: number, price: string) => ({
  item_id: itemId,
  item_name: `Optimakina Muldo de Génération ${generation}`,
  icon_url: `https://api.dofusdb.fr/img/items/${93000 + generation}.png`,
  price,
  updated_at: '2026-08-28T10:00:00.000Z',
  updated_by: USER,
});

/** La gen 3, que la fournée vise, et la gen 8, qu'elle ne vise pas. */
const OPTIMAKINA_GEN3 = 33356;
const OPTIMAKINA_GEN8 = 33461;

const poser = async (mock: SupabaseMock) => {
  mock.tables.user_breeding_individuals = ecurie() as never;
  mock.tables.user_breeding_mounts = [] as never;
  mock.tables.breeding_color_prices = [
    ...(mock.tables.breeding_color_prices as Record<string, unknown>[]),
    ...prixCouronne('azur_dore'),
  ] as never;
  mock.tables.item_prices = [
    ...(mock.tables.item_prices as Record<string, unknown>[]),
    prixOptimakina(OPTIMAKINA_GEN3, 3, '8000'),
    prixOptimakina(OPTIMAKINA_GEN8, 8, '8000'),
  ] as never;
};

/** Les lignes du conseil d'achat, telles que l'éleveur les lit. */
const conseil = async (page: Page) => {
  await page.getByTestId('step-mate').click();
  await expect(page.getByTestId('pane-mate')).toBeVisible();
  const lines = await page.getByTestId('optimakina-line').all();
  return Promise.all(
    lines.map(async (line) => ({
      generation: Number(await line.getAttribute('data-generation')),
      quantity: Number(await line.getAttribute('data-quantity')),
      icons: await line.locator('img').count(),
    }))
  );
};

test.describe('les Optimakina que la fournée demande', () => {
  test('la quantité est celle des accouplements immédiats, et l’icône est là', async ({
    page,
  }) => {
    const mock = await mockSupabase(page);
    await poser(mock);
    await openBreeding(page);

    // Quatre couples immédiats, tous vers la gen 3 : c'est le compte à la main.
    const immediats = Number(
      (await page.getByTestId('step-mate').innerText()).match(/(\d+)\s*$/)?.[1] ?? 0
    );
    expect(immediats, 'quatre couples disjoints entre les quatre gen 2').toBe(4);

    const lignes = await conseil(page);
    expect(lignes, `le conseil devrait porter une ligne : ${JSON.stringify(lignes)}`).toHaveLength(
      1
    );
    expect(lignes[0].generation).toBe(3);
    expect(lignes[0].quantity, 'une Optimakina par accouplement de gen 3').toBe(immediats);
    expect(lignes[0].icons, 'l’icône de l’item, celle qu’on cherche à l’hôtel de vente').toBe(1);
  });

  /**
   * La demande de l'éleveur, à la lettre : « pas d'achat d'Optimakina gen 10 s'il
   * n'y en a pas de prévu ».
   *
   * La gen 8 est tarifée au même prix que la gen 3 — donc elle se rembourse tout
   * autant, et c'est bien l'absence de croisement qui la retire, pas son prix.
   */
  test('une génération que la fournée ne vise pas n’apparaît pas', async ({ page }) => {
    const mock = await mockSupabase(page);
    await poser(mock);
    await openBreeding(page);

    const lignes = await conseil(page);
    expect(
      lignes.map((line) => line.generation),
      'aucun croisement ne vise la gen 8, elle ne doit pas être proposée'
    ).not.toContain(8);
  });

  /**
   * Les deux écrans doivent dire la même chose.
   *
   * C'est la contrainte qui a fait choisir le rang de la paire plutôt que celui du
   * plan : une fenêtre qui propose une Optimakina pendant que le conseil n'en
   * compte aucune envoie l'éleveur à l'hôtel de vente sans elle, ou l'y envoie
   * pour rien.
   *
   * Sur cette fixture les deux rangs coïncident, donc ce test vérifie l'accord
   * sans pouvoir montrer qu'il était menacé — voir l'en-tête.
   */
  test('la fenêtre d’accouplement propose ce que le conseil a compté', async ({ page }) => {
    const mock = await mockSupabase(page);
    await poser(mock);
    await openBreeding(page);

    const lignes = await conseil(page);
    const comptees = lignes.reduce((total, line) => total + line.quantity, 0);

    await page
      .getByTestId('pane-mate')
      .getByRole('button', { name: /reproductions? à faire/ })
      .click();
    await expect(page.getByRole('heading', { name: 'Ce qui est né' })).toBeVisible();

    const badge = page.getByTestId('mate-optimakina');
    expect(
      await badge.count(),
      `le conseil compte ${comptees} Optimakina, la fenêtre en propose ${await badge.count()}`
    ).toBeGreaterThan(0);
    // La même icône qu'à l'achat : c'est la même Optimakina, et on la reconnaît
    // dans l'inventaire à son image, pas à son nom qui ne varie que d'un chiffre.
    expect(await badge.first().locator('img').count()).toBe(1);
  });
});
