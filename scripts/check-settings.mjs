/**
 * Tout réglage lu par l'écran est-il écrit par l'écran ?
 *
 * ```sh
 * node scripts/check-settings.mjs
 * ```
 *
 * ## La panne que cette garde attrape
 *
 * Elle s'est produite **deux fois**, à onze jours d'écart, et les deux fois elle
 * n'a pas ressemblé à une panne.
 *
 * #81 avait retiré trois réglages de l'écran d'élevage en annonçant ce qui
 * s'appliquerait à la place. Le hook en lisait toujours deux. Une ligne
 * enregistrée avant figeait donc le comportement à ce qu'elle portait — sans
 * case pour en changer, et sans rien à l'écran qui le dise. Mesuré sur l'écurie
 * du 14/08 : une gen 10 à **5 073 068** kamas au lieu de 702 266, les parents
 * poussés au niveau **200**, et **zéro** couleur à marge positive sur 120. Ça se
 * lit comme un marché difficile, pas comme un réglage bloqué. C'est #179.
 *
 * #94 avait fait la même chose avec six réglages de plus, avec le même
 * raisonnement — « the model now gives the answer on its own » — et le même
 * oubli. C'est #181.
 *
 * ## Pourquoi une garde et pas de la vigilance
 *
 * Les deux fois, le code était correct partout où on l'a relu : le calcul lisait
 * bien la colonne, la colonne existait bien, la valeur était bien celle de la
 * base. Rien à trouver dans un fichier. Ce qui manquait était une **absence** —
 * aucun composant n'écrivait plus ce champ — et une absence ne se voit pas dans
 * un diff.
 *
 * D'où la règle, qui est celle qu'`AGENTS.md` appelle rendre la classe
 * inreprésentable :
 *
 * > Tout champ de `BreedingSettings` doit être **explicitement écrit** par au
 * > moins un appel `onSaveSettings({…})` d'un composant. Sinon, il quitte le type
 * > et devient une réponse figée — voir `FROZEN_ANSWERS`.
 *
 * Un `...settings` ne compte pas : il recopie la valeur chargée sans rien
 * permettre d'en changer, et c'est **exactement** par lui que les huit colonnes
 * ont survécu à chaque enregistrement. Seule une affectation nommée compte.
 *
 * ## Ce qu'elle ne prouve pas
 *
 * Qu'un champ écrit soit *réglable* : un composant pourrait écrire une constante.
 * Le test de bout en bout `settings-controls.spec.ts` couvre l'autre moitié — il
 * clique sur les contrôles et regarde ce qui part en base.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOOK = join(ROOT, 'src/lib/hooks/useBreeding.ts');

let failures = 0;
const fail = (message) => {
  console.error(`  ✗ ${message}`);
  failures += 1;
};

/** Les fichiers d'un arbre, extensions filtrées. */
const walk = (directory, extensions) => {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(path, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }
  return found;
};

/**
 * Le littéral objet qui suit `after`, accolades équilibrées.
 *
 * Une expression régulière ne suffit pas : ces littéraux portent des objets
 * imbriqués et des accolades dans les chaînes de gabarit, et un `[\s\S]*?\}`
 * s'arrêterait à la première accolade fermante venue.
 */
const literalAfter = (source, from) => {
  const start = source.indexOf('{', from);
  if (start === -1) return null;

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  return null;
};

/** Les clés affectées au premier niveau d'un littéral. */
const keysOf = (literal) => {
  const keys = new Set();
  let depth = 0;
  for (const line of literal.split('\n')) {
    const trimmed = line.trim();
    // Une clé de premier niveau seulement : à l'intérieur d'un objet imbriqué,
    // `stock: { … }` porte des clés qui ne sont pas des réglages.
    if (depth === 0) {
      const match = trimmed.match(/^([a-z_][a-z0-9_]*)\s*:/i);
      if (match) keys.add(match[1]);
    }
    for (const character of line) {
      if (character === '{' || character === '[' || character === '(') depth += 1;
      if (character === '}' || character === ']' || character === ')') depth -= 1;
    }
  }
  return keys;
};

// ---------------------------------------------------------------- ce qui est lu
const hook = readFileSync(HOOK, 'utf8');
const defaults = literalAfter(hook, hook.indexOf('export const DEFAULT_SETTINGS'));
if (!defaults) {
  console.error('DEFAULT_SETTINGS introuvable dans useBreeding.ts');
  process.exit(1);
}
const read = keysOf(defaults);

// ------------------------------------------------------------- ce qui est écrit
const written = new Map();
for (const path of walk(join(ROOT, 'src'), ['.tsx'])) {
  const source = readFileSync(path, 'utf8');
  let from = source.indexOf('onSaveSettings(');
  while (from !== -1) {
    const literal = literalAfter(source, from);
    if (literal) {
      for (const key of keysOf(literal)) {
        if (!written.has(key)) written.set(key, relative(ROOT, path));
      }
    }
    from = source.indexOf('onSaveSettings(', from + 1);
  }
}

console.log(`${read.size} réglage${read.size > 1 ? 's' : ''} dans BreedingSettings :\n`);
for (const key of [...read].sort()) {
  const where = written.get(key);
  console.log(`  ${where ? '✓' : '✗'} ${key.padEnd(18)} ${where ?? 'écrit par personne'}`);
}

for (const key of [...read].sort()) {
  if (written.has(key)) continue;
  fail(
    `\`${key}\` est lu par le calcul et aucun composant ne l'écrit : ` +
      `une ligne enregistrée avant garde sa valeur à vie, sans contrôle pour en ` +
      `changer. Rends-lui un contrôle, ou sors-le du type et fige-le dans ` +
      `FROZEN_ANSWERS.`
  );
}

/**
 * Et la réciproque : un champ écrit mais absent du type est une écriture qui ne
 * se relit pas. Moins grave, mais c'est la même famille — les deux moitiés
 * doivent se répondre.
 */
for (const [key, where] of [...written].sort()) {
  if (read.has(key) || key === 'updated_at') continue;
  fail(`\`${key}\` est écrit par ${where} sans être dans BreedingSettings : personne ne le relit.`);
}

if (failures > 0) {
  console.error(
    `\n${failures} réglage${failures > 1 ? 's' : ''} sans les deux moitiés.`
  );
  process.exit(1);
}
console.log('\ntout réglage lu est écrit, et tout réglage écrit est lu');
