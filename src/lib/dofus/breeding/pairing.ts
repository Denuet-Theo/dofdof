import { genetonsForCrossing, targetGenerationRate, type BreedingColor } from './costs';
import { lineageDistribution, LINEAGE_SHARE } from './lineage';
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
 * | Le taux suit-il la même formule sur un saut de générations ? | 0,3 + 0,0015 × (61+61) = 48,3 % | 48,3 % | oui |
 * | Les génétons suivent-ils les parents ou l'ascendance ? | parents gen 2 → 2 + 2 = 4 | 4 | les parents |
 *
 * Restait à savoir si le raccourci valait pour n'importe quel écart ou seulement
 * pour +2. **Il n'est pas plafonné** : un gen 1 dont un parent est gen 9,
 * apparié à un gen 1 anonyme, vise la **gen 10** — huit générations d'un coup —
 * et à niveau 67 de chaque côté le taux annoncé est 50 %, soit
 * `0,3 + 0,0015 × (67 + 67) = 50,1 %`. Rien ne s'atténue avec l'écart, ni la
 * règle ni la probabilité.
 *
 * Ce second cas est **lu en ligne et non reproduit en jeu**, à la différence du
 * premier. Il ne fonde donc rien à lui seul — mais il tombe exactement sur la
 * formule générale, ce qui est difficile à mettre sur le compte du hasard, et
 * c'est cette formule que le calcul ci-dessous applique.
 *
 * Il dit aussi quelque chose de plus fort que le premier relevé : la monture qui
 * porte le raccourci peut être de **génération 1**. Une gen 1 ne s'élève pas,
 * elle se capture — sauf celle-là, qui n'a pu naître que d'un croisement gen 9
 * manqué. Le graphe de recettes la range parmi les feuilles sauvages ; c'est la
 * monture la plus précieuse de l'écurie.
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
 * Les index de composition déjà construits, par catalogue et par génération.
 *
 * Sans ce cache, chaque évaluation de couple refiltrait les 226 couleurs et
 * reconstruisait son index — négligeable sur un couple, ruineux dès qu'on en
 * compare des milliers. La simulation de la politique en évalue des millions et
 * n'aboutissait pas ; l'écran, lui, en évaluait déjà assez pour ramer sur une
 * grosse écurie.
 *
 * Clé faible sur le tableau de couleurs : il vient de `trees.json` et ne change
 * pas de la session, mais rien n'oblige l'appelant à le garantir.
 */
const indexCache = new WeakMap<BreedingColor[], Map<number, Map<string, string>>>();

const compositionIndexAt = (colors: BreedingColor[], generation: number) => {
  let byGeneration = indexCache.get(colors);
  if (!byGeneration) {
    byGeneration = new Map();
    indexCache.set(colors, byGeneration);
  }
  let index = byGeneration.get(generation);
  if (!index) {
    index = compositionIndex(colors.filter((color) => color.generation === generation));
    byGeneration.set(generation, index);
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
  const index = compositionIndexAt(colors, targetGeneration);
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
 * `null` dans deux cas, et pour la même raison de fond — ne rien annoncer plutôt
 * qu'annoncer faux :
 *
 * 1. **Une couleur de l'ascendance manque au catalogue.** La cible serait bâtie
 *    sur une généalogie à moitié lue.
 * 2. **La cible dépasse la génération la plus haute de la famille.** Deux
 *    montures dont l'ascendance porte déjà une gen 10 ne visent pas une gen 11 :
 *    elle n'existe pas. Il n'y a alors plus aucune génération à gagner, et le
 *    jeu bascule dans le régime que `lineage.ts` appelle la **recopie** — la
 *    masse se répartit sur les cases survivantes, toutes lignées confondues.
 *    C'est un croisement qu'on ne monte pas volontairement, donc pas un
 *    raccourci.
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

  // Le plafond se lit sur la famille et non sur une constante : les trois
  // plafonnent à 10 aujourd'hui, mais c'est une donnée du jeu, pas du calcul.
  const top = colors.reduce((highest, color) => Math.max(highest, color.generation), 0);
  if (targetGeneration > top) return null;

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

/** Une couleur que l'accouplement peut rendre, et avec quelle probabilité. */
export type MatingOutcome = {
  colorId: string;
  probability: number;
  /**
   * `target` pour la génération visée, `other` pour ce que rend une tentative
   * qui la manque. Le jeu les sépare de la même façon — « Génération cible » et
   * « Autres » — et la distinction compte : seule la première rend des génétons.
   */
  kind: 'target' | 'other';
};

/**
 * Ce que l'accouplement peut donner, dans la forme où le jeu l'affiche.
 *
 * C'est la fenêtre d'accouplement reconstituée, et elle l'est **exactement** sur
 * le relevé #59 : 48,3 % sur Doré-Amande, puis 21,81 % / 21,81 % / 8,08 % sur
 * Amande, Doré et Ébène-Orchidée. Rien de nouveau n'est calculé ici — la masse
 * de réussite vient de `targetGenerationRate`, le reste de `lineageDistribution`
 * partagé moitié-moitié entre les deux lignées, ce que `lineageValue` faisait
 * déjà pour chiffrer. Seule la présentation change : des couleurs et des
 * probabilités plutôt qu'une valeur en kamas.
 *
 * ## La part qui est une approximation
 *
 * Quand **plusieurs** couleurs occupent la génération visée, le jeu ne les
 * donne pas à parts égales : deux parents niveau 69 affichaient
 * 40,02 % + 5,34 % + 5,34 % pour trois couleurs cibles, et non trois fois
 * 16,68 %. Le partage retenu ici suit les poids de la recombinaison, qui
 * reproduisent l'écart de rang mais pas forcément sa valeur. Le **total** de la
 * ligne « Génération cible », lui, est exact — c'est celui de la formule.
 *
 * Sans conséquence pour ce à quoi cette liste sert : saisir ce qui est né. On
 * clique sur la couleur obtenue, pas sur sa probabilité.
 */
export const matingOutcomes = (
  male: Mate,
  female: Mate,
  colors: BreedingColor[],
  generations: Map<string, number>
): MatingOutcome[] => {
  const outlook = pairOutlook(male, female, colors, generations);
  if (!outlook) return [];

  const outcomes = new Map<string, MatingOutcome>();
  const add = (colorId: string, probability: number, kind: MatingOutcome['kind']) => {
    const current = outcomes.get(colorId);
    if (current) current.probability += probability;
    else outcomes.set(colorId, { colorId, probability, kind });
  };

  const totalWeight = outlook.targetColors.reduce((sum, color) => sum + color.weight, 0);
  for (const color of outlook.targetColors) {
    add(
      color.colorId,
      outlook.successRate * (totalWeight > 0 ? color.weight / totalWeight : 1 / outlook.targetColors.length),
      'target'
    );
  }

  // La masse d'échec se partage exactement moitié-moitié entre les deux lignées,
  // et les parts se normalisent à l'intérieur de chacune. Voir `lineage.ts`.
  const failureMass = 1 - outlook.successRate;
  for (const mate of [male, female]) {
    const distribution = lineageDistribution(mate.colorId, mate.parents);
    for (const [colorId, share] of distribution) {
      add(colorId, LINEAGE_SHARE * share * failureMass, 'other');
    }
  }

  return [...outcomes.values()].sort(
    (a, b) =>
      // La cible d'abord, quoi qu'elle pèse : c'est elle qu'on vient chercher, et
      // c'est le classement du jeu.
      Number(b.kind === 'target') - Number(a.kind === 'target') ||
      b.probability - a.probability ||
      a.colorId.localeCompare(b.colorId)
  );
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
