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

const { ladderOf, aimsAt, namesSomething } = await import(
  pathToFileURL(join(out, 'ladder.js')).href
);

const trees = JSON.parse(readFileSync(join(ROOT, 'src/lib/dofus/breeding/trees.json'), 'utf8'));

let failures = 0;
const fail = (message) => {
  console.error(`ÉCHEC — ${message}`);
  failures += 1;
};

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

  console.log(
    `${family.id.padEnd(11)} · ${ladder.wanted.size} couleurs au plan · ` +
      `blocs ${blocks} · ` +
      `paires gen 1 : ${barren} sans cible refusées, ${accepted} admises`
  );
}

if (failures > 0) {
  console.error(`\n${failures} règle${failures > 1 ? 's' : ''} violée${failures > 1 ? 's' : ''}.`);
  process.exit(1);
}
console.log("\nl'échelle refuse tout croisement qui ne nomme rien");
