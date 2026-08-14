/**
 * Ce que le champion embarqué propose sur une écurie d'éleveur.
 *
 * ```sh
 * node scripts/policy-report.mjs
 * ```
 *
 * ## Ce que les quatre gardes ne disent pas
 *
 * Elles prouvent que le portage rejoue le Rust — au bit près pour la recherche.
 * Elles ne disent rien de ce que le champion **fait**. Un artefact peut être
 * reproduit parfaitement et proposer une fournée inutile, et c'est arrivé : le
 * champion entraîné avant la correction du débordement de `cyclable_free` met
 * vingt montures en banque et n'en accouple aucune, sur une écurie où la valeur
 * myope en accouple trente-quatre.
 *
 * Aucune garde de parité ne pouvait le voir. Celle-ci le voit.
 *
 * ## Le témoin est la valeur myope
 *
 * Elle passe par exactement le même chemin — même recherche, même encodage, même
 * écurie, même graine — et ne sait rien faire d'autre que compter les kamas. Si
 * elle accouple et que le champion non, c'est une préférence apprise ; si aucune
 * des deux n'accouple, c'est le câblage ou l'écurie. Sans ce témoin, les deux
 * diagnostics se ressemblent.
 *
 * ## L'écurie est fixe, et représentative
 *
 * Pas un tirage : deux exécutions doivent se comparer. Du vrac de gen 1 comme
 * toute écurie en porte, quelques gen 2 suivies avec leurs stériles, deux gen 3
 * déjà fécondes. Les prix vont de 1 000 en gen 1 à 512 000 en gen 10, ce qui est
 * l'ordre de grandeur réel — un barème trop raide mettrait l'entrée de prix des
 * gen 10 à 30 au lieu de 1 et le réseau lirait un marché qu'il n'a jamais vu.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, compile, load } from './lib/tsc.mjs';

const out = compile(
  'policy',
  ['src/lib/dofus/breeding/policy.ts', 'src/lib/dofus/breeding/random.ts'],
  { json: true }
);

const { stablePlan, economyView } = await load(out, 'policy.js');
const { createSearcher, flatten, planUnit, myopic } = await load(out, 'search.js');
const { seededRandom } = await load(out, 'random.js');

const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const champion = read('src/lib/dofus/breeding/champion.json');
const trees = read('src/lib/dofus/breeding/trees.json');
const colors = trees.families.find((family) => family.id === 'muldo').colors;
const nameOf = Object.fromEntries(colors.map((color) => [color.id, color.name]));

/* ---------------------------------------------------------------- l'écurie */

const CAPACITY = 60;
const gen1 = colors.filter((color) => color.generation === 1);
const bulk = new Map(gen1.map((color) => [color.id, { males: 6, females: 6 }]));

const individuals = [];
const add = (color, sex, fertile, cycled, name) =>
  individuals.push({
    id: `i${individuals.length}`,
    colorId: color.id,
    name,
    sex,
    level: 100,
    fertile,
    cycled,
    parents: color.recipes[0] ?? null,
  });

const short = (color) => color.name.slice(0, 3).toUpperCase();
for (const color of colors.filter((c) => c.generation === 2).slice(0, 4)) {
  add(color, 'M', true, true, `G2 ${short(color)} M`);
  add(color, 'F', true, false, `G2 ${short(color)} F`);
  // Deux stériles de même rang : de quoi rendre un clonage possible.
  add(color, 'M', false, false, null);
  add(color, 'F', false, false, null);
}
for (const color of colors.filter((c) => c.generation === 3).slice(0, 2)) {
  add(color, 'M', true, true, `G3 ${short(color)} M`);
  add(color, 'F', true, true, `G3 ${short(color)} F`);
}

const stable = { bulk, individuals };
const price = (generation) => Math.round(1000 * 2 ** (generation - 1));
const market = {
  marketPrice: (colorId) => {
    const color = colors.find((entry) => entry.id === colorId);
    return color ? price(color.generation) : 0;
  },
  genetonValue: 549,
  amberPerGeneration: 20_000,
  optimakina: [0, 0, 5000, 8000, 10001, 13000, 15000, 22500, 35000, 78700, 149996],
};
const input = { stable, colors, market, capacity: CAPACITY, loadKamas: 150_000, kamas: 30_000_000 };

/* ----------------------------------------------------------------- le plan */

const started = Date.now();
const plan = stablePlan(input);
const elapsed = Date.now() - started;

if (!plan) {
  console.error('La politique ne répond pas : arité incompatible, ou écurie vide.');
  process.exit(1);
}

const nameOfMount = (id) => individuals.find((mount) => mount.id === id)?.name ?? 'Anonyme';
const listed = (ids) => (ids.length === 0 ? 'achat' : [...new Set(ids.map(nameOfMount))].join(', '));

console.log(
  `\nchampion : ${champion.features} entrées · ` +
    `${champion.validation_score ? `${(champion.validation_score / 1e6).toFixed(2)} M au départage` : 'sans score'}`
);
console.log(`écurie   : ${flatten(stable).length} montures · ${CAPACITY} places · calculé en ${elapsed} ms\n`);
console.log(`${plan.raw.crossings.length} accouplements · ${plan.places}/${plan.capacity} places\n`);

for (const line of plan.couples.slice(0, 10)) {
  console.log(
    `  ${String(line.count).padStart(2)} ×  ♂ ${nameOf[line.male.colorId]} [${listed(line.male.mountIds)}]` +
      `  +  ♀ ${nameOf[line.female.colorId]} [${listed(line.female.mountIds)}]` +
      `  → ${line.targetGeneration === null ? 'RECOPIE' : `gen ${line.targetGeneration}`}` +
      `${line.places === 0 ? '  (sans enclos)' : ''}`
  );
}
if (plan.couples.length > 10) console.log(`  … ${plan.couples.length - 10} lignes de plus`);

const join_ = (list) => (list.length > 0 ? list.join(' · ') : '—');
console.log(
  '\n  à féconder :',
  join_(plan.cycles.map((entry) => `${nameOf[entry.colorId]} ×${entry.mountIds.length}`))
);
console.log(
  '  à cloner   :',
  join_(plan.clonings.map((entry) => `gén ${entry.generation} : ${entry.mountIds.length / 2} paire(s)`))
);
console.log(
  '  à acheter  :',
  join_(plan.purchases.map((entry) => `${nameOf[entry.colorId]} ${entry.males}♂${entry.females}♀`))
);

/* -------------------------------------------------------------- le témoin */

const control = planUnit(
  createSearcher({ iterations: 600, sacrifices: false }),
  {
    mounts: flatten(stable),
    colors,
    generations: new Map(colors.map((color) => [color.id, color.generation])),
    economy: economyView(colors, market),
    strategy: { level: champion.strategies?.[0]?.level ?? 0, optimakinaFrom: 11 },
    kamas: 30_000_000,
    capacity: CAPACITY,
    loadKamas: 150_000,
  },
  seededRandom(1),
  myopic
);

console.log(
  `\ntémoin myope : ${control.crossings.length} accouplements · ` +
    `${control.cycles.length} fécondations · ${control.clonings.length} clonages · ` +
    `${control.purchases.length} achats`
);

// Un champion qui n'accouple pas là où la valeur myope accouple n'est pas
// forcément fautif — mais c'est une anomalie, et elle doit se dire. Sortie non
// nulle pour qu'une chaîne s'arrête plutôt que de publier un écran inutile.
if (plan.raw.crossings.length === 0 && control.crossings.length > 0) {
  console.error(
    `\nANOMALIE : le champion n'accouple pas là où la valeur myope accouple ` +
      `${control.crossings.length} fois. Le câblage est hors de cause — le témoin ` +
      `passe par le même chemin. C'est l'artefact qu'il faut regarder.`
  );
  process.exit(1);
}
const recopies = plan.couples
  .filter((line) => line.targetGeneration === null)
  .reduce((sum, line) => sum + line.count, 0);
console.log(
  `\nsur ${plan.raw.crossings.length} accouplements, ${recopies} ne montent d'aucun rang ` +
    `(${Math.round((recopies / Math.max(plan.raw.crossings.length, 1)) * 100)} %)`
);
console.log('\nla politique accouple — cet artefact est utilisable dans l’écran');
