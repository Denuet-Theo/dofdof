/**
 * Toute écriture qui part vers Supabase dit-elle ce qu'elle a fait ?
 *
 * ```sh
 * node scripts/check-writes.mjs
 * ```
 *
 * ## La panne que cette garde attrape
 *
 * Elle s'est produite **quatre fois**, et jamais deux fois sous la même forme.
 *
 * Le 15/08, une insertion de 22 naissances a échoué : la stérilisation des
 * parents est passée quand même, la fenêtre s'est refermée en annonçant que
 * c'était fait, et l'erreur est partie dans un `console.error`. 22 montures
 * perdues, découvertes le lendemain en comparant l'écurie du jeu à celle de
 * l'outil — 203 contre 225. C'est ce qui a produit `write-failures.ts`.
 *
 * Le 23/08, une fournée de six enclos sortie en fécondes a écrit dix lignes sur
 * soixante, **sans une seule erreur**. Deux causes distinctes, l'une et l'autre
 * muettes :
 *
 * 1. `recordEnclosExit` sautait en silence toute monture que l'écurie ne pouvait
 *    plus donner, puis se déclarait complète — l'enclos quittait la fournée sur
 *    des montures que rien n'avait enregistrées (#271) ;
 * 2. PostgREST rend un **succès** à un `update … in(…)` qui ne trouve aucune
 *    ligne, et les quinze points d'écriture filtrée de l'app lisaient ce succès
 *    comme « c'est écrit » (#272).
 *
 * ## Pourquoi une garde et pas de la vigilance
 *
 * Les quatre fois, le code était correct à la relecture : la requête partait, le
 * corps était juste, la table était la bonne. Ce qui manquait était une
 * **absence** — personne ne demandait le résultat — et une absence ne se voit
 * pas dans un diff. Les trois premiers correctifs ont d'ailleurs été des
 * rustines locales qui ont laissé les autres appels intacts, faute d'avoir
 * cherché la classe.
 *
 * D'où les deux règles, qui sont celles qu'`AGENTS.md` appelle rendre la classe
 * irreprésentable :
 *
 * > **1.** Toute écriture Supabase doit faire suivre son échec à
 * >    `reportWriteFailure` ou `touchedRows` — ou le relancer à un appelant qui
 * >    le fait. Un `console.error` ne compte pas : la console est fermée depuis
 * >    des heures quand l'éleveur s'en aperçoit.
 * >
 * > **2.** Tout `update` et tout `delete` **filtré** doit chaîner `.select()` et
 * >    passer son résultat à `touchedRows`. Sans ça, « dix lignes écrites » et
 * >    « aucune de ces dix lignes n'existe » sont la même réponse.
 *
 * Les exceptions sont nommées ci-dessous, une par une, avec leur raison. Une
 * exception non écrite ici fait échouer la garde — c'est le but : elle force à
 * défendre le silence plutôt qu'à le laisser passer.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'src');

/**
 * Ce qu'on considère comme une écriture.
 *
 * `rpc` en fait partie : une fonction SQL écrit, et `sell_lots` est celle qui
 * marque une vente faite. Qu'elle lève une exception quand la vente n'existe
 * plus est une **bonne** chose — c'est justement ce que la règle 2 demande à un
 * `update` — mais ça ne dispense pas de relayer l'échec.
 */
const WRITE = /\.(insert|upsert|update|rpc)\s*\(|\.delete\(\)/;

/**
 * Les écritures qu'un `update`/`delete` filtré doit confronter à la base.
 *
 * `.delete()` **sans argument** : c'est la forme du constructeur de requêtes, et
 * c'est ce qui la sépare de `Map.delete(clé)`, `Set.delete(valeur)` ou
 * `URLSearchParams.delete('nom')`, qui abondent ici et n'ont rien à voir.
 */
const FILTERED = /\.update\s*\(|\.delete\(\)/;

/**
 * La marque d'une requête Supabase autour de l'appel.
 *
 * Sans elle, la garde criait sur `ladder.wanted.delete(colorId)` et sur trois
 * autres tables de travail en mémoire — et une garde qui crie à tort s'apprend à
 * ignorer, ce qui la rend pire qu'absente.
 */
const SUPABASE = /\.from\(|supabase\.rpc\(/;

/**
 * Le silence assumé, fichier par fichier et raison par raison.
 *
 * Chaque entrée dit **pourquoi** l'absence de réponse n'est pas une perte. Un
 * ajout ici est une décision, pas une formalité : la question à se poser est
 * « si cette écriture ne touche rien, l'éleveur peut-il s'en apercevoir ? ».
 */
const ALLOWED = [
  {
    file: 'lib/hooks/useBreedingBatch.ts',
    match: "from('breeding_batch').delete()",
    why: 'Vise « plus de ligne » : ne rien trouver est l’état voulu, pas une écriture perdue.',
  },
  {
    file: 'app/api/dofusdb/farm/route.ts',
    match: 'supabase.rpc(',
    why: 'Lecture : `farm_targets` calcule des cibles, elle n’écrit rien. La route rend une 500 explicite que l’écran affiche.',
  },
  {
    file: 'app/api/dofusdb/farm/zones/route.ts',
    match: 'supabase.rpc(',
    why: 'Lecture : `farm_zones` agrège des zones, elle n’écrit rien. Même route d’erreur.',
  },
  {
    file: 'lib/hooks/usePriceSuggestions.ts',
    match: 'supabase.rpc(',
    why: 'Lecture : `price_suggestions` classe des recettes, elle n’écrit rien.',
  },
  {
    file: 'lib/hooks/useCounters.ts',
    match: "from('user_counters').delete()",
    why: 'Idem — la case doit disparaître ; une case déjà absente est le résultat attendu. Le refus, lui, remet la case à l’écran.',
  },
];

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
};
walk(ROOT);

/**
 * Les lignes qui suivent un appel, jusqu'à ce que son résultat soit traité.
 *
 * Vingt-cinq lignes, et non l'unité syntaxique : les écritures d'ici sont
 * multi-lignes, leur résultat se lit trois à trente lignes plus bas, et un
 * analyseur complet coûterait plus que ce qu'il attraperait. La fenêtre est
 * volontairement large — la garde préfère laisser passer un cas tordu que crier
 * sur du code juste, parce qu'une garde qu'on apprend à ignorer ne garde rien.
 */
const WINDOW = 25;

const problems = [];

for (const full of files) {
  const relative = path.relative(ROOT, full).split(path.sep).join('/');
  const lines = readFileSync(full, 'utf8').split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!WRITE.test(line)) continue;
    // Les définitions de types et les commentaires ne partent pas sur le réseau.
    if (/^\s*(\*|\/\/)/.test(line)) continue;

    // Une requête, et non une table de travail en mémoire : la chaîne doit
    // nommer sa table.
    const chain = lines.slice(Math.max(0, index - 8), index + 4).join('\n');
    if (!SUPABASE.test(chain)) continue;

    const context = lines.slice(index, index + WINDOW).join('\n');
    // Le contexte remonte aussi : `const { error } = await supabase` précède
    // souvent l'appel de plusieurs lignes quand la requête est chaînée.
    const around = lines.slice(Math.max(0, index - WINDOW), index + WINDOW).join('\n');

    const excused = ALLOWED.find(
      (entry) => relative === entry.file && line.includes(entry.match)
    );
    if (excused) continue;

    const relayed =
      /reportWriteFailure\s*\(|touchedRows\s*\(|revertOnFailure\s*\(|throw\s/.test(around) ||
      // Une écriture rendue à l'appelant qui, lui, la relaie.
      /return\s+\{\s*ok:\s*false/.test(around);
    if (!relayed) {
      problems.push({
        relative,
        line: index + 1,
        rule: 1,
        text: line.trim(),
        say: 'l’échec ne va ni à `reportWriteFailure` ni à `touchedRows` ni à `revertOnFailure`',
      });
    }

    /**
     * Clause 2 de la règle d'or : ce qui est posé en avance revient.
     *
     * On cherche un poseur d'état **avant** l'écriture — c'est ça, une écriture
     * optimiste — et on exige alors que le résultat passe par une porte qui
     * prend un `Undo`. Le type rend l'oubli impossible à compiler ; cette règle
     * attrape l'autre moitié, celle où l'appelant a court-circuité la porte et
     * s'est contenté d'un `reportWriteFailure`.
     *
     * Les poseurs de confort — `setLoading`, `setError`, `setSaving` — ne
     * décrivent pas l'écurie : ils ne comptent pas.
     */
    // Bornée à la fonction englobante : une fenêtre de taille fixe traversait
    // les frontières et accusait `saveSettings` du `setItemStock` de la fonction
    // d'au-dessus. Une garde qui accuse à tort s'apprend à ignorer.
    let start = index;
    while (start > 0 && !/^\s{0,4}(const|function|export)\s+\w+/.test(lines[start - 1])) {
      start -= 1;
    }
    const before = lines.slice(start, index).join('\n');
    const posted = [...before.matchAll(/\bset([A-Z]\w*)\s*\(/g)]
      .map((hit) => hit[1])
      // Les poseurs de confort ne décrivent pas l'écurie : un spinner, un
      // message, une fenêtre ouverte n'ont rien à défaire.
      .filter((name) => !/Loading|Error|Saving|Running|Open|Busy|Pending|Modal|Dialog/.test(name));
    if (posted.length > 0) {
      const goesThroughDoor = /touchedRows\s*\(|revertOnFailure\s*\(/.test(context);
      if (!goesThroughDoor) {
        problems.push({
          relative,
          line: index + 1,
          rule: 3,
          text: line.trim(),
          say:
            `\`set${posted[0]}\` pose l’état avant l’écriture, et le résultat ne passe ` +
            'pas par `touchedRows`/`revertOnFailure` : rien ne dit ce qu’il faut défaire',
        });
      }
    }

    if (!FILTERED.test(line)) continue;
    // Un `update`/`delete` doit demander ce qu'il a changé, et le confronter.
    const asks = /\.select\s*\(/.test(context);
    const confronts = /touchedRows\s*\(/.test(context);
    if (!asks || !confronts) {
      problems.push({
        relative,
        line: index + 1,
        rule: 2,
        text: line.trim(),
        say: asks
          ? 'le résultat n’est pas passé à `touchedRows`'
          : 'pas de `.select()` : impossible de savoir combien de lignes ont changé',
      });
    }
  }
}

if (problems.length === 0) {
  const excused = ALLOWED.length;
  console.log(
    `check-writes : ${files.length} fichiers, aucune écriture muette ` +
      `(${excused} silence${excused > 1 ? 's' : ''} assumé${excused > 1 ? 's' : ''}).`
  );
  process.exit(0);
}

console.error(`check-writes : ${problems.length} écriture(s) muette(s).\n`);
for (const problem of problems) {
  console.error(`  règle ${problem.rule} — ${problem.relative}:${problem.line}`);
  console.error(`    ${problem.text}`);
  console.error(`    ${problem.say}\n`);
}
console.error(
  'Une écriture qui ne dit pas ce qu’elle a fait est une écriture perdue : le 15/08\n' +
    'elle a coûté 22 montures, le 23/08 une fournée de six enclos. Fais-la parler,\n' +
    'ou inscris son silence dans `ALLOWED` avec sa raison.'
);
process.exit(1);
