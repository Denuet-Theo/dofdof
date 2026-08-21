/**
 * Combien de questions faut-il pour retrouver un écart entre l'app et le jeu ?
 *
 *   node scripts/check-reconcile.mjs
 *
 * ## Pourquoi ce chiffre est la garde
 *
 * L'instrument tient une promesse et une seule : **le moins de questions
 * possible**. Un outil de rapprochement qui en demande quarante ne se fait pas —
 * l'éleveur compte deux cents montures à la main, ce qui est exactement ce qu'on
 * essaie d'éviter. `tsc` ne voit pas ça, un test d'écran non plus : ils
 * vérifient que l'écran affiche une question, pas qu'il en pose peu.
 *
 * On joue donc la partie en entier contre une écurie de jeu simulée, on répond
 * aux questions par le compte réel, et on mesure. Une régression sur l'ordre des
 * axes ou sur la déduction se voit immédiatement : le nombre monte.
 *
 * ## Comment le jeu est simulé
 *
 * L'écurie du 15/08 est prise pour ce que l'app tient. Le « jeu » en est une
 * copie qu'on abîme : on retire des montures, on en change l'état. Les réponses
 * sont alors exactes par construction, ce qui est le point — on mesure la
 * recherche, pas la capacité de l'éleveur à compter.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, compile, load } from './lib/tsc.mjs';

const out = compile('reconcile', ['src/lib/dofus/breeding/reconcile.ts'], { json: true });
const { censusRoot, nextProbe, recordAnswer, pinned, asked, NAME_THRESHOLD } = await load(
  out,
  'reconcile.js'
);
const { rosterOf, matches, countOf } = await load(out, 'roster.js');

const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const trees = read('src/lib/dofus/breeding/trees.json');
const colors = trees.families.find((family) => family.id === 'muldo').colors;
const byId = new Map(colors.map((color) => [color.id, color]));
const generationOf = (colorId) => byId.get(colorId)?.generation ?? 1;
const nameOf = (colorId) => byId.get(colorId)?.name ?? colorId;

const tables = read('e2e/fixtures/muldo-stable.json');
const individuals = tables['user_breeding_individuals'].map((row) => ({
  id: row.id,
  colorId: row.color_id,
  name: row.name ?? null,
  sex: row.sex,
  level: row.level,
  fertile: row.fertile,
  cycled: row.cycled ?? false,
  parents:
    row.parent_a_color && row.parent_b_color
      ? [row.parent_a_color, row.parent_b_color]
      : null,
}));
const bulk = new Map(
  (tables['user_breeding_mounts'] ?? [])
    .filter((row) => row.males > 0 || row.females > 0)
    .map((row) => [
      row.color_id,
      {
        males: row.males,
        females: row.females,
        cycledMales: row.cycled_males ?? 0,
        cycledFemales: row.cycled_females ?? 0,
      },
    ])
);

const appEntries = rosterOf({ bulk, individuals }, generationOf);

/** Joue la recherche jusqu'au bout contre une écurie de jeu donnée. */
const play = (gameIndividuals) => {
  const gameEntries = rosterOf({ bulk, individuals: gameIndividuals }, generationOf);
  const countGame = (cell) =>
    countOf(gameEntries.filter((entry) => matches(entry, cell, nameOf)));

  let root = censusRoot(appEntries, nameOf);
  let questions = 0;
  // Borne dure : une recherche qui ne converge pas doit échouer bruyamment
  // plutôt que tourner. Deux cents questions, c'est déjà l'aveu.
  for (let guard = 0; guard < 200; guard += 1) {
    const probe = nextProbe(root, appEntries, nameOf);
    if (!probe) break;
    // Une question = une colonne entière, telle que le panneau du jeu l'affiche.
    const seen = probe.cells.map((cell) => countGame(cell.cell));
    const colle = seen.every((count, index) => count === probe.cells[index].held);
    questions += 1;
    root = recordAnswer(
      root,
      probe,
      colle ? { ok: true } : { ok: false, seen },
      appEntries,
      nameOf
    );
  }
  return { questions, cells: pinned(root, nameOf) };
};

/** Retire `n` montures qui partagent une facette, pour simuler un écart net. */
const without = (predicate, n) => {
  let left = n;
  const removed = [];
  const kept = individuals.filter((mount) => {
    if (left > 0 && predicate(mount)) {
      left -= 1;
      removed.push(mount);
      return false;
    }
    return true;
  });
  if (left > 0) throw new Error(`pas assez de montures pour retirer ${n}`);
  return { kept, removed };
};

const rows = [];
const problems = [];

const scenario = (label, gameIndividuals, removed) => {
  const { questions, cells } = play(gameIndividuals);
  const total = cells.reduce((sum, cell) => sum + Math.abs(cell.held - cell.seen), 0);
  rows.push({ label, questions, cells: cells.length, ecart: total });

  // Chaque disparue doit tomber dans une cellule pointée : une recherche qui
  // s'arrête à côté est pire qu'une recherche longue.
  for (const mount of removed) {
    const inside = cells.some((cell) =>
      matches(
        {
          colorId: mount.colorId,
          generation: generationOf(mount.colorId),
          sex: mount.sex,
          status: mount.fertile ? (mount.cycled ? 'feconde' : 'fertile') : 'sterile',
          level: mount.level,
          name: mount.name,
          mount,
          count: 1,
        },
        cell.cell,
        nameOf
      )
    );
    if (!inside) problems.push(`${label} : ${mount.name ?? 'Anonyme'} n'est dans aucune cellule`);
  }
  return { questions, cells };
};

/*
 * Tout colle : le total, puis les quatre marges. C'est le cas courant, et c'est
 * le chiffre qui décide si l'outil se fait ou non.
 *
 * Une seule question — le total — coûterait moins cher et ne **validerait
 * rien** : c'est exactement ce que mesurait la première version, qui déclarait
 * saine une écurie où quatre fécondes étaient saisies fertiles.
 */
const parfait = play(individuals);
rows.push({ label: 'aucun écart', questions: parfait.questions, cells: 0, ecart: 0 });
const MARGES = 5;
if (parfait.questions > MARGES) {
  problems.push(
    `une écurie qui colle demande ${parfait.questions} questions, au-delà des ${MARGES} marges`
  );
}
if (parfait.cells.length > 0) {
  problems.push('une écurie qui colle pointe des cellules — faux positif');
}

const un = without((mount) => mount.fertile && !mount.cycled && mount.name, 1);
scenario('1 fertile nommée en moins', un.kept, un.removed);

const cinq = without((mount) => !mount.fertile && mount.name, 5);
scenario('5 stériles nommées en moins', cinq.kept, cinq.removed);

const melange = without((mount) => mount.sex === 'F', 3);
scenario('3 femelles en moins', melange.kept, melange.removed);

// Un état changé plutôt qu'une disparition : le total colle, l'écart est
// interne. C'est le cas que le total seul ne peut pas voir.
let aBasculer = 4;
const bascule = individuals.map((mount) => {
  if (aBasculer > 0 && mount.fertile && mount.cycled) {
    aBasculer -= 1;
    return { ...mount, cycled: false };
  }
  return mount;
});
if (aBasculer > 0) throw new Error('pas assez de fécondes pour le scénario');
const etat = scenario('4 fécondes devenues fertiles', bascule, []);
// Le cas que le total seul ne peut pas voir : si la recherche ne pointe rien,
// l'outil donne une fausse assurance, ce qui est pire que de ne rien dire.
if (etat.cells.length === 0) {
  problems.push('4 fécondes saisies fertiles ne sont pas trouvées — le total les cache');
}

/*
 * Le total dément, et toutes les colonnes d'accord : une réponse qui doit
 * ressortir.
 *
 * Les scénarios ci-dessus répondent d'après une écurie simulée, donc leurs
 * réponses sont cohérentes par construction : un écart au total s'y lit toujours
 * aussi dans une colonne. Celui-là ne peut donc venir que d'une main — c'est
 * l'éleveur qui dit « le jeu en montre un de moins » puis « les quatre colonnes
 * collent ». Contradictoire, et c'est justement pour ça qu'il faut le dire :
 * la version précédente prenait le chiffre et concluait que tout collait.
 */
{
  let root = censusRoot(appEntries, nameOf);
  const total = nextProbe(root, appEntries, nameOf);
  root = recordAnswer(root, total, { ok: false, seen: [total.cells[0].held - 1] }, appEntries, nameOf);
  for (let guard = 0; guard < 10; guard += 1) {
    const probe = nextProbe(root, appEntries, nameOf);
    if (!probe) break;
    root = recordAnswer(root, probe, { ok: true }, appEntries, nameOf);
  }
  const cells = pinned(root, nameOf);
  rows.push({ label: 'total démenti, colonnes d’accord', questions: asked(root), cells: cells.length, ecart: 1 });
  if (cells.length !== 1 || cells[0].held - cells[0].seen !== 1) {
    problems.push(
      'un total démenti que rien ne confirme passe au vert — la réponse est prise puis perdue'
    );
  }
}

console.log('écurie du 15/08 · 203 montures suivies · seuil de lecture nominative :', NAME_THRESHOLD);
console.log('');
console.log('scénario                          questions   cellules   écart');
console.log('-------------------------------------------------------------');
for (const row of rows) {
  console.log(
    `${row.label.padEnd(32)} ${String(row.questions).padStart(6)} ${String(row.cells).padStart(10)} ${String(row.ecart).padStart(7)}`
  );
}

// Le plafond : au-delà, l'outil ne tient plus sa promesse et il vaut mieux le
// dire que de laisser dériver. Deux cents montures se recensent à la main en
// une soirée ; c'est ce qu'on doit rester très en dessous.
const CEILING = 12;
for (const row of rows) {
  if (row.questions > CEILING) {
    problems.push(`« ${row.label} » demande ${row.questions} questions — au-delà de ${CEILING}`);
  }
}

if (problems.length > 0) {
  console.error('\n' + problems.map((line) => `  ✗ ${line}`).join('\n'));
  process.exit(1);
}

console.log('\nune écurie saine coûte les 5 marges, et chaque écart se localise sous le plafond');
