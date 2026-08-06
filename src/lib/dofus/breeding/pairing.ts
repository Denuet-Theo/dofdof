import { genetonsForCrossing, targetGenerationRate, type BreedingColor } from './costs';
import { lineageDistribution } from './lineage';
import type { Individual, Sex, Stable } from './stable';

/**
 * Ce qu'un couple vise — et pourquoi ce n'est pas une propriété de la recette.
 *
 * Les arbres de `trees.json` sont un graphe de recettes entre **couleurs**, où
 * chaque parent est d'une génération strictement inférieure à son enfant. Cette
 * propriété rend la récursion de `computeBreedingCosts` sûre, et elle est vraie
 * des 382 croisements des trois familles. Elle n'est pas vraie du jeu.
 *
 * Relevé en jeu (issue #59) : deux muldos **Ébène et Orchidée gen 2**, niveau 61
 * chacun, portant tous deux la même ascendance — *Amande* gen 3 et *Doré* gen 1
 * — visent la **génération 4**. Deux générations d'un coup, sans qu'aucune
 * recette ne porte « Ébène-Orchidée × Ébène-Orchidée → Doré-Amande ».
 *
 * La règle du jeu n'est pas « génération des parents + 1 » mais **« génération
 * maximale de toute la généalogie + 1 »**. On la connaissait comme un plancher
 * d'échec — l'enfant doit dépasser toute l'ascendance — sans en tirer la
 * conséquence : elle **relève la cible**.
 *
 * ## D'où viennent ces gen 2 à ascendance gen 3
 *
 * De l'échec lui-même. Un croisement Amande gen 3 × Doré gen 1 qui n'atteint pas
 * la gen 4 rend quand même un bébé, d'une couleur tirée dans la généalogie —
 * c'est tout l'objet de `lineageValue`. Ce bébé-là est de génération basse et
 * porte une ascendance haute. Les commentaires de `creditOffTarget` les
 * décrivaient comme des « couleurs de génération 2 dont on ne fera rien » ; ce
 * sont au contraire les montures les plus utiles de l'écurie.
 *
 * ## La profondeur d'ascendance, et pourquoi deux niveaux suffisent
 *
 * Le jeu n'expose qu'un niveau d'ascendance par monture. La fenêtre
 * d'accouplement montre donc six cases : les **deux montures** et les **deux
 * parents de chacune**. C'est exactement ce que `lineageDistribution` pondère,
 * et exactement ce que la base enregistre (`parent_a_color`, `parent_b_color`).
 * La cible se lit sur ces six cases-là, pas sur un arbre complet.
 *
 * ## Ce que ce relevé confirme d'autre
 *
 * Deux des inconnues de l'issue se referment sur ses propres chiffres :
 *
 * | Question | Attendu | Affiché | Verdict |
 * | --- | --- | --- | --- |
 * | Le taux suit-il la même formule sur un saut de deux générations ? | 0,3 + 0,0015 × (61+61) = 48,3 % | 48,3 % | oui |
 * | Les génétons suivent-ils les parents ou l'ascendance ? | parents gen 2 → 2 + 2 = 4 | 4 | les parents |
 *
 * Reste ouvert : le raccourci vaut-il pour n'importe quel écart, ou seulement
 * +2 ? Le calcul ci-dessous suppose la règle générale — `max + 1` — parce que
 * c'est la formulation dont le cas observé est un cas particulier, et parce
 * qu'une règle plafonnée à +2 demanderait une constante que rien ne mesure.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne replanifie rien. `computeBreedingCosts` continue de parcourir les
 * couleurs par génération croissante, ce qui reste juste **pour les recettes**
 * et faux pour le croisement libre. Chercher, parmi tous les appariements
 * possibles, la route la plus courte vers la gen 10 demande d'abandonner cette
 * récursion et de borner un espace de recherche qui explose ; c'est un autre
 * chantier. Ici, on répond à la question qu'on peut trancher tout de suite :
 * **ce que visent deux montures que l'éleveur a déjà en main**.
 */

/**
 * Une monture réduite à ce qu'un appariement a besoin d'en savoir.
 *
 * `id` est `null` du côté du vrac : les basses générations sont
 * interchangeables et n'ont pas d'individu à désigner. Elles n'ont pas non plus
 * d'ascendance enregistrée, donc elles ne portent jamais de raccourci — mais
 * elles peuvent servir de partenaire à une monture qui en porte un.
 */
export type Mate = {
  id: string | null;
  colorId: string;
  sex: Sex;
  /** Niveau courant : c'est lui qui décide du taux de réussite. */
  level: number;
  /** Couleurs des deux parents, ou `null` pour une monture achetée ou capturée. */
  parents: [string, string] | null;
};

/** Le niveau prêté à une monture du vrac, qui n'en a pas d'enregistré. */
export const BULK_MATE_LEVEL = 1;

/** Les cases d'ascendance qu'une monture apporte : elle-même, puis ses parents. */
export const mateAncestry = (mate: Mate): string[] => [mate.colorId, ...(mate.parents ?? [])];

/**
 * Les six cases que la fenêtre d'accouplement affiche — moins s'il manque des
 * ascendances. Les doublons sont conservés : ce sont les générations qui
 * comptent ici, et un maximum ne s'en émeut pas.
 */
export const pairAncestry = (male: Mate, female: Mate): string[] => [
  ...mateAncestry(male),
  ...mateAncestry(female),
];

/**
 * La génération que vise un couple : le maximum de toute son ascendance, plus
 * un.
 *
 * `null` dès qu'une couleur de l'ascendance est inconnue du catalogue. Combler
 * par un zéro rabaisserait la cible en silence, ce qui est exactement l'erreur
 * que ce module corrige.
 */
export const pairTargetGeneration = (
  male: Mate,
  female: Mate,
  generations: Map<string, number>
): number | null => {
  let top = 0;
  for (const colorId of pairAncestry(male, female)) {
    const generation = generations.get(colorId);
    if (generation === undefined) return null;
    top = Math.max(top, generation);
  }
  return top > 0 ? top + 1 : null;
};

/**
 * La génération qu'un couple viserait si seuls comptaient ses deux parents —
 * c'est-à-dire ce que le graphe de recettes sait voir.
 */
export const recipeTargetGeneration = (
  male: Mate,
  female: Mate,
  generations: Map<string, number>
): number | null => {
  const first = generations.get(male.colorId);
  const second = generations.get(female.colorId);
  if (first === undefined || second === undefined) return null;
  return Math.max(first, second) + 1;
};

/**
 * Générations gagnées par rapport à ce que la recette annoncerait.
 *
 * `0` sur un croisement ordinaire — les deux lectures coïncident dès que
 * l'ascendance ne dépasse pas les parents, ce qui est le cas de toutes les
 * recettes des arbres. `1` ou plus sur un raccourci.
 */
export const generationLeap = (
  male: Mate,
  female: Mate,
  generations: Map<string, number>
): number | null => {
  const target = pairTargetGeneration(male, female, generations);
  const byRecipe = recipeTargetGeneration(male, female, generations);
  return target === null || byRecipe === null ? null : target - byRecipe;
};

/** Une couleur que la recombinaison peut donner, et à quel point elle est probable. */
export type TargetColor = {
  colorId: string;
  /** Produit des parts des deux lignées. Sert à ordonner, pas à parier. */
  weight: number;
};

/**
 * Index « quelles deux couleurs composent celle-ci », tiré des recettes.
 *
 * Les recettes servent ici de **table de composition** et non de chemin de
 * production : « Doré et Amande » se fabrique canoniquement par Doré × Amande,
 * donc ce couple-là *nomme* la couleur. Que le croisement réel passe par deux
 * Ébène-Orchidée n'y change rien — c'est bien la couleur composée de Doré et
 * d'Amande qui sort.
 */
const compositionIndex = (colors: BreedingColor[]): Map<string, string> => {
  const index = new Map<string, string>();
  for (const color of colors) {
    for (const recipe of color.recipes) {
      const key = [...recipe].sort().join('+');
      // Premier arrivé : une composition ne nomme qu'une couleur, et les
      // recettes d'une même couleur ne se contredisent pas sur ce point.
      if (!index.has(key)) index.set(key, color.id);
    }
  }
  return index;
};

/**
 * Les couleurs que le croisement peut rendre à la génération visée.
 *
 * Le mécanisme est celui que `lineage.ts` appelle **recombinaison croisée** :
 * un composant pris à gauche, l'autre à droite. Chaque lignée porte une
 * distribution de couleurs ; on croise les deux et on retient les paires qui
 * nomment une couleur de la génération cible.
 *
 * Sur le relevé de l'issue #59, les deux lignées valent
 * `{Amande 42,19 %, Doré 42,19 %, Ébène-Orchidée 15,63 %}` — et la seule paire
 * qui nomme une couleur de génération 4 est `{Doré, Amande}`, soit exactement
 * la couleur annoncée par la fenêtre d'accouplement.
 *
 * **Inféré d'un seul relevé.** La cible s'y jouait entre deux couleurs à parts
 * égales, si bien que le croisement tranchait seul ; rien ne dit ce qui se passe
 * quand plusieurs paires nomment une couleur de la bonne génération. D'où une
 * liste ordonnée et non une réponse unique.
 */
export const pairTargetColors = (
  male: Mate,
  female: Mate,
  colors: BreedingColor[],
  targetGeneration: number
): TargetColor[] => {
  const index = compositionIndex(colors.filter((color) => color.generation === targetGeneration));
  if (index.size === 0) return [];

  const left = lineageDistribution(male.colorId, male.parents);
  const right = lineageDistribution(female.colorId, female.parents);

  const weights = new Map<string, number>();
  for (const [colorA, shareA] of left) {
    for (const [colorB, shareB] of right) {
      const colorId = index.get([colorA, colorB].sort().join('+'));
      if (!colorId) continue;
      weights.set(colorId, (weights.get(colorId) ?? 0) + shareA * shareB);
    }
  }

  return [...weights]
    .map(([colorId, weight]) => ({ colorId, weight }))
    .sort((a, b) => b.weight - a.weight || a.colorId.localeCompare(b.colorId));
};

/** Ce qu'un couple donné promet, une fois son ascendance lue. */
export type PairOutlook = {
  male: Mate;
  female: Mate;
  targetGeneration: number;
  /** Générations gagnées sur ce que la recette annoncerait. `0` hors raccourci. */
  leap: number;
  successRate: number;
  /** Génétons rendus, qui suivent la génération des **parents** (relevé #59). */
  genetons: number;
  /** Les couleurs possibles à la génération visée, la plus probable devant. */
  targetColors: TargetColor[];
};

/**
 * Ce que vise un couple, tout compris.
 *
 * `null` quand une couleur de l'ascendance manque au catalogue : mieux vaut ne
 * rien annoncer qu'une cible bâtie sur une généalogie à moitié lue.
 */
export const pairOutlook = (
  male: Mate,
  female: Mate,
  colors: BreedingColor[],
  generations: Map<string, number>
): PairOutlook | null => {
  const targetGeneration = pairTargetGeneration(male, female, generations);
  const byRecipe = recipeTargetGeneration(male, female, generations);
  if (targetGeneration === null || byRecipe === null) return null;

  const maleGeneration = generations.get(male.colorId)!;
  const femaleGeneration = generations.get(female.colorId)!;

  return {
    male,
    female,
    targetGeneration,
    leap: targetGeneration - byRecipe,
    successRate: targetGenerationRate(male.level, female.level),
    // L'ascendance décide de la **validité** du croisement, les parents de la
    // quantité : quatre génétons sur deux parents gen 2, quelle que soit la
    // génération visée. Voir `genetonsForCrossing`.
    genetons: genetonsForCrossing(
      targetGeneration,
      [maleGeneration, femaleGeneration],
      targetGeneration - 1
    ),
    targetColors: pairTargetColors(male, female, colors, targetGeneration),
  };
};

/**
 * Ce qui distingue une monture d'une autre du point de vue de l'appariement :
 * sa couleur et son ascendance. À signature égale, deux montures visent
 * exactement la même chose.
 */
export const mateSignature = (mate: Mate) => `${mate.colorId}|${(mate.parents ?? []).join('+')}`;

/** Des montures interchangeables, et combien l'écurie en porte. */
export type MateGroup = {
  /**
   * Une représentante, la mieux montée du groupe.
   *
   * Le taux de réussite est croissant en niveau, donc c'est elle qui répond à
   * « est-ce que ça vaut le coup maintenant ». Laquelle charger reste le choix
   * de l'éleveur — et `formCouples` dépense au contraire les plus bas niveau
   * d'abord, pour garder les hauts aux croisements qui restent.
   */
  sample: Mate;
  count: number;
};

/**
 * Les montures fertiles de l'écurie, repliées par couleur, ascendance et sexe.
 *
 * Le repli n'est pas une optimisation mais la bonne unité de raisonnement : le
 * vrac ne distingue pas ses montures, et deux individus de même ascendance
 * visent la même génération. Les déplier ferait des milliers de paires
 * identiques et un compte de couples faux — quatre combinaisons entre deux
 * mâles et deux femelles ne font que deux accouplements, chaque monture n'étant
 * consommée qu'une fois.
 *
 * Le niveau prêté au vrac est 1 : c'est celui d'un poulain, et le vrac est
 * justement où tombent les achats et les naissances basses.
 */
export const mateGroups = (stable: Stable): Map<string, MateGroup> => {
  const groups = new Map<string, MateGroup>();

  const add = (mate: Mate, count: number) => {
    const key = `${mateSignature(mate)}|${mate.sex}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { sample: mate, count });
      return;
    }
    current.count += count;
    if (mate.level > current.sample.level) current.sample = mate;
  };

  for (const mount of stable.individuals as Individual[]) {
    if (!mount.fertile) continue;
    add(
      {
        id: mount.id,
        colorId: mount.colorId,
        sex: mount.sex,
        level: mount.level,
        parents: mount.parents,
      },
      1
    );
  }

  for (const [colorId, counts] of stable.bulk) {
    for (const [sex, count] of [
      ['M', counts.males],
      ['F', counts.females],
    ] as [Sex, number][]) {
      if (count > 0) {
        add({ id: null, colorId, sex, level: BULK_MATE_LEVEL, parents: null }, count);
      }
    }
  }

  return groups;
};

/** Un raccourci disponible, et combien de couples l'écurie peut en former. */
export type Shortcut = PairOutlook & {
  /**
   * Couples réellement formables avec cette même ascendance des deux côtés.
   *
   * Les montures de même couleur **et** de même ascendance sont
   * interchangeables : les lister une par une remplirait l'écran de lignes
   * identiques. On en montre une, et on dit combien.
   */
  available: number;
};

export type ShortcutOptions = {
  /** Générations gagnées en deçà desquelles on ne signale rien. Un par défaut. */
  minLeap?: number;
  /** Raccourcis rendus au plus. Le classement met les meilleurs devant. */
  limit?: number;
};

/**
 * Les raccourcis que l'écurie porte **maintenant**, les plus hauts devant.
 *
 * C'est le levier que l'issue #59 dit manquant : sur un objectif « gen 10 au
 * plus vite », deux montures déjà en main peuvent sauter une génération que le
 * plan comptait produire. Aucune replanification ici — seulement la liste de ce
 * qui est possible tout de suite, à charger dans l'enclos avant tout le reste.
 *
 * L'énumération est quadratique sur les montures fertiles. Une écurie se compte
 * en dizaines, le vrac est replié en un représentant par couleur et par sexe :
 * il n'y a rien à optimiser ici, et une borne inventée masquerait des
 * raccourcis.
 */
export const stableShortcuts = (
  stable: Stable,
  colors: BreedingColor[],
  generations: Map<string, number>,
  { minLeap = 1, limit = 12 }: ShortcutOptions = {}
): Shortcut[] => {
  const groups = [...mateGroups(stable).values()];
  const males = groups.filter((group) => group.sample.sex === 'M');
  const females = groups.filter((group) => group.sample.sex === 'F');

  const best = new Map<string, Shortcut>();

  for (const male of males) {
    for (const female of females) {
      const outlook = pairOutlook(male.sample, female.sample, colors, generations);
      if (!outlook || outlook.leap < minLeap) continue;

      // Deux ascendances distinctes se rencontrent dans les **deux sens** —
      // mâle de l'une avec femelle de l'autre, et l'inverse — et ces deux
      // orientations ne se disputent aucune monture. La clé les réunit, le
      // compte les additionne. À signature identique des deux côtés, une seule
      // combinaison existe et c'est le sexe le moins fourni qui plafonne.
      const key = [mateSignature(male.sample), mateSignature(female.sample)].sort().join('//');
      const available = Math.min(male.count, female.count);
      const current = best.get(key);

      if (!current) {
        best.set(key, { ...outlook, available });
        continue;
      }

      current.available += available;
      if (outlook.successRate > current.successRate) {
        best.set(key, { ...outlook, available: current.available });
      }
    }
  }

  return [...best.values()]
    .sort(
      (a, b) =>
        b.targetGeneration - a.targetGeneration ||
        b.leap - a.leap ||
        b.successRate - a.successRate ||
        b.available - a.available
    )
    .slice(0, limit);
};
