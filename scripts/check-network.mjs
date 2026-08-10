/**
 * Le portage du réseau rejoue-t-il le Rust ?
 *
 * ```sh
 * node scripts/check-network.mjs
 * ```
 *
 * ## Pourquoi ce garde-fou existe
 *
 * `dump-parity-fixtures.ts` verrouille la loi d'appariement **dans l'autre sens** :
 * là-bas le TypeScript fait foi, parce que cette loi est mesurée en jeu et qu'il
 * la porte depuis toujours. Ici c'est le Rust qui fait foi, parce que les poids
 * sortent de sa recherche.
 *
 * Ce qui compte est qu'il y ait une référence dans les deux sens. Deux
 * implémentations d'une même règle divergent en silence, et rien dans une
 * compilation ne le signale — c'est exactement ce que ce dépôt a appris en
 * portant `pairing.ts` vers Rust.
 *
 * ## Régénérer la référence
 *
 * ```sh
 * cd rust
 * cargo run --release -p breeding-neat --bin dump-network -- champion-t2.json \
 *   ../src/lib/dofus/breeding/network-parity.json
 * ```
 *
 * À refaire quand le champion change **ou** quand `FEATURES` bouge : l'artefact
 * porte son arité, donc un vecteur d'une autre taille est refusé plutôt que lu de
 * travers.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TOLERANCE = 1e-9;

// Le module est en TypeScript et n'importe rien : on le compile seul, sans monter
// le bundle, exactement comme `check-plan.mjs` le fait pour `timeline.ts`.
const out = mkdtempSync(join(tmpdir(), 'dofdof-net-'));
execFileSync(
  'npx',
  [
    'tsc',
    join(ROOT, 'src/lib/dofus/breeding/network.ts'),
    '--outDir', out,
    '--module', 'commonjs',
    '--target', 'es2020',
    '--moduleResolution', 'node',
    '--esModuleInterop',
    '--skipLibCheck',
    '--noCheck',
  ],
  { stdio: 'inherit' }
);

const { compile, evaluate, isConnected } = await import(join(out, 'network.js'));
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const champion = read('src/lib/dofus/breeding/champion.json');
const fixture = read('src/lib/dofus/breeding/network-parity.json');

if (champion.features !== fixture.features) {
  console.error(
    `Le champion attend ${champion.features} entrées, la référence en fige ` +
      `${fixture.features}. Régénérer la référence — voir l'en-tête.`
  );
  process.exit(1);
}

const network = compile(champion);
if (!isConnected(network)) {
  console.error('La sortie du réseau ne reçoit rien : un réseau muet note tout pareil.');
  process.exit(1);
}

let worst = 0;
let at = -1;
for (const [index, testCase] of fixture.cases.entries()) {
  const gap = Math.abs(evaluate(network, testCase.inputs) - testCase.value);
  if (gap > worst) {
    worst = gap;
    at = index;
  }
}

const verdict = worst < TOLERANCE;
console.log(
  `${fixture.cases.length} cas · ${network.inputs} entrées · ` +
    `écart maximal ${worst.toExponential(3)} au cas ${at}`
);
console.log(verdict ? 'le portage rejoue le Rust' : `DIVERGENCE — tolérance ${TOLERANCE}`);
process.exit(verdict ? 0 : 1);
