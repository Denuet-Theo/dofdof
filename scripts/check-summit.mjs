/**
 * La frontière du sommet tient-elle encore ?
 *
 * ```sh
 * node scripts/check-summit.mjs
 * ```
 *
 * Une gen 10 ne monte plus : `climbs` rend `false` sur tout croisement qui
 * l'emploie, donc `aimsAt` les refusait tous. C'est juste tant que la cible est
 * un barreau à gravir, et faux dès que la cible **est** le sommet — l'éleveur
 * qui vise Azur-Doré ne voyait aucune tentative alors que ses gen 10 azurées la
 * nommaient jusqu'à 13,95 %.
 *
 * `SummitRule` ouvre exactement une porte, et ce script en verrouille les deux
 * montants :
 *
 * > **`'target'` admet un croisement du sommet si et seulement si ses couleurs
 * > possibles nomment une couleur de `ladder.summit`.**
 *
 * Ni plus — la boucle du forum, qui accumule des gen 10 pour les vendre, reste
 * `'all'` et reste éteinte — ni moins. Les deux erreurs sont silencieuses à
 * l'écran : trop peu et la cible devient inatteignable sans que rien ne le dise,
 * trop et la politique se met à dupliquer du sommet que le marché n'absorbe pas.
 *
 * Le test de bout en bout `e2e/summit-target.spec.ts` tient le même contrat sur
 * deux couleurs. Celui-ci le tient sur **toutes** les gen 10 des trois familles,
 * ce qu'un navigateur ne ferait pas en moins de trois minutes.
 */

import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const out = mkdtempSync(join(tmpdir(), 'dofdof-summit-'));
// Le compilateur par son point d'entrée et non par `npx` : sous Windows `npx`
// est un `.cmd`, que `spawnSync` refuse de lancer sans shell depuis Node 20.12.
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

const { crownedLadderOf, aimsAt } = await import(pathToFileURL(join(out, 'ladder.js')).href);
const { pairOutlook } = await import(pathToFileURL(join(out, 'pairing.js')).href);

const trees = JSON.parse(readFileSync(join(ROOT, 'src/lib/dofus/breeding/trees.json'), 'utf8'));

let failures = 0;
const fail = (message) => {
  console.error(`ÉCHEC — ${message}`);
  failures += 1;
};

for (const family of trees.families) {
  const colors = family.colors;
  const generations = new Map(colors.map((color) => [color.id, color.generation]));
  const top = Math.max(...generations.values());
  const summits = colors.filter((color) => color.generation === top);
  if (summits.length === 0) {
    fail(`${family.id} : aucune couleur au sommet.`);
    continue;
  }

  // La couronne est posée sur la première gen 10 couronnable, et c'est elle qui
  // décide de ce que `'target'` doit admettre. Le prix est constant : sans cible
  // saisie il départagerait les gen 10 entre elles, ce qui n'est pas ce qu'on
  // mesure ici.
  const target = summits.find((color) =>
    crownedLadderOf(colors, () => 1000, undefined, color.id).summit.includes(color.id)
  );
  if (!target) {
    fail(`${family.id} : aucune gen ${top} couronnable.`);
    continue;
  }
  const ladder = crownedLadderOf(colors, () => 1000, undefined, target.id);

  // Une gen 1 quelconque comme partenaire : c'est le cas du jeu — on marie la
  // gen 10 à ce qu'on a sous la main — et c'est celui qui a été remonté.
  const starters = colors.filter((color) => color.generation === 1);
  let admitted = 0;
  let refused = 0;

  for (const color of summits) {
    const mate = { colorId: color.id, parents: color.recipes[0] ?? null, level: 100 };
    for (const starter of starters) {
      const partner = { colorId: starter.id, parents: null, level: 100 };
      const outlook = pairOutlook(partner, mate, colors, generations);
      if (!outlook) continue;

      const names = outlook.targetColors.some((entry) => ladder.summit.includes(entry.colorId));
      const aimed = aimsAt(partner, mate, colors, generations, ladder, 'target');

      // Le seul et unique critère. Les deux sens comptent : une porte trop
      // étroite rend la cible inatteignable, une porte trop large rouvre la
      // boucle.
      if (names && aimed === null) {
        fail(`${family.id} : ${color.id} × ${starter.id} nomme ${target.id} et n'est pas admis.`);
      }
      if (!names && aimed !== null) {
        fail(`${family.id} : ${color.id} × ${starter.id} ne nomme pas ${target.id} et passe.`);
      }
      // Et ce qu'il rend est la cible elle-même, pas la couleur la plus
      // probable : c'est ce que l'écran affiche comme visé.
      if (aimed !== null && !ladder.summit.includes(aimed)) {
        fail(`${family.id} : ${color.id} × ${starter.id} vise ${aimed}, hors sommet du plan.`);
      }

      // `'hold'` est le défaut du modèle et ne bouge pas.
      if (aimsAt(partner, mate, colors, generations, ladder, 'hold') !== null) {
        fail(`${family.id} : ${color.id} × ${starter.id} passe en 'hold'.`);
      }
      // `'all'` est la boucle du forum : elle admet tout ce qui est au sommet,
      // et c'est très exactement ce qu'on refuse d'allumer.
      if (aimsAt(partner, mate, colors, generations, ladder, 'all') === null) {
        fail(`${family.id} : ${color.id} × ${starter.id} refusé même en 'all'.`);
      }

      if (aimed !== null) admitted += 1;
      else refused += 1;
    }
  }

  if (admitted === 0) {
    fail(`${family.id} : aucune tentative admise, la cible ${target.id} est inatteignable.`);
  }

  console.log(
    `${family.id.padEnd(11)} · cible ${target.id} · ${summits.length} couleurs au sommet · ` +
      `croisements gen ${top} × gen 1 : ${admitted} admis, ${refused} refusés`
  );
}

if (failures > 0) {
  console.error(`\n${failures} règle${failures > 1 ? 's' : ''} violée${failures > 1 ? 's' : ''}.`);
  process.exit(1);
}
console.log('\nle sommet n’admet que ce qui nomme la cible du plan');
