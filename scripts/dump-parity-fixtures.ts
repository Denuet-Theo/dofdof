/**
 * Fige ce que le TypeScript répond, pour que le portage Rust ait quelque chose
 * à contredire.
 *
 * Le crate `rust/breeding-sim` rejoue les règles d'appariement des millions de
 * fois — ce que la neuroévolution exige et que cette boucle-ci ne tient pas.
 * Mais une seconde implémentation d'une règle **mesurée en jeu** est une
 * occasion de diverger en silence : les poids de lignée, le partage de la masse
 * d'échec et le régime « recopie » ont chacun coûté plusieurs relevés à établir,
 * et rien dans un `cargo test` ne les redécouvrirait tout seul.
 *
 * On tire donc des paires au hasard, on enregistre ce que `pairOutlook` et
 * `matingOutcomes` en disent, et `tests/parity.rs` exige l'égalité au
 * milliardième. Le TS fait foi : c'est lui qui porte les mesures.
 *
 * ## Le tirage est biaisé, exprès
 *
 * Uniformément sur les 120 couleurs du muldo, la moitié des cases tomberait en
 * génération 10 — les six cases d'une paire porteraient presque toujours un 10,
 * la cible viserait la génération 11, et `pairOutlook` répondrait `null` sur
 * l'écrasante majorité des cas. On ne mesurerait plus rien.
 *
 * On tire donc d'abord un **plafond** de génération, puis les couleurs en
 * dessous. Les cibles se répartissent alors sur tout le catalogue, et les cas
 * intéressants — recopie, raccourci, cible multiple — sortent en nombre.
 *
 * ## Ce qui n'est pas comparé
 *
 * Les génétons. Le crate Rust ne les porte pas : l'économie visée ne les
 * monnaie pas, et une valeur transportée sans être utilisée finit par être crue.
 *
 * ## Invocation
 *
 * ```sh
 * npx tsc scripts/dump-parity-fixtures.ts \
 *   --outDir "$SCRATCH/lib" --module commonjs --target es2020 \
 *   --moduleResolution node --esModuleInterop --skipLibCheck --resolveJsonModule
 * node "$SCRATCH/lib/scripts/dump-parity-fixtures.js" \
 *   rust/breeding-sim/tests/fixtures/outcomes.json
 * ```
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { matingOutcomes, pairOutlook, type Mate } from '../src/lib/dofus/breeding/pairing';
import { BREEDING_FAMILIES } from '../src/lib/dofus/breeding/trees';

const FAMILY_ID = 'muldo';
const CASE_COUNT = 5000;
const SEED = 20260808;

/** Le même générateur que `simulate.ts`, pour que le tirage se relise. */
const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const family = BREEDING_FAMILIES.find((candidate) => candidate.id === FAMILY_ID);
if (!family) throw new Error(`famille introuvable : ${FAMILY_ID}`);

const colors = family.colors;
const generations = new Map(colors.map((color) => [color.id, color.generation]));
const byGeneration = new Map<number, string[]>();
for (const color of colors) {
  const bucket = byGeneration.get(color.generation);
  if (bucket) bucket.push(color.id);
  else byGeneration.set(color.generation, [color.id]);
}
const topGeneration = Math.max(...generations.values());

const random = seededRandom(SEED);
const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)];
const pickColorUpTo = (ceiling: number): string => {
  const generation = 1 + Math.floor(random() * ceiling);
  return pick(byGeneration.get(generation) ?? byGeneration.get(1)!);
};

type SerialisedMate = { color: string; level: number; parents: [string, string] | null };

const makeMate = (ceiling: number): SerialisedMate => ({
  color: pickColorUpTo(ceiling),
  // Le taux ne dépend que de la somme des niveaux, mais on veut quand même
  // vérifier le plafond à 1 : deux niveaux 200 donnent 90 %, et rien ne monte
  // au-dessus par le niveau seul.
  level: 1 + Math.floor(random() * 200),
  // Une monture sur quatre est achetée ou capturée, donc sans ascendance. C'est
  // le cas qui fait basculer `lineageDistribution` sur sa branche courte.
  parents: random() < 0.25 ? null : [pickColorUpTo(ceiling), pickColorUpTo(ceiling)],
});

const toMate = (mate: SerialisedMate): Mate => ({
  id: null,
  colorId: mate.color,
  sex: 'M',
  level: mate.level,
  parents: mate.parents,
});

/**
 * Des cas construits à la main, en tête de fixture.
 *
 * Le tirage aléatoire couvre large mais ne garantit rien de précis. Ces
 * cinq-là sont les relevés en jeu qui ont fondé les règles ; s'ils passent
 * inaperçus dans le lot, une régression sur eux passerait inaperçue aussi.
 */
const named: { why: string; male: SerialisedMate; female: SerialisedMate }[] = [
  {
    why: 'relevé #59 : deux Ébène-Orchidée gen 2 d’ascendance Amande/Doré visent la gen 4',
    male: { color: 'ebene_orchidee', level: 61, parents: ['amande', 'dore'] },
    female: { color: 'ebene_orchidee', level: 61, parents: ['amande', 'dore'] },
  },
  {
    why: 'raccourci non plafonné : une gen 1 d’ascendance gen 9 vise la gen 10',
    male: { color: 'dore', level: 67, parents: ['ambre', 'dore'] },
    female: { color: 'dore', level: 67, parents: null },
  },
  {
    why: 'recopie #68 : deux Indigo capturés, aucune gen 2 ne les nomme',
    male: { color: 'indigo', level: 67, parents: null },
    female: { color: 'indigo', level: 67, parents: null },
  },
  {
    why: 'purification : la lignée se concentre à 100 %',
    male: { color: 'dore', level: 100, parents: ['dore', 'dore'] },
    female: { color: 'amande', level: 100, parents: ['amande', 'amande'] },
  },
  {
    why: 'au-dessus du plafond : une ascendance gen 10 des deux côtés ne vise rien',
    male: { color: 'dore', level: 67, parents: ['ambre_dore', 'dore'] },
    female: { color: 'dore', level: 67, parents: ['ambre_dore', 'dore'] },
  },
];

/**
 * La forme figée de la fixture, telle que `tests/parity.rs` la relit.
 *
 * Écrite explicitement plutôt que déduite : les deux implémentations se
 * rencontrent ici, et c'est le seul endroit du chantier où un champ renommé
 * d'un côté ne casse rien de l'autre — il ferait simplement passer la porte sur
 * des comparaisons vides.
 */
type ParityCase = {
  why?: string;
  male: SerialisedMate;
  female: SerialisedMate;
  outlook: {
    gen: number;
    leap: number;
    rate: number;
    targets: [string, number][];
  } | null;
  outcomes: [string, number, string][];
};

const cases: ParityCase[] = [];
let recopies = 0;
let shortcuts = 0;
let aboveCap = 0;
let multiTarget = 0;

const record = (male: SerialisedMate, female: SerialisedMate, why: string | null) => {
  const outlook = pairOutlook(toMate(male), toMate(female), colors, generations);
  const outcomes = matingOutcomes(toMate(male), toMate(female), colors, generations);

  if (!outlook) aboveCap += 1;
  else {
    if (outlook.targetColors.length === 0) recopies += 1;
    if (outlook.targetColors.length > 1) multiTarget += 1;
    if (outlook.leap > 0) shortcuts += 1;
  }

  // Les listes sont encodées en tuples plutôt qu'en objets nommés : à 5 000 cas
  // la répétition des clés pesait plus lourd que les données, et une fixture
  // versionnée qu'on hésite à régénérer parce qu'elle fait des mégaoctets finit
  // par ne plus l'être. `targets` est `[couleur, poids]`, `outcomes` est
  // `[couleur, probabilité, 't' | 'o']`.
  cases.push({
    ...(why ? { why } : {}),
    male,
    female,
    outlook: outlook
      ? {
          gen: outlook.targetGeneration,
          leap: outlook.leap,
          rate: outlook.successRate,
          targets: outlook.targetColors.map(
            (target): [string, number] => [target.colorId, target.weight]
          ),
        }
      : null,
    outcomes: outcomes.map(
      (outcome): [string, number, string] => [
        outcome.colorId,
        outcome.probability,
        outcome.kind === 'target' ? 't' : 'o',
      ]
    ),
  });
};

for (const entry of named) record(entry.male, entry.female, entry.why);
while (cases.length < CASE_COUNT) {
  // Le plafond monte jusqu'au sommet une fois sur dix, pour que le refus de
  // viser une génération 11 soit couvert par le tirage et pas seulement par le
  // cas nommé. Le reste du temps il s'arrête en dessous, sans quoi la moitié du
  // lot ne mesurerait plus qu'un `null`.
  const ceiling =
    random() < 0.1 ? topGeneration : 1 + Math.floor(random() * (topGeneration - 1));
  record(makeMate(ceiling), makeMate(ceiling), null);
}

const output = resolve(
  process.argv[2] ?? 'rust/breeding-sim/tests/fixtures/outcomes.json'
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify({
    family: FAMILY_ID,
    seed: SEED,
    note: 'Généré par scripts/dump-parity-fixtures.ts. Le TypeScript fait foi.',
    cases,
  })
);

console.log(`${cases.length} cas écrits dans ${output}`);
console.log(
  `couverture : ${recopies} recopies, ${shortcuts} raccourcis, ${multiTarget} cibles multiples, ${aboveCap} au-dessus du plafond`
);
