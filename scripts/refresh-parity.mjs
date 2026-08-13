/**
 * Réinstaller un champion et refaire les six références de parité.
 *
 * ```sh
 * node scripts/refresh-parity.mjs                 # rust/champion.json
 * node scripts/refresh-parity.mjs rust/champion-t3.json
 * node scripts/refresh-parity.mjs --check         # ne réécrit rien, vérifie
 * ```
 *
 * ## Pourquoi une commande et pas six
 *
 * Changer de champion demande cinq gestes : copier l'artefact dans `src/`, refaire
 * les deux références qui en dépendent — le réseau et la recherche — refaire les
 * deux qui n'en dépendent pas mais que `FEATURES` peut invalider, et rejouer les
 * six gardes. Les faire à la main, c'est en oublier un ; et l'oubli qui compte
 * ne se voit pas.
 *
 * Le pire est celui-ci : régénérer les références **sans** copier l'artefact. Les
 * gardes comparent alors l'ancien champion à des références faites avec le
 * nouveau, et l'écran continue de tourner sur l'ancien sans que rien ne le dise.
 * Ici l'oubli est impossible par construction — le même chemin sert aux deux.
 *
 * ## Ce que ça ne régénère pas
 *
 * Les douze plans embarqués de `model-plans/`. Ils viennent de `plan.rs`, joué sur
 * la partie **complète**, alors que le champion du tapis roulant ne décide que de
 * l'appariement et du clonage. Ce sont deux artefacts distincts, et le second ne
 * périme pas le premier.
 */

import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const RUST = join(ROOT, 'rust');
const EMBEDDED = join(ROOT, 'src/lib/dofus/breeding/champion.json');

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const source = resolve(ROOT, argv.find((arg) => !arg.startsWith('--')) ?? 'rust/champion.json');

const say = (message) => console.log(message);
/** Le chemin, court quand il est dans le dépôt et entier quand il en sort. */
const shown = (path) => {
  const inside = relative(ROOT, path);
  return inside.startsWith('..') ? path : inside;
};
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', env: process.env });

/* ------------------------------------------------------------ l'artefact -- */

if (!existsSync(source)) {
  console.error(
    `${shown(source)} est absent.\n` +
      `Lancer d'abord l'entraînement :\n` +
      `  cd rust && cargo run --release -p breeding-neat -- --env treadmill --minutes 360`
  );
  process.exit(1);
}

const champion = JSON.parse(readFileSync(source, 'utf8'));
const embedded = existsSync(EMBEDDED) ? JSON.parse(readFileSync(EMBEDDED, 'utf8')) : null;

// L'arité est le seul contrat que l'artefact porte lui-même, et le seul dont la
// violation ne se voie pas : un vecteur de la mauvaise taille se lit de travers
// sans rien casser. `network.ts` la vérifie aussi, mais autant refuser ici.
const FEATURES = Number(
  /export const FEATURES = (\d+)/.exec(
    readFileSync(join(ROOT, 'src/lib/dofus/breeding/census.ts'), 'utf8')
  )?.[1]
);
if (champion.features !== FEATURES) {
  console.error(
    `${shown(source)} attend ${champion.features} entrées, le portage en ` +
      `déclare ${FEATURES}. Ce champion est d'une autre génération d'encodage : il ` +
      `n'est pas rechargeable, il faut réentraîner.`
  );
  process.exit(1);
}

const scoreOf = (artifact) =>
  artifact?.validation_score ? `${(artifact.validation_score / 1e6).toFixed(2)} M au départage` : '—';

say(`champion   : ${shown(source)} · ${scoreOf(champion)}`);
say(`embarqué   : ${embedded ? scoreOf(embedded) : 'aucun'}`);

if (checkOnly) {
  say('\n--check : rien n’est réécrit, on rejoue seulement les gardes.\n');
} else {
  copyFileSync(source, EMBEDDED);
  say(`\n${shown(EMBEDDED)} remplacé.\n`);
}

/* ------------------------------------------------------------ les fixtures */

if (!checkOnly) {
  // Les six dumpers d'un coup : `cargo` ne recompile que ce qui a bougé, et
  // les demander séparément relançait six fois la même vérification de crate.
  say('--- compilation des dumpers ---');
  run(
    'cargo',
    [
      'build',
      '--release',
      '-q',
      '-p',
      'breeding-neat',
      '--bin',
      'dump-network',
      '--bin',
      'dump-census',
      '--bin',
      'dump-delta',
      '--bin',
      'dump-search',
      '--bin',
      'dump-schedule',
      '--bin',
      'dump-ladder',
    ],
    RUST
  );

  // `dump-network` et `dump-search` prennent le champion ; les deux autres n'en
  // dépendent pas, mais ils dépendent de `FEATURES` et de `trees.json` — les
  // refaire coûte quelques secondes et évite d'avoir à se demander lesquels.
  const target = (name) => join(ROOT, 'scripts/fixtures', name);
  const dumps = [
    ['dump-network', [source, target('network-parity.json')]],
    ['dump-census', [target('census-parity.json')]],
    ['dump-delta', [target('delta-parity.json')]],
    ['dump-search', [source, target('search-parity.json')]],
    // Celle-ci ne dépend d'aucun champion — c'est de l'ordonnancement pur — mais
    // elle dépend de `schedule.rs`, et la refaire coûte deux secondes.
    ['dump-schedule', [target('schedule-parity.json')]],
    // Celle-ci non plus : le plan de l'échelle se déduit de `trees.json` et de
    // `ladder.rs`, donc c'est l'un des deux qui bouge quand elle change. La
    // refaire par réflexe évite d'avoir à se demander lequel.
    ['dump-ladder', [target('ladder-parity.json')]],
  ];
  say('\n--- références ---');
  for (const [binary, args] of dumps) {
    run(join(RUST, 'target/release', binary), args, RUST);
  }
}

/* --------------------------------------------------------------- les gardes */

say('\n--- gardes ---');
let failed = 0;
for (const guard of ['network', 'census', 'delta', 'search', 'schedule', 'ladder-parity']) {
  try {
    run('node', [join(ROOT, `scripts/check-${guard}.mjs`)], ROOT);
  } catch {
    failed += 1;
  }
}

if (failed > 0) {
  console.error(
    `\n${failed} garde(s) en échec. Une divergence ici n'est pas un défaut de ` +
      `référence : elle dit que le portage et le Rust ne font plus la même chose.`
  );
  process.exit(1);
}
say('\nles six gardes passent — le portage rejoue ce champion-ci');
