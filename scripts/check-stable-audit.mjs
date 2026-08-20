/**
 * Ce que le relevé d'écurie trouve sur une écurie réelle.
 *
 *   node scripts/check-stable-audit.mjs
 *
 * ## Pourquoi une garde, et pas seulement un spec
 *
 * `auditStable` compte des défauts. Un compteur de défauts a un mode de panne
 * qui lui est propre et que ni `tsc` ni un test d'écran ne voient : **compter
 * trop**. Une règle trop large rend deux cents lignes, l'éleveur les ignore en
 * bloc, et l'outil devient un bruit qu'on replie — c'est le sort qu'ont connu
 * tous les avertissements retirés de l'écran d'élevage.
 *
 * La garde tourne donc sur l'écurie du 15/08, celle des specs, et affirme deux
 * choses : que chaque règle trouve **quelque chose** (sinon elle est morte), et
 * qu'aucune ne déborde sur une part déraisonnable de l'écurie.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, compile, load } from './lib/tsc.mjs';

const out = compile('stable-audit', ['src/lib/dofus/breeding/stable-audit.ts'], { json: true });
const { auditStable } = await load(out, 'stable-audit.js');

const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const trees = read('src/lib/dofus/breeding/trees.json');
const colors = trees.families.find((family) => family.id === 'muldo').colors;
const tables = read('e2e/fixtures/muldo-stable.json');

const individuals = tables['user_breeding_individuals'].map((row) => ({
  id: row.id,
  colorId: row.color_id,
  name: row.name ?? null,
  sex: row.sex,
  level: row.level,
  fertile: row.fertile,
  cycled: row.cycled ?? false,
  parents:
    row.parent_a_color && row.parent_b_color
      ? [row.parent_a_color, row.parent_b_color]
      : null,
  createdAt: row.created_at ?? null,
}));
const bulk = new Map(
  (tables['user_breeding_mounts'] ?? []).map((row) => [
    row.color_id,
    {
      males: row.males,
      females: row.females,
      cycledMales: row.cycled_males ?? 0,
      cycledFemales: row.cycled_females ?? 0,
    },
  ])
);

const audit = auditStable({ bulk, individuals }, colors);

const countBy = (findings) => {
  const by = new Map();
  for (const finding of findings) by.set(finding.kind, (by.get(finding.kind) ?? 0) + 1);
  return by;
};

const defects = countBy(audit.defects);
const claims = countBy(audit.claims);

console.log(`écurie du 15/08 · ${individuals.length} montures suivies\n`);
console.log('défauts — faux quoi que dise la partie');
for (const [kind, count] of defects) console.log(`  ${kind.padEnd(20)} ${count}`);
if (defects.size === 0) console.log('  (aucun)');
console.log('\nà confronter au jeu');
for (const [kind, count] of claims) console.log(`  ${kind.padEnd(20)} ${count}`);
if (claims.size === 0) console.log('  (aucun)');

const problems = [];

/*
 * Chaque règle doit **attraper ce qu'elle vise**, et une écurie saine ne le
 * prouve pas.
 *
 * Mesuré, et c'est la raison d'être de ce bloc : sur l'écurie du 15/08,
 * `stale-name` et `double-counted` ne rendent rien du tout. Ce n'est pas un
 * défaut de la fixture — elle est cohérente, tant mieux — mais ça veut dire que
 * les faire tourner dessus ne distingue pas une règle juste d'une règle **morte**.
 * Une condition inversée par mégarde passerait la garde en silence.
 *
 * On abîme donc une copie, une classe à la fois, et on vérifie que la ligne
 * abîmée ressort — et elle seule, ce qui attrape du même coup la règle trop
 * large.
 */
const damaged = (change) => {
  const copy = individuals.map((mount) => ({ ...mount }));
  // Le vrac est copié aussi : le compteur de la fixture est à zéro partout, donc
  // la règle du double compte ne peut pas s'éprouver sans en poser un.
  const counters = new Map([...bulk].map(([id, counts]) => [id, { ...counts }]));
  const target = change(copy, counters);
  const result = auditStable({ bulk: counters, individuals: copy }, colors);
  return { target, findings: [...result.defects, ...result.claims] };
};

const catches = (label, kind, change, baseline) => {
  const { target, findings } = damaged(change);
  const hits = findings.filter((finding) => finding.kind === kind);
  if (!hits.some((finding) => finding.mount.id === target.id)) {
    problems.push(`« ${kind} » n'attrape pas ${label} — règle morte ou condition inversée`);
    return;
  }
  if (hits.length !== baseline + 1) {
    problems.push(`« ${kind} » rend ${hits.length} lignes pour un seul dégât (${baseline} avant)`);
  }
};

// Un sexe corrigé dans « Mes stocks » sans renommer en jeu : le nom encode le
// sexe, donc il ment dès la seconde qui suit.
catches(
  'un sexe changé sans renommage',
  'stale-name',
  (copy) => {
    const mount = copy.find((candidate) => candidate.name !== null && candidate.parents);
    mount.sex = mount.sex === 'M' ? 'F' : 'M';
    return mount;
  },
  defects.get('stale-name') ?? 0
);

// La même monture des deux côtés : une fertile sans ascendance suivie
// individuellement, alors que le compteur de vrac tient déjà sa couleur.
catches(
  'une fertile sans ascendance doublée par le vrac',
  'double-counted',
  (copy, counters) => {
    const colorId = colors.find((color) => color.generation === 1).id;
    counters.set(colorId, { males: 4, females: 0, cycledMales: 0, cycledFemales: 0 });
    const mount = {
      ...copy[0],
      id: 'sonde-double',
      colorId,
      sex: 'M',
      name: null,
      parents: null,
      fertile: true,
      cycled: false,
      level: 1,
    };
    copy.push(mount);
    return mount;
  },
  claims.get('double-counted') ?? 0
);

// Une stérile qu'on dénomme : elle devient le reste que le jeu ne rend pas.
catches(
  'une stérile privée de son nom',
  'anonymous-sterile',
  (copy) => {
    const mount = copy.find((candidate) => candidate.name !== null && !candidate.fertile);
    mount.name = null;
    return mount;
  },
  defects.get('anonymous-sterile') ?? 0
);

// La fertile au-dessus du niveau 1, que l'écurie du 15/08 porte déjà pour de
// bon : trois lignes, écrites par `recordClonings` quand il recopiait le niveau
// de la stérile consommée. C'est la règle qui trouve les dégâts de ce défaut.
if (!defects.has('impossible-level')) {
  problems.push('la règle « impossible-level » ne trouve rien — morte ?');
}

// Et aucune ne doit déborder. Le seuil est grossier exprès : il ne défend pas un
// chiffre, il attrape une règle qui vient de s'élargir d'un ordre de grandeur.
const CEILING = Math.round(individuals.length * 0.4);
for (const [kind, count] of [...defects, ...claims]) {
  if (count > CEILING) {
    problems.push(`« ${kind} » rend ${count} lignes sur ${individuals.length} — au-delà de ${CEILING}`);
  }
}

// Une monture ne peut pas être à la fois un défaut et une affirmation : on ne
// vérifie pas dans le jeu, par son nom, une monture dont le nom est justement
// ce qu'on dit faux.
const flawed = new Set(audit.defects.map((finding) => finding.mount.id));
const both = audit.claims.filter((finding) => flawed.has(finding.mount.id));
if (both.length > 0) problems.push(`${both.length} monture(s) à la fois en défaut et à vérifier`);

if (problems.length > 0) {
  console.error('\n' + problems.map((line) => `  ✗ ${line}`).join('\n'));
  process.exit(1);
}

console.log('\nchaque règle trouve, aucune ne déborde, les deux tas sont disjoints');
