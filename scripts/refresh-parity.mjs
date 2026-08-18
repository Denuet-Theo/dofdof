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
 */

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath` et non `.pathname` : sous Windows ce dernier rend
// `/C:/Users/...`, que `resolve` prend pour un chemin absolu à rattacher au
// disque courant et transforme en `C:\C:\Users\...`. La commande échouait donc
// sur « rust\champion.json est absent » alors que le fichier était là, et le
// message envoyait réentraîner un champion pour rien.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUST = join(ROOT, 'rust');
const FIXTURES = join(ROOT, 'scripts/fixtures');
const EMBEDDED = join(ROOT, 'src/lib/dofus/breeding/champion.json');

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const asked = argv.find((arg) => !arg.startsWith('--'));
const source = resolve(ROOT, asked ?? 'rust/champion.json');

/**
 * Le champion que les dumpers reçoivent.
 *
 * En vérification sans argument, c'est l'**embarqué** et non `rust/champion.json` :
 * les gardes comparent le portage à l'artefact de `src/`, donc c'est celui-là dont
 * il faut demander « produit-il encore ces références ». Dumper avec un champion
 * fraîchement entraîné qui traîne dans `rust/` ferait crier la reproductibilité
 * pour une raison qui n'en est pas une.
 */
const dumpChampion = checkOnly && !asked && existsSync(EMBEDDED) ? EMBEDDED : source;

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

const champion = JSON.parse(readFileSync(dumpChampion, 'utf8'));
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
    `${shown(dumpChampion)} attend ${champion.features} entrées, le portage en ` +
      `déclare ${FEATURES}. Ce champion est d'une autre génération d'encodage : il ` +
      `n'est pas rechargeable, il faut réentraîner.`
  );
  process.exit(1);
}

const scoreOf = (artifact) =>
  artifact?.validation_score ? `${(artifact.validation_score / 1e6).toFixed(2)} M au départage` : '—';

say(`champion   : ${shown(dumpChampion)} · ${scoreOf(champion)}`);
say(`embarqué   : ${embedded ? scoreOf(embedded) : 'aucun'}`);

if (checkOnly) {
  say('\n--check : rien n’est réécrit, on refait les références à côté pour les comparer.\n');
} else {
  copyFileSync(source, EMBEDDED);
  say(`\n${shown(EMBEDDED)} remplacé.\n`);
}

/* ------------------------------------------------------------ les fixtures */

/**
 * Les six références et leur dumper. `dump-network` et `dump-search` prennent le
 * champion ; les autres n'en dépendent pas, mais ils dépendent de `FEATURES` et
 * de `trees.json` — les refaire coûte quelques secondes et évite d'avoir à se
 * demander lesquels.
 *
 * `dump-ladder` se déduit de `trees.json` et de `ladder.rs` : le refaire par
 * réflexe évite d'avoir à se demander s'il a bougé.
 *
 * `dump-schedule` est parti avec `schedule.ts` : l'ordonnanceur porté n'était plus
 * appelé par l'écran, et une garde de parité sur du code que personne n'exécute
 * coûte à chaque vérification sans rien protéger.
 */
const DUMPS = [
  ['dump-network', 'network-parity.json', true],
  ['dump-census', 'census-parity.json', false],
  ['dump-delta', 'delta-parity.json', false],
  ['dump-search', 'search-parity.json', true],
  ['dump-ladder', 'ladder-parity.json', false],
  ['dump-ladder-policy', 'ladder-policy-parity.json', false],
];

/** Refait les six références dans `outDir`. */
const runDumps = (outDir) => {
  // Les six dumpers d'un coup : `cargo` ne recompile que ce qui a bougé, et
  // les demander séparément relançait six fois la même vérification de crate.
  say('--- compilation des dumpers ---');
  run(
    'cargo',
    ['build', '--release', '-q', '-p', 'breeding-neat', ...DUMPS.flatMap(([bin]) => ['--bin', bin])],
    RUST
  );

  say('\n--- références ---');
  for (const [binary, name, takesChampion] of DUMPS) {
    const args = takesChampion
      ? [dumpChampion, join(outDir, name)]
      : [join(outDir, name)];
    run(join(RUST, 'target/release', binary), args, RUST);
  }
};

/**
 * Références qui ne se reproduisent plus — vide hors `--check`.
 *
 * C'est le défaut que relevait #161, et il était **silencieux** : les trois
 * références concernées passaient leurs gardes, parce qu'elles portent leur
 * propre économie en entrée et restent donc auto-cohérentes. Ce qu'elles avaient
 * cessé d'être, c'est **reproductibles** — et une référence de parité ne vaut que
 * par là. Sans ce contrôle, la seule façon de s'en apercevoir est de lancer
 * `npm run parity` et de voir trois fichiers salir un diff sans rapport.
 */
const stale = [];

if (checkOnly) {
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
}

/* --------------------------------------------------------------- les gardes */

say('\n--- gardes ---');
let failed = 0;
for (const guard of ['network', 'census', 'delta', 'search', 'ladder-parity', 'ladder-policy']) {
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
  // Distinct d'une garde en échec, et le message doit le dire : ici le portage
  // et le Rust s'accordent toujours, c'est la **référence** qui a vieilli. Le
  // Rust a bougé dans ce qui l'alimente et personne ne l'a régénérée.
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
    ? '\nles six gardes passent, et les six références se reproduisent'
    : '\nles six gardes passent — le portage rejoue ce champion-ci'
);
