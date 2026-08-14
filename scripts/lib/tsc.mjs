/**
 * Compiler un module du portage pour le comparer au Rust.
 *
 * Les six gardes de parité font toutes le même geste : prendre un module
 * TypeScript de `src/lib/dofus/breeding`, le compiler seul dans un répertoire
 * jetable, et l'importer. Le geste était recopié dans chacune, avec ses onze
 * drapeaux — et il était cassé de deux façons sous Windows, donc cassé cinq
 * fois.
 *
 * ## Les deux pannes, pour qu'elles ne reviennent pas
 *
 * **`.pathname` n'est pas un chemin.** `new URL('..', import.meta.url).pathname`
 * rend `/C:/Users/...` sous Windows ; `join` en fait `\C:\Users\...`, que `tsc`
 * refuse. La garde s'arrêtait avant d'avoir rien comparé, sur un message qui
 * parlait de champion absent. `fileURLToPath` est la fonction prévue pour ça.
 *
 * **`npx` n'est pas un exécutable.** Sous Windows c'est un `.cmd`, et Node
 * refuse depuis la 20.12 de lancer un `.cmd` sans shell (CVE-2024-27980) :
 * `EINVAL`, `pid: 0`, aucune mention de la cause. Plutôt que d'ouvrir un shell
 * et d'échapper la ligne de commande soi-même, on lance le point d'entrée de
 * `tsc` avec le Node courant. Pas de shell, pas de résolution de `PATH`, et la
 * version de `typescript` est celle du dépôt par construction.
 *
 * **Et `import()` ne prend pas un chemin.** Une fois compilé, le module se
 * charge par `await import(...)`, qui veut une URL : `C:\...` y passe pour un
 * schéma `c:` et rend `ERR_UNSUPPORTED_ESM_URL_SCHEME`. D'où `load`, qui
 * enveloppe `pathToFileURL`. Les trois pannes tombaient dans cet ordre, chacune
 * masquant la suivante.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** La racine du dépôt, en chemin natif. */
export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Les drapeaux communs. `--noCheck` est délibéré : la garde mesure ce que le
 * module **calcule**, et `npx tsc --noEmit` sur le projet entier vérifie déjà ce
 * qu'il déclare. Les refaire ici doublerait le temps de chaque garde sans rien
 * ajouter.
 */
const FLAGS = [
  '--module', 'commonjs',
  '--target', 'es2020',
  '--moduleResolution', 'node',
  '--esModuleInterop',
  '--skipLibCheck',
  '--noCheck',
];

/**
 * Compile un ou plusieurs modules et rend le répertoire de sortie.
 *
 * `entries` est relatif à la racine du dépôt. `json` ouvre `--resolveJsonModule`,
 * dont ont besoin les modules qui lisent `trees.json` ou `champion.json`.
 */
export const compile = (label, entries, { json = false } = {}) => {
  const out = mkdtempSync(join(tmpdir(), `dofdof-${label}-`));
  execFileSync(
    process.execPath,
    [
      join(ROOT, 'node_modules/typescript/bin/tsc'),
      ...entries.map((entry) => join(ROOT, entry)),
      '--outDir', out,
      ...FLAGS,
      ...(json ? ['--resolveJsonModule'] : []),
    ],
    { stdio: 'inherit' }
  );
  return out;
};

/**
 * Charge un module compilé par `compile`. `file` est relatif au répertoire rendu.
 *
 * Passe par `pathToFileURL` : `import()` attend une URL, et un chemin Windows
 * absolu s'y lit comme un schéma inconnu.
 */
export const load = (out, file) => import(pathToFileURL(join(out, file)).href);
