/**
 * L'échelle portée pose-t-elle le même plan que le Rust ?
 *
 * ```sh
 * node scripts/check-ladder-parity.mjs
 * ```
 *
 * Sixième garde-fou du portage, et le second — avec l'ordonnanceur — à couvrir
 * **tout son domaine** plutôt qu'un échantillon : le plan se déduit de l'arbre
 * seul, donc trois familles fois deux routes en font le tour.
 *
 * ## Ce qu'il attrape, et pourquoi rien d'autre ne le voyait
 *
 * `check-ladder.mjs` verrouille des **invariants** — tout ingrédient voulu est
 * fabricable ou achetable, les blocs sont des cliques, un couple qui ne nomme
 * rien est refusé. Un plan peut les tenir tous en étant un **autre plan** que
 * celui du Rust : il suffit qu'un départage bascule. L'échelle en compte trois,
 * et aucun ne se voit à l'écran — le panneau affiche une liste de couleurs
 * parfaitement plausible dans les deux cas.
 *
 * - la **route par défaut**, quand l'appelant n'en nomme aucune. Les deux côtés
 *   en portent une, et rien ne les oblige à porter la même : c'est ce qui les a
 *   séparés jusqu'à #160. La référence porte donc `defaultRoute`, lu sur
 *   `Route::default()`, et on appelle ici `ladderOf(colors)` **sans argument**
 *   pour le vérifier ;
 * - le **jeu de couleurs** retenu à chaque barreau, qui dépend de l'ordre des
 *   identifiants ;
 * - la **demande propagée**, qui décide combien d'unités de chaque couleur un
 *   sommet réclame.
 *
 * ## Pas de tolérance
 *
 * On compare des ensembles de couleurs et des recettes, pas des flottants :
 * l'égalité est exacte. Les demandes elles-mêmes sont des sommes d'entiers —
 * aucune division n'entre dans `spreadDemand` — donc elles se comparent au
 * comptant.
 *
 * Blocs et sommet se comparent **en place** et pas comme des ensembles : les
 * deux côtés les ordonnent par l'ordre du catalogue, donc un même ensemble rendu
 * dans un autre ordre est déjà une divergence de départage.
 *
 * ## Ce qu'il ne couvre pas
 *
 * La **couronne** — `crown_at`, `best_partner_crown`, `lay_single` et la taille
 * qui retire du plan les couleurs dont la demande retombe à zéro. Ce qu'on
 * compare ici est le plan **d'avant le sommet**, celui que `Ladder::of` et
 * `ladderOf` rendent tous deux ; le couronnement est une passe à part des deux
 * côtés, `crownedLadderOf` depuis #160. Il dépend des prix de gen 10 tirés par
 * partie, donc le verrouiller demande de figer aussi un barème : c'est une
 * seconde référence, pas une colonne de celle-ci, et un plan nu juste des deux
 * côtés ne suffit pas à conclure sur le plan couronné.
 *
 * ## Régénérer la référence
 *
 * ```sh
 * npm run parity                     # avec les cinq autres
 * cd rust && cargo run --release -p breeding-neat --bin dump-ladder -- \
 *   ../scripts/fixtures/ladder-parity.json
 * ```
 */

import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const out = mkdtempSync(join(tmpdir(), 'dofdof-ladder-parity-'));
// Le compilateur est appelé par son point d'entrée et non par `npx` : sous
// Windows `npx` est un `.cmd`, que `spawnSync` refuse de lancer sans shell
// depuis Node 20.12. Le binaire local est là de toute façon.
execFileSync(
  process.execPath,
  [
    join(ROOT, 'node_modules/typescript/bin/tsc'),
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

const { ladderOf } = await import(pathToFileURL(join(out, 'ladder.js')).href);

const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const fixture = read('scripts/fixtures/ladder-parity.json');
const trees = read('src/lib/dofus/breeding/trees.json');

let failures = 0;
const fail = (message) => {
  console.error(`ÉCHEC — ${message}`);
  failures += 1;
};

/** Une liste de couleurs, lisible dans un message d'erreur. */
const listed = (colors) => (colors.length === 0 ? '—' : colors.join(', '));

/**
 * Deux ensembles de couleurs, nommés par ce qui les sépare.
 *
 * On dit **quelles** couleurs manquent et lesquelles sont en trop plutôt que
 * « ça diverge » : sur un plan de trente couleurs, c'est la différence entre une
 * piste et une énigme.
 */
const sameSet = (label, mine, theirs) => {
  const ours = new Set(mine);
  const rust = new Set(theirs);
  const extra = mine.filter((colorId) => !rust.has(colorId));
  const missing = theirs.filter((colorId) => !ours.has(colorId));
  if (extra.length === 0 && missing.length === 0) return true;
  fail(
    `${label} : ${missing.length} manquante(s) — ${listed(missing)} — et ` +
      `${extra.length} en trop — ${listed(extra)}`
  );
  return false;
};

/** Deux listes ordonnées, comparées position par position. */
const sameList = (label, mine, theirs) => {
  if (mine.length === theirs.length && mine.every((value, at) => value === theirs[at])) return true;
  fail(`${label} : ${listed(mine)} contre ${listed(theirs)} côté Rust`);
  return false;
};

for (const family of fixture.families) {
  const colors = trees.families.find((candidate) => candidate.id === family.id)?.colors;
  if (!colors) {
    fail(`${family.id} : famille absente de trees.json`);
    continue;
  }
  // L'ordre du catalogue, celui qui départage — les deux côtés s'y réfèrent, et
  // c'est dans cet ordre que la référence sérialise ses ensembles.
  const index = new Map(colors.map((color, position) => [color.id, position]));
  const byCatalogOrder = (a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0);

  for (const plan of family.plans) {
    // La route par défaut se vérifie en n'en nommant aucune : c'est le seul
    // moyen de lire ce que le portage choisit quand l'écran ne choisit pas.
    const routes =
      plan.route === fixture.defaultRoute
        ? [[plan.route, [colors, plan.route]], ['défaut', [colors]]]
        : [[plan.route, [colors, plan.route]]];

    for (const [label, args] of routes) {
      const where = `${family.id}/${label}`;
      const ladder = ladderOf(...args);

      const wanted = [...ladder.wanted].sort(byCatalogOrder);
      const sound = sameSet(`${where} · wanted`, wanted, plan.wanted);

      // Les recettes : mêmes couleurs recensées, et la même paire pour chacune.
      // L'ordre des deux teintes compte — il vient de l'arbre, donc une paire
      // lue à l'envers est une divergence de lecture, pas de présentation.
      const theirRecipes = new Map(plan.recipeOf.map(([colorId, a, b]) => [colorId, [a, b]]));
      sameSet(
        `${where} · recipeOf`,
        [...ladder.recipeOf.keys()].sort(byCatalogOrder),
        [...theirRecipes.keys()]
      );
      for (const [colorId, [a, b]] of theirRecipes) {
        const mine = ladder.recipeOf.get(colorId);
        if (!mine) continue; // Déjà dit par `sameSet`.
        if (mine[0] !== a || mine[1] !== b) {
          fail(`${where} · recette de ${colorId} : ${mine[0]}×${mine[1]} contre ${a}×${b}`);
        }
      }

      // La demande : des sommes d'entiers, donc comparables au comptant.
      const theirDemand = new Map(plan.demand);
      sameSet(
        `${where} · demand`,
        [...ladder.demand.keys()].sort(byCatalogOrder),
        [...theirDemand.keys()]
      );
      for (const [colorId, quantity] of theirDemand) {
        const mine = ladder.demand.get(colorId);
        if (mine === undefined) continue;
        if (mine !== quantity) {
          fail(`${where} · demande de ${colorId} : ${mine} contre ${quantity}`);
        }
      }

      if (ladder.blocks.length !== plan.blocks.length) {
        fail(`${where} · blocs : ${ladder.blocks.length} contre ${plan.blocks.length}`);
      } else {
        ladder.blocks.forEach((block, at) => {
          sameList(`${where} · bloc ${at}`, block, plan.blocks[at]);
        });
      }
      sameList(`${where} · summit`, ladder.summit, plan.summit);

      if (sound) {
        console.log(
          `${where.padEnd(22)} · ${plan.wanted.length} couleurs au plan · ` +
            `sommet ${plan.summit.join('+')}`
        );
      }
    }
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} divergence${failures > 1 ? 's' : ''} entre l'échelle portée et ` +
      `rust/breeding-sim/src/ladder.rs.`
  );
  process.exit(1);
}
console.log("\nl'échelle portée pose le plan du Rust, sur les trois familles et les deux routes");
