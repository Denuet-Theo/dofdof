/**
 * Tout saisir ne doit pas en découvrir d'autres.
 *
 *   node scripts/check-record-fixpoint.mjs
 *
 * ## Ce que la liste promet
 *
 * `couplesToRecordAll` promet **tous** les accouplements réalisables tout de
 * suite, et pas une tranche. La promesse est vérifiable : on saisit tout ce qu'elle
 * rend, on refait exactement ce que `recordBirths` écrit en base, on replanifie, et
 * il ne doit rien rester.
 *
 * Elle ne l'était pas. La boucle simulait la **moitié** du geste — les deux parents
 * consommés, jamais le poulain arrivé — donc elle convergeait sur une écurie qui
 * s'était vidée sans rien produire. La vraie replanification voyait les poulains et
 * arbitrait autrement, d'où des couples qui « repoussaient » au rafraîchissement.
 *
 * ## Les deux régimes, parce que les clonages comptent
 *
 * L'écran planifie les accouplements sur l'écurie **d'après les clonages** (#223) :
 * vingt clonages rendent vingt fertiles et font changer d'avis la politique. La
 * garde joue donc les deux régimes, et surveille les deux — un correctif qui
 * viderait la liste dans l'un en la faisant repousser dans l'autre n'en est pas un.
 *
 * Une reprojection des clonages **à chaque passe** a été essayée et jetée : elle
 * fait passer le résidu de 0 à 1 sur cette écurie. La boucle ne peut pas prévoir
 * quels clonages la saisie va rendre possibles, parce qu'elle ne sait pas quelles
 * montures seront devenues stériles ni lequel des deux clones le jeu rendra.
 *
 * ## La limite, et elle est réelle
 *
 * On rejoue le cas **sur la cible** : chaque croisement donne la couleur visée.
 * C'est le seul cas où la boucle peut être exacte, puisqu'elle ne peut pas savoir
 * ce que le jeu va tirer. Une naissance hors cible laisse une autre écurie et un
 * résidu reste possible ; il est mesuré à un couple sur l'écurie du 15/08, et il
 * est borné par construction — une vague non vide consomme deux fécondes et rien
 * ici n'en rend.
 *
 * Cette garde vérifie donc la moitié démontrable, ce qui est déjà ce qui manquait :
 * sans elle, retirer `projectBirths` ne fait rougir **aucun** test du dépôt — les
 * specs de navigateur restent vertes sur la fixture du 15/08, faute d'y produire
 * une égalité de valeur au bon endroit.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, compile, load } from './lib/tsc.mjs';

const out = compile(
  'record-fixpoint',
  ['src/lib/dofus/breeding/policy.ts', 'src/lib/dofus/breeding/random.ts'],
  { json: true }
);

const { stablePlan, couplesToRecord, couplesToRecordAll } = await load(out, 'policy.js');
const { copyStable, consumeCouples } = await load(out, 'stable.js');
const { cloneOptions, afterClonings } = await load(out, 'cloning.js');

const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const trees = read('src/lib/dofus/breeding/trees.json');
const colors = trees.families.find((family) => family.id === 'muldo').colors;
const generationOf = new Map(colors.map((color) => [color.id, color.generation]));

const CAPACITY = 60;
const gen1 = colors.filter((color) => color.generation === 1);

const buildStable = () => {
  const bulk = new Map(
    gen1.map((color) => [
      color.id,
      { males: 6, females: 6, cycledMales: 4, cycledFemales: 4 },
    ])
  );
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
    add(color, 'F', true, true, `G2 ${short(color)} F`);
    add(color, 'M', false, false, `G2 ${short(color)} S1`);
    add(color, 'F', false, false, `G2 ${short(color)} S2`);
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

const cheapestAt = (generation) => price(generation);
const cloneContext = {
  generations: generationOf,
  costOf: (colorId) => price(generationOf.get(colorId) ?? 1),
  cheapestAt,
  sacrificeUnitValue: market.genetonValue,
  objective: null,
  allowAnonymous: false,
};

const inputFor = (stable, withClonings) => ({
  stable: withClonings
    ? afterClonings(stable, cloneOptions(stable, cloneContext, Number.POSITIVE_INFINITY))
    : stable,
  colors,
  market,
  capacity: CAPACITY,
  loadKamas: 150_000,
  kamas: 30_000_000,
});

/**
 * Ce que `recordBirths` écrit vraiment, rejoué sur une écurie de travail : les
 * deux parents stériles **et non cyclés**, et un poulain de la couleur visée qui
 * porte l'ascendance de ses deux parents.
 */
const applyRecording = (stable, couples) => {
  const next = copyStable(stable);
  consumeCouples(next, couples, { spendCycled: true });
  for (const couple of couples) {
    for (const side of [couple.male, couple.female]) {
      if (!side.mountId) continue;
      const mount = next.individuals.find((candidate) => candidate.id === side.mountId);
      if (mount) mount.cycled = false;
    }
  }
  couples.forEach((couple, index) => {
    next.individuals.push({
      id: `ne-${index}`,
      colorId: couple.targetColorId,
      name: `NE ${index}`,
      sex: index % 2 === 0 ? 'M' : 'F',
      level: 1,
      fertile: true,
      cycled: false,
      parents: [couple.male.colorId, couple.female.colorId],
    });
  });
  return next;
};

/** Ce qui repousse après avoir tout saisi, dans un régime donné. */
const residueOf = (withClonings) => {
  const stable = buildStable();
  const promised = couplesToRecordAll(inputFor(stable, withClonings));
  const after = applyRecording(stable, promised);
  const plan = stablePlan(inputFor(after, withClonings));
  return { promised: promised.length, left: plan ? couplesToRecord(plan).length : 0 };
};

const plain = residueOf(false);
const withClones = residueOf(true);

console.log(`  sans clonages                  : ${plain.promised} proposés, ${plain.left} qui repoussent`);
console.log(`  clonages projetés à l'entrée   : ${withClones.promised} proposés, ${withClones.left} qui repoussent`);

const problems = [];

// La moitié démontrable : à écurie qui ne change que par les naissances, le point
// fixe est exact. C'est cette assertion que `projectBirths` fait tenir.
if (plain.left !== 0) {
  problems.push(
    `sans clonages, ${plain.left} couple(s) repoussent alors que la boucle promettait tout : ` +
      'la simulation de la saisie est incomplète (voir `projectBirths`).'
  );
}

// Et l'autre régime aussi, celui de l'écran : les accouplements y sont planifiés
// sur l'écurie **d'après les clonages** (#223).
//
// Zéro y est exigé parce que zéro y est vrai, pas parce que ce serait garanti. Ce
// régime a porté un résidu de 1 avant #224 — les clonages que la saisie rend
// possibles dépendent de quelles montures sont devenues stériles, et le survivant
// d'un clonage est un tirage. S'il repasse à 1, la réponse n'est pas de relever la
// borne : c'est de comprendre ce qui a fait dériver le modèle de la saisie par
// rapport à ce que `recordBirths` écrit. Une borne large ne garde plus rien —
// mesuré, elle laissait passer le retrait de `projectBirths`.
if (withClones.left !== 0) {
  problems.push(
    `avec les clonages projetés à l'entrée, ${withClones.left} couple(s) repoussent alors ` +
      'que la boucle promettait tout.'
  );
}

if (problems.length > 0) {
  console.error('\n' + problems.join('\n'));
  process.exit(1);
}

console.log('\ntout saisir vide la liste, dans les deux régimes : le point fixe en est un');
