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
 * ## Ce qui est comparé
 *
 * Les croisements, les achats, **les clonages et les sacrifices**. Ces deux
 * derniers étaient ignorés — `clone_by_generation` n'était pas porté, la
 * référence les portait « pour mémoire » — et cette exemption a coûté cher :
 * l'échelle TypeScript n'extrayait **rien du tout**, jamais, y compris la règle
 * du hors-plan que le Rust applique depuis toujours. Un port entier manquait et
 * la garde était écrite pour ne pas le voir.
 *
 * La leçon est sur la forme de l'exemption, pas sur celle-là en particulier :
 * une garde qui documente ce qu'elle ne regarde pas finit par documenter le
 * trou dans lequel un bug s'installe. Ce qui n'est pas comparé doit être
 * **vide des deux côtés**, ou comparé.
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

/**
 * L'arbre de la famille du cas, et ses générations.
 *
 * La référence était **muldo seul**, alors que le plan se comparait déjà sur les
 * trois familles (`check-ladder-parity.mjs`). C'était la moitié qui décide qui
 * manquait : la forme de l'arbre change la fournée — la gen 9 du volkorne se
 * compose d'une gen 6 et d'une gen 8, pas de deux gen 8 — et rien ne comparait
 * ce que les deux ports en faisaient.
 */
const catalogues = new Map();
const catalogueOf = (id) => {
  const held = catalogues.get(id);
  if (held) return held;
  const found = trees.families.find((family) => family.id === id);
  if (!found) throw new Error(`famille inconnue dans la référence : ${id}`);
  const built = {
    colors: found.colors,
    generations: new Map(found.colors.map((color) => [color.id, color.generation])),
  };
  catalogues.set(id, built);
  return built;
};

const reference = read('scripts/fixtures/ladder-policy-parity.json');

let failures = 0;
const fail = (message) => {
  console.error(`ÉCHEC — ${message}`);
  failures += 1;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let crossings = 0;
let purchases = 0;
let clonings = 0;
let sacrifices = 0;

for (const [index, entry] of reference.cases.entries()) {
  const { colors, generations } = catalogueOf(entry.family ?? 'muldo');
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
    {
      harvestStocked: entry.harvestStocked === true,
      // `cloneTop` éteint sur quelques cas : c'est le seul moyen que `clonable`
      // soit évalué au lieu d'être court-circuité par son `||`.
      cloneTop: entry.cloneTop !== false,
    }
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
  if (!same(plan.clonings, entry.plan.clonings)) {
    fail(
      `cas ${index} : ${plan.clonings.length} clonages ici, ${entry.plan.clonings.length} côté Rust.\n` +
        `  ici  : ${JSON.stringify(plan.clonings.slice(0, 8))}\n` +
        `  Rust : ${JSON.stringify(entry.plan.clonings.slice(0, 8))}`
    );
  }
  if (!same(plan.sacrifices, entry.plan.sacrifices)) {
    fail(
      `cas ${index} : ${plan.sacrifices.length} extractions ici, ${entry.plan.sacrifices.length} côté Rust.\n` +
        `  ici  : ${JSON.stringify(plan.sacrifices.slice(0, 12))}\n` +
        `  Rust : ${JSON.stringify(entry.plan.sacrifices.slice(0, 12))}`
    );
  }

  crossings += entry.plan.crossings.length;
  purchases += entry.plan.purchases.length;
  clonings += entry.plan.clonings.length;
  sacrifices += entry.plan.sacrifices.length;
}

console.log(
  `${[...new Set(reference.cases.map((c) => c.family))].length} familles · ` +
    `${reference.cases.length} fournées comparées · ${crossings} croisements · ${purchases} achats` +
    ` · ${clonings} clonages · ${sacrifices} extractions`
);

if (failures > 0) {
  console.error(`\n${failures} cas divergent.`);
  process.exit(1);
}
console.log("l'échelle portée joue la fournée du Rust, coup pour coup");
