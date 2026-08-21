/**
 * Passer un champion aux gardes **avant** de l'embarquer, et non après.
 *
 *   node scripts/screen-champions.mjs rust/finalists.json
 *   node scripts/screen-champions.mjs rust/champion-a.json rust/champion-b.json
 *
 * ## Pourquoi ce filtre existe
 *
 * L'entraînement note `kamas + liquidation − malus stérile + prime de collection`.
 * Il ne voit **rien** de ce que l'écran exige par ailleurs. Mesuré le 21/08 : un
 * champion entraîné quatre heures, meilleur que l'embarqué sur la moitié des
 * chiffres, n'appariait que **2 fécondes sur 20** là où le précédent en apparie 4.
 * `e2e/spend-fertility` l'a arrêté à l'embarquement — après la manche, une fois le
 * temps machine dépensé.
 *
 * Or c'est un défaut connu et daté : #227 a chiffré qu'une féconde non dépensée est
 * du capital immobilisé, et l'a corrigé **côté application seulement**. La fitness
 * n'a jamais porté le terme, donc la recherche ne pouvait pas l'apprendre. Elle
 * produira donc encore des champions qui thésaurisent, aussi longtemps qu'on ne les
 * filtrera pas.
 *
 * Ce script est ce filtre. Il joue les propriétés que les specs de navigateur
 * vérifient, mais au niveau de la politique et en une seconde par candidat, si bien
 * qu'on peut trier **quarante-trois finalistes** au lieu d'embarquer le premier et
 * de découvrir le reste à la suite e2e.
 *
 * ## Ce qu'il ne remplace pas
 *
 * La suite. Il porte deux propriétés sur trois écuries de synthèse ; elle en porte
 * cent sur un navigateur réel. Il sert à **choisir** un candidat qui a une chance de
 * passer, pas à déclarer qu'il passe.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EMBEDDED = join(ROOT, 'src/lib/dofus/breeding/champion.json');

/* --------------------------------------------------------------- le filtre -- */

/**
 * On fait tourner la **vraie spec**, et non une imitation.
 *
 * Première version : rejouer la propriété au niveau de la politique, en Node, une
 * seconde par candidat. Calibrée contre le navigateur, elle rendait **5 et 5** là
 * où l'écran rend 4 et 2 — elle aurait donc laissé passer exactement le champion
 * que `spend-fertility` recale. L'écart ne venait ni des prix ni de la capacité
 * mais des paramètres de recherche que la page compose elle-même.
 *
 * Reproduire fidèlement l'entrée de la politique est un travail sans fin, et une
 * imitation non fidèle est pire qu'aucun filtre : elle donne un feu vert. On paie
 * donc les vingt secondes de navigateur, et le verdict est celui de la suite parce
 * que c'est la suite.
 */
const runSpec = (spec) => {
  try {
    // `spec` vide : toute la suite, ce que `--full` demande.
    execFileSync('npx', ['playwright', 'test', ...(spec ? [spec] : []), '--reporter=line'], {
      cwd: ROOT,
      stdio: 'pipe',
      env: process.env,
    });
    return true;
  } catch {
    return false;
  }
};

const candidates = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (candidates.length === 0) {
  console.error('usage: node scripts/screen-champions.mjs <champion.json|finalists.json> ...');
  process.exit(1);
}

/** `finalists.json` porte un tableau ; un champion, un objet. */
const expand = (path) => {
  const parsed = JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
  if (!Array.isArray(parsed)) return [{ label: path, genome: parsed }];
  return parsed.map((genome, index) => ({ label: `${path}#${index + 1}`, genome }));
};

/**
 * Les specs qui jugent la **politique** et non l'écran.
 *
 * Celles-ci ont rougi le 21/08 en embarquant un champion entraîné quatre heures.
 * Les faire passer avant de choisir, c'est choisir un candidat qui a une chance,
 * au lieu de dépenser la manche puis de la jeter.
 */
const POLICY_SPECS = [
  // Thésaurisation : vingt fécondes, aucune excuse. C'est celle qui a recalé les
  // 43 finalistes du 21/08.
  'e2e/spend-fertility.spec.ts',
  // La liste qui repousse, sous les deux rapports de sexes.
  'e2e/mating-list-does-not-regrow.spec.ts',
  // Ce que la fournée range dans un enclos, et ce qu'elle en dit.
  'e2e/load-list.spec.ts',
  'e2e/pen-unloadable.spec.ts',
  'e2e/clone-then-mate.spec.ts',
];

/**
 * `--full` passe la **suite entière**, et c'est le seul verdict qui vaut avant
 * d'embarquer.
 *
 * Sans lui on ne joue que les specs sensibles à la politique : quatre minutes de
 * moins par candidat, assez pour trier quarante-trois finalistes, pas assez pour
 * conclure. Le 21/08 la suite a rougi sur quatre specs dont **trois** que le
 * filtre court n'aurait pas jouées.
 */
const full = process.argv.includes('--full');
const SPECS = full ? [''] : POLICY_SPECS;

const keep = existsSync(EMBEDDED) ? readFileSync(EMBEDDED, 'utf8') : null;
const rows = [];

try {
  for (const path of candidates) {
    for (const { label, genome } of expand(path)) {
      writeFileSync(EMBEDDED, JSON.stringify(genome));
      const passed = SPECS.every(runSpec);
      rows.push({ label, passed });
      console.log(`  ${passed ? 'passe ' : 'RECALÉ'}  ${label}`);
    }
  }
} finally {
  // L'artefact embarqué revient toujours : ce script trie, il n'installe pas.
  if (keep !== null) writeFileSync(EMBEDDED, keep);
}

const passing = rows.filter((row) => row.passed);
console.log(`\n  ${passing.length} sur ${rows.length} passent les gardes de politique.`);
if (passing.length === 0) {
  console.log('  Aucun candidat à embarquer : la manche entière échoue.');
} else {
  console.log('  Candidats à mesurer avec `replay`, puis à passer à la suite entière :');
  for (const row of passing.slice(0, 12)) console.log(`    ${row.label}`);
}
