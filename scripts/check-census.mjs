/**
 * L'encodage porté rend-il les mêmes 74 entrées que le Rust ?
 *
 * ```sh
 * node scripts/check-census.mjs
 * ```
 *
 * `check-network.mjs` verrouille l'arithmétique du réseau ; celui-ci verrouille ce
 * qu'on lui donne à manger, et c'est la moitié risquée. Une entrée décalée d'un
 * cran, un `log1p` oublié, une normalisation prise sur la mauvaise référence, et
 * le réseau rend un nombre parfaitement plausible qui ne veut rien dire.
 *
 * En cas d'écart, on nomme **l'indice** fautif plutôt que de dire « ça diverge » :
 * le vecteur est un empilement de blocs de dix, donc l'indice désigne à lui seul
 * le bloc et la génération, et c'est presque toujours suffisant pour trouver.
 *
 * ## Régénérer la référence
 *
 * ```sh
 * npm run parity                     # depuis rust/champion.json
 * npm run parity -- rust/champion-t3.json
 * ```
 *
 * Une seule commande pour les quatre, et c'est délibéré : elle réinstalle aussi
 * l'artefact dans `src/`, si bien qu'on ne peut plus refaire les références sans
 * déployer le champion qui les a produites. Voir `refresh-parity.mjs`.
 */

import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TOLERANCE = 1e-9;

const out = mkdtempSync(join(tmpdir(), 'dofdof-census-'));
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

const { censusOf, featuresOf, FEATURES } = await import(
  join(out, 'census.js')
);
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const fixture = read('scripts/fixtures/census-parity.json');
const trees = read('src/lib/dofus/breeding/trees.json');
const colors = trees.families.find((family) => family.id === 'muldo').colors;

if (fixture.features !== FEATURES) {
  console.error(
    `La référence fige ${fixture.features} entrées, le portage en attend ${FEATURES}. ` +
      `Régénérer — voir l'en-tête.`
  );
  process.exit(1);
}

let worst = 0;
let worstAt = { case: -1, index: -1 };

for (const [at, testCase] of fixture.cases.entries()) {
  const values = new Map(testCase.economy.values);
  const economy = {
    ...testCase.economy,
    valueOf: (colorId) => values.get(colorId) ?? 0,
  };

  // Le Rust ne connaît que des montures ; le vrac est une commodité d'écran. On
  // reconstruit donc tout en individus, ce qui est le cas général — une monture
  // de vrac n'est qu'un individu fertile, non fécond et sans ascendance.
  const stable = {
    bulk: new Map(),
    individuals: testCase.mounts.map((mount, index) => ({
      id: String(index),
      colorId: mount.color,
      name: null,
      sex: mount.sex,
      level: 1,
      fertile: mount.fertile,
      cycled: mount.cycled,
      parents: mount.parents ?? null,
    })),
  };

  const features = featuresOf(censusOf(stable, colors, economy, testCase.kamas), colors, economy);
  for (const [index, expected] of testCase.features.entries()) {
    const gap = Math.abs(features[index] - expected);
    if (gap > worst) {
      worst = gap;
      worstAt = { case: at, index, mine: features[index], theirs: expected };
    }
  }
}

console.log(
  `${fixture.cases.length} écuries · ${FEATURES} entrées · écart maximal ` +
    `${worst.toExponential(3)}`
);
if (worst >= TOLERANCE) {
  console.error(
    `DIVERGENCE au cas ${worstAt.case}, entrée ${worstAt.index} : ` +
      `${worstAt.mine} contre ${worstAt.theirs}`
  );
  process.exit(1);
}
console.log("l'encodage porté rejoue le Rust");
