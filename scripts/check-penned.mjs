/**
 * Mesurer ce que le retrait des montures d'enclos fait à la politique.
 *
 *   node scripts/check-penned.mjs
 *
 * `withoutPenned` et le calcul des places libres changent l'**entrée** de la
 * politique, jamais son algorithme. `ship-change` est pourtant catégorique :
 * chaque défaut jamais trouvé dans cette politique l'a été en la faisant
 * tourner, et le cas #83 est passé de 85 % à 10 % de montées en gen 10 avec
 * `tsc` vert, `eslint` vert et l'écran correct. Un raisonnement n'est pas une
 * mesure.
 *
 * ## Trois questions, trois bras
 *
 *   A. écurie entière, parc entier        la référence
 *   B. `withoutPenned(écurie, [])`        la fournée vide
 *   C. 10 montures en enclos, 30 places   ce que voit un éleveur qui a verrouillé
 *
 * **B contre A** est la question qui compte pour tout le monde : tant qu'aucun
 * enclos n'est verrouillé, l'entrée doit être *identique*. Pas « proche » —
 * identique, au chiffre près, sur les quatre distributions. C'est ce qui garantit
 * qu'un éleveur qui n'a jamais cliqué LOCK ne voit rien changer.
 *
 * **C contre A** dit ce que le verrouillage coûte dans le modèle. On l'attend
 * plus bas : dix montures enfermées et dix places prises sont dix montures et dix
 * places en moins, et c'est la vérité du parc. Ce bras ne juge donc pas le
 * correctif — il le chiffre. Le comparer à un bras « sans correctif » n'aurait
 * aucun sens : ce dernier planifierait avec des montures qui ne sont pas là,
 * donc il sortirait *meilleur* en étant faux. Une politique qui triche gagne
 * toujours sur le papier.
 *
 * ## Ce que cette mesure ne prétend pas être
 *
 * L'économie est **synthétique**, reprise telle quelle de `check-promotion.mjs` :
 * le dépôt ne versionne pas de prix d'HDV. Elle est identique dans tous les
 * bras, et c'est tout ce que la comparaison demande. Un coût absolu sorti d'ici
 * ne vaut rien.
 *
 * ## Et surtout : ce n'est pas la politique de l'écran
 *
 * `simulatePolicy` joue `planCouples` (`loadout.ts`), le chargement
 * **heuristique**. L'écran d'élevage, lui, appelle `stablePlan` (`policy.ts`),
 * c'est-à-dire la recherche portée du Rust. Les deux ne décident pas de la même
 * façon, et le dépôt n'a pas de harnais qui rejoue la seconde sur une écurie.
 *
 * Conséquence à tenir en tête en lisant les chiffres ci-dessous :
 *
 * * le verdict **A = B** vaut pleinement — `withoutPenned` est une
 *   transformation d'écurie, et l'identité se vérifie sur n'importe quel joueur
 *   de plan ;
 * * les écarts **C, D, E** décrivent le comportement de l'heuristique face à un
 *   parc réduit, **pas** celui de la politique entraînée. Ils se lisent comme
 *   une indication, pas comme une mesure de ce que l'écran fera.
 *
 * Le seul contrôle du vrai chemin est l'end-to-end : `e2e/penned-mounts.spec.ts`
 * fait tourner `stablePlan` dans un navigateur et vérifie qu'à parc plein il
 * annonce « 0/0 places » et ne charge rien. Le simulateur ne peut pas le faire —
 * il borne la capacité à `Math.max(context.slots, 2)`.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const FAMILY = 'dragodinde';
const TARGET_GENERATION = 10;
const RUNS = 100;
/** Plusieurs graines : à une seule, le verdict change de signe. Voir #promotion. */
const SEEDS = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1, 2, 3, 7];
const MAX_CROSSINGS = 4000;

/** Le parc : quatre enclos de dix places, l'ordre de grandeur d'un éleveur réel. */
const SLOTS = 40;
/** Un enclos verrouillé : dix montures dedans, dix places prises. */
const PENNED = 10;

const SOURCES = [
  'src/lib/dofus/breeding/simulate.ts',
  'src/lib/dofus/breeding/costs.ts',
  'src/lib/dofus/breeding/trees.ts',
  'src/lib/dofus/breeding/stable.ts',
  'src/lib/dofus/breeding/search.ts',
  'src/lib/dofus/breeding/batch.ts',
];

const out = mkdtempSync(join(tmpdir(), 'penned-'));

/** tsc rend un code non nul sur une erreur de types tout en ayant émis le JS. */
const compile = (run) => {
  try {
    run();
  } catch (error) {
    if (error.status === undefined) throw error;
  }
};

try {
  compile(() =>
    execFileSync(
      process.execPath,
      [
        'node_modules/typescript/bin/tsc',
        ...SOURCES,
        '--outDir', out,
        '--module', 'commonjs',
        '--target', 'es2020',
        '--moduleResolution', 'node',
        '--esModuleInterop',
        '--resolveJsonModule',
        '--skipLibCheck',
      ],
      { stdio: 'pipe' }
    )
  );

  const require = createRequire(import.meta.url);
  const load = (name) => {
    for (const candidate of [
      join(out, `${name}.js`),
      join(out, 'src/lib/dofus/breeding', `${name}.js`),
    ]) {
      try {
        return require(candidate);
      } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') throw error;
      }
    }
    throw new Error(`module ${name} introuvable dans ${out}`);
  };

  const { simulatePolicy } = load('simulate');
  const { computeBreedingCosts } = load('costs');
  const { findFamily } = load('trees');
  const { withoutPenned, pennedUnits } = load('batch');

  const family = findFamily(FAMILY);
  if (!family) throw new Error(`famille ${FAMILY} introuvable`);
  const colors = family.colors;
  const generations = new Map(colors.map((color) => [color.id, color.generation]));

  // --- l'économie, tenue constante dans les trois bras ----------------------
  const GENETON = 735;
  const AMBER = 20_500;
  const FUEL_PER_CYCLE = Math.round(AMBER / 4);

  const priceOf = (generation) => Math.round(20_000 * Math.pow(2.15, generation - 1));
  const prices = new Map(
    colors.map((color) => [
      color.id,
      { level0: priceOf(color.generation), level200: priceOf(color.generation) * 3 },
    ])
  );

  const estimates = computeBreedingCosts(colors, prices, {
    parentLevel: 'auto',
    fuelCostPerCycle: FUEL_PER_CYCLE,
    genetonValue: GENETON,
    sacrificeUnitValue: GENETON,
    mangeoireCostPerMountPoint: 12,
    recycleSteriles: true,
    captureCost: 15_000,
  });

  const costOf = (colorId) =>
    estimates.get(colorId)?.priceLevel0 ?? priceOf(generations.get(colorId) ?? 1);

  const cheapestByGeneration = new Map();
  for (const color of colors) {
    const price = costOf(color.id);
    const known = cheapestByGeneration.get(color.generation);
    if (known === undefined || price < known) cheapestByGeneration.set(color.generation, price);
  }

  const contextWith = (slots) => ({
    colors,
    generations,
    costOf,
    fuelCostPerCycle: FUEL_PER_CYCLE,
    batchHours: 48,
    slots,
    recycleSteriles: true,
    cheapestAt: (generation) => cheapestByGeneration.get(generation) ?? priceOf(generation),
    sacrificeUnitValue: GENETON,
    estimates,
    genetonValue: GENETON,
  });

  // --- l'écurie de départ ---------------------------------------------------
  const gen1 = colors.filter((color) => color.generation === 1);
  const PER_COLOR = 20;

  /**
   * Des montures **suivies**, et non du vrac : c'est ce que la sortie d'enclos
   * laisse derrière elle depuis la promotion, donc l'écurie réelle d'un éleveur
   * qui a déjà tourné. C'est aussi la seule forme sur laquelle `withoutPenned`
   * retire par identifiant, ce qu'on vient vérifier.
   */
  const stableOf = () => {
    const individuals = [];
    let seq = 0;
    for (const color of gen1) {
      for (const sex of ['M', 'F']) {
        for (let i = 0; i < PER_COLOR / 2; i += 1) {
          individuals.push({
            id: `mount-${seq++}`,
            colorId: color.id,
            name: null,
            sex,
            level: 61,
            fertile: true,
            cycled: false,
            parents: null,
          });
        }
      }
    }
    return { bulk: new Map(), individuals };
  };

  /** Un enclos verrouillé, portant les `PENNED` premières montures de l'écurie. */
  const lockedPen = (stable) => [
    {
      lockedAt: new Date().toISOString(),
      units: stable.individuals.slice(0, PENNED).map((mount) => ({
        id: mount.id,
        colorId: mount.colorId,
        sex: mount.sex,
        name: null,
        level: mount.level,
        banked: false,
        toBuy: false,
      })),
    },
  ];

  const target = colors
    .filter((color) => color.generation === TARGET_GENERATION)
    .sort((a, b) => costOf(a.id) - costOf(b.id))[0];
  if (!target) throw new Error(`aucune couleur de génération ${TARGET_GENERATION}`);

  const base = stableOf();
  const pens = lockedPen(base);

  // Le contrat de `pennedUnits`, vérifié avant de s'en servir : un enclos
  // verrouillé porte bien ses dix montures.
  if (pennedUnits(pens).length !== PENNED) {
    throw new Error(`pennedUnits rend ${pennedUnits(pens).length}, attendu ${PENNED}`);
  }

  /**
   * Cinq bras et non trois.
   *
   * Les trois premiers répondent aux questions posées. Les deux derniers
   * existent parce que le troisième a surpris : verrouiller un enclos fait
   * **monter** la génération atteinte, pas baisser. Un résultat contre-intuitif
   * qu'on ne décompose pas est un résultat qu'on ne comprend pas, et le publier
   * tel quel reviendrait à faire passer un effet de bord pour un bénéfice.
   *
   * D et E séparent les deux leviers : D retire les places sans retirer les
   * montures, E retire les montures sans retirer les places.
   */
  const arms = [
    ['A · référence', () => base, SLOTS],
    ['B · withoutPenned(écurie, [])', () => withoutPenned(stableOf(), []), SLOTS],
    [`C · ${PENNED} en enclos`, () => withoutPenned(stableOf(), pens), SLOTS - PENNED],
    [`D · places seules (${SLOTS - PENNED})`, () => stableOf(), SLOTS - PENNED],
    [`E · montures seules (−${PENNED})`, () => withoutPenned(stableOf(), pens), SLOTS],
  ];

  console.log(
    `\nCible ${target.name} (gen ${TARGET_GENERATION}) · ${RUNS} parties × ${SEEDS.length} graines ` +
      `(${SEEDS.join(', ')}) · plafond ${MAX_CROSSINGS} croisements`
  );
  console.log(
    `Écurie de départ : ${gen1.length} couleurs gen 1 × ${PER_COLOR} montures ` +
      `(${gen1.length * PER_COLOR} au total) · parc ${SLOTS} places`
  );

  const climbed = arms.map(() => []);
  const reached = arms.map(() => []);
  const costs = arms.map(() => []);

  for (const seed of SEEDS) {
    const options = {
      targetColorId: target.id,
      targetGeneration: TARGET_GENERATION,
      runs: RUNS,
      maxCrossings: MAX_CROSSINGS,
      seed,
    };

    console.log(`\ngraine ${seed}`);
    arms.forEach(([label, build, slots], index) => {
      const result = simulatePolicy(build(), contextWith(slots), options);
      climbed[index].push(result.top.mean);
      reached[index].push(result.reachedShare);
      costs[index].push(result.cost.median);
      console.log(
        `  ${label.padEnd(30)} génération atteinte ${result.top.mean.toFixed(2)}` +
          ` · médiane ${String(result.top.median).padStart(2)}` +
          ` · p90 ${String(result.top.p90).padStart(2)}` +
          `   gen ${TARGET_GENERATION} : ${(result.reachedShare * 100).toFixed(1)} %`
      );
    });
  }

  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const spread = (values) => Math.max(...values) - Math.min(...values);
  const [a, b, c, d, e] = climbed.map(mean);

  console.log('\nMoyenne sur les graines — génération atteinte :');
  arms.forEach(([label], index) => {
    console.log(`  ${label.padEnd(30)} ${climbed[index] && mean(climbed[index]).toFixed(3)}`);
  });

  /**
   * Le verdict qui compte : **B doit égaler A exactement**.
   *
   * Pas « à la tolérance près ». `withoutPenned` sur une fournée vide rend
   * l'écurie telle quelle, donc la simulation joue la même suite de tirages sur
   * la même population — au bit près. Un écart, si petit soit-il, voudrait dire
   * que l'entrée de la politique a bougé pour un éleveur qui n'a rien verrouillé,
   * et c'est exactement ce qu'on promet de ne pas faire.
   */
  const identical =
    climbed[0].every((value, index) => value === climbed[1][index]) &&
    reached[0].every((value, index) => value === reached[1][index]) &&
    costs[0].every((value, index) => value === costs[1][index]);

  if (!identical) {
    console.error(
      `\n✗ B diffère de A. Sans enclos verrouillé, l'entrée de la politique doit être ` +
        `identique — un éleveur qui n'a jamais cliqué LOCK ne doit rien voir changer.`
    );
    process.exit(1);
  }

  console.log(
    `\n✓ B est identique à A sur les ${SEEDS.length} graines — génération, part de montées et ` +
      `coût médian, au chiffre près. Sans enclos verrouillé, la politique reçoit exactement ` +
      `ce qu'elle recevait avant.`
  );

  const resolution = Math.max(...climbed.map(spread));
  const signed = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;

  console.log(
    `\n  Résolution : ${resolution.toFixed(3)} d'écart entre graines à réglage identique — un effet ` +
      `plus petit que ça n'est pas mesuré ici.`
  );
  console.log(`\n  Décomposition, face à A :`);
  console.log(`    C · les deux leviers   ${signed(c - a)} génération`);
  console.log(`    D · places seules      ${signed(d - a)}`);
  console.log(`    E · montures seules    ${signed(e - a)}`);
  console.log(
    `\n  Ce bloc chiffre le verrouillage, il ne juge pas le correctif : le comparer à une ` +
      `politique qui garderait les montures enfermées dans son écurie la ferait gagner en ` +
      `étant fausse — elle planifierait avec des montures qui ne sont pas là.`
  );

  // Le résultat qui n'était pas attendu, dit à voix haute plutôt que laissé dans
  // un tableau. Un parc plus PETIT monte plus haut, et l'effet vient des places,
  // pas des montures.
  if (d - a > resolution) {
    console.log(
      `\n  ⚠ Résultat contre-intuitif, et il ne vient pas de ce correctif : réduire le parc de ` +
        `${SLOTS} à ${SLOTS - PENNED} places fait MONTER la génération atteinte de ` +
        `${signed(d - a)}, au-delà de la résolution. Retirer les montures seules ne fait que ` +
        `${signed(e - a)}, donc sous la résolution : tout l'effet est dans les places.`
    );
    console.log(
      `    Autrement dit, l'heuristique de chargement remplit le parc avec des croisements qui ` +
        `consomment des montures dont l'échelle a besoin. À vérifier sur \`stablePlan\`, que ce ` +
        `harnais ne joue pas — voir l'en-tête.`
    );
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
