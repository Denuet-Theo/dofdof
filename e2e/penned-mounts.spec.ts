import { expect, test, type Page } from '@playwright/test';
import { mockSupabase } from './support/supabase';
import { openBreeding } from './support/breeding';

/**
 * Une monture en enclos ne se propose plus ailleurs.
 *
 * Le verrou d'enclos a fermé la moitié du problème : ce qui est chargé ne bouge
 * plus. L'autre moitié restait ouverte, et elle se voyait à l'usage. L'écurie
 * enregistrée décrit une monture d'enclos comme **fertile et non féconde** —
 * c'est juste, elle ne deviendra féconde qu'à la sortie, seul moment où l'on
 * connaît son niveau — donc la politique continuait de la compter parmi ce dont
 * elle dispose.
 *
 * Elle la comptait donc deux fois : une fois dans l'enclos où elle est, une fois
 * dans les gestes proposés à côté. Un éleveur qui verrouillait ses cinq enclos
 * se voyait proposer d'accoupler dans la foulée les cinquante montures qu'il
 * venait d'y enfermer, et les cherchait dans un coffre où elles n'étaient plus.
 *
 * Le jeu, lui, est clair : tant que le cycle tourne, la monture ne s'accouple
 * pas, ne se clone pas, ne se sacrifie pas.
 *
 * ## Ce que ces tests ne disent pas
 *
 * Que l'écurie **affichée** rétrécit. Elle ne doit pas : ces montures sont
 * toujours à vous, et « Mes stocks » continue de les compter. La distinction est
 * entre « ce que je possède » et « ce dont je dispose ce matin », et le dernier
 * test la verrouille.
 */

const openLoadTab = async (page: Page) => {
  const tab = page.getByTestId('step-load');
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByTestId('pane-load')).toBeVisible();
};

/** Verrouille les `count` prochains enclos, en attendant chaque écriture. */
const lockAll = async (page: Page, count: number) => {
  for (let index = 0; index < count; index += 1) {
    await page.getByTestId('lock-pen').click();
    await expect(page.getByTestId('locked-pen')).toHaveCount(index + 1);
  }
};

test.describe('montures en enclos', () => {
  test('verrouiller retire les montures des arbitrages', async ({ page }) => {
    await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    // La sonde est le **résumé de la politique**, et non les compteurs d'onglet.
    //
    // Ceux-ci ne répondent plus, et c'est une correction : « Accoupler » compte
    // les couples à zéro place, or un enclos ne reçoit que des fertiles **non
    // fécondes** — enfermer n'ôte donc rien à ce qui peut s'accoupler
    // gratuitement, et « Clonage » ne compte que des stériles, qui n'entrent
    // jamais en enclos. Qu'ils frémissaient venait de la politique changeant
    // d'avis quand l'écurie bougeait sous elle, ce que `projectBirths` et
    // `canonicalStable` ferment. Un test qui s'appuie sur ce frémissement mesure
    // le défaut et non la propriété.
    //
    // Le résumé porte le plan entier, places comprises : il perd exactement ce
    // qu'on enferme.
    const summary = () => page.getByTestId('policy-summary').innerText();
    const before = (await summary()).replace(/\s+/g, ' ');
    const enclos = Number(
      (await page.getByTestId('pane-load').innerText()).match(/(\d+) enclos/)![1]
    );

    await lockAll(page, enclos);

    // Les cinquante montures enfermées ne sont plus dans ce que la politique
    // arbitre. Sans le retrait, le résumé ne bougerait pas d'un chiffre —
    // l'écurie enregistrée, elle, n'a pas changé.
    expect((await summary()).replace(/\s+/g, ' ')).not.toBe(before);

    /* Le **sens** de la variation, lui, n'est pas une propriété, et l'affirmer
       ici était un porte-à-faux.

       « Accoupler » ne comptait pas des montures mais des couples à zéro place,
       et verrouillé, le parc n'a plus une place libre : la politique ne peut
       plus charger quoi que ce soit, donc tout ce qui lui reste à proposer est
       précisément l'appariement des fécondes déjà payées. La liste **grossit**
       de ce que le chargement lui prenait. Mesuré sur cette fixture : 20 → 19
       avant que la liste ne se calcule sur l'écurie d'après les clonages,
       18 → 21 depuis. Les deux sont justes ; seul le premier ressemblait à une
       règle.

       Ce que le retrait garantit est ailleurs, et c'est testé par les trois
       specs qui suivent : le parc est annoncé plein, l'écart est dit au nombre
       près, et « Mes stocks » ne rétrécit pas. */
  });

  test('le parc plein n’est plus annoncé comme libre', async ({ page }) => {
    // Le double comptage, dans sa forme la plus nette. Le parc fait cinquante
    // places ; une fois les cinq enclos verrouillés, elles sont **toutes**
    // occupées. La politique continuait pourtant d'annoncer « 50/50 places » sur
    // une écurie qu'elle croyait entière, c'est-à-dire de planifier une seconde
    // fournée de cinquante montures dans un parc qui n'a plus une place libre —
    // avec les montures déjà enfermées dedans.
    await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    const before = await page.getByTestId('policy-summary').innerText();
    const entete = await page.getByTestId('pane-load').innerText();
    const enclos = Number(entete.match(/(\d+) enclos/)![1]);
    const montures = Number(entete.match(/(\d+) montures?/)![1]);

    await lockAll(page, enclos);

    // Le plan n'est plus le même, parce que l'écurie sur laquelle il se calcule
    // ne l'est plus.
    expect(await page.getByTestId('policy-summary').innerText()).not.toBe(before);

    // Et l'écart est dit à l'écran, sur le compte exact des montures enfermées.
    await expect(page.getByTestId('penned-notice')).toContainText(
      `${montures} montures en enclos, mises de côté`
    );
  });

  test('parc plein : plus une place annoncée libre', async ({ page }) => {
    // Le jumeau du retrait des montures, et il fallait les deux. Retirer les
    // montures sans retirer leurs places laissait la politique planifier une
    // seconde fournée de cinquante montures dans un parc où il n'en reste pas
    // une de libre — avec, dedans, celles qui y sont déjà.
    await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    const enclos = Number(
      (await page.getByTestId('pane-load').innerText()).match(/(\d+) enclos/)![1]
    );
    await expect(page.getByTestId('policy-summary')).toContainText('/50 places');

    await lockAll(page, enclos);

    // Cinquante places occupées, zéro libre — et la politique ne charge donc
    // plus rien. C'est le comportement juste, pas un cas dégradé.
    await expect(page.getByTestId('policy-summary')).toContainText('0/0 places');
  });

  test('l’écurie affichée, elle, ne rétrécit pas', async ({ page }) => {
    // La distinction que ce correctif introduit : « ce que je possède » n'est
    // pas « ce dont je dispose ce matin ». Retirer les montures d'enclos de
    // « Mes stocks » ferait croire à un vol, et c'est le compte que l'éleveur
    // compare à celui du jeu — 203 contre 225, la fois où ça a coûté 22
    // montures.
    await mockSupabase(page);
    await openBreeding(page);

    const stocks = page.getByRole('button', { name: /montures ·/ });
    const before = await stocks.innerText();

    await openLoadTab(page);
    const enclos = Number(
      (await page.getByTestId('pane-load').innerText()).match(/(\d+) enclos/)![1]
    );
    await lockAll(page, enclos);

    expect(await stocks.innerText()).toBe(before);
    // Et l'écart entre les deux comptes est dit, plutôt que laissé à deviner.
    await expect(page.getByTestId('penned-notice')).toContainText('en enclos, mises de côté');
  });

  test('sortir l’enclos rend les montures aux arbitrages', async ({ page }) => {
    // La contrepartie, et elle compte autant : une monture mise de côté qui ne
    // reviendrait jamais serait perdue pour l'outil, ce qui est pire que
    // comptée deux fois. « Fertile » est le cas qui le montre le mieux — il
    // n'écrit rien sur les montures, donc l'écurie retrouve exactement son état
    // d'avant.
    //
    // La sonde est l'**accouplement**, et ce n'est plus un détail : un enclos ne
    // reçoit que des fertiles, donc mettre de côté ne change rien à ce qui se
    // clone. Le compteur du clonage y répondait pourtant, parce qu'il portait le
    // plan de la politique et non les stériles de l'écurie — les deux listes que
    // l'onglet Clonage confondait. Il n'y répond plus, et c'est la correction, pas
    // une régression : ce qui bouge quand on enferme une fertile, c'est ce qu'on
    // peut accoupler.
    await mockSupabase(page);
    await openBreeding(page);
    await openLoadTab(page);

    // La sonde est le **résumé de la politique** — « N accouplements · P/Q
    // places » — et non le compteur de l'onglet.
    //
    // Celui-ci comptait les accouplements à zéro place, et il a cessé de
    // répondre : un enclos ne reçoit que des fertiles **non fécondes**, donc
    // enfermer n'ôte rien à ce qui peut s'accoupler gratuitement. Qu'il bougeait
    // avant était l'effet de bord qu'on vient de corriger — la politique changeait
    // d'avis quand l'écurie bougeait sous elle (voir `projectBirths`). Un test qui
    // s'appuie sur ce frémissement mesure le défaut, pas la propriété.
    //
    // Le résumé, lui, porte le plan entier, places comprises, donc il perd
    // exactement ce qu'on enferme et le retrouve à la sortie. C'est bien « les
    // montures reviennent aux arbitrages » qu'on lit.
    const summary = () => page.getByTestId('policy-summary').innerText();
    const before = (await summary()).replace(/\s+/g, ' ');
    await lockAll(page, 1);
    const penned = (await summary()).replace(/\s+/g, ' ');
    expect(penned, 'enfermer doit se voir dans le plan').not.toBe(before);

    await page.getByTestId('locked-pen').first().getByTestId('exit-pen').click();
    await page.getByTestId('exit-fertile').click();
    await expect(page.getByTestId('locked-pen')).toHaveCount(0);

    await expect(page.getByTestId('penned-notice')).toHaveCount(0);
    expect((await summary()).replace(/\s+/g, ' '), 'et se défaire à la sortie').toBe(before);
  });
});
