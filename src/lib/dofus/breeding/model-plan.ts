/**
 * Le plan du modèle, embarqué — un par taille de parc.
 *
 * `timeline.ts` définit le contrat et `samplePlan()` en donnait un exemplaire
 * fabriqué à la main, le temps que la recherche converge. Elle a convergé :
 * ceci est la sortie de `rust/breeding-neat/src/bin/plan.rs`, produite par le
 * champion et vérifiée par `parsePlan` avant d'entrer ici.
 *
 * ## Pourquoi douze fichiers et non un seul
 *
 * Le plan portait six enclos, parce que c'est le parc sur lequel le champion a
 * été entraîné. Un éleveur qui en possède cinq y lisait une piste de trop, et
 * des quantités d'achat qu'il ne pouvait pas honorer — sur un écran dont toute
 * l'utilité est de dire quoi acheter et pour quand.
 *
 * Chaque taille a donc **sa partie jouée**, pas une règle de trois appliquée à
 * celle de six. Les effectifs, les durées et l'ordonnancement d'un parc de cinq
 * sortent d'une partie de cinq enclos ; rien n'est extrapolé. C'est le même
 * principe que dans `plan.rs` : on n'estime pas ce que le modèle aurait fait, on
 * le lui fait faire.
 *
 * ## Comment la taille se découpe
 *
 * `plan.rs` décide seul, et sur mesure : au-delà de trois enclos il en détache
 * un du bloc synchrone pour en faire une unité libre, en deçà il garde un bloc
 * entier. Voir `split` là-bas pour le relevé qui fixe la bascule — l'écart entre
 * les deux découpes va jusqu'à 15 M à parc égal, donc ce n'est pas un détail de
 * présentation.
 *
 * ## Pourquoi des artefacts figés plutôt qu'un appel
 *
 * Le modèle tourne en Rust, hors du navigateur, et une partie de 300 h prend
 * des secondes de calcul : il n'y a pas de service à interroger. Les plans sont
 * donc des artefacts, régénérés à la main quand le champion change :
 *
 * ```sh
 * cd rust
 * for n in $(seq 1 12); do
 *   ./target/release/plan.exe champion-r5.json --enclos $n \
 *     --out "../src/lib/dofus/breeding/model-plans/$n.json"
 * done
 * cd ..
 * for n in $(seq 1 12); do node scripts/check-plan.mjs "src/lib/dofus/breeding/model-plans/$n.json"; done
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

import { parsePlan, type TimelinePlan } from './timeline';

/**
 * Les parcs pour lesquels un plan existe.
 *
 * Un import dynamique par taille, et non un `import()` construit à la volée :
 * le chemin doit rester lisible statiquement pour que le découpage de bundle
 * fonctionne. C'est aussi ce qui évite d'embarquer les 748 Ko de la famille
 * entière dans la page — seule la taille demandée traverse le réseau.
 */
const PLANS: Record<number, () => Promise<{ default: unknown }>> = {
  1: () => import('./model-plans/1.json'),
  2: () => import('./model-plans/2.json'),
  3: () => import('./model-plans/3.json'),
  4: () => import('./model-plans/4.json'),
  5: () => import('./model-plans/5.json'),
  6: () => import('./model-plans/6.json'),
  7: () => import('./model-plans/7.json'),
  8: () => import('./model-plans/8.json'),
  9: () => import('./model-plans/9.json'),
  10: () => import('./model-plans/10.json'),
  11: () => import('./model-plans/11.json'),
  12: () => import('./model-plans/12.json'),
};

const SIZES = Object.keys(PLANS).map(Number);
export const MODEL_PLAN_MIN = Math.min(...SIZES);
export const MODEL_PLAN_MAX = Math.max(...SIZES);

/**
 * D'où sort ce plan. Affiché avec lui : un plan sans provenance est
 * indiscernable d'un plan périmé.
 */
export const MODEL_PLAN_SOURCE = {
  champion: 'champion-r5.json',
  /**
   * Médiane sur les 200 graines scellées **à six enclos**, contre 72,48 M pour
   * le glouton. Les autres tailles n'ont pas été mesurées sur ce jeu-là et ne
   * le seront pas : il a été ouvert une fois, et le rouvrir pour chaque parc le
   * transformerait en jeu d'entraînement.
   */
  sealedMedian: 111_110_000,
  sealedEnclos: 6,
  seed: 900_000,
} as const;

/** La taille de parc réellement servie pour une demande donnée. */
export const modelPlanSize = (enclosCount: number): number =>
  Math.min(MODEL_PLAN_MAX, Math.max(MODEL_PLAN_MIN, Math.round(enclosCount) || MODEL_PLAN_MIN));

export type ModelPlan = {
  plan: TimelinePlan;
  /**
   * Le parc du plan servi. Peut différer de celui demandé — au-delà de douze
   * enclos on sert le plus grand qui existe, et l'écran doit pouvoir le dire
   * plutôt que de laisser croire qu'il parle du parc réel.
   */
  enclos: number;
};

/**
 * Le plan du parc demandé, relu par le contrat lui-même.
 *
 * On revalide au lieu de caster : le JSON est écrit par un autre programme,
 * dans un autre langage, et rien ne garantit qu'il ait été régénéré depuis le
 * dernier changement de contrat. Un plan refusé rend `null`, ce que l'écran
 * sait afficher — un plan casté rendrait un ruban vide.
 */
export const modelPlan = async (enclosCount: number): Promise<ModelPlan | null> => {
  const enclos = modelPlanSize(enclosCount);
  const load = PLANS[enclos];
  if (!load) return null;

  try {
    const loaded = await load();
    const result = parsePlan(loaded.default);
    return result.ok ? { plan: result.plan, enclos } : null;
  } catch (error) {
    console.error('[breeding] plan du modèle illisible:', error);
    return null;
  }
};
