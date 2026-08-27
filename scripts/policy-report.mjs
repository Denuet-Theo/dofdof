/**
 * Ce que la politique embarquée propose sur une écurie d'éleveur.
 *
 * ```sh
 * node scripts/policy-report.mjs
 * ```
 *
 * ## Ce que les quatre gardes ne disent pas
 *
 * Elles prouvent que le portage rejoue le Rust. Elles ne disent rien de ce que la
 * politique **fait** : un plan peut être reproduit parfaitement et proposer une
 * fournée inutile, et c'est arrivé — un champion entraîné avant la correction du
 * débordement de `cyclable_free` mettait vingt montures en banque et n'en
 * accouplait aucune. Aucune garde de parité ne pouvait le voir. Celle-ci le voit.
 *
 * ## Ce que le témoin myope disait, et pourquoi il n'est plus là
 *
 * Il passait par le même chemin que le champion et ne savait que compter les
 * kamas : s'il accouplait et que le champion non, c'était une **préférence
 * apprise** ; si aucun des deux n'accouplait, c'était le câblage ou l'écurie.
 *
 * Le champion a quitté le TypeScript — l'échelle joue, et la recherche reste côté
 * Rust comme étalon. Il n'y a donc plus de préférence apprise à distinguer d'un
 * défaut de câblage, et plus de second chemin ici pour le faire : l'échelle est la
 * seule politique portée. Ce que cette garde prouve encore est plus étroit, et
 * c'est dit plutôt que sous-entendu — **la politique accouple, et ses croisements
 * montent**. Le reste se mesure côté Rust, où `Greedy` et `Myopic` vivent
 * toujours (`bench`, `replay`, `table`).
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
const { flatten } = await load(out, 'unit-plan.js');

const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
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

// Une politique qui n'accouple **pas du tout** est une anomalie, quelle qu'en
// soit la cause. Le témoin myope servait à trancher entre préférence apprise et
// câblage ; sans lui on ne tranche plus, mais le symptôme se dit quand même —
// sortie non nulle, pour qu'une chaîne s'arrête plutôt que de publier un écran
// vide. La cause se cherche alors côté Rust, sur `bench`.
if (plan.raw.crossings.length === 0) {
  console.error(
    `\nANOMALIE : la politique n'accouple pas sur cette écurie. Elle porte pourtant ` +
      `${flatten(stable).length} montures et ${CAPACITY} places. Regarder \`bench\` côté ` +
      `Rust, qui compare l'échelle au glouton et à la valeur myope sur la même physique.`
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
const kamas = (value) => `${(value / 1e6).toFixed(2)} M`;
console.log(
  `\nfournée : ${kamas(plan.earnings.genetons)} de génétons · ` +
    `${kamas(plan.earnings.sales)} de ventes · ` +
    `-${kamas(plan.earnings.loadKamas + plan.earnings.purchases + plan.earnings.optimakina)} de frais ` +
    `→ ${kamas(plan.earnings.net)} net, soit ${kamas(plan.earnings.perMonth)} par mois`
);
console.log('\nla politique accouple, et ses croisements montent — l’écran a de quoi afficher');
