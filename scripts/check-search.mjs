/**
 * La montée de colline, portée, rend-elle **le même plan** que le Rust ?
 *
 * ```sh
 * node scripts/check-search.mjs
 * ```
 *
 * Quatrième et dernier garde-fou du portage. Les trois précédents comparaient des
 * nombres à une tolérance près — le réseau à 2,8 × 10⁻¹⁴, les 74 entrées à
 * 8,9 × 10⁻¹⁶, l'effet d'un croisement à zéro. Celui-ci compare des listes
 * d'entiers, donc sans tolérance : le plan est identique ou il ne l'est pas.
 *
 * ## Pourquoi c'est possible
 *
 * `random.ts` et `breeding_sim::economy::Rng` sont le même Mulberry32 sur `u32`,
 * opération pour opération. À écurie, graine et stratégie égales, les deux
 * recherches tirent la même suite de mutations et arrivent au même sommet.
 *
 * C'est aussi ce que ce garde-fou attrape le mieux : un `rng()` de plus ou de moins
 * sur une branche, même une qui ne sert à rien, décale toute la suite. Aucune des
 * deux recherches n'est fausse alors, et rien ne le signale — sauf ceci.
 *
 * ## Deux juges exigés, un troisième seulement observé
 *
 * Chaque cas est rejoué avec trois fonctions de valeur, et les deux premières
 * sont le contrat :
 *
 * - la **myope**, qui ne lit que les kamas et la liquidation ;
 * - la **sonde**, qui lit chaque champ, chaque génération et chaque couleur, et
 *   n'emploie que `*` et `+`, correctement arrondis.
 *
 * Ensemble elles couvrent tout ce que le portage possède : l'algèbre du
 * recensement champ par champ, et la mécanique de la recherche — tirage, ordre des
 * groupes, application et annulation des mutations, matérialisation. Elles doivent
 * être exactes, et elles le sont.
 *
 * Le **champion** est joué en plus, et son accord n'est pas exigé. Il ajoute
 * `log1p` dans l'encodage et `tanh` dans le réseau, et aucune norme n'oblige deux
 * bibliothèques mathématiques à s'accorder au dernier bit sur celles-là. Mesuré :
 * les deux valeurs s'écartent de **6 ulp**. Sur quatre cents comparaisons
 * `scored > best` par fournée, il suffit que deux états candidats se tiennent dans
 * ces 6 ulp pour que les deux recherches bifurquent — sans qu'aucune ait tort.
 *
 * Exiger l'égalité là serait exiger que V8 et la libm de Rust rendent le même bit
 * sur une transcendante. `check-network.mjs` borne déjà cet écart ; ce qui reste
 * ici n'est pas mesurable autrement, donc on le **compte et on l'affiche** plutôt
 * que de faire semblant de le garder.
 *
 * ## Régénérer la référence
 *
 * ```sh
 * npm run parity                     # depuis rust/champion.json
 * npm run parity -- rust/champion-t3.json
 * ```
 *
 * Une seule commande pour les quatre, et c'est délibéré : elle réinstalle aussi
 * l'artefact dans `src/`, si bien qu'on ne peut plus refaire les références sans
 * déployer le champion qui les a produites. Voir `refresh-parity.mjs`.
 *
 * À refaire quand le champion change, quand `FEATURES` bouge, ou quand `search.rs`
 * change de tirage — les trois font un autre plan, légitimement.
 */

import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const out = mkdtempSync(join(tmpdir(), 'dofdof-search-'));
// Le compilateur est appelé par son point d'entrée et non par  : sous
// Windows  est un , que  refuse de lancer sans shell
// depuis Node 20.12, et le script mourait avant d'avoir rien vérifié.
execFileSync(
  process.execPath,
  [
    join(ROOT, 'node_modules/typescript/bin/tsc'),
    join(ROOT, 'src/lib/dofus/breeding/search.ts'),
    join(ROOT, 'src/lib/dofus/breeding/network.ts'),
    // `search.ts` reçoit son générateur en argument plutôt que de l'importer, donc
    // il faut le demander à part — c'est le même que celui de l'app, et c'est ce
    // qui rend la comparaison exacte plutôt qu'approchée.
    join(ROOT, 'src/lib/dofus/breeding/random.ts'),
    // Le filtre d'admissibilité vient de l'échelle : sans elle la moitié des cas
    // ne peut pas être rejouée.
    join(ROOT, 'src/lib/dofus/breeding/ladder.ts'),
    '--outDir', out,
    '--module', 'commonjs',
    '--target', 'es2020',
    '--moduleResolution', 'node',
    '--esModuleInterop',
    '--skipLibCheck',
    '--resolveJsonModule',
    '--noCheck',
  ],
  { stdio: 'inherit' }
);

const { planUnit, createSearcher, myopic, linearProbe } = await import(pathToFileURL(join(out, 'search.js')).href);
const { censusOf, featuresOf, FEATURES } = await import(pathToFileURL(join(out, 'census.js')).href);
const { seededRandom } = await import(pathToFileURL(join(out, 'random.js')).href);
const { aimsAt, crownedLadderOf } = await import(pathToFileURL(join(out, 'ladder.js')).href);
const { compile, evaluate } = await import(pathToFileURL(join(out, 'network.js')).href);

const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const fixture = read('scripts/fixtures/search-parity.json');
const champion = read('src/lib/dofus/breeding/champion.json');
const trees = read('src/lib/dofus/breeding/trees.json');
const colors = trees.families.find((family) => family.id === 'muldo').colors;

if (fixture.features !== FEATURES || champion.features !== FEATURES) {
  console.error(
    `Arités incompatibles : référence ${fixture.features}, champion ` +
      `${champion.features}, portage ${FEATURES}. Régénérer — voir l'en-tête.`
  );
  process.exit(1);
}

const network = compile(champion);
const generations = new Map(colors.map((color) => [color.id, color.generation]));

/** Le plan tel qu'on le compare : des listes d'entiers, rien d'autre. */
const shape = (plan) =>
  JSON.stringify({
    purchases: plan.purchases,
    clonings: plan.clonings,
    crossings: plan.crossings,
    optimakina: plan.optimakina,
    sacrifices: plan.sacrifices,
    cycles: plan.cycles,
  });

let matched = 0;
let acted = 0;
let agreed = 0;
const failures = [];

for (const [at, testCase] of fixture.cases.entries()) {
  const values = new Map(testCase.economy.values);
  const economy = {
    ...testCase.economy,
    valueOf: (colorId) => values.get(colorId) ?? 0,
  };

  // Le Rust ne connaît que des montures ; le vrac est une commodité d'écran. On
  // reconstruit donc tout en individus, dans l'ordre du Rust — c'est cet ordre que
  // les indices du plan désignent.
  const mounts = testCase.mounts.map((mount, index) => ({
    id: String(index),
    colorId: mount.color,
    name: null,
    sex: mount.sex,
    level: 1,
    fertile: mount.fertile,
    cycled: mount.cycled,
    parents: mount.parents ?? null,
  }));

  const view = {
    mounts,
    colors,
    generations,
    economy,
    strategy: testCase.strategy,
    kamas: testCase.kamas,
    capacity: testCase.capacity,
    loadKamas: testCase.loadKamas,
  };

  // Le filtre, quand le cas le demande. C'est le prédicat de `policy.ts` :
  // `aimsAt` contre l'échelle couronnée, en régime `'target'`.
  //
  // Sans cette dimension la référence ne couvrait que `admissible: undefined`, et
  // le filtre qui décide ce que la recherche a le droit de composer n'était
  // vérifié d'aucun côté du portage.
  let admissible;
  if (testCase.admissible !== 'aucun') {
    const ladder = crownedLadderOf(colors, economy.valueOf);
    admissible = (male, female) =>
      aimsAt(male, female, colors, generations, ladder, 'target') !== null;
  }

  const run = (value) =>
    planUnit(
      createSearcher({
        iterations: testCase.iterations,
        sacrifices: testCase.sacrifices,
        admissible,
      }),
      view,
      seededRandom(testCase.seed),
      value
    );

  for (const [label, value, expected] of [
    ['myope', myopic, testCase.myopic],
    ['sonde', linearProbe(colors), testCase.probe],
  ]) {
    const theirs = shape(expected);
    const mine = shape(run(value));
    if (mine === theirs) matched += 1;
    else failures.push({ at, label, mine, theirs });
  }

  // Observé, pas exigé — voir l'en-tête.
  const champion = run((census) => evaluate(network, featuresOf(census, colors, economy)));
  if (shape(champion) === shape(testCase.plan)) agreed += 1;

  const actions =
    testCase.plan.crossings.length +
    testCase.plan.clonings.length +
    testCase.plan.cycles.length +
    testCase.plan.sacrifices.length;
  if (actions > 0) acted += 1;

  // `censusOf` n'est pas comparé ici — `check-census.mjs` s'en charge — mais on
  // vérifie qu'il tourne sur ces écuries-là, faute de quoi un plan vide passerait
  // pour un accord.
  censusOf({ bulk: new Map(), individuals: mounts }, colors, economy, testCase.kamas);
}

console.log(
  `${matched}/${fixture.cases.length * 2} plans identiques (myope, sonde) · ` +
    `${acted} cas non vides`
);
console.log(
  `${agreed}/${fixture.cases.length} avec le champion — observé, non exigé : ` +
    `\`log1p\` et \`tanh\` s'écartent de 6 ulp entre les deux libm`
);
for (const failure of failures.slice(0, 3)) {
  console.error(`\ncas ${failure.at} (${failure.label})\n  portage : ${failure.mine}\n  rust    : ${failure.theirs}`);
}
if (failures.length > 0) {
  console.error(`\nDIVERGENCE sur ${failures.length} cas`);
  process.exit(1);
}
console.log('la recherche, portée, rejoue le Rust coup pour coup');
