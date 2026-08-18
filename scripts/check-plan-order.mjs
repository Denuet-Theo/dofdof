/**
 * Le plan est une fonction du **contenu** de l'écurie, pas de l'ordre de ses lignes.
 *
 *   node scripts/check-plan-order.mjs
 *
 * ## Le défaut que cette garde ferme
 *
 * `flatten` parcourt `stable.individuals` dans l'ordre du tableau, et la recherche
 * départage à valeur strictement égale dans l'ordre où elle rencontre les
 * montures. Deux écuries de contenu identique rangées différemment ne rendaient
 * donc pas le même plan. Mesuré sur l'écurie du 15/08 : **18** accouplements
 * proposés dans l'ordre de la fixture, **19** dans l'ordre des identifiants.
 *
 * Ce n'est pas une curiosité théorique, c'est visible par l'éleveur. La lecture de
 * l'écurie trie (`.order('id')`), alors que les écritures locales ajoutent en
 * **fin** de tableau : un poulain saisi vit en queue jusqu'au rafraîchissement, où
 * il reprend sa place d'uuid. Même écurie, deux ordres, deux plans — donc une liste
 * d'accouplements qui bouge sans qu'il se soit rien passé.
 *
 * ## Pourquoi une garde et pas un test de bout en bout
 *
 * Parce que la propriété porte sur `stablePlan` et non sur l'écran. Un test de
 * navigateur ne peut pas servir la même écurie dans deux ordres : le vrai serveur
 * trie, et le faux le trie aussi depuis qu'il honore `order`. La sensibilité ne
 * s'observe donc qu'en appelant la fonction deux fois, ce qui est exactement ce que
 * font les autres `check:*`.
 *
 * ## L'écurie est celle de `check-success.mjs`
 *
 * La même, pour la même raison : deux exécutions doivent se comparer. Et elle est
 * assez fournie pour que des égalités de valeur s'y produisent — c'est là que
 * l'ordre décidait.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, compile, load } from './lib/tsc.mjs';

const out = compile(
  'plan-order',
  ['src/lib/dofus/breeding/policy.ts', 'src/lib/dofus/breeding/random.ts'],
  { json: true }
);

const { stablePlan } = await load(out, 'policy.js');

const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const trees = read('src/lib/dofus/breeding/trees.json');
const colors = trees.families.find((family) => family.id === 'muldo').colors;

const CAPACITY = 60;
const gen1 = colors.filter((color) => color.generation === 1);

const buildStable = () => {
  const bulk = new Map(gen1.map((color) => [color.id, { males: 6, females: 6 }]));
  const individuals = [];
  const add = (color, sex, fertile, cycled, name) =>
    individuals.push({
      id: `i${String(individuals.length).padStart(3, '0')}`,
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
    add(color, 'M', false, false, null);
    add(color, 'F', false, false, null);
  }
  for (const color of colors.filter((c) => c.generation === 3).slice(0, 2)) {
    add(color, 'M', true, true, `G3 ${short(color)} M`);
    add(color, 'F', true, true, `G3 ${short(color)} F`);
  }
  return { bulk, individuals };
};

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

const planFor = (individuals) =>
  stablePlan({
    stable: { bulk: buildStable().bulk, individuals },
    colors,
    market,
    capacity: CAPACITY,
    loadKamas: 150_000,
    kamas: 30_000_000,
  });

/** Une permutation déterministe : pas de `Math.random`, la garde doit se rejouer. */
const shuffled = (items, step) => {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const target = (index * step + 7) % (index + 1);
    [out[index], out[target]] = [out[target], out[index]];
  }
  return out;
};

const signature = (plan) =>
  JSON.stringify(plan, (_key, value) =>
    value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value] : value
  );

const base = buildStable().individuals;
const reference = signature(planFor(base));

const orders = [
  ['inversé', [...base].reverse()],
  ['permuté (3)', shuffled(base, 3)],
  ['permuté (11)', shuffled(base, 11)],
  ['trié par nom', [...base].sort((a, b) => String(a.name).localeCompare(String(b.name)))],
];

let broken = 0;
for (const [label, individuals] of orders) {
  const same = signature(planFor(individuals)) === reference;
  console.log(`${same ? '  ok  ' : ' ÉCART'}  ${label}`);
  if (!same) broken += 1;
}

if (broken > 0) {
  console.error(
    `\n${broken} ordre(s) sur ${orders.length} rendent un autre plan sur la même écurie.\n` +
      "Le plan doit dépendre du contenu, pas de l'ordre des lignes — voir `canonicalStable`."
  );
  process.exit(1);
}

console.log(`\nle plan ne dépend pas de l'ordre des lignes (${orders.length} ordres comparés)`);
