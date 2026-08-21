import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding, panels } from './support/breeding';

/**
 * La liste d'accouplements ne repousse pas.
 *
 * ## Le défaut, tel que l'éleveur le vit
 *
 * « J'en fais 20, j'ai fini, je refresh : 2 nouveaux. Je les fais, je refresh :
 * rien. Je fais mes clonages : 3 nouveaux. » Une liste qui repousse à chaque
 * geste, sans jamais dire pourquoi, et qui ne se termine qu'en tâtonnant.
 *
 * Ce n'était ni de l'aléa ni un oubli d'écriture — à écurie constante la liste
 * est stable, et c'est le second test ci-dessous. C'était que la boucle censée
 * atteindre le point fixe ne simulait que **la moitié** du geste : les deux
 * parents consommés, jamais le poulain arrivé. Elle convergeait donc sur une
 * écurie qui s'était vidée sans rien produire — une écurie que l'éleveur n'aurait
 * jamais — et la vraie replanification, elle, voyait les poulains et changeait
 * d'avis. Voir `projectBirths`.
 *
 * ## Pourquoi le test parcourt tout le carrousel
 *
 * La fenêtre « Ce qui est né » montre **un croisement à la fois**. Un test qui
 * saisit le premier panneau et s'arrête ne prouve rien : il mesure la taille d'un
 * groupe, pas celle de la liste. C'est ce qui a d'abord masqué le défaut pendant
 * le diagnostic. Il faut « Suivant » jusqu'au bout, ce qui est aussi le seul
 * moyen de saisir une vraie fournée de vingt.
 */

/** Ce que le bouton de l'onglet promet, sans ouvrir la fenêtre. `0` s'il n'y a rien. */
const promisedCount = async (page: Page): Promise<number> => {
  await page.getByTestId('step-mate').click();
  await expect(page.getByTestId('pane-mate')).toBeVisible();
  const button = page
    .getByTestId('pane-mate')
    .getByRole('button', { name: /reproductions? à faire/ });
  if ((await button.count()) === 0) return 0;
  return Number((await button.innerText()).match(/(\d+)/)![1]);
};

/** Ce que le bouton de l'onglet promet, et la fenêtre ouverte. `0` s'il n'y a rien. */
const openMatingDoor = async (page: Page): Promise<number> => {
  await page.getByTestId('step-mate').click();
  await expect(page.getByTestId('pane-mate')).toBeVisible();
  const button = page
    .getByTestId('pane-mate')
    .getByRole('button', { name: /reproductions? à faire/ });
  if ((await button.count()) === 0) return 0;
  const promised = Number((await button.innerText()).match(/(\d+)/)![1]);
  await button.click();
  await expect(page.getByRole('heading', { name: 'Ce qui est né' })).toBeVisible();
  return promised;
};

/**
 * Le sexe qu'on déclare aux naissances, et pourquoi c'est un paramètre.
 *
 * Les deux premiers boutons d'un panneau sont le ♂ et le ♀ de la **couleur
 * cible** ; ceux d'après appartiennent aux issues manquées. Cliquer toujours le
 * premier disponible, ce que faisait ce fichier, déclare donc une saisie
 * entièrement sur la cible et entièrement **mâle**.
 *
 * Or `projectBirths` projette les poulains en **alternant** les sexes. Une saisie
 * tout en mâles ne s'écarte donc pas de la projection par sa couleur — elle est sur
 * la cible — mais par son rapport des sexes. C'est le seul axe qui reste, et il
 * suffit à changer le résultat : `21` d'un côté, `21 → 1 → 2` de l'autre. D'où les
 * deux régimes ci-dessous, sans prétendre en nommer le mécanisme — voir l'en-tête
 * du `describe`, où deux tentatives de le reproduire sont consignées.
 */
type SexChoice = 'male' | 'alternating';

/**
 * Saisit tout le carrousel, croisement par croisement, et rend le compte.
 *
 * `choice` décide du sexe déclaré, en restant toujours sur la couleur cible :
 * `'male'` prend le ♂ à chaque fois, `'alternating'` alterne ♂ et ♀ sur la saisie
 * entière — le rapport que `projectBirths` projette.
 */
const recordEverything = async (page: Page, choice: SexChoice = 'male'): Promise<number> => {
  let recorded = 0;
  for (let group = 0; group < 80; group += 1) {
    for (let guard = 0; guard < 80; guard += 1) {
      const sexes = panels(page).locator('button').filter({ hasText: /^[♂♀]$/ });
      const count = await sexes.count();
      // Les deux boutons de la cible d'abord, dans l'ordre que `choice` dicte, puis
      // le reste du panneau en secours si la cible est déjà pleine.
      const preferred =
        choice === 'alternating' && recorded % 2 === 1 ? [1, 0] : [0, 1];
      const order = [...preferred, ...Array.from({ length: count }, (_, i) => i)];
      let clicked = false;
      for (const index of order) {
        if (index >= count) continue;
        if (await sexes.nth(index).isEnabled()) {
          await sexes.nth(index).click();
          // L'écriture doit être revenue : enchaîner testerait l'anti-double-clic.
          await expect(page.getByText('enregistrement…')).toHaveCount(0, { timeout: 20_000 });
          recorded += 1;
          clicked = true;
          break;
        }
      }
      if (!clicked) break;
    }
    const next = page.getByTestId('next-cross');
    if ((await next.count()) === 0 || !(await next.isEnabled())) break;
    await next.click();
  }
  return recorded;
};

/** Saisit tout, tour après tour, jusqu'à ce que la liste soit vide. Rend les tours. */
const roundsUntilEmpty = async (page: Page, choice: SexChoice): Promise<number[]> => {
  const rounds: number[] = [];
  for (let round = 0; round < 6; round += 1) {
    await openBreeding(page);
    const promised = await openMatingDoor(page);
    if (promised === 0) break;
    rounds.push(promised);
    const recorded = await recordEverything(page, choice);
    expect(recorded, 'le bouton promet ce que la fenêtre sait délivrer').toBe(promised);
    await page.reload();
  }
  return rounds;
};

test.describe('la liste d’accouplements', () => {
  // ## Ce qui fait repousser la liste, nommé pour de bon
  //
  // La boucle de `couplesToRecordAll` rejoue la saisie pour atteindre son point
  // fixe. Elle peut se tromper sur deux choses, et **une seule** des deux joue ici.
  //
  // **La couleur.** Le jeu tire dans une distribution d'issues ; la boucle projette
  // la cible. Une naissance hors cible laisse une autre écurie que celle projetée.
  // Aucune fidélité de simulation ne ferme ça, et `check:record-fixpoint` garde la
  // moitié qui est démontrable : à naissances sur la cible, le point fixe est exact.
  //
  // **Le sexe.** `projectBirths` alterne ♂ et ♀, faute de pouvoir deviner un tirage.
  // Le rapport des sexes **déclaré** change ce que la replanification trouve : sur
  // cette fixture, une saisie alternée s'épuise en un tour et une saisie tout en
  // mâles laisse `21 → 1 → 2`. Le lien n'est pas une simple discordance entre la
  // projection et la saisie — projeter tous les poulains mâles ne reproduit pas le
  // résidu, mesuré — donc on se garde d'en nommer le mécanisme et on couvre les
  // deux régimes.
  //
  // Ces deux tests ci-dessous ne parcourent **que la cible** : les deux premiers
  // boutons d'un panneau sont le ♂ et le ♀ de la couleur visée, et `recordEverything`
  // les prend d'abord. Il n'y a donc **aucune naissance hors cible ici**, et tout
  // écart observé vient du sexe. C'était mal dit auparavant — le commentaire
  // attribuait le résidu aux naissances hors cible, qui sont absentes de ce
  // fichier — et ça envoyait la prochaine lecture chercher au mauvais endroit.

  test('au rapport des sexes projeté, la liste s’épuise en un seul tour', async ({
    page,
  }) => {
    // Le cas serré, et celui qui porte le sens. Quand la saisie rend le rapport des
    // sexes que `projectBirths` projette, la boucle a simulé **exactement** ce que
    // la saisie a fait : couleur et sexe. Le point fixe doit alors être atteint du
    // premier coup, sans résidu du tout.
    //
    // C'est l'assertion qui mord, et elle a été vérifiée en la faisant rougir :
    // retirer `projectBirths` — le défaut de #165 — donne ici `22 → 1` et la casse,
    // **alors que le cas tout en mâles ci-dessous reste vert**. Sur cette fixture,
    // c'est donc le seul des deux qui garde la projection des naissances.
    //
    // Deux autres défauts ont été essayés et ne la font **pas** rougir, ce qui borne
    // ce qu'elle promet : remettre l'alternance à zéro à chaque vague (sans effet
    // ici, la fournée tenant en une seule vague) et projeter tous les poulains mâles
    // (`23`, sans résidu, dans les deux régimes). Elle garde que la boucle projette
    // une naissance, pas qu'elle en projette le bon sexe.
    await mockSupabase(page);

    const rounds = await roundsUntilEmpty(page, 'alternating');

    expect(rounds[0], 'la fixture doit proposer une vraie fournée').toBeGreaterThan(10);
    expect(rounds, `tours : ${rounds.join(' → ')}`).toHaveLength(1);
  });

  test('tout en mâles, la liste laisse un résidu borné et petit', async ({ page }) => {
    // Le cas de tension. Déclarer vingt et une naissances mâles d'affilée est le pire
    // rapport des sexes que la fenêtre permette, et le plus loin de l'alternance
    // projetée. On n'exige donc plus zéro, mais on exige que ça converge et que le
    // reste ne fasse jamais une seconde fournée.
    //
    // ## La borne, et ce qu'elle vaut vraiment
    //
    // Elle valait « deux tours », calibrée sur `17 → 1`. Le champion entraîné sous
    // l'échelle propose 21 accouplements et rend `21 → 1 → 2`. #238 a déplacé la
    // borne en attribuant ce tour de plus aux naissances hors cible : c'est faux,
    // il n'y en a aucune dans ce fichier. Le tour de plus tient au rapport des sexes
    // déclaré, et le test au-dessus le montre en le refermant à zéro.
    //
    // La borne reste donc large **pour ce régime-là seulement**, parce qu'un écart
    // maximal de rapport des sexes justifie un reste ; la garde qui mord est
    // l'autre. Le défaut d'origine — `12 → 4 → 3` — échoue toujours ici, sur son
    // résidu de 4.
    await mockSupabase(page);

    const rounds = await roundsUntilEmpty(page, 'male');

    expect(rounds[0], 'la fixture doit proposer une vraie fournée').toBeGreaterThan(10);
    // Elle converge : la boucle sort parce que la liste s'est vidée, pas parce
    // qu'on l'a arrêtée.
    expect(rounds.length, `tours : ${rounds.join(' → ')}`).toBeLessThanOrEqual(4);
    // Et tout ce qui suit la première fournée est un **reste** : chaque tour
    // ultérieur tient en trois gestes, et leur somme ne fait pas une seconde fournée.
    for (const [index, count] of rounds.slice(1).entries()) {
      expect(count, `tour ${index + 2} : ${rounds.join(' → ')}`).toBeLessThanOrEqual(3);
    }
    const residue = rounds.slice(1).reduce((sum, count) => sum + count, 0);
    expect(residue, `restes : ${rounds.join(' → ')}`).toBeLessThan(rounds[0]);
  });

  test('à écurie constante, la liste ne change pas d’un chargement à l’autre', async ({
    page,
  }) => {
    // Ce test sépare deux diagnostics qui se ressemblent : une liste qui bouge
    // parce que l'écurie a bougé, et une liste qui bouge toute seule. Sans lui,
    // « la politique change d'avis » et « le planificateur tire au hasard »
    // s'expliquent l'un par l'autre.
    await mockSupabase(page);
    const promised: number[] = [];
    for (let visit = 0; visit < 3; visit += 1) {
      await openBreeding(page);
      promised.push(await openMatingDoor(page));
      await page.reload();
    }
    expect(promised[0]).toBeGreaterThan(0);
    expect(promised, 'trois chargements, la même liste').toEqual([
      promised[0],
      promised[0],
      promised[0],
    ]);
  });

  test('le rafraîchissement seul ne change rien : même écurie, même liste', async ({ page }) => {
    // La phrase de l'éleveur, mot pour mot : « j'en fais 20, j'ai fini, je
    // refresh : 2 nouveaux ». Rien n'avait changé dans son écurie entre les deux
    // écrans — seulement l'**ordre des lignes**.
    //
    // La lecture trie par identifiant (`.order('id')`), les écritures locales
    // ajoutent en fin de tableau. Un poulain saisi vit donc en queue jusqu'au
    // rafraîchissement, où il reprend sa place d'uuid. Et le plan dépend de cet
    // ordre : la recherche départage à valeur égale dans l'ordre où elle
    // rencontre les montures. Même contenu, deux ordres, deux plans.
    //
    // Voir `canonicalStable`. Ce test compare les deux moments à contenu
    // identique : ce qu'on lit avant le rafraîchissement doit être ce qu'on lit
    // après, sans quoi l'éleveur voit une liste repousser sans cause.
    await mockSupabase(page);
    await openBreeding(page);
    await openMatingDoor(page);

    // Quelques saisies, pas toutes : c'est le cas où le compteur reste non nul,
    // donc où un écart se lit sur un nombre et pas seulement sur « 0 ou pas 0 ».
    for (let index = 0; index < 3; index += 1) {
      const sexes = panels(page).locator('button').filter({ hasText: /^[♂♀]$/ });
      const count = await sexes.count();
      for (let position = 0; position < count; position += 1) {
        if (await sexes.nth(position).isEnabled()) {
          await sexes.nth(position).click();
          await expect(page.getByText('enregistrement…')).toHaveCount(0, { timeout: 20_000 });
          break;
        }
      }
      const next = page.getByTestId('next-cross');
      if ((await next.count()) > 0 && (await next.isEnabled())) await next.click();
    }
    await page.keyboard.press('Escape');

    const inSession = await promisedCount(page);
    await page.reload();
    await openBreeding(page);
    const afterReload = await promisedCount(page);

    expect(afterReload, 'le rafraîchissement ne doit rien faire repousser').toBe(inSession);
  });
});
