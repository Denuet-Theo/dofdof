/**
 * L'échelle portée joue-t-elle la **même fournée** que le Rust ?
 *
 * ```sh
 * node scripts/check-ladder-policy.mjs
 * ```
 *
 * `check-ladder-parity.mjs` verrouille déjà le **plan** — quelles couleurs,
 * quelles recettes, quels blocs. Il ne dit rien de ce que l'échelle en fait
 * quand on lui pose une écurie et vingt places devant, et c'est cette moitié-là
 * qui décide de ce que l'éleveur voit.
 *
 * ## Pourquoi la comparaison est exacte, et non à une tolérance près
 *
 * `LadderPolicy::plan` ne tire rien du générateur : la fournée est une fonction
 * de l'écurie et des prix. Les deux côtés doivent donc rendre les **mêmes
 * entiers**. Ce qui pourrait diverger n'est pas l'arithmétique mais des ordres —
 * l'ordre des groupes, celui des couples dans `by_target`, celui des couleurs
 * dans un étage — et aucun écran ne montre jamais ça. Une divergence d'ordre
 * change la fournée sans changer un seul chiffre affiché.
 *
 * Le piège concret, rencontré en portant : côté Rust une couleur est un
 * **indice** de catalogue et c'est lui qui départage les égalités ; côté
 * TypeScript c'est une chaîne, et trier par ordre alphabétique donne un autre
 * plan sur les mêmes données. Rien d'autre que cette garde ne l'aurait dit.
 *
 * ## Ce qui n'est pas comparé, et pourquoi
 *
 * Les **clonages** et les **sacrifices** : ils viennent de
 * `clone_by_generation`, qui n'est pas dans ce portage-ci. La référence les
 * porte pour mémoire, ce script les ignore. La **moisson**, elle, est allumée
 * des deux côtés et donc comparée.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, compile, load } from './lib/tsc.mjs';

const out = compile(
  'ladder-policy',
  ['src/lib/dofus/breeding/ladder-policy.ts', 'src/lib/dofus/breeding/ladder.ts'],
  { json: true }
);

const { ladderPlan } = await load(out, 'ladder-policy.js');
const { crownedLadderOf } = await load(out, 'ladder.js');

const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const trees = read('src/lib/dofus/breeding/trees.json');
const colors = trees.families.find((family) => family.id === 'muldo').colors;
const generations = new Map(colors.map((color) => [color.id, color.generation]));

const reference = read('scripts/fixtures/ladder-policy-parity.json');

let failures = 0;
const fail = (message) => {
  console.error(`ÉCHEC — ${message}`);
  failures += 1;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let crossings = 0;
let purchases = 0;

for (const [index, entry] of reference.cases.entries()) {
  const values = new Map(entry.economy.values);
  const economy = {
    starterPrice: entry.economy.starterPrice,
    genetonValue: entry.economy.genetonValue,
    optimakinaBonus: entry.economy.optimakinaBonus,
    valueOf: (colorId) => values.get(colorId) ?? 0,
  };

  // La couronne se pose comme côté Rust : au prix, le partenaire d'abord — le
  // défaut des deux côtés. On vérifie qu'elle tombe sur la même avant de
  // comparer quoi que ce soit, sans quoi les deux politiques ne viseraient même
  // pas la même chose et la fournée différerait pour une raison sans intérêt.
  const ladder = crownedLadderOf(colors, economy.valueOf);
  if (!ladder.summit.includes(entry.crown)) {
    fail(`cas ${index} : couronne ${ladder.summit.join('+')} ici, ${entry.crown} côté Rust.`);
    continue;
  }

  const mounts = entry.mounts.map((mount, at) => ({
    id: `m${at}`,
    colorId: mount.color,
    name: null,
    sex: mount.sex,
    level: mount.level,
    fertile: mount.fertile,
    cycled: mount.cycled,
    parents: mount.parents ?? null,
  }));

  const plan = ladderPlan(
    {
      mounts,
      colors,
      generations,
      economy,
      capacity: entry.capacity,
      kamas: entry.kamas,
      loadKamas: entry.loadKamas,
      mountLevel: entry.mountLevel,
    },
    ladder,
    // La référence porte les deux configurations, une paire de cas par écurie :
    // l'app joue la moisson stockée allumée, donc la garde doit couvrir ce
    // chemin-là et pas seulement le défaut. Voir `harvestStocked`.
    { harvestStocked: entry.harvestStocked === true }
  );

  if (!same(plan.crossings, entry.plan.crossings)) {
    fail(
      `cas ${index} : ${plan.crossings.length} croisements ici, ${entry.plan.crossings.length} côté Rust.\n` +
        `  ici  : ${JSON.stringify(plan.crossings.slice(0, 8))}\n` +
        `  Rust : ${JSON.stringify(entry.plan.crossings.slice(0, 8))}`
    );
  }
  if (!same(plan.purchases, entry.plan.purchases)) {
    fail(
      `cas ${index} : achats différents.\n` +
        `  ici  : ${JSON.stringify(plan.purchases.slice(0, 8))}\n` +
        `  Rust : ${JSON.stringify(entry.plan.purchases.slice(0, 8))}`
    );
  }

  crossings += entry.plan.crossings.length;
  purchases += entry.plan.purchases.length;
}

console.log(
  `${reference.cases.length} fournées comparées · ${crossings} croisements · ${purchases} achats`
);

if (failures > 0) {
  console.error(`\n${failures} cas divergent.`);
  process.exit(1);
}
console.log("l'échelle portée joue la fournée du Rust, coup pour coup");
