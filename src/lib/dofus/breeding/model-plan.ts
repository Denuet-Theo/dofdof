/**
 * Le plan du modèle, embarqué.
 *
 * `timeline.ts` définit le contrat et `samplePlan()` en donnait un exemplaire
 * fabriqué à la main, le temps que la recherche converge. Elle a convergé :
 * ceci est la sortie de `rust/breeding-neat/src/bin/plan.rs`, produite par le
 * champion et vérifiée par `parsePlan` avant d'entrer ici.
 *
 * ## Pourquoi un fichier figé plutôt qu'un appel
 *
 * Le modèle tourne en Rust, hors du navigateur, et une partie de 300 h prend
 * des secondes de calcul : il n'y a pas de service à interroger. Le plan est
 * donc un artefact, régénéré à la main quand le champion change :
 *
 * ```sh
 * cd rust
 * ./target/release/plan.exe champion-r5.json --out plan.json
 * cd .. && node scripts/check-plan.mjs rust/plan.json
 * cp rust/plan.json src/lib/dofus/breeding/model-plan.json
 * ```
 *
 * ## Ce qu'il faut savoir avant de le suivre
 *
 * Il est **daté d'une graine**. Les effectifs — dix montures à replacer, trois
 * stériles à cloner — viennent d'une partie qui a réellement tourné, avec ses
 * naissances tirées ; une autre graine donnerait d'autres nombres, tout aussi
 * valides. Ce sont les **durées et l'ordonnancement** qui portent la décision
 * du modèle, pas les effectifs au geste près.
 *
 * Il ne porte pas de rechargement de carburant : le modèle connaît un prix au
 * point, pas une capacité de cuve. Les recharges restent à juger sur place.
 */

import raw from './model-plan.json';
import { parsePlan, type TimelinePlan } from './timeline';

/**
 * D'où sort ce plan. Affiché avec lui : un plan sans provenance est
 * indiscernable d'un plan périmé.
 */
export const MODEL_PLAN_SOURCE = {
  champion: 'champion-r5.json',
  /** Médiane sur les 200 graines scellées, contre 72,48 M pour le glouton. */
  sealedMedian: 111_110_000,
  seed: 900_000,
} as const;

/**
 * Le plan relu par le contrat lui-même.
 *
 * On revalide au lieu de caster : le JSON est écrit par un autre programme,
 * dans un autre langage, et rien ne garantit qu'il ait été régénéré depuis le
 * dernier changement de contrat. Un plan refusé rend `null`, ce que l'écran
 * sait afficher — un plan casté rendrait un ruban vide.
 */
export const modelPlan = (): TimelinePlan | null => {
  const result = parsePlan(raw);
  return result.ok ? result.plan : null;
};
