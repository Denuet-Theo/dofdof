// Vérifie un export téléchargé avant de se fier à lui.
//
//   node scripts/check-export.mjs dofdof-export.ndjson
//
// Un export de sauvetage se lit une fois : après la fermeture de la base, il n'y a
// plus de quoi le refaire. Un fichier tronqué en plein milieu reste du JSON
// parfaitement valide ligne à ligne, et une reprise qui démarre dessus ne se
// découvre incomplète que bien plus tard. D'où trois contrôles que l'œil ne fait
// pas :
//
//   1. La ligne finale `{"kind":"end"}` est présente. Le flux part avec un code
//      HTTP 200 avant que la première table ne soit lue, donc une coupure en cours
//      de route laisse un fichier d'apparence saine. Son absence est le seul signe.
//   2. Chaque borne `table_end` concorde avec le nombre de lignes reçues.
//   3. Les `bigint` et `numeric` sont bien des chaînes. Un prix en kamas dépasse
//      Number.MAX_SAFE_INTEGER : relu en flottant il revient faux, silencieusement.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

const file = process.argv[2];

if (!file) {
  console.error('Usage: node scripts/check-export.mjs <fichier.ndjson>');
  process.exit(2);
}

const problems = [];
const counts = new Map();
const bounds = new Map();
let manifest = null;
let ended = false;
let streamError = null;
let lineNumber = 0;

const rl = createInterface({
  input: createReadStream(path.resolve(file), { encoding: 'utf8' }),
  crlfDelay: Infinity,
});

for await (const raw of rl) {
  lineNumber += 1;
  if (!raw.trim()) continue;

  let line;
  try {
    line = JSON.parse(raw);
  } catch {
    problems.push(`ligne ${lineNumber} : JSON illisible — fichier probablement tronqué ici`);
    continue;
  }

  if (lineNumber === 1) {
    if (line.kind !== 'manifest') problems.push('la première ligne n’est pas le manifeste');
    else manifest = line;
    continue;
  }

  // La route émet cette ligne quand elle échoue après avoir déjà envoyé le
  // statut 200 : c'est le seul endroit où l'erreur peut encore apparaître.
  if (line.kind === 'error') streamError = line.error;
  else if (line.kind === 'end') ended = true;
  else if (line.kind === 'table_end') bounds.set(line.table, line.rows);
  else if (line.t) counts.set(line.t, (counts.get(line.t) ?? 0) + 1);
}

if (streamError) problems.push(`l’export a échoué en cours de flux : ${streamError}`);
if (!ended) {
  problems.push(
    'ligne finale {"kind":"end"} absente : export incomplet. Le transfert a été ' +
      'interrompu — recommencez, ne construisez rien sur ce fichier.'
  );
}

for (const [table, expected] of bounds) {
  const got = counts.get(table) ?? 0;
  if (got !== expected) {
    problems.push(
      `${table} : ${expected} ligne${expected === 1 ? '' : 's'} annoncée${expected === 1 ? '' : 's'}, ` +
        `${got} présente${got === 1 ? '' : 's'}`
    );
  }
}

// Les tables annoncées à l'import mais dont aucune borne n'est arrivée : leur dump
// n'a pas commencé, ou s'est arrêté avant la fin.
for (const table of manifest?.import_order ?? []) {
  if (!bounds.has(table)) problems.push(`${table} : annoncée au manifeste, absente du flux`);
}

// Fidélité des types, sur les colonnes que le manifeste déclare en bigint/numeric.
// C'est la vérification qui ne se rattrape pas : une valeur relue en flottant est
// déjà fausse dans le fichier.
const numericLike = new Set(['bigint', 'numeric', 'double precision', 'real']);
for (const [table, columns] of Object.entries(manifest?.columns ?? {})) {
  for (const column of columns) {
    if (!numericLike.has(column.type)) continue;
    if (column.type === 'double precision' || column.type === 'real') {
      problems.push(
        `${table}.${column.name} est un ${column.type} : un flottant ne se relit pas à l’identique`
      );
    }
  }
}

const sampled = new Map();
{
  // Deuxième passe, uniquement sur les colonnes sensibles : on vérifie que les
  // valeurs sont sérialisées en chaînes et non en nombres JSON.
  const sensitive = new Map();
  for (const [table, columns] of Object.entries(manifest?.columns ?? {})) {
    const names = columns.filter((c) => numericLike.has(c.type)).map((c) => c.name);
    if (names.length > 0) sensitive.set(table, names);
  }

  const rl2 = createInterface({
    input: createReadStream(path.resolve(file), { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const raw of rl2) {
    if (!raw.trim()) continue;
    let line;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    const names = line.t ? sensitive.get(line.t) : null;
    if (!names) continue;
    for (const name of names) {
      const value = line.r?.[name];
      if (value === null || value === undefined) continue;
      if (typeof value === 'number') {
        const key = `${line.t}.${name}`;
        if (!sampled.has(key)) {
          sampled.set(key, value);
          problems.push(
            `${key} est un nombre JSON (${value}) et non une chaîne : précision perdue`
          );
        }
      }
    }
  }
}

const totalRows = [...counts.values()].reduce((sum, n) => sum + n, 0);

console.log(`Fichier   ${file}`);
if (manifest) {
  console.log(`Exporté   ${manifest.exported_at}`);
  console.log(`Tables    ${bounds.size} sur ${manifest.import_order?.length ?? '?'} annoncées`);
  console.log(`Lignes    ${totalRows}`);
  console.log(`Catalogue ${manifest.catalog_included ? 'inclus' : 'exclu (régénérable)'}`);
  console.log(
    `Mots de passe ${manifest.passwords_included ? 'inclus (hachages bcrypt)' : 'exclus'}`
  );
  if (manifest.defer_foreign_keys?.length) {
    console.log(`À l’import, différer les clés étrangères : ${manifest.defer_foreign_keys.join(', ')}`);
  }
}

if (problems.length === 0) {
  console.log('\n✓ Export complet et fidèle. Rien à signaler.');
  process.exit(0);
}

console.error(`\n✗ ${problems.length} problème${problems.length > 1 ? 's' : ''} :`);
for (const problem of problems) console.error(`  - ${problem}`);
process.exit(1);
