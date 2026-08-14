/**
 * Les deux lois que la fenêtre d'accouplement applique : ce qu'un croisement
 * rend en génétons, et avec quelle probabilité il atteint la génération visée.
 *
 * ## Pourquoi une feuille à part
 *
 * Elles vivaient dans `costs.ts`, que `pairing.ts` importait pour elles seules —
 * et ce sont les deux seules **valeurs** qu'il en tirait. Ça fermait un cycle qui
 * existait déjà sans qu'on le voie : `costs.ts` → `ladder.ts` → `pairing.ts` →
 * `costs.ts`. Il ne tenait qu'à un fil, celui de l'ordre des appels : rien ne
 * s'évalue au chargement des modules, donc personne n'a jamais lu un `undefined`.
 * Le jour où `pairing.ts` aurait appelé `targetGenerationRate` au niveau du
 * module, il l'aurait lu.
 *
 * Les remonter ici casse le cycle à sa racine plutôt que d'en creuser un second :
 * `costs.ts` peut maintenant importer `crossingFailureShares` de `pairing.ts` en
 * ligne droite, et `pairing.ts` ne garde de `costs.ts` qu'un `import type`,
 * effacé à la compilation.
 *
 * Rien n'a changé dans les lois elles-mêmes : ce déplacement est à comportement
 * constant, et la garde de parité de `matingOutcomes` le vérifie.
 */

/**
 * Génétons produits à la naissance, selon la génération de **chaque parent**.
 * Les deux apports s'additionnent : gen 8 × gen 4 → 120 + 8 = 128.
 *
 * La table s'arrête à la génération 9 et c'est suffisant : un parent doit être
 * d'une génération strictement inférieure à son enfant, et les arbres plafonnent
 * à 10. Vérifié sur les 382 croisements des trois familles — la génération de
 * parent la plus haute rencontrée est 9.
 */
const GENETONS_BY_GENERATION: Record<number, number> = {
  1: 1,
  2: 2,
  3: 4,
  4: 8,
  5: 15,
  6: 30,
  7: 60,
  8: 120,
  9: 250,
};

/**
 * Génétons rendus par un croisement, co-produit revendable de l'élevage.
 *
 * Deux générations différentes entrent dans ce calcul, et les confondre était
 * l'erreur :
 *
 * - **la validité** du croisement se juge sur toute la généalogie — l'enfant
 *   doit dépasser l'ascendance entière, pas seulement ses deux parents ;
 * - **la quantité** rendue suit la génération des **parents directs**.
 *
 * Les deux coïncident sur les recettes des arbres, où la génération croît à
 * chaque croisement : le maximum d'une ascendance y est toujours celui du parent
 * lui-même. Vérifié sur les 382 croisements des trois familles — d'où le défaut
 * de `ancestryGeneration`, qui laisse ce calcul inchangé pour eux.
 *
 * Elles cessent de coïncider sur un croisement libre, et le relevé de l'issue
 * #59 tranche : deux parents **gen 2** visant la **gen 4** — parce que leur
 * ascendance porte une gen 3 — rendent **4 génétons**, soit 2 + 2. Ce sont bien
 * les parents qui comptent, pas la cible, qui en aurait donné 8 + 8.
 */
export const genetonsForCrossing = (
  childGeneration: number,
  parentGenerations: [number, number],
  /**
   * Génération la plus haute de toute l'ascendance du couple.
   *
   * Voir `pairTargetGeneration` : elle vaut le maximum des six cases que la
   * fenêtre d'accouplement affiche. Par défaut celle des parents directs, ce qui
   * est exact partout où le graphe de recettes s'applique.
   */
  ancestryGeneration = Math.max(...parentGenerations)
): number => {
  if (ancestryGeneration >= childGeneration) return 0;
  return parentGenerations.reduce(
    (total, generation) => total + (GENETONS_BY_GENERATION[generation] ?? 0),
    0
  );
};

/**
 * Probabilité d'obtenir la **génération** cible : 30 % de base, plus 0,15 % par
 * niveau, les niveaux des deux parents s'additionnant.
 *
 * Vérifié au point près en jeu. Deux parents niveau 69 donnent 50,70 %, et le
 * jeu affiche bien 40,02 % + 5,34 % + 5,34 % pour les trois couleurs de la
 * génération visée, soit 50,70 %. Le complément, 27,55 % + 21,75 % = 49,30 %,
 * couvre les deux couleurs de génération inférieure.
 *
 * La génération, donc, et **pas la couleur** : c'est le piège de cette formule.
 * Ce que le complément rend, c'est `crossingFailureShares` qui le dit.
 *
 * Et la génération **visée**, quel que soit l'écart : deux parents niveau 61
 * visant deux générations au-dessus d'eux — un raccourci d'ascendance, voir
 * `pairTargetGeneration` — affichent 48,3 %, soit exactement
 * `0,3 + 0,0015 × (61 + 61)`. Le saut ne coûte rien en probabilité, ce qui est
 * précisément ce qui le rend intéressant.
 *
 * Deux parents niveau 200 plafonnent à 90 % — la certitude n'est pas atteignable
 * par le niveau seul (il y faudrait 233 niveaux par parent). Les Optimakina
 * poussent au-delà mais ne sont pas modélisées ici.
 */
const TARGET_GENERATION_BASE_RATE = 0.3;
const RATE_PER_PARENT_LEVEL = 0.0015;

export const targetGenerationRate = (levelA: number, levelB: number) =>
  Math.min(1, TARGET_GENERATION_BASE_RATE + RATE_PER_PARENT_LEVEL * (levelA + levelB));
