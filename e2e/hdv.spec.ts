import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * L'onglet HDV : le prix de vente des miennes, le plafond d'achat des autres.
 *
 * ## La panne que ce fichier attrape
 *
 * `breeding_color_prices.price` est un `bigint`, donc PostgREST le rend en
 * **chaîne**, et le hook le rangeait tel quel dans un champ déclaré `number`. Le
 * chiffrage des routes n'en souffrait pas : il ne fait que des multiplications, et
 * JS coerce `*`. Une **addition** non.
 *
 * Cet onglet est le premier à en faire une — `revient = couleur + raccourci` — et
 * il affichait un Indigo gen 1 à `"6000" + 74872` = **600 074 872** kamas, avec un
 * prix de vente conseillé de 750 millions. C'est la même famille que le solde de
 * l'écurie changé en texte par `+=`, qui avait ramené la politique à un
 * accouplement sur vingt-trois.
 *
 * D'où le test central : **l'arithmétique se vérifie sur les chiffres exacts**,
 * lus dans les attributs, et non sur l'affichage — « 600.1M » et « 80.9K » se
 * ressemblent trop dans une capture.
 *
 * ## Pourquoi deux saisies plutôt qu'une
 *
 * Le devis d'achat vit dans un `useMemo`. Une dépendance oubliée ne se voit qu'au
 * **second** changement : la première saisie affiche le bon prix parce qu'il n'y
 * avait rien avant, la seconde garde le premier. C'est la règle « clique deux
 * fois » d'`AGENTS.md`, appliquée à un formulaire.
 */

/** Les chiffres exacts d'une ligne, tels que le calcul les a produits. */
const figuresOf = async (row: Locator) => {
  const read = async (name: string) => {
    const raw = await row.getAttribute(`data-${name}`);
    return raw === null || raw === '' ? null : Number(raw);
  };
  return {
    base: await read('base'),
    gain: await read('gain'),
    revient: await read('revient'),
    sell: await read('sell'),
    buy: await read('buy'),
  };
};

const openHdv = async (page: Page) => {
  await openBreeding(page);
  await page.getByTestId('step-hdv').click();
  await expect(page.getByTestId('pane-hdv')).toBeVisible();
};

test.describe('onglet HDV', () => {
  test('l’onglet suit Extraction et porte les deux listes', async ({ page }) => {
    await mockSupabase(page);
    await openHdv(page);

    // La fixture est l'écurie du 15/08 : des couleurs groupées, et quelques
    // montures dont l'ascendance porte plus haut que leur couleur.
    await expect(page.getByTestId('hdv-color').first()).toBeVisible();
    expect(await page.getByTestId('hdv-color').count()).toBeGreaterThan(5);
    expect(await page.getByTestId('hdv-named').count()).toBeGreaterThan(0);
  });

  test('le revient est la somme, pas la concaténation', async ({ page }) => {
    // Le cœur : sans la conversion du prix, `revient` vaut « 6000 » suivi de
    // « 74872 » et ce test lit 600 074 872 au lieu de 80 872.
    await mockSupabase(page);
    await openHdv(page);

    const named = page.getByTestId('hdv-named');
    const count = await named.count();
    expect(count, 'la fixture doit porter au moins une monture à raccourci').toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const row = named.nth(index);
      const color = await row.getAttribute('data-color');
      const { base, gain, revient, sell } = await figuresOf(row);

      expect(base, `${color} : couleur non chiffrée`).not.toBeNull();
      expect(gain, `${color} : raccourci sans gain`).not.toBeNull();
      // La somme, au kama près une fois arrondie.
      expect(revient, `${color} : revient concaténé au lieu d'être additionné`).toBe(
        Math.round(base! + gain!)
      );
      // Et aucun revient plausible sur cette écurie n'atteint le million : c'est
      // la borne qui rend la panne d'origine impossible à laisser passer.
      expect(revient!, `${color} : revient hors de toute échelle`).toBeLessThan(1_000_000);
      // À un kama près, et c'est l'arrondi qui l'impose : le calcul arrondit une
      // seule fois, à la fin, alors que l'attribut porte déjà un revient arrondi.
      // La tolérance ne masque rien de ce qu'on surveille — la panne d'origine
      // écartait le prix de vente d'un facteur dix mille.
      expect(
        Math.abs(sell! - Math.round(revient! * 1.25)),
        `${color} : la marge de vente ne suit pas le revient`
      ).toBeLessThanOrEqual(1);
    }
  });

  test('une couleur groupée se vend à +25 %, net de la taxe', async ({ page }) => {
    await mockSupabase(page);
    await openHdv(page);

    const row = page.getByTestId('hdv-color').first();
    const { base, gain, revient, sell } = await figuresOf(row);
    // Une ligne de couleur n'a pas de raccourci : le revient est la couleur nue.
    expect(gain).toBeNull();
    expect(revient).toBe(Math.round(base!));
    expect(Math.abs(sell! - Math.round(revient! * 1.25))).toBeLessThanOrEqual(1);

    // Le net affiché retire les 2 % de l'hôtel de vente du prix conseillé.
    const net = sell! - Math.floor(sell! * 0.02);
    await expect(row).toContainText(`net ${net.toLocaleString('fr-FR')}`);
  });

  test('le plafond d’achat vaut −25 %, et la généalogie le relève', async ({ page }) => {
    await mockSupabase(page);
    await openHdv(page);

    // Une gen 1 nue : le plafond est les trois quarts de son prix saisi.
    await page.getByTestId('hdv-color-pick').selectOption('dore');
    const quote = page.getByTestId('hdv-quote');
    await expect(quote).toBeVisible();
    const nu = await figuresOf(quote);
    expect(nu.gain, 'une monture sans parents n’ouvre aucun raccourci').toBeNull();
    expect(Math.abs(nu.buy! - Math.round(nu.revient! * 0.75))).toBeLessThanOrEqual(1);

    // La même gen 1, née d'une gen 4 : son ascendance lui ouvre une génération
    // que sa couleur seule n'atteint pas, donc elle vaut plus cher.
    await page.getByTestId('hdv-parent-a').selectOption('dore_amande');
    await page.getByTestId('hdv-parent-b').selectOption('roux_ebene');
    await expect(quote).toHaveAttribute('data-gain', /\d+/);
    const porteuse = await figuresOf(quote);
    expect(porteuse.base).toBe(nu.base);
    expect(Math.abs(porteuse.revient! - Math.round(porteuse.base! + porteuse.gain!))).toBeLessThanOrEqual(1);
    expect(Math.abs(porteuse.buy! - Math.round(porteuse.revient! * 0.75))).toBeLessThanOrEqual(1);
    expect(porteuse.buy!, 'la généalogie doit relever le plafond').toBeGreaterThan(nu.buy!);
    await expect(quote).toContainText('Raccourci');
  });

  test('deux saisies de suite : le devis suit la seconde', async ({ page }) => {
    // Une dépendance de `useMemo` oubliée ne se voit qu'au second changement.
    await mockSupabase(page);
    await openHdv(page);

    const quote = page.getByTestId('hdv-quote');
    await page.getByTestId('hdv-color-pick').selectOption('dore');
    await expect(quote).toHaveAttribute('data-color', 'dore');
    const first = await figuresOf(quote);

    await page.getByTestId('hdv-color-pick').selectOption('amande');
    await expect(quote).toHaveAttribute('data-color', 'amande');
    const second = await figuresOf(quote);

    expect(second.revient).not.toBe(first.revient);
    expect(Math.abs(second.buy! - Math.round(second.revient! * 0.75))).toBeLessThanOrEqual(1);

    // Et le retour en arrière rend le premier chiffre, pas un mélange des deux.
    await page.getByTestId('hdv-color-pick').selectOption('dore');
    await expect(quote).toHaveAttribute('data-color', 'dore');
    expect((await figuresOf(quote)).revient).toBe(first.revient);
  });

  test('l’onglet ne montre ni enclos ni clonage', async ({ page }) => {
    // La même étanchéité que les quatre autres onglets : un geste à la fois.
    await mockSupabase(page);
    await openHdv(page);

    for (const other of ['pane-mate', 'pane-clone', 'pane-load', 'pane-extract']) {
      await expect(page.getByTestId(other)).toHaveCount(0);
    }
    const text = (await page.getByTestId('pane-hdv').innerText()).toLowerCase();
    expect(text).not.toContain('clonage');
    expect(text).not.toContain('enclos');
  });
});
