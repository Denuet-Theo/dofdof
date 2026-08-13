/**
 * Le plan de l'écran suit-il l'échelle ?
 *
 * ```sh
 * node scripts/check-recipes.mjs
 * ```
 *
 * `check-ladder.mjs` verrouille la règle d'**admissibilité** : un croisement qui
 * ne nomme rien est refusé. Elle ne dit rien du **plan** que l'écran construit,
 * et c'est l'autre moitié.
 *
 * `computeBreedingCosts` choisissait sa recette couleur par couleur, à la moins
 * chère, sans jamais regarder les autres. Rien dans ce choix ne garantit la
 * propriété que `layThird` démontre :
 *
 * > Le jeu de gen 2 retenu doit être une **union disjointe de cliques**. Un raté
 * > de `A × B` rend une gen 1 portant `[A, B]` ; la réemployer face à un C fait
 * > rencontrer B et C, qui nomment `B-C`. Dans une clique `B-C` est voulue et
 * > rien n'est perdu ; sinon la cible se dédouble et 27 % de la masse utile s'en
 * > va.
 *
 * Le relevé qui a motivé le correctif, obtenu en énumérant les jeux atteignables
 * par un choix indépendant :
 *
 * | famille | jeux de gen 2 atteignables | fermés | le choix à prix plats |
 * | --- | --- | --- | --- |
 * | dragodinde | 1 | 1 | fermé |
 * | muldo | 18 | 6 | **non fermé** |
 * | volkorne | 81 | 30 | **non fermé** |
 *
 * Sur le muldo, deux jeux sur trois sont cassés et le choix par défaut en fait
 * partie. Ce script échoue sur le code d'avant et passe sur celui d'après.
 */

import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SOURCES = [
  'src/lib/dofus/breeding/costs.ts',
  'src/lib/dofus/breeding/ladder.ts',
].map((path) => join(ROOT, path));

const out = mkdtempSync(join(tmpdir(), 'dofdof-recipes-'));

// tsc rend un code non nul sur une erreur de types tout en ayant émis le JS.
// Compilé hors du tsconfig du dépôt, seul un module manquant est fatal — et le
// chargement ci-dessous le dira.
try {
  execFileSync(
    process.execPath,
    [
      join(ROOT, 'node_modules/typescript/bin/tsc'),
      ...SOURCES,
      '--outDir', out,
      '--module', 'commonjs',
      '--target', 'es2020',
      '--moduleResolution', 'node',
      '--esModuleInterop',
      '--resolveJsonModule',
      '--skipLibCheck',
      '--noCheck',
    ],
    { stdio: 'pipe' }
  );
} catch (error) {
  if (error.status === undefined) throw error;
}

const require = createRequire(import.meta.url);
const load = (name) => {
  for (const candidate of [
    join(out, `${name}.js`),
    join(out, 'src/lib/dofus/breeding', `${name}.js`),
  ]) {
    try {
      return require(candidate);
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error(`module ${name} introuvable dans ${out}`);
};

const { computeBreedingCosts } = load('costs');
const { ladderOf } = load('ladder');

const trees = JSON.parse(readFileSync(join(ROOT, 'src/lib/dofus/breeding/trees.json'), 'utf8'));

let failures = 0;
const fail = (message) => {
  console.error(`ÉCHEC — ${message}`);
  failures += 1;
};

/**
 * Le tirage des prix.
 *
 * Un modèle de prix plat ne départage aucune recette, donc l'ancien choix
 * retombait toujours sur `recipes[0]` et on ne verrait qu'un seul cas. Ce qui
 * décide vraiment est l'**écart entre couleurs de même génération** — c'est lui
 * qui rend une recette moins chère que sa voisine. On le tire, sur des graines
 * fixes pour que l'échec soit reproductible.
 */
const seededRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
};

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34];

/** Le jeu de gen 2 est-il une union disjointe de cliques ? La règle de `layThird`. */
const isClosed = (seconds, byId) => {
  const edges = new Set();
  const vertices = new Set();
  for (const colorId of seconds) {
    const pair = byId.get(colorId)?.recipes[0];
    if (!pair || pair[0] === pair[1]) return false;
    const [a, b] = [...pair].sort();
    edges.add(`${a}|${b}`);
    vertices.add(pair[0]);
    vertices.add(pair[1]);
  }
  const joined = (a, b) => {
    const [x, y] = [a, b].sort();
    return edges.has(`${x}|${y}`);
  };
  return [...vertices].every((vertex) => {
    const near = [...vertices].filter((other) => other !== vertex && joined(vertex, other));
    return near.every((x) => near.every((y) => x === y || joined(x, y)));
  });
};

for (const family of trees.families) {
  const colors = family.colors;
  const byId = new Map(colors.map((color) => [color.id, color]));
  const ladder = ladderOf(colors);
  const generationOf = (id) => byId.get(id)?.generation ?? 0;

  let closedRuns = 0;
  let offLadder = 0;

  for (const seed of SEEDS) {
    const random = seededRandom(seed);
    // Monotone par génération, dispersée à l'intérieur : la forme des prix
    // réels, où deux gen 1 ne valent pas le même.
    const prices = new Map(
      colors.map((color) => {
        const base = 20_000 * Math.pow(2.15, color.generation - 1);
        const jitter = 0.5 + random() * 1.5;
        return [color.id, { level0: Math.round(base * jitter), level200: Math.round(base * 3) }];
      })
    );

    const estimates = computeBreedingCosts(colors, prices, {
      parentLevel: 'auto',
      fuelCostPerCycle: 5_000,
      genetonValue: 735,
      sacrificeUnitValue: 735,
      mangeoireCostPerMountPoint: 12,
      recycleSteriles: true,
      captureCost: 15_000,
    });

    // Les gen 2 que le plan mobilise réellement : celles que les recettes
    // retenues des gen 3 nomment.
    const seconds = new Set();
    for (const color of colors) {
      if (color.generation !== 3) continue;
      const recipe = estimates.get(color.id)?.breedRecipe;
      if (recipe) for (const parent of recipe) seconds.add(parent);
    }
    if (seconds.size > 0 && isClosed(seconds, byId)) closedRuns += 1;

    // Et la recette retenue doit être celle de l'échelle, partout où l'échelle
    // en nomme une.
    for (const color of colors) {
      const planned = ladder.recipeOf.get(color.id);
      if (!planned || generationOf(color.id) === 1) continue;
      const chosen = estimates.get(color.id)?.breedRecipe;
      if (!chosen) continue;
      const same =
        (chosen[0] === planned[0] && chosen[1] === planned[1]) ||
        (chosen[0] === planned[1] && chosen[1] === planned[0]);
      if (!same) {
        offLadder += 1;
        if (seed === SEEDS[0]) {
          console.error(
            `  ${family.id} · ${color.name} : plan ${chosen.join(' × ')}, ` +
              `échelle ${planned.join(' × ')}`
          );
        }
      }
    }
  }

  const verdict = closedRuns === SEEDS.length && offLadder === 0 ? 'ok' : 'CASSÉ';
  console.log(
    `${family.id.padEnd(11)} · jeu de gen 2 fermé sur ${closedRuns}/${SEEDS.length} tirages · ` +
      `${offLadder} recette${offLadder > 1 ? 's' : ''} hors échelle · ${verdict}`
  );

  if (closedRuns !== SEEDS.length) {
    fail(
      `${family.id} : le plan s'appuie sur un jeu de gen 2 non fermé sur ` +
        `${SEEDS.length - closedRuns} tirage(s) — 27 % de la masse utile part hors cible.`
    );
  }
  if (offLadder > 0) {
    fail(`${family.id} : ${offLadder} recette(s) retenue(s) hors du plan de l'échelle.`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} règle${failures > 1 ? 's' : ''} violée${failures > 1 ? 's' : ''}.`);
  process.exit(1);
}
console.log("\nle plan de l'écran suit les recettes de l'échelle");
