/**
 * L'effet attendu d'un croisement, porté, rejoue-t-il le Rust ?
 *
 * ```sh
 * node scripts/check-delta.mjs
 * ```
 *
 * Troisième garde-fou du portage, après le réseau et le recensement, et celui qui
 * couvre les subtilités. La masse de génétons ne tombe qu'à la réussite **et**
 * seulement si une couleur nomme la cible — donc zéro sur une recopie. La
 * génération qu'un bébé porte est le maximum de sa couleur et de celles de ses
 * **deux parents**. L'espérance de valeur somme les issues couleur par couleur,
 * donc elle dépend des cinquante prix de gen 10 et pas d'un barème par rang.
 *
 * Aucune des trois ne se voit à l'écran si elle est fausse : le plan sort
 * plausible et vise à côté.
 *
 * ## Régénérer la référence
 *
 * ```sh
 * cd rust
 * cargo run --release -p breeding-neat --bin dump-delta -- \
 *   ../scripts/fixtures/delta-parity.json
 * ```
 */

import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TOLERANCE = 1e-9;

const out = mkdtempSync(join(tmpdir(), 'dofdof-delta-'));
execFileSync(
  'npx',
  [
    'tsc',
    join(ROOT, 'src/lib/dofus/breeding/census.ts'),
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

const { pairDelta } = await import(join(out, 'census.js'));
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const fixture = read('scripts/fixtures/delta-parity.json');
const trees = read('src/lib/dofus/breeding/trees.json');
const colors = trees.families.find((family) => family.id === 'muldo').colors;
const generations = new Map(colors.map((color) => [color.id, color.generation]));

let worst = 0;
let worstAt = null;
let missing = 0;

const compare = (label, at, mine, theirs) => {
  const gap = Math.abs(mine - theirs);
  if (gap > worst) worst = gap, (worstAt = { case: at, label, mine, theirs });
};

for (const [at, testCase] of fixture.cases.entries()) {
  const values = new Map(testCase.economy.values);
  const economy = {
    ...testCase.economy,
    valueOf: (colorId) => values.get(colorId) ?? 0,
    // Sans effet sur un delta, mais le contrat les réclame.
    startingKamas: 1,
    amberPerGeneration: 1,
    amberRange: [0, 0],
    genetonRange: [0, 0],
    topValue: 1,
    topValueRange: [0, 0],
    starterPrice: 0,
  };
  const mate = (side) => ({ id: null, ...side });

  const delta = pairDelta(
    mate(testCase.male),
    mate(testCase.female),
    colors,
    generations,
    economy,
    testCase.level,
    testCase.optimakinaFrom
  );
  if (!delta) {
    missing += 1;
    continue;
  }

  const theirs = testCase.delta;
  for (const key of [
    'maleGeneration', 'femaleGeneration', 'maleCarried', 'femaleCarried',
    'targetGeneration', 'optimakinaCost', 'genetonKamas', 'expectedValue',
  ]) {
    compare(key, at, delta[key], theirs[key]);
  }

  // Les naissances : mêmes couleurs, mêmes probabilités, mêmes générations
  // portées. L'ordre n'est pas comparé — c'est un ensemble.
  const mine = new Map(delta.births.map(([colorId, p, carried]) => [colorId, [p, carried]]));
  if (mine.size !== theirs.births.length) {
    console.error(
      `cas ${at} : ${mine.size} issues contre ${theirs.births.length}`
    );
    process.exit(1);
  }
  for (const [colorId, probability, carried] of theirs.births) {
    const ours = mine.get(colorId);
    if (!ours) {
      console.error(`cas ${at} : issue « ${colorId} » absente du portage`);
      process.exit(1);
    }
    compare(`births.${colorId}.p`, at, ours[0], probability);
    compare(`births.${colorId}.carried`, at, ours[1], carried);
  }
}

console.log(
  `${fixture.cases.length - missing} croisements comparés · écart maximal ${worst.toExponential(3)}`
);
if (missing > 0) {
  console.error(`${missing} croisements rendus \`null\` par le portage alors que le Rust en donne un`);
  process.exit(1);
}
if (worst >= TOLERANCE) {
  console.error(
    `DIVERGENCE au cas ${worstAt.case}, ${worstAt.label} : ${worstAt.mine} contre ${worstAt.theirs}`
  );
  process.exit(1);
}
console.log("l'effet d'un croisement, porté, rejoue le Rust");
