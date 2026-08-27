/**
 * Refaire les références de parité, et vérifier qu'elles se reproduisent.
 *
 * ```sh
 * node scripts/refresh-parity.mjs           # régénère les références
 * node scripts/refresh-parity.mjs --check   # ne réécrit rien, vérifie
 * ```
 *
 * ## Ce que cette commande était, et ce qu'elle est
 *
 * Elle réinstallait un champion : copier l'artefact dans `src/`, refaire les six
 * références — dont deux le prenaient en entrée — et rejouer les six gardes. Le
 * geste risqué qu'elle rendait impossible était de **régénérer les références sans
 * copier l'artefact** : les gardes comparaient alors l'ancien champion à des
 * références faites avec le nouveau, et l'écran tournait sur l'ancien sans que rien
 * ne le dise.
 *
 * Le champion a quitté le TypeScript — l'échelle joue, et la recherche reste côté
 * Rust comme étalon. Il n'y a donc plus d'artefact à installer, plus de `FEATURES`
 * à faire correspondre, et deux références au lieu de six : le **plan** de
 * l'échelle et sa **fournée**. Les deux ne dépendent que de `trees.json` et de
 * `ladder.rs`.
 *
 * ## Ce qui reste, et pourquoi
 *
 * Deux questions différentes, et l'une passait inaperçue :
 *
 * - **la divergence** — le portage et le Rust ne font plus la même chose. Les
 *   gardes le disent.
 * - **la péremption** — ils s'accordent toujours, mais la référence a été produite
 *   par un Rust antérieur. Aucune garde ne peut le voir, puisqu'une référence
 *   périmée reste auto-cohérente. C'est le défaut de #161, et c'est ce que
 *   `--check` regarde en dumpant à côté pour comparer.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath` et non `.pathname` : sous Windows ce dernier rend
// `/C:/Users/...`, que `resolve` prend pour un chemin absolu à rattacher au
// disque courant et transforme en `C:\C:\Users\...`.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUST = join(ROOT, 'rust');
const FIXTURES = join(ROOT, 'scripts/fixtures');

const checkOnly = process.argv.slice(2).includes('--check');

const say = (message) => console.log(message);
/** Le chemin, court quand il est dans le dépôt et entier quand il en sort. */
const shown = (path) => {
  const inside = relative(ROOT, path);
  return inside.startsWith('..') ? path : inside;
};
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', env: process.env });

/* ------------------------------------------------------------ les fixtures */

/**
 * Les deux références et leur dumper.
 *
 * `dump-ladder` fige le **plan** — quelles couleurs, quelles recettes, quelle
 * couronne. `dump-ladder-policy` fige la **fournée** que ce plan produit sur une
 * écurie donnée. Les deux se déduisent de `trees.json` et de `ladder.rs`, donc les
 * refaire par réflexe évite d'avoir à se demander laquelle a bougé.
 *
 * Sont partis avec ce qu'ils gardaient : `dump-network`, `dump-census`,
 * `dump-delta` et `dump-search` — les binaires existent toujours côté Rust, mais
 * plus rien ne les rejoue en TypeScript. `dump-schedule` est parti avec
 * `schedule.ts`. Une garde de parité sur du code que personne n'exécute coûte à
 * chaque vérification sans rien protéger.
 */
const DUMPS = [
  ['dump-ladder', 'ladder-parity.json'],
  ['dump-ladder-policy', 'ladder-policy-parity.json'],
];

/** Refait les deux références dans `outDir`. */
const runDumps = (outDir) => {
  // Les deux dumpers d'un coup : `cargo` ne recompile que ce qui a bougé, et les
  // demander séparément relançait deux fois la même vérification de crate.
  say('--- compilation des dumpers ---');
  run(
    'cargo',
    ['build', '--release', '-q', '-p', 'breeding-neat', ...DUMPS.flatMap(([bin]) => ['--bin', bin])],
    RUST
  );

  say('\n--- références ---');
  for (const [binary, name] of DUMPS) {
    run(join(RUST, 'target/release', binary), [join(outDir, name)], RUST);
  }
};

/** Références qui ne se reproduisent plus — vide hors `--check`. */
const stale = [];

if (checkOnly) {
  say('--check : rien n’est réécrit, on refait les références à côté pour les comparer.\n');
  // À côté, jamais par-dessus : `--check` ne réécrit rien, c'est son contrat.
  const scratch = mkdtempSync(join(tmpdir(), 'dofdof-parity-'));
  try {
    runDumps(scratch);
    for (const [, name] of DUMPS) {
      const fresh = readFileSync(join(scratch, name));
      const kept = existsSync(join(FIXTURES, name)) ? readFileSync(join(FIXTURES, name)) : null;
      if (kept === null || !fresh.equals(kept)) stale.push(name);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
} else {
  runDumps(FIXTURES);
  say(`\n${shown(FIXTURES)} régénéré.`);
}

/* --------------------------------------------------------------- les gardes */

say('\n--- gardes ---');
let failed = 0;
for (const guard of ['ladder-parity', 'ladder-policy']) {
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
}

/* ------------------------------------------------- la reproductibilité */

if (stale.length > 0) {
  // Distinct d'une garde en échec, et le message doit le dire : ici le portage et
  // le Rust s'accordent toujours, c'est la **référence** qui a vieilli. Le Rust a
  // bougé dans ce qui l'alimente et personne ne l'a régénérée.
  console.error(
    `\n${stale.length} référence(s) ne se reproduisent plus depuis le Rust ` +
      `d'aujourd'hui :\n` +
      stale.map((name) => `  ${name}`).join('\n') +
      `\n\nCe n'est pas une divergence portage/Rust — les gardes le disent ` +
      `séparément. C'est que ces fichiers ont été produits par un Rust antérieur.\n` +
      `Trouver ce qui a bougé, décider si la nouvelle valeur fait foi, puis ` +
      `régénérer dans un commit dédié :\n  npm run parity`
  );
}

if (failed > 0 || stale.length > 0) process.exit(1);

say(
  checkOnly
    ? '\nles deux gardes passent, et les deux références se reproduisent'
    : '\nles deux gardes passent — le portage rejoue ce Rust-ci'
);
