/**
 * La montée de colline, portée, rend-elle **le même plan** que le Rust ?
 *
 * ```sh
 * node scripts/check-search.mjs
 * ```
 *
 * Quatrième et dernier garde-fou du portage. Les trois précédents comparaient des
 * nombres à une tolérance près — le réseau à 2,8 × 10⁻¹⁴, les 74 entrées à
 * 8,9 × 10⁻¹⁶, l'effet d'un croisement à zéro. Celui-ci compare des listes
 * d'entiers, donc il n'admet aucune tolérance : le plan est identique ou il ne
 * l'est pas.
 *
 * ## Pourquoi c'est possible
 *
 * `random.ts` et `breeding_sim::economy::Rng` sont le même Mulberry32 sur `u32`,
 * opération pour opération. À écurie, graine et stratégie égales, les deux
 * recherches tirent la même suite de mutations et arrivent au même sommet.
 *
 * C'est aussi ce que ce garde-fou attrape le mieux : un `rng()` de plus ou de moins
 * sur une branche, même une qui ne sert à rien, décale toute la suite. Aucune des
 * deux recherches n'est fausse alors, et rien ne le signale — sauf ceci.
 *
 * ## Ce qu'il couvre en plus des trois autres
 *
 * La chaîne complète, dans l'ordre où l'app l'emploie : recensement de l'écurie,
 * encodage, réseau, effet d'un croisement, et la recherche qui appelle tout ça
 * quatre cents fois. La fonction de valeur est le **champion** et non la valeur
 * myope, pour cette raison précisément.
 *
 * ## Régénérer la référence
 *
 * ```sh
 * cd rust
 * cargo run --release -p breeding-neat --bin dump-search -- champion-t2.json \
 *   ../scripts/fixtures/search-parity.json
 * ```
 *
 * À refaire quand le champion change, quand `FEATURES` bouge, ou quand `search.rs`
 * change de tirage — les trois font un autre plan, légitimement.
 */

import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const out = mkdtempSync(join(tmpdir(), 'dofdof-search-'));
execFileSync(
  'npx',
  [
    'tsc',
    join(ROOT, 'src/lib/dofus/breeding/search.ts'),
    join(ROOT, 'src/lib/dofus/breeding/network.ts'),
    // `search.ts` reçoit son générateur en argument plutôt que de l'importer, donc
    // il faut le demander à part — c'est le même que celui de l'app, et c'est ce
    // qui rend la comparaison exacte plutôt qu'approchée.
    join(ROOT, 'src/lib/dofus/breeding/random.ts'),
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

const { planUnit, createSearcher, myopic, linearProbe } = await import(join(out, 'search.js'));
const { censusOf, featuresOf, FEATURES } = await import(join(out, 'census.js'));
const { seededRandom } = await import(join(out, 'random.js'));
const { compile, evaluate } = await import(join(out, 'network.js'));

const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const fixture = read('scripts/fixtures/search-parity.json');
const champion = read('src/lib/dofus/breeding/champion.json');
const trees = read('src/lib/dofus/breeding/trees.json');
const colors = trees.families.find((family) => family.id === 'muldo').colors;

if (fixture.features !== FEATURES || champion.features !== FEATURES) {
  console.error(
    `Arités incompatibles : référence ${fixture.features}, champion ` +
      `${champion.features}, portage ${FEATURES}. Régénérer — voir l'en-tête.`
  );
  process.exit(1);
}

const network = compile(champion);
const generations = new Map(colors.map((color) => [color.id, color.generation]));

/** Le plan tel qu'on le compare : des listes d'entiers, rien d'autre. */
const shape = (plan) =>
  JSON.stringify({
    purchases: plan.purchases,
    clonings: plan.clonings,
    crossings: plan.crossings,
    optimakina: plan.optimakina,
    sacrifices: plan.sacrifices,
    cycles: plan.cycles,
  });

let matched = 0;
let acted = 0;
const failures = [];

for (const [at, testCase] of fixture.cases.entries()) {
  const values = new Map(testCase.economy.values);
  const economy = {
    ...testCase.economy,
    valueOf: (colorId) => values.get(colorId) ?? 0,
  };

  // Le Rust ne connaît que des montures ; le vrac est une commodité d'écran. On
  // reconstruit donc tout en individus, dans l'ordre du Rust — c'est cet ordre que
  // les indices du plan désignent.
  const mounts = testCase.mounts.map((mount, index) => ({
    id: String(index),
    colorId: mount.color,
    name: null,
    sex: mount.sex,
    level: 1,
    fertile: mount.fertile,
    cycled: mount.cycled,
    parents: mount.parents ?? null,
  }));

  const view = {
    mounts,
    colors,
    generations,
    economy,
    strategy: testCase.strategy,
    kamas: testCase.kamas,
    capacity: testCase.capacity,
    loadKamas: testCase.loadKamas,
  };

  const run = (value) =>
    planUnit(
      createSearcher({ iterations: testCase.iterations, sacrifices: testCase.sacrifices }),
      view,
      seededRandom(testCase.seed),
      value
    );

  for (const [label, value, expected] of [
    ['myope', myopic, testCase.myopic],
    ['sonde', linearProbe(colors), testCase.probe],
    ['champion', (census) => evaluate(network, featuresOf(census, colors, economy)), testCase.plan],
  ]) {
    const theirs = shape(expected);
    if (shape(run(value)) === theirs) matched += 1;
    else failures.push({ at, label, mine: shape(run(value)), theirs });
  }

  const actions =
    testCase.plan.crossings.length +
    testCase.plan.clonings.length +
    testCase.plan.cycles.length +
    testCase.plan.sacrifices.length;
  if (actions > 0) acted += 1;

  // `censusOf` n'est pas comparé ici — `check-census.mjs` s'en charge — mais on
  // vérifie qu'il tourne sur ces écuries-là, faute de quoi un plan vide passerait
  // pour un accord.
  censusOf({ bulk: new Map(), individuals: mounts }, colors, economy, testCase.kamas);
}

console.log(
  `${matched}/${fixture.cases.length * 3} plans identiques · ${acted} cas non vides`
);
for (const failure of failures.slice(0, 3)) {
  console.error(`\ncas ${failure.at} (${failure.label})\n  portage : ${failure.mine}\n  rust    : ${failure.theirs}`);
}
if (failures.length > 0) {
  console.error(`\nDIVERGENCE sur ${failures.length} cas`);
  process.exit(1);
}
console.log('la recherche, portée, rejoue le Rust coup pour coup');
