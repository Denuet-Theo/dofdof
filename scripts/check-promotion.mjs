/**
 * Mesurer ce que la **composition de l'écurie** fait à la montée en génération.
 *
 *   node scripts/check-promotion.mjs
 *
 * La sortie d'enclos promeut désormais le vrac et les montures procurées en
 * montures suivies, avec leur niveau. C'est un changement d'entrée de la
 * politique, et `ship-change` est catégorique : chaque défaut jamais trouvé dans
 * cette politique l'a été **en la faisant tourner**. Le cas #83 est passé de 85 %
 * à 10 % de montées en gen 10 avec `tsc` vert, `eslint` vert et l'écran correct.
 *
 * Aucun script du dépôt n'appelait `simulatePolicy`. Celui-ci le fait.
 *
 * ## Trois bras, pour ne pas confondre deux effets
 *
 * Promouvoir change deux choses à la fois — la composition (compteurs → lignes
 * suivies) et le niveau (1 → celui saisi en sortant). Les mesurer ensemble
 * dirait si c'est mieux, pas pourquoi. D'où :
 *
 *   A. vrac, niveau 1        l'écurie telle que la sortie la laissait
 *   B. suivies, niveau 1     la composition seule
 *   C. suivies, niveau saisi la promotion telle qu'elle est livrée
 *
 * B contre A isole la composition. C contre A est ce que l'éleveur obtient.
 *
 * ## Ce que cette mesure ne prétend pas être
 *
 * L'économie ci-dessous est **synthétique** : le dépôt ne versionne pas de prix
 * d'HDV, et les inventer réalistes n'y changerait rien. Elle est *identique* dans
 * les trois bras, et c'est tout ce que la comparaison demande — on lit un écart
 * entre deux compositions, pas un coût absolu. Un chiffre de coût sorti d'ici ne
 * vaut donc rien ; seul l'écart de `reachedShare` en vaut.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const FAMILY = 'dragodinde';
const TARGET_GENERATION = 10;
const RUNS = 100;
/**
 * Plusieurs graines, et non une.
 *
 * Une seule graine rend un verdict qui change de signe : sur cette mesure, la
 * graine 1 donnait −0,27 génération et la graine 7 +0,05, à code identique. La
 * variation d'une graine à l'autre est de l'ordre de ±0,3 génération à 100
 * parties, donc juger sur une graine, c'est tirer à pile ou face et appeler ça
 * une mesure.
 */
const SEEDS = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1, 2, 3, 7];
const MAX_CROSSINGS = 4000;
/** Le niveau qu'une fournée rend en sortant d'enclos, saisi dans la fenêtre. */
const EXIT_LEVEL = 61;

const SOURCES = [
  'src/lib/dofus/breeding/simulate.ts',
  'src/lib/dofus/breeding/costs.ts',
  'src/lib/dofus/breeding/trees.ts',
  'src/lib/dofus/breeding/stable.ts',
  'src/lib/dofus/breeding/search.ts',
];

const out = mkdtempSync(join(tmpdir(), 'promotion-'));

/** tsc rend un code non nul sur une erreur de types tout en ayant émis le JS. */
const compile = (run) => {
  try {
    run();
  } catch (error) {
    if (error.status === undefined) throw error;
  }
};

try {
  // Même invocation que `scripts/check-plan.mjs` : le `tsc` du dépôt par son
  // point d'entrée Node, pour ne dépendre d'aucun shell.
  //
  // Les erreurs de **types** sont tolérées, et le code de sortie ignoré. Compilé
  // hors du tsconfig du dépôt, `trees.ts` en produit une : le JSON des arbres
  // rend `string[][]` là où `BreedingRecipe` attend un tuple de deux. tsc émet le
  // JS quand même, et c'est le comportement à l'exécution qu'on vient chercher —
  // les types, eux, sont gardés par `npx tsc --noEmit` sur le dépôt entier. Seul
  // un module manquant est fatal, et le chargement ci-dessous le dira.
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
    // tsc aplatit la sortie quand toutes les sources partagent une racine.
    for (const candidate of [join(out, `${name}.js`), join(out, 'src/lib/dofus/breeding', `${name}.js`)]) {
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

  const family = findFamily(FAMILY);
  if (!family) throw new Error(`famille ${FAMILY} introuvable`);
  const colors = family.colors;
  const generations = new Map(colors.map((color) => [color.id, color.generation]));

  // --- l'économie, tenue constante dans les trois bras ----------------------
  //
  // Ancrée sur `TRAINING_SCALES` (policy.ts), qui recopie `rust/economy.toml` :
  // géneton entre 490 et 980, ambre entre 11 000 et 30 000. On prend les milieux.
  const GENETON = 735;
  const AMBER = 20_500;
  // Un cycle de fécondité brûle du carburant ; la quantité exacte n'importe pas
  // ici puisqu'elle est la même partout, seul son ordre de grandeur compte.
  const FUEL_PER_CYCLE = Math.round(AMBER / 4);

  // Prix par génération : monotone et de la bonne forme (une gen 10 vaut des
  // millions, une gen 1 des dizaines de milliers). Synthétique, et partagée.
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

  const context = {
    colors,
    generations,
    costOf,
    fuelCostPerCycle: FUEL_PER_CYCLE,
    batchHours: 48,
    slots: 40,
    recycleSteriles: true,
    cheapestAt: (generation) => cheapestByGeneration.get(generation) ?? priceOf(generation),
    sacrificeUnitValue: GENETON,
    estimates,
    genetonValue: GENETON,
  };

  // --- l'écurie de départ, la même dans les trois bras ----------------------
  //
  // Les gen 1 de la famille, en nombre : c'est de là que part un éleveur, et
  // c'est exactement la population que la promotion déplace.
  const gen1 = colors.filter((color) => color.generation === 1);
  const PER_COLOR = 20; // 10 mâles, 10 femelles

  const asBulk = () => ({
    bulk: new Map(
      gen1.map((color) => [
        color.id,
        { males: PER_COLOR / 2, females: PER_COLOR / 2, cycledMales: 0, cycledFemales: 0 },
      ])
    ),
    individuals: [],
  });

  const asIndividuals = (level) => {
    const individuals = [];
    let seq = 0;
    for (const color of gen1) {
      for (const sex of ['M', 'F']) {
        for (let i = 0; i < PER_COLOR / 2; i += 1) {
          individuals.push({
            id: `promoted-${seq++}`,
            colorId: color.id,
            name: null,
            sex,
            level,
            fertile: true,
            cycled: false,
            parents: null,
          });
        }
      }
    }
    return { bulk: new Map(), individuals };
  };

  // La cible : la gen 10 la moins chère, celle qu'un plan viserait.
  const target = colors
    .filter((color) => color.generation === TARGET_GENERATION)
    .sort((a, b) => costOf(a.id) - costOf(b.id))[0];
  if (!target) throw new Error(`aucune couleur de génération ${TARGET_GENERATION}`);

  const arms = [
    ['A · vrac, niveau 1', asBulk],
    ['B · suivies, niveau 1', () => asIndividuals(1)],
    [`C · suivies, niveau ${EXIT_LEVEL}`, () => asIndividuals(EXIT_LEVEL)],
  ];

  console.log(
    `\nCible ${target.name} (gen ${TARGET_GENERATION}) · ${RUNS} parties × ${SEEDS.length} graines ` +
      `(${SEEDS.join(', ')}) · plafond ${MAX_CROSSINGS} croisements`
  );
  console.log(`Écurie de départ : ${gen1.length} couleurs gen 1 × ${PER_COLOR} montures`);

  /** Génération moyenne atteinte, par bras et par graine. */
  const reached = arms.map(() => []);
  const climbed = arms.map(() => []);

  for (const seed of SEEDS) {
    const options = {
      targetColorId: target.id,
      targetGeneration: TARGET_GENERATION,
      runs: RUNS,
      maxCrossings: MAX_CROSSINGS,
      seed,
    };

    console.log(`\ngraine ${seed}`);
    arms.forEach(([label, build], index) => {
      const result = simulatePolicy(build(), context, options);
      climbed[index].push(result.top.mean);
      reached[index].push(result.reachedShare);
      console.log(
        `  ${label.padEnd(26)} génération atteinte ${result.top.mean.toFixed(2)}` +
          ` · médiane ${String(result.top.median).padStart(2)}` +
          ` · p10 ${String(result.top.p10).padStart(2)}` +
          ` · p90 ${String(result.top.p90).padStart(2)}` +
          `   gen ${TARGET_GENERATION} : ${(result.reachedShare * 100).toFixed(1)} %`
      );
    });
  }

  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const spread = (values) => Math.max(...values) - Math.min(...values);

  /**
   * Le verdict porte sur la **génération moyenne atteinte**, pas sur la part de
   * montées en gen 10.
   *
   * `ship-change` nomme la part de montées, et c'est la bonne mesure quand elle se
   * tient au milieu de l'échelle — le cas #83 tombait de 85 % à 10 %. Ici elle
   * plafonne à quelques pourcents : un ou deux succès sur cent ne distinguent
   * rien, et un verdict rendu là-dessus dirait « pas de régression » quoi qu'il
   * arrive. La génération atteinte, elle, se calcule sur **toutes** les parties.
   *
   * Si la part de montées remonte un jour au milieu de l'échelle (écurie plus
   * grande, plafond plus haut), c'est elle qu'il faudra reprendre comme juge.
   */
  const [a, b, c] = climbed.map(mean);
  const delta = (x, y) => `${y - x >= 0 ? '+' : ''}${(y - x).toFixed(2)} gén.`;

  console.log('\nMoyenne sur les graines — génération atteinte :');
  console.log(`  A · vrac, niveau 1        ${a.toFixed(2)}`);
  console.log(`  B · suivies, niveau 1     ${b.toFixed(2)}   composition seule ${delta(a, b)}`);
  console.log(`  C · suivies, niveau ${EXIT_LEVEL}    ${c.toFixed(2)}   promotion livrée  ${delta(a, c)}`);

  // La résolution de la mesure : ce qu'on ne peut PAS voir avec ce réglage.
  const resolution = Math.max(...climbed.map(spread));
  console.log(
    `\n  Résolution : ${resolution.toFixed(2)} génération d'écart entre graines à réglage ` +
      `identique. Un effet plus petit que ça est invisible ici — il faudrait plus de parties.`
  );
  if (mean(reached[0]) < 0.1) {
    console.log(
      `  La part de montées en gen ${TARGET_GENERATION} plafonne à ` +
        `${(mean(reached[0]) * 100).toFixed(1)} % : trop bas pour juger, d'où le verdict sur la ` +
        `génération atteinte.`
    );
  }

  // Une demi-génération de perte est déjà un plan qui n'aboutit pas. La tolérance
  // ne descend pas sous la résolution : en dessous, on jugerait le bruit.
  const TOLERANCE = Math.max(0.25, resolution);
  if (c < a - TOLERANCE) {
    console.error(
      `\n✗ La promotion fait BAISSER la génération atteinte (${a.toFixed(2)} → ${c.toFixed(2)}), ` +
        `au-delà de la résolution. À revoir avant de fusionner.`
    );
    process.exit(1);
  }

  console.log(
    `\n✓ Aucune dégradation détectable : ${delta(a, c)} sur ${SEEDS.length} graines, pour une ` +
      `résolution de ${resolution.toFixed(2)}. La promotion ne coûte pas de génération — et un ` +
      `effet sous ${resolution.toFixed(2)} n'est pas mesuré.`
  );
} finally {
  rmSync(out, { recursive: true, force: true });
}
