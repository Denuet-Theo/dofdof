/**
 * À quel niveau monter les montures d'une fournée, sur **vos** prix.
 *
 * ## Ce que `optimalParentLevel` ne peut pas voir
 *
 * Il choisit déjà un niveau, et bien : celui qui minimise le coût **en kamas**
 * d'une réussite. Son propre commentaire nomme sa limite — « ce calcul-ci ne
 * compte que des kamas et ne peut pas le voir » — à propos des points d'XP
 * gratuits, et la limite est plus large que ça.
 *
 * Monter les parents achète du **taux de réussite**, donc réduit le nombre de
 * tentatives, donc le nombre de fournées, donc les heures d'enclos. Sur un
 * horizon fini, ces heures sont la vraie rareté : une fournée qui réussit plus
 * souvent laisse jouer la suivante. Un calcul qui ne compte que les kamas
 * conclut de descendre le niveau et paie en temps ce qu'il économise en or.
 *
 * ## Le calcul, et pourquoi il n'a pas d'horizon
 *
 * C'est celui de `LadderPolicy::tuned_for` — `nombre de fournées × (valeur −
 * carburant)` — avec les entrées de l'éleveur au lieu de celles
 * d'`economy.toml`. À une simplification près, qui a coûté un réglage :
 *
 * > `horizon / (cycle + montée) × (valeur − carburant − montée)`
 *
 * L'horizon y est un **facteur multiplicatif**. Il change le total, jamais le
 * niveau qui le maximise — mesuré sur une écurie réelle, le conseil vaut 23 à
 * 60 h, à 300 h et à 2 000 h. On ne le demande donc pas, et on maximise
 * directement la valeur **par heure d'enclos**, qui est la même chose sans la
 * constante. Il redeviendrait une vraie entrée le jour où l'app aurait des
 * fenêtres de jeu, que `loads_within` gère côté Rust et qui rendent le compte
 * non linéaire.
 *
 * | terme | ici | côté Rust |
 * | --- | --- | --- |
 * | la durée d'une fournée | `cycleHours` + la montée au prorata | `unit_load`, second membre |
 * | ce qu'un croisement coûte | `fuelPerCrossing` + la Mangeoire du niveau | `unit_load` |
 * | ce qu'une réussite rapporte | prix de la couronne ÷ barreaux restants | `value_per_success_toward` |
 * | le taux | `targetGenerationRate` | `success_rate` |
 *
 * **Une différence assumée** : le Rust balaye aussi les *bandes de jauge*, et
 * pas nous. L'écran ne les pilote pas — il lit le rythme réel de l'éleveur via
 * `supplies.cycleHours`. C'est donc le niveau qui paie **à ses jauges à lui**,
 * et non le meilleur couple bande-niveau dans l'absolu.
 *
 * Ce n'est donc **pas un portage** et il n'y a pas de garde de parité : les deux
 * calculs n'ont pas les mêmes entrées et ne peuvent pas rendre le même nombre.
 * C'est la même formule appliquée à ce que l'app sait mesurer.
 */

import { mountXpForLevel, MAX_MOUNT_LEVEL } from './costs';
import { targetGenerationRate } from './mating';

export type TunedLevelInput = {
  /** Durée d'un cycle d'enclos, relevée sur ses jauges. */
  cycleHours: number;
  /**
   * Ce qu'**un croisement** coûte en carburant, hors Mangeoire.
   *
   * Deux cycles de fécondité, un par parent — `fuelCostPerCycle × 2`, exactement
   * ce que `computeBreedingCosts` facture (`costs.ts`, `fuelCost`).
   *
   * Le champ s'appelait `fuelPerLoad` et recevait `fuelCostPerCycle × 10`, soit le
   * carburant d'un **enclos plein**. Il était soustrait de `perLoad`, qui est la
   * valeur d'**un** croisement, et de `levelling`, qui monte **deux** parents :
   * une dépense pour dix montures retranchée d'une recette pour deux. Cinq fois
   * trop, et dans la seule soustraction du calcul.
   *
   * Le prix, mesuré sur l'export du 27/08 : le net était **négatif à tous les
   * niveaux** — −8 106 au niveau 50, −8 321 au niveau 67 — donc le conseil ne
   * choisissait pas le niveau qui rapporte le plus mais celui qui **perd le
   * moins**, ce qui n'est pas la même courbe et n'a pas le même sommet.
   */
  fuelPerCrossing: number;
  /** Prix d'un point d'XP sur une monture, Mangeoire comprise. */
  mangeoireCostPerMountPoint: number;
  /**
   * Heures pour monter une fournée au niveau 200, relevées sur la Mangeoire.
   *
   * **Le terme qui fait tout basculer.** Sans lui, monter ne coûte que des kamas
   * et, à 0,13 kama le point d'XP, le plafond gagne toujours : sur l'écurie qui a
   * servi à l'écrire, le conseil sortait « niveau 200 » à 60 h d'horizon comme à
   * 2 000. Or la montée prend des heures d'enclos, donc elle **retire des
   * fournées** — c'est `unit_load` côté Rust, qui rend un couple (carburant,
   * durée) et non un prix seul.
   */
  levelUpHours: number;
  /** Ce qu'une réussite rapporte, amortie sur les barreaux qui restent. */
  valuePerSuccess: number;
  /**
   * Heures entre deux fournées que l'éleveur **lance vraiment**.
   *
   * ## Le terme qui manquait, et ce qu'il corrige
   *
   * Le calcul divisait par `cycleHours + climbHours` : il supposait que les
   * heures d'enclos sont la rareté, donc qu'une montée qui prend du temps retire
   * des fournées. Vrai pour qui enchaîne les fournées ; **faux pour cet
   * éleveur-ci, qui en lance une par jour** — il dort et il travaille, et la
   * Mangeoire tourne pendant ce temps-là sans lui coûter une seule fournée.
   *
   * Sous cette hypothèse, le conseil sortait **niveau 23**. Mesuré sur son écurie
   * réelle, 240 montures, 90 fournées, comparaison appariée sur 200 marchés :
   *
   * | niveau | encaissé | écart contre 100 | t |
   * | --- | --- | --- | --- |
   * | 60 | 82,78 M | −4,73 M | −6,06 |
   * | 80 | 86,31 M | −1,20 M | −1,46 |
   * | **100** | **87,51 M** | — | — |
   * | 120 | 84,91 M | −2,59 M | −2,94 |
   * | 140 | 76,82 M | −10,68 M | −11,81 |
   *
   * L'optimum est **autour de 100**, avec un plateau de 80 à 105 où rien ne se
   * distingue à 200 graines — un pas de niveau vaut 0,2 M contre une erreur type
   * de 0,85 M, donc chercher 99 contre 101 n'a pas de sens ici. Au-delà de 120 la
   * facture de Mangeoire, en `niveau^2,329`, dépasse le taux qu'elle achète.
   *
   * **24 pour une fournée par jour.** Le diviseur devient
   * `max(cycle + montée, cet intervalle)` : tant que la montée tient dans la
   * journée, elle est gratuite et le niveau grimpe jusqu'à ce que les kamas
   * cessent de payer. Absent, on retrouve le régime d'avant, où les heures
   * comptent.
   */
  hoursBetweenLoads?: number;
  /**
   * Points qu'un **seul remplissage** de Mangeoire peut porter.
   *
   * Le plafond du carburant tenu — 40 000, 70 000, 90 000 ou le maximum — et
   * c'est une borne **dure**, pas un coût. Le niveau 100 demande 172 668 points :
   * à 70 000 il faut trois remplissages, donc trois passages devant l'enclos. Un
   * niveau qu'on ne peut pas atteindre en une visite n'est pas un conseil cher,
   * c'est un conseil faux.
   *
   * Relevé de l'éleveur, qui l'a dit avant que le calcul ne le sache : « 172 000
   * points, ça va prendre 2 jours ». Absent, aucun plafond n'est appliqué.
   */
  pointsCap?: number;
};

export type TunedLevel = {
  level: number;
  /**
   * Ce que ce niveau rapporte par heure, tout déduit — l'heure étant celle du
   * **rythme réel** de l'éleveur quand il est plus lent que l'enclos. Voir
   * `hoursBetweenLoads`.
   */
  perHour: number;
};

/**
 * Les niveaux essayés — ceux du Rust, plus le plafond.
 *
 * Un balayage des deux cents niveaux ne dirait rien de plus : la courbe est
 * lisse et son sommet large. Ceux-ci sont les paliers que `tuned_for` retient,
 * donc les deux calculs se comparent au moins sur la même grille.
 */
const STEPS = [1, 12, 23, 36, 50, 67, 85, 100, 120, MAX_MOUNT_LEVEL];

/**
 * Le niveau qui paie, ou `null` si l'écurie n'a pas de quoi le dire.
 *
 * `null` plutôt qu'un nombre par défaut : sans cycle relevé ni prix de couronne,
 * toute réponse serait inventée, et un niveau inventé affiché à côté d'un prix
 * réel se lit comme une mesure.
 */
export const tunedLevel = (input: TunedLevelInput): TunedLevel | null => {
  const { cycleHours, valuePerSuccess } = input;
  if (!(cycleHours > 0) || !(valuePerSuccess > 0)) return null;
  // Un point de Mangeoire gratuit rend **le plafond toujours gagnant** : monter
  // ne coûte alors rien et augmente le taux, donc 200 sort quels que soient les
  // autres chiffres. Ce n'est pas un conseil, c'est un prix manquant qui se
  // déguise en réponse — et « niveau 200 » affiché à côté de vrais kamas se lit
  // comme une mesure. On préfère ne rien dire.
  if (!(input.mangeoireCostPerMountPoint > 0)) return null;

  const scored: TunedLevel[] = [];
  for (const level of STEPS) {
    // Le plafond d'un remplissage : au-delà, le niveau demande un second passage
    // que l'éleveur ne fera pas dans la même fournée. Voir `pointsCap`.
    if (input.pointsCap && mountXpForLevel(level) > input.pointsCap) continue;
    // Le temps de la montée, au prorata des points : `levelUpHours` est relevé
    // pour le plafond, et la Mangeoire transfère à débit constant.
    const climbHours =
      input.levelUpHours * (mountXpForLevel(level) / mountXpForLevel(MAX_MOUNT_LEVEL));

    // La Mangeoire monte les dix places d'un bloc, et `mangeoireCostPerMountPoint`
    // porte déjà ce partage. Deux parents par croisement, comme dans `costs.ts`.
    const levelling = 2 * input.mangeoireCostPerMountPoint * mountXpForLevel(level);
    // Sans Optimakina : elle se décide par croisement et par rang visé, donc
    // elle n'a rien à faire dans un niveau choisi pour toute la fournée.
    const perLoad = valuePerSuccess * targetGenerationRate(level, level);
    // Le rythme qui borne vraiment : l'enclos, ou l'éleveur. Une montée qui
    // tient dans l'intervalle qu'il joue ne lui coûte aucune fournée, donc elle
    // ne doit pas entrer au dénominateur — c'est toute la différence entre
    // conseiller 23 et conseiller 100.
    const spacing = Math.max(cycleHours + climbHours, input.hoursBetweenLoads ?? 0);
    const perHour = (perLoad - input.fuelPerCrossing - levelling) / spacing;
    scored.push({ level, perHour });
  }
  if (scored.length === 0) return null;

  /**
   * Le sommet est **plat**, et c'est la simulation qui le tranche.
   *
   * Sur l'export du 27/08, une fois le carburant remis à l'échelle du croisement :
   * niveau 50 rend 49 919 par heure, niveau 67 en rend 49 706 — **0,4 % d'écart**.
   * La courbe n'a pas de sommet net : son maximum continu tombe vers 57, entre
   * deux paliers de la grille, donc lequel des deux gagne tient à l'arrondi de la
   * grille et non à l'économie.
   *
   * Le banc, lui, tranche. Sur la même écurie, 200 graines appariées, en mode
   * fournée — le seul qui corresponde à un calendrier d'une fournée par jour — et
   * **à son prix de Mangeoire** (0,1266 le point, et non les 0,5640
   * d'`economy.toml`) :
   *
   * | niveau | écart contre 67 | t |
   * | --- | --- | --- |
   * | 36 | −2,18 M | −10,77 |
   * | 50 | −0,83 M | −4,09 |
   * | 60 | −0,49 M | −2,15 |
   * | 67 | référence | |
   *
   * Ce que la formule ne voit pas : elle chiffre **un croisement** en régime
   * permanent, quand la partie **capitalise** — un taux plus haut rend plus de
   * montures par fournée, qui alimentent les fournées suivantes. Un calcul par
   * croisement ne peut pas voir un stock qui grossit.
   *
   * D'où la règle : à écart négligeable, **le niveau le plus haut**. Elle ne
   * renverse jamais un écart réel — 36 reste écarté, la simulation le confirme à
   * −2,18 M — et elle laisse le banc décider là où la formule dit « je ne sais
   * pas ».
   *
   * La marge s'applique sur l'**amplitude** et non sur la valeur signée : un net
   * négatif — écurie pauvre, réussite qui ne paie pas le carburant — inverserait
   * une comparaison écrite `max × (1 − marge)`.
   */
  const MARGE = 0.02;
  const sommet = scored.reduce((a, b) => (b.perHour > a.perHour ? b : a));
  const plancher = sommet.perHour - Math.abs(sommet.perHour) * MARGE;
  const best = scored
    .filter((candidate) => candidate.perHour >= plancher)
    .reduce((a, b) => (b.level > a.level ? b : a));

  return best;
};

/**
 * Ce qu'une réussite rapporte, amortie sur les barreaux qui restent à gravir.
 *
 * Le prix de la couronne divisé par le nombre de rangs entre ce que l'écurie
 * tient déjà et elle : une réussite ne livre pas la gen 10, elle avance d'un
 * cran vers elle. C'est `value_per_success_toward`, avec le prix saisi par
 * l'éleveur au lieu d'une constante d'`economy.toml`.
 */
export const valuePerSuccessToward = (
  crownValue: number,
  summitGeneration: number,
  frontier: number
): number => {
  const climb = Math.max(1, summitGeneration - Math.min(frontier, summitGeneration));
  return crownValue / climb;
};
