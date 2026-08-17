/**
 * Ce que les trois modes du succès font à une fournée.
 *
 *   node scripts/check-success.mjs
 *
 * ## Pourquoi ce script existe, et pourquoi `check-penned.mjs` ne suffit pas
 *
 * `applySuccess` s'applique **dans `stablePlan`**, après la recherche. Or le seul
 * harnais qui joue une partie entière — `check-penned.mjs` — joue
 * `simulatePolicy`, c'est-à-dire le chemin heuristique de `loadout.ts`, et sa
 * propre en-tête le dit : « L'écran d'élevage, lui, appelle `stablePlan` ». Le
 * lancer sur ce correctif rendrait donc un vert **vide de sens** : il ne
 * traverserait pas une ligne de la passe.
 *
 * Ce script prend l'autre chemin. Il rejoue `stablePlan` sur la même écurie que
 * `policy-report.mjs`, une fois par mode, et compare ce que la fournée devient.
 *
 * ## Ce qu'il mesure, et ce qu'il ne mesure pas
 *
 * Il mesure l'effet **immédiat sur une fournée** : places engagées, croisements,
 * achats, couleurs de la collection visées, et surtout **combien de pas de
 * l'échelle changent de cible**. C'est ce qui décide si un mode est utilisable.
 *
 * Il ne mesure **pas** le coût sur une route entière — combien de fournées en plus
 * pour atteindre la gen 10. Aucun harnais du dépôt ne joue une partie complète sur
 * `stablePlan`, et en écrire un est un chantier à part. Le coût long terme des deux
 * modes actifs reste donc une inconnue déclarée, et c'est pour ça que `ignore` est
 * le défaut.
 *
 * ## L'écurie est fixe
 *
 * La même que `policy-report.mjs`, et pour la même raison : deux exécutions
 * doivent se comparer. Un tirage rendrait le tableau ci-dessous illisible d'une
 * fois à l'autre.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, compile, load } from './lib/tsc.mjs';

const out = compile(
  'success',
  ['src/lib/dofus/breeding/policy.ts', 'src/lib/dofus/breeding/random.ts'],
  { json: true }
);

const { stablePlan } = await load(out, 'policy.js');
const { ladderOf } = await load(out, 'ladder.js');

const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const trees = read('src/lib/dofus/breeding/trees.json');
const colors = trees.families.find((family) => family.id === 'muldo').colors;
const nameOf = Object.fromEntries(colors.map((color) => [color.id, color.name]));

/* ---------------------------------------------------------------- l'écurie */

const CAPACITY = 60;
const gen1 = colors.filter((color) => color.generation === 1);

const buildStable = () => {
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

/**
 * La collection de départ : vide, comme en vrai.
 *
 * C'est le pire cas pour les deux modes actifs — tout est à collectionner, donc
 * chaque croisement a un détournement possible. Un départ à moitié rempli les
 * ferait paraître plus sages qu'ils ne sont.
 */
const HATCHED = new Set();

const planFor = (mode) =>
  stablePlan({
    stable: buildStable(),
    colors,
    market,
    capacity: CAPACITY,
    loadKamas: 150_000,
    kamas: 30_000_000,
    success: mode === 'ignore' ? undefined : { mode, hatched: HATCHED },
  });

/* ----------------------------------------------------------- la comparaison */

const ladder = ladderOf(colors);
const onLadder = new Set(ladder.recipeOf.keys());

const measure = (plan) => {
  const targets = plan.couples
    .filter((line) => line.targetColorId !== null)
    .map((line) => line.targetColorId);
  return {
    couples: plan.couples.reduce((sum, line) => sum + line.count, 0),
    lines: plan.couples.length,
    places: plan.places,
    purchases: plan.purchases.reduce((sum, entry) => sum + entry.males + entry.females, 0),
    // Ce qui compte : combien de cibles sortent du plan de l'échelle. C'est la
    // mesure du détournement, et elle se lit sans connaître la passe.
    offLadder: targets.filter((colorId) => !onLadder.has(colorId)).length,
    onLadder: targets.filter((colorId) => onLadder.has(colorId)).length,
    collecting: new Set(targets.filter((colorId) => !HATCHED.has(colorId))).size,
  };
};

const MODES = ['ignore', 'free', 'priority'];
const results = new Map();

for (const mode of MODES) {
  const plan = planFor(mode);
  if (!plan) {
    console.error(`la politique ne répond pas en mode ${mode}`);
    process.exit(1);
  }
  results.set(mode, { plan, stats: measure(plan) });
}

const base = results.get('ignore').stats;
const pad = (value, width = 7) => String(value).padStart(width);

console.log(`écurie fixe · ${CAPACITY} places · collection vide (le pire cas)\n`);
console.log(
  '  mode        couples  places  achats  cibles au plan  hors plan  couleurs visées'
);
for (const mode of MODES) {
  const s = results.get(mode).stats;
  const delta = (value, reference) => {
    const diff = value - reference;
    return diff === 0 ? '' : ` (${diff > 0 ? '+' : ''}${diff})`;
  };
  console.log(
    `  ${mode.padEnd(10)}${pad(s.couples)}${delta(s.couples, base.couples).padEnd(6)}` +
      `${pad(s.places)}${delta(s.places, base.places).padEnd(6)}` +
      `${pad(s.purchases)}${delta(s.purchases, base.purchases).padEnd(6)}` +
      `${pad(s.onLadder, 10)}${delta(s.onLadder, base.onLadder).padEnd(6)}` +
      `${pad(s.offLadder, 6)}${delta(s.offLadder, base.offLadder).padEnd(6)}` +
      `${pad(s.collecting, 8)}`
  );
}

console.log('\nce que chaque mode détourne ou ajoute :');
for (const mode of ['free', 'priority']) {
  const { plan } = results.get(mode);
  const redirected = plan.couples.filter(
    (line) => line.targetColorId !== null && !onLadder.has(line.targetColorId)
  );
  console.log(`\n  ${mode} — ${redirected.length} ligne(s) hors du plan de l'échelle`);
  for (const line of redirected.slice(0, 6)) {
    console.log(
      `    ♂ ${(nameOf[line.male.colorId] ?? line.male.colorId).padEnd(16)}` +
        ` × ♀ ${(nameOf[line.female.colorId] ?? line.female.colorId).padEnd(16)}` +
        ` → ${nameOf[line.targetColorId] ?? line.targetColorId}` +
        // Une ligne sans identifiant désigne du **vrac**, pas forcément un achat :
        // une gen 1 est interchangeable et n'a pas d'identité. Le compte d'achats
        // du tableau ci-dessus est la seule mesure fiable là-dessus.
        (line.male.mountIds.length === 0 || line.female.mountIds.length === 0
          ? '  (du vrac)'
          : '')
    );
  }
  if (redirected.length > 6) console.log(`    … ${redirected.length - 6} de plus`);
}

/* --------------------------------------------------------------- le verdict */

let failures = 0;
const fail = (message) => {
  console.error(`\n  ✗ ${message}`);
  failures += 1;
};

// `ignore` doit être exactement la fournée d'avant la passe : c'est ce qui garantit
// qu'un éleveur qui n'y touche pas ne voit rien changer.
const ignored = results.get('ignore').stats;
const withoutSuccess = measure(
  stablePlan({
    stable: buildStable(),
    colors,
    market,
    capacity: CAPACITY,
    loadKamas: 150_000,
    kamas: 30_000_000,
  })
);
for (const key of Object.keys(ignored)) {
  if (ignored[key] !== withoutSuccess[key]) {
    fail(`en mode ignore, ${key} vaut ${ignored[key]} au lieu de ${withoutSuccess[key]}`);
  }
}

// Et aucun mode ne doit faire déborder le parc : une fournée infaisable ne se
// signale nulle part devant l'enclos.
for (const mode of MODES) {
  const s = results.get(mode).stats;
  if (s.places > CAPACITY) fail(`en mode ${mode}, ${s.places} places engagées pour ${CAPACITY}`);
}

if (failures > 0) {
  console.error(`\n${failures} règle${failures > 1 ? 's' : ''} violée${failures > 1 ? 's' : ''}.`);
  process.exit(1);
}
console.log('\nignore ne change rien, et aucun mode ne fait déborder le parc');
console.log(
  'non mesuré : le coût sur une route entière. Aucun harnais ne joue une partie\n' +
    'complète sur `stablePlan` — voir l’en-tête.'
);
