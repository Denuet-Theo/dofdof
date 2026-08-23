import { expect, test, type Page } from '@playwright/test';
import { mockSupabase, type SupabaseMock } from './support/supabase';
import { openBreeding, failureBanner } from './support/breeding';

/**
 * Désigner un lot en collant la liste du jeu.
 *
 * ## Pourquoi ce chemin existe
 *
 * La correction en lot sait passer cinquante montures fécondes d'un coup. Il
 * fallait encore les **désigner**, et cinquante cases à cocher dans une liste de
 * deux cents, avec des homonymes à départager à l'œil, est la tâche où l'on se
 * trompe — sans s'en apercevoir avant que la politique ne planifie sur une
 * écurie fausse. Relevé mot pour mot : « trop fastidieux et source d'erreur ».
 *
 * La désignation existe déjà : c'est la liste de l'écran d'enclos du jeu, où
 * chaque monture porte le nom que l'outil lui a dicté.
 *
 * ## Ce que ces tests tiennent
 *
 * 1. Une liste collée **telle quelle** — décor du jeu compris — désigne les
 *    bonnes montures, et le lot s'écrit ensuite d'un geste.
 * 2. Un homonyme se départage par une règle, pas au hasard : la fertile non
 *    féconde, du niveau le plus bas. C'est ce qui sort d'un enclos.
 * 3. Ce qui manque est **nommé** avant qu'on referme. Une ligne qui ne désigne
 *    rien est une monture qui restera fausse.
 */

const openStocks = async (page: Page) => {
  const stock = page.getByRole('button', { name: /montures ·/ });
  await expect(stock).toBeVisible({ timeout: 30_000 });
  await stock.click();
  await expect(page.getByTestId('stock-list')).toBeVisible();
};

const paste = async (page: Page, text: string) => {
  await page.getByTestId('pick-open').click();
  await expect(page.getByRole('heading', { name: 'Coller une liste de noms' })).toBeVisible();
  await page.getByTestId('pick-input').fill(text);
};

const named = (mock: SupabaseMock) =>
  mock.rows('user_breeding_individuals').filter((row) => row.name !== null);

test.describe('coller une liste du jeu', () => {
  test('une liste copiée telle quelle désigne le lot, décor compris', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    // Des noms qui n'existent qu'une fois : le départage des homonymes a son
    // propre test, celui-ci porte sur la lecture.
    const counts = new Map<string, number>();
    for (const row of named(mock)) {
      counts.set(row.name as string, (counts.get(row.name as string) ?? 0) + 1);
    }
    const unique = [...counts].filter(([, count]) => count === 1).map(([name]) => name);
    expect(unique.length).toBeGreaterThan(4);
    const wanted = unique.slice(0, 5);

    // Recopié comme le jeu l'affiche : la colonne GEN., le niveau, la fertilité.
    await paste(
      page,
      wanted.map((name, index) => `${name}  GEN. ${index + 1}  44  Féconde`).join('\n')
    );
    await expect(page.getByTestId('pick-count')).toHaveAttribute('data-count', '5');
    await expect(page.getByTestId('pick-missing')).toHaveCount(0);
    await page.getByTestId('pick-apply').click();

    await expect(page.getByTestId('bulk-count')).toHaveAttribute('data-count', '5');

    // Et le lot s'écrit, sur exactement ces montures-là.
    await page.getByTestId('bulk-status-feconde').click();
    await page.getByTestId('bulk-level').fill('44');
    await page.getByTestId('bulk-apply').click();
    await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 20_000 });
    await expect(failureBanner(page)).toHaveCount(0);

    for (const name of wanted) {
      const row = mock.rows('user_breeding_individuals').find((entry) => entry.name === name)!;
      expect(row.level).toBe(44);
      expect(row.cycled).toBe(true);
    }
  });

  test('un homonyme se départage par la règle, pas au hasard', async ({ page }) => {
    // Ce qu'on colle vient d'un enclos, et une monture entrée en enclos y est
    // entrée fertile non féconde. Sept sœurs peuvent porter le même nom ; la
    // sélection doit prendre celle-là, et du niveau le plus bas.
    const mock = await mockSupabase(page);
    const rows = mock.rows('user_breeding_individuals');
    // Un nom dicté fait quatre mots : `readLine` écarte tout le reste, parce
    // qu'une liste collée d'une interface de jeu ramène du décor.
    const name = 'G9 HO M HO-HO';
    const sisters = [
      { id: 'pick-0000-0000-0000-000000000001', level: 61, fertile: true, cycled: true },
      { id: 'pick-0000-0000-0000-000000000002', level: 40, fertile: false, cycled: false },
      { id: 'pick-0000-0000-0000-000000000003', level: 1, fertile: true, cycled: false },
      { id: 'pick-0000-0000-0000-000000000004', level: 41, fertile: true, cycled: false },
    ];
    for (const sister of sisters) {
      rows.push({ ...rows[0], ...sister, name, family: 'muldo' });
    }

    await openBreeding(page);
    await openStocks(page);

    await paste(page, name);
    await expect(page.getByTestId('pick-count')).toHaveAttribute('data-count', '1');
    await page.getByTestId('pick-apply').click();
    await expect(page.getByTestId('bulk-count')).toHaveAttribute('data-count', '1');

    await page.getByTestId('bulk-level').fill('44');
    await page.getByTestId('bulk-apply').click();
    await expect(page.getByText('Enregistrement…')).toHaveCount(0, { timeout: 20_000 });

    // La fertile non féconde au niveau le plus bas, et elle seule.
    const after = mock.rows('user_breeding_individuals').filter((row) => row.name === name);
    expect(after.find((row) => row.id === sisters[2].id)?.level).toBe(44);
    for (const other of [sisters[0], sisters[1], sisters[3]]) {
      expect(after.find((row) => row.id === other.id)?.level).toBe(other.level);
    }
  });

  test('ce que l’écurie ne peut pas fournir est nommé avant qu’on referme', async ({ page }) => {
    const mock = await mockSupabase(page);
    await openBreeding(page);
    await openStocks(page);

    const real = named(mock)[0].name as string;
    // Une ligne fantaisiste, et une qui en demande plus que l'écurie n'en a.
    await paste(page, [`${real} ×99`, 'G9 ZZ M ZZ-ZZ'].join('\n'));

    const missing = page.getByTestId('pick-missing');
    await expect(missing).toBeVisible();
    await expect(missing).toContainText('G9 ZZ M ZZ-ZZ');
    await expect(missing).toContainText('introuvable');
    await expect(missing).toContainText(real);

    // Ce qui est trouvable est quand même désigné : une ligne fautive ne fait
    // pas renoncer au reste du lot.
    const count = Number(await page.getByTestId('pick-count').getAttribute('data-count'));
    expect(count).toBeGreaterThan(0);
    await expect(page.getByTestId('pick-apply')).toBeEnabled();
  });
});
