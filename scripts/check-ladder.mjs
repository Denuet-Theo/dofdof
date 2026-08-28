/**
 * La règle de l'échelle tient-elle encore ?
 *
 * ```sh
 * node scripts/check-ladder.mjs
 * ```
 *
 * Une seule chose est verrouillée ici, et c'est celle qui a manqué pendant
 * quatre mois :
 *
 * > **Un croisement est admissible si et seulement si ses couleurs cibles sont
 * > non vides et toutes dans le plan.**
 *
 * L'écran proposait des accouplements qu'il affichait lui-même « rien à
 * gagner » — la cible n'était nommée par aucune couleur, donc le croisement
 * recopiait l'ascendance, ne payait aucun géneton et stérilisait ses deux
 * parents. Sur une écurie réelle de 36 montures, 160 des 169 appariements
 * possibles étaient dans ce cas, et rien ne les écartait.
 *
 * Le Rust verrouille la même règle avec `un_couple_qui_ne_nomme_rien_est_refuse`
 * dans `rust/breeding-sim/src/ladder.rs`. Ce script est son pendant porté : sans
 * lui, la règle peut disparaître d'un rendu à l'autre sans que rien ne rougisse.
 */

import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const out = mkdtempSync(join(tmpdir(), 'dofdof-ladder-'));
// Le compilateur est appelé par son point d'entrée et non par `npx` : sous
// Windows `npx` est un `.cmd`, que `spawnSync` refuse de lancer sans shell
// depuis Node 20.12. Le binaire local est là de toute façon.
execFileSync(
  process.execPath,
  [
    join(ROOT, 'node_modules/typescript/bin/tsc'),
    join(ROOT, 'src/lib/dofus/breeding/ladder.ts'),
    '--outDir', out,
    '--module', 'commonjs',
    '--target', 'es2020',
    '--moduleResolution', 'node',
    '--esModuleInterop',
    '--skipLibCheck',
    '--resolveJsonModule',
    '--noCheck',
  ],
  { stdio: 'inherit' }
);

const { ladderOf, crownAt, aimsAt, namesSomething, CLIMB_MUST_GAIN_GENERATION } = await import(
  pathToFileURL(join(out, 'ladder.js')).href
);
const { pairOutlook } = await import(pathToFileURL(join(out, 'pairing.js')).href);

const trees = JSON.parse(readFileSync(join(ROOT, 'src/lib/dofus/breeding/trees.json'), 'utf8'));

let failures = 0;
const fail = (message) => {
  console.error(`ÉCHEC — ${message}`);
  failures += 1;
};

/**
 * La liste elle-même est une décision mesurée, donc elle est épinglée.
 *
 * Sans cette ligne, la garde du rang ci-dessous reste verte si on **retire**
 * `muldo` de `CLIMB_MUST_GAIN_GENERATION` : elle vérifie alors « la règle ne
 * s'applique pas et ne change rien », ce qui est vrai. Vérifié en la retirant :
 * 60 latéraux sans elle, 60 livrés, aucune ligne rouge.
 *
 * Le muldo y est parce qu'un relevé le dit — export de l'éleveur du 28/08,
 * 100 graines, couronne du projet, moisson étendue éteinte : +3,8 M à
 * 120 fournées et +4,8 M à 150, et plus de gen 10 tenues aux cinq horizons.
 * Les deux autres familles n'y sont **pas** parce qu'elles ne sont pas mesurées
 * dans ce régime, et que le relevé qui a fondé `climbs` au coût y était franc.
 *
 * Changer cette liste demande donc une mesure, pas un avis.
 */
if (!CLIMB_MUST_GAIN_GENERATION.includes('muldo')) {
  fail(
    'CLIMB_MUST_GAIN_GENERATION ne contient plus « muldo ». La règle du rang y a ' +
      'été mesurée gagnante ; la retirer demande une nouvelle mesure.'
  );
}

for (const family of trees.families) {
  const colors = family.colors;
  const generations = new Map(colors.map((color) => [color.id, color.generation]));
  const byId = new Map(colors.map((color) => [color.id, color]));
  const ladder = ladderOf(colors);

  if (ladder.wanted.size === 0) {
    fail(`${family.id} : aucun plan posé.`);
    continue;
  }

  // Tout ingrédient d'une couleur voulue est lui-même voulu, ou s'achète —
  // c'est-à-dire qu'il est de génération 1. Un plan qui réclame une couleur que
  // rien ne fabrique ne se termine jamais.
  for (const colorId of ladder.wanted) {
    const recipe = ladder.recipeOf.get(colorId);
    if (!recipe) {
      fail(`${family.id} : ${colorId} est au plan sans recette.`);
      continue;
    }
    for (const ingredient of recipe) {
      const generation = generations.get(ingredient);
      if (!ladder.wanted.has(ingredient) && generation !== 1) {
        fail(`${family.id} : ${colorId} demande ${ingredient}, ni au plan ni achetable.`);
      }
    }
  }

  // Les gen 1 du plan sont toutes dans un bloc, et les blocs sont des cliques :
  // c'est ce qui garantit qu'un raté reste utilisable — voir `layThird`.
  const inBlocks = new Set(ladder.blocks.flat());
  for (const colorId of ladder.wanted) {
    if (generations.get(colorId) !== 1) continue;
    if (!inBlocks.has(colorId)) fail(`${family.id} : la gen 1 ${colorId} n'est dans aucun bloc.`);
  }
  const secondsOf = (a, b) =>
    colors.some(
      (color) =>
        color.generation === 2 &&
        color.recipes.some(
          ([x, y]) => (x === a && y === b) || (x === b && y === a)
        )
    );
  for (const block of ladder.blocks) {
    for (const a of block) {
      for (const b of block) {
        if (a !== b && !secondsOf(a, b)) {
          fail(`${family.id} : le bloc ${block.join('+')} n'est pas une clique (${a}, ${b}).`);
        }
      }
    }
  }

  // **L'invariant** : un couple dont la cible n'est nommée par aucune couleur
  // est refusé. On le cherche sur toutes les paires de gen 1 du catalogue, qui
  // sont exactement celles qu'un éleveur tient par dizaines.
  const firsts = colors.filter((color) => color.generation === 1);
  let barren = 0;
  let accepted = 0;
  for (const male of firsts) {
    for (const female of firsts) {
      const mate = (color, sex) => ({ id: null, colorId: color.id, sex, level: 1, parents: null });
      const pair = [mate(male, 'M'), mate(female, 'F')];
      const names = namesSomething(pair[0], pair[1], colors, generations);
      const aim = aimsAt(pair[0], pair[1], colors, generations, ladder);
      if (!names) {
        barren += 1;
        if (aim !== null) {
          fail(
            `${family.id} : ${male.id} × ${female.id} ne nomme rien et l'échelle l'accepte.`
          );
        }
      } else if (aim !== null) {
        accepted += 1;
        // Ce que l'échelle accepte doit être au plan, sans quoi la seconde
        // moitié de la règle ne sert à rien.
        if (!ladder.wanted.has(aim)) {
          fail(`${family.id} : ${male.id} × ${female.id} visé hors plan (${aim}).`);
        }
      }
    }
  }

  // Les gen 1 ne sont pas « voulues » — elles s'achètent, elles ne se
  // fabriquent pas. Ce que le plan en dit tient dans ses blocs.
  const blocks = ladder.blocks
    .map((block) => block.map((colorId) => byId.get(colorId)?.name ?? colorId).join('+'))
    .join(' | ');

  // **Le plan couronné**, qui est celui que l'écran applique.
  //
  // `ladderOf` s'arrête au dernier barreau impair et garde toutes ses couleurs ;
  // `crownedLadderOf` tranche une gen 10 et taille ce que plus rien ne réclame.
  // C'est le second qui alimente `aimsAt` dans `policy.ts`, donc c'est lui qu'il
  // faut refermer — et rien ne le vérifiait : le volkorne a posé pendant tout un
  // correctif un plan couronné dont la gen 8 réclamait une gen 7 absente, sans
  // qu'aucune garde ne rougisse.
  //
  // La couronne dépend des prix de gen 10, donc on ne conclut pas sur un tirage :
  // on couronne sur chaque candidate à tour de rôle, ce qui couvre aussi les
  // routes que le prix ne choisit jamais.
  const top = colors.reduce((highest, color) => Math.max(highest, color.generation), 0);
  const tops = colors.filter((color) => color.generation === top).map((color) => color.id);
  let crownedRuns = 0;
  for (const forced of tops) {
    // `crownedLadderOf` choisit d'abord le partenaire, donc un prix ne suffit
    // pas à imposer une couronne : on passe par `crownAt`, qui l'accepte.
    const crowned = {
      wanted: new Set(ladder.wanted),
      recipeOf: new Map(ladder.recipeOf),
      demand: new Map(ladder.demand),
      blocks: ladder.blocks.map((block) => [...block]),
      summit: [...ladder.summit],
    };
    crownAt(crowned, colors, () => 0, forced);
    // Une gen 10 qui n'est pas gen 9 × gen 1 achetable n'est pas couronnable.
    if (crowned.summit.length !== 1 || crowned.summit[0] !== forced) continue;
    crownedRuns += 1;

    for (const colorId of crowned.wanted) {
      const recipe = crowned.recipeOf.get(colorId);
      if (!recipe) {
        fail(`${family.id} : ${colorId} au plan couronné sans recette (${forced}).`);
        continue;
      }
      for (const ingredient of recipe) {
        if (!crowned.wanted.has(ingredient) && generations.get(ingredient) !== 1) {
          fail(
            `${family.id} : le plan couronné sur ${forced} demande ${ingredient} ` +
              `pour ${colorId}, ni au plan ni achetable.`
          );
        }
      }
      // Ce qui reste au plan doit être réclamé. C'est la taille par la demande,
      // et c'est elle qui distingue le plan du Rust de celui d'avant le portage.
      if ((crowned.demand.get(colorId) ?? 0) <= 0) {
        fail(`${family.id} : ${colorId} reste au plan couronné sans demande (${forced}).`);
      }
    }
    // Et la règle d'admissibilité doit tenir sur ce plan-là aussi.
    for (const male of firsts) {
      for (const female of firsts) {
        const mate = (color, sex) => ({ id: null, colorId: color.id, sex, level: 1, parents: null });
        const pair = [mate(male, 'M'), mate(female, 'F')];
        if (namesSomething(pair[0], pair[1], colors, generations)) continue;
        if (aimsAt(pair[0], pair[1], colors, generations, crowned) !== null) {
          fail(
            `${family.id} : ${male.id} × ${female.id} ne nomme rien et le plan ` +
              `couronné sur ${forced} l'accepte.`
          );
        }
      }
    }
  }
  if (crownedRuns === 0) fail(`${family.id} : aucune couronne posable.`);

  /**
   * La règle par famille : un croisement doit **gagner un rang**, pas seulement
   * du coût de construction.
   *
   * Vraie sur le muldo seul — mesurée sur l'export de l'éleveur du 28/08 — et
   * fausse ailleurs, où `climbs` au coût est ce qui ouvre le seul chemin vers la
   * couleur chère d'un rang (+41 M au volkorne, +34 M à la dragodinde). Voir
   * `CLIMB_MUST_GAIN_GENERATION`.
   *
   * Les deux moitiés sont vérifiées, et la seconde est l'**anti-vacuité** : sans
   * elle, une règle qui refuserait tout, ou un catalogue sans croisement latéral,
   * rendrait la première vraie sans rien dire.
   *
   * Le **sommet est exclu**, et pas par commodité : au plafond
   * `targetGeneration === ancestryGeneration` par construction, une gen 10 croisée
   * avec une gen 1 visant la gen 10. La règle est posée après cette porte-là dans
   * les deux ports, et `check-summit.mjs` tient ce qu'elle laisse passer.
   */
  const attendu = CLIMB_MUST_GAIN_GENERATION.includes(family.id);
  const sommet = Math.max(...generations.values());
  // Des montures **nées de leur recette**, et non achetées.
  //
  // C'est ce qui rend le cas latéral représentable : une monture sans ascendance
  // ne porte que sa propre génération, donc sa cible est toujours au-dessus et
  // aucun couple n'est jamais latéral. La première version de cette garde
  // énumérait des `parents: null` et annonçait « 0 croisement latéral » sur les
  // trois familles — vraie, et vide. L'éleveur, lui, croise ce qu'il a fait
  // naître : sa Turquoise-Indigo est née d'une Indigo et d'une Turquoise.
  const nes = colors
    .filter((color) => (color.recipes ?? []).length > 0)
    .map((color) => ({ color, parents: color.recipes[0] }));
  // Le même comptage sous les deux régimes : la règle éteinte donne le témoin,
  // la règle telle qu'elle est livrée donne le résultat. Comparer une famille à
  // une autre ne dirait rien — leurs plans n'ont pas les mêmes barreaux.
  const compter = (ladder) => {
    let n = 0;
    const exemples = [];
    for (const male of nes) {
      for (const female of nes) {
        const mate = (entry, sex) => ({
          id: null,
          colorId: entry.color.id,
          sex,
          level: 1,
          parents: [...entry.parents],
        });
        const pair = [mate(male, 'M'), mate(female, 'F')];
        const outlook = pairOutlook(pair[0], pair[1], colors, generations);
        if (!outlook || outlook.targetGeneration > outlook.ancestryGeneration) continue;
        if (outlook.targetGeneration >= sommet) continue; // le sommet, décidé ailleurs
        if (aimsAt(pair[0], pair[1], colors, generations, ladder) === null) continue;
        n += 1;
        if (exemples.length < 3) {
          exemples.push(
            `${male.color.id} × ${female.color.id} -> gen ${outlook.targetGeneration} ` +
              `(le couple porte gen ${outlook.ancestryGeneration})`
          );
        }
      }
    }
    return { n, exemples };
  };

  const sansRegle = compter(ladderOf(colors, undefined, null));
  const livre = compter(ladderOf(colors, undefined, family.id));

  if (attendu) {
    // L'anti-vacuité vit ici, et nulle part ailleurs : sans latéral à refuser, un
    // « zéro » ne prouverait rien. Une première version l'avait cherchée chez les
    // autres familles, qui n'en portent aucun — la garde était verte et vide.
    if (sansRegle.n === 0) {
      fail(
        `${family.id} : la règle du rang est appliquée mais le plan n'admettait ` +
          `aucun croisement latéral sans elle. Le zéro ne prouve rien.`
      );
    }
    if (livre.n !== 0) {
      fail(
        `${family.id} : ${livre.n} croisement(s) latéral(aux) restent admis malgré ` +
          `la règle du rang. Par exemple ${livre.exemples[0]}.`
      );
    }
  } else if (livre.n !== sansRegle.n) {
    fail(
      `${family.id} : la règle du rang ne s'y applique pas, mais le plan livré ` +
        `admet ${livre.n} latéraux contre ${sansRegle.n} sans elle.`
    );
  }

  console.log(
    `${family.id.padEnd(11)} · règle du rang ${attendu ? 'appliquée' : 'non appliquée'} · ` +
      `latéraux hors sommet : ${sansRegle.n} sans elle, ${livre.n} livrés` +
      (sansRegle.exemples.length > 0 ? ` · ex. ${sansRegle.exemples[0]}` : '')
  );

  console.log(
    `${family.id.padEnd(11)} · ${ladder.wanted.size} couleurs au plan · ` +
      `blocs ${blocks} · ` +
      `paires gen 1 : ${barren} sans cible refusées, ${accepted} admises · ` +
      `${crownedRuns} couronne${crownedRuns > 1 ? 's' : ''} refermée${crownedRuns > 1 ? 's' : ''}`
  );
}

if (failures > 0) {
  console.error(`\n${failures} règle${failures > 1 ? 's' : ''} violée${failures > 1 ? 's' : ''}.`);
  process.exit(1);
}
console.log("\nl'échelle refuse tout croisement qui ne nomme rien");
