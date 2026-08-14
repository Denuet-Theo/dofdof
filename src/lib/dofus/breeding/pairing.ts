import type { BreedingColor } from './costs';
import { genetonsForCrossing, targetGenerationRate } from './mating';
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
 * c'est tout l'objet de `crossingFailureShares`. Ce bébé-là est de génération
 * basse et porte une ascendance haute. Les commentaires de `creditOffTarget` les
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
 * Le même index, **toutes générations confondues**.
 *
 * La cible ne se lit qu'à une génération, mais l'échec, lui, produit des
 * recombinaisons à toutes les générations en dessous — voir `matingOutcomes`. Il
 * faut donc pouvoir demander « quelle couleur nomment ces deux teintes » sans
 * savoir d'avance à quelle génération répondre.
 *
 * Le « premier arrivé » de `compositionIndex` ne tranche jamais rien ici :
 * vérifié sur les trois familles, aucune paire de teintes ne nomme deux couleurs
 * différentes — 63 clés pour la dragodinde, 162 pour le muldo, 157 pour le
 * volkorne, zéro collision.
 */
const anyGenerationIndexCache = new WeakMap<BreedingColor[], Map<string, string>>();

const compositionIndexAnywhere = (colors: BreedingColor[]) => {
  let index = anyGenerationIndexCache.get(colors);
  if (!index) {
    index = compositionIndex(colors);
    anyGenerationIndexCache.set(colors, index);
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
 *    jeu bascule dans le régime que `lineage.ts` appelle la **recopie**.
 *
 * Ce second cas n'est pas la seule porte vers la recopie, et c'est même la plus
 * rare. On y tombe bien plus souvent avec une cible parfaitement licite que
 * **aucune paire ne nomme** : deux Indigo visent la gen 2, mais « Indigo et
 * Indigo » n'est pas une couleur. `pairOutlook` répond alors normalement, avec
 * une liste de cibles vide, et `matingOutcomes` rend les 100 % à l'ascendance.
 * Refuser de répondre serait ici une faute : c'est exactement le croisement
 * d'une purification.
 */
/**
 * Ce qu'un couple vise, **hors niveaux** : tout sauf le taux de réussite.
 *
 * La séparation n'est pas cosmétique, elle est ce qui rend l'énumération
 * praticable. Un appariement se décrit par les deux **ascendances** ; les
 * niveaux, eux, ne jouent que sur la probabilité, par une formule à deux
 * additions. Or la partie coûteuse — deux distributions de lignée et leur
 * produit croisé — ne dépend que des ascendances, et les mêmes reviennent sans
 * cesse : une écurie de cent montures ne porte qu'une poignée d'ascendances
 * distinctes.
 *
 * On mémoïse donc sur les signatures, et le taux se recalcule à chaque fois
 * puisqu'il ne coûte rien.
 */
type PairShape = {
  targetGeneration: number;
  leap: number;
  genetons: number;
  targetColors: TargetColor[];
};

const shapeCache = new WeakMap<BreedingColor[], Map<string, PairShape | null>>();

const pairShape = (
  male: Mate,
  female: Mate,
  colors: BreedingColor[],
  generations: Map<string, number>
): PairShape | null => {
  let byPair = shapeCache.get(colors);
  if (!byPair) {
    byPair = new Map();
    shapeCache.set(colors, byPair);
  }

  const key = [mateSignature(male), mateSignature(female)].sort().join('//');
  const cached = byPair.get(key);
  if (cached !== undefined) return cached;

  const targetGeneration = pairTargetGeneration(male, female, generations);
  const byRecipe = recipeTargetGeneration(male, female, generations);

  // Le plafond se lit sur la famille et non sur une constante : les trois
  // plafonnent à 10 aujourd'hui, mais c'est une donnée du jeu, pas du calcul.
  const top = colors.reduce((highest, color) => Math.max(highest, color.generation), 0);

  if (targetGeneration === null || byRecipe === null || targetGeneration > top) {
    byPair.set(key, null);
    return null;
  }

  const targetColors = pairTargetColors(male, female, colors, targetGeneration);

  const shape: PairShape = {
    targetGeneration,
    leap: targetGeneration - byRecipe,
    // L'ascendance décide de la **validité** du croisement, les parents de la
    // quantité : quatre génétons sur deux parents gen 2, quelle que soit la
    // génération visée. Voir `genetonsForCrossing`.
    //
    // Sauf quand la génération visée n'est nommée par aucune paire : le bébé naît
    // alors forcément en dessous, et le jeu ne paie rien. Relevé sur deux Indigo
    // capturés (issue #68), où la fenêtre annonce « Indigo 100 %, 0 géneton » —
    // le jeu compte sur la génération que l'enfant **aura**, pas sur celle qu'on
    // visait.
    genetons:
      targetColors.length === 0
        ? 0
        : genetonsForCrossing(
            targetGeneration,
            [generations.get(male.colorId)!, generations.get(female.colorId)!],
            targetGeneration - 1
          ),
    targetColors,
  };

  byPair.set(key, shape);
  return shape;
};

export const pairOutlook = (
  male: Mate,
  female: Mate,
  colors: BreedingColor[],
  generations: Map<string, number>
): PairOutlook | null => {
  const shape = pairShape(male, female, colors, generations);
  if (!shape) return null;

  return {
    ...shape,
    male,
    female,
    successRate: targetGenerationRate(male.level, female.level),
  };
};

/**
 * Ce qui distingue une monture d'une autre du point de vue de l'appariement :
 * sa couleur et son ascendance. À signature égale, deux montures visent
 * exactement la même chose.
 */
/**
 * Ce qui distingue une monture d'une autre du point de vue de l'appariement.
 *
 * ## Une ascendance qui ne dit rien est une absence d'ascendance
 *
 * Un Ébène né de deux Ébène porte `['ebene', 'ebene']` ; un Ébène acheté porte
 * `null`. En jeu ce sont **la même monture**, et le modèle le savait déjà partout
 * où ça compte — sur les 14 400 couples du catalogue la loi d'appariement ne les
 * distingue en rien, et les 74 entrées du recensement leur sont identiques au bit.
 *
 * Seule cette clé les séparait, et elle décide du regroupement : deux montures
 * interchangeables tombaient dans deux groupes, donc en deux candidats portant le
 * même delta, et le stock se fragmentait à mesure que les recopies s'accumulaient.
 *
 * La réduction ne vaut que pour ce cas : `[a, a]` avec la couleur `a`. Une
 * ascendance mixte ouvre des cibles et doit être gardée — un Ébène né d'Ébène ×
 * Doré porte du Doré, et c'est ce qui lui permet de viser plus haut.
 */
export const canonicalParents = (
  colorId: string,
  parents: [string, string] | null
): [string, string] | null =>
  parents && parents[0] === colorId && parents[1] === colorId ? null : parents;

export const mateSignature = (mate: Mate) =>
  `${mate.colorId}|${(canonicalParents(mate.colorId, mate.parents) ?? []).join('+')}`;

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

/** Ce dont la loi d'échec a besoin d'un parent : sa couleur et son ascendance. */
export type CrossingParent = Pick<Mate, 'colorId' | 'parents'>;

/**
 * Ce qu'un croisement rend quand il rate — **sachant qu'il a raté**.
 *
 * Les parts somment à 1 : c'est la loi conditionnelle, et non la moitié basse
 * d'une fenêtre d'accouplement. Deux appelants en ont besoin sous cette forme.
 * `matingOutcomes` la remet à l'échelle du complément de la réussite pour
 * reconstituer la fenêtre ; `computeBreedingCosts` la valorise telle quelle, un
 * bébé raté et un seul étant ce qu'une tentative manquée rend.
 *
 * Le taux n'entre donc pas ici, et c'est ce qui rend la fonction utile :
 * `optimalParentLevel` balaye les 200 niveaux d'un croisement, et le partage de
 * l'échec est le même à tous.
 *
 * ## Pourquoi ce n'est pas moitié-moitié
 *
 * On lisait l'échec comme un partage 50/50 entre les deux lignées. C'est le cas
 * particulier d'une loi plus large, et il ne se voyait pas parce que les relevés
 * dont on disposait tombaient tous dedans. La masse d'échec se répartit entre
 * **deux sortes d'issues** :
 *
 * 1. **Une couleur de l'ascendance**, tirée dans une lignée. Chaque lignée pèse
 *    **1**, et les parts se normalisent à l'intérieur (voir `lineage.ts`).
 * 2. **Une recombinaison croisée** — une teinte prise à gauche, l'autre à
 *    droite — qui nomme une couleur d'une génération **en dessous** de la cible.
 *    Chacune pèse le produit des deux parts.
 *
 * Le tout se normalise sur `2 + w`, où `w` est la somme des poids des
 * recombinaisons retenues. Quand aucune n'aboutit — le cas de tous les relevés
 * antérieurs — `w` vaut zéro, le diviseur retombe à 2, et on retrouve exactement
 * le partage moitié-moitié. C'est pourquoi l'erreur est restée invisible : elle
 * ne se manifeste que lorsque les deux lignées portent des teintes qui se
 * composent **sans atteindre la cible**.
 *
 * Le relevé qui tranche : Doré [Amande gen 3, Doré] × Orchidée [Ébène,
 * Orchidée], cible gen 4. Les quatre recombinaisons donnent deux couleurs gen 4
 * — la cible — et deux couleurs gen 2, Doré-Orchidée et Doré-Ébène, qui pèsent
 * ensemble 88/121. Le jeu les affiche à 9,68 % et 3,63 %, et rabaisse d'autant
 * les couleurs simples : 13,31 % au lieu des 18,15 % que le partage 50/50
 * prédisait. Diviseur `2 + 88/121`, et les six lignes tombent au centième.
 *
 * ## Ce que la cible exclut
 *
 * Aucune couleur de la génération visée n'apparaît ici : celles-là sont la
 * réussite. Et aucune ne peut la dépasser, la cible valant par construction le
 * maximum de l'ascendance plus un. Toutes les couleurs rendues sont donc
 * **strictement en dessous** de la cible — ce qui vaut à `computeBreedingCosts`
 * de les trouver déjà chiffrées dans son parcours par génération croissante.
 */
export const crossingFailureShares = (
  parents: readonly [CrossingParent, CrossingParent],
  colors: BreedingColor[],
  generations: Map<string, number>,
  targetGeneration: number
): Map<string, number> => {
  const lineages = parents.map((parent) =>
    lineageDistribution(parent.colorId, parent.parents)
  );

  const index = compositionIndexAnywhere(colors);
  const crossings = new Map<string, number>();
  let crossingWeight = 0;
  for (const [colorA, shareA] of lineages[0]) {
    for (const [colorB, shareB] of lineages[1]) {
      const colorId = index.get([colorA, colorB].sort().join('+'));
      if (!colorId || generations.get(colorId) === targetGeneration) continue;
      const weight = shareA * shareB;
      crossings.set(colorId, (crossings.get(colorId) ?? 0) + weight);
      crossingWeight += weight;
    }
  }

  const shares = new Map<string, number>();
  const add = (colorId: string, share: number) =>
    shares.set(colorId, (shares.get(colorId) ?? 0) + share);

  const total = lineages.length + crossingWeight;
  for (const distribution of lineages) {
    for (const [colorId, share] of distribution) add(colorId, share / total);
  }
  for (const [colorId, weight] of crossings) add(colorId, weight / total);

  return shares;
};

/**
 * Ce que l'accouplement peut donner, dans la forme où le jeu l'affiche.
 *
 * C'est la fenêtre d'accouplement reconstituée, et elle l'est **au centième sur
 * les huit fenêtres relevées par l'issue #68** — couleurs, probabilités et
 * partage cible/autres compris. Ces huit-là couvrent ce que les relevés
 * précédents laissaient ouvert : des parents composés comme simples, avec et
 * sans ascendance, une à quatre couleurs cibles, un saut de deux générations, et
 * le cas où il n'y a rien à gagner.
 *
 * ## Ce que la cible prend
 *
 * `targetGenerationRate` donne le **total** de la ligne « Génération cible », et
 * les poids de la recombinaison en donnent le **partage**. Ce partage était
 * annoncé ici comme une approximation ; il ne l'est pas. Sur le relevé à trois
 * couleurs — 33,06 % / 12,40 % / 4,65 % — les poids valent 64 / 24 / 9, et le
 * rapport tombe juste aux trois chiffres. Sur celui à quatre, de même. Le
 * contre-exemple qui fondait la réserve (40,02 % + 5,34 % + 5,34 %) s'y range
 * aussi : ce sont les poids 225 / 30 / 30 d'une lignée à parent simple et
 * grands-parents composés.
 *
 * ## Ce que l'échec prend
 *
 * `crossingFailureShares` le dit, et ne dit que ça : la masse de réussite se
 * verse sur les couleurs cibles ci-dessus, le complément se répartit selon cette
 * loi-là. Le partage de l'échec ne dépend pas du taux, seulement des deux
 * ascendances — ce qui est exactement ce dont `optimalParentLevel` a besoin pour
 * balayer les niveaux sans recalculer la loi.
 *
 * ## Quand il n'y a rien à gagner
 *
 * Deux Indigo capturés visent la gen 2, mais aucune couleur ne s'appelle
 * « Indigo et Indigo » : la cible est vide. Le jeu ne perd pas cette masse pour
 * autant — il affiche **Indigo 100 %**, et zéro géneton. C'est le régime que
 * `lineage.ts` appelle la **recopie**, et il n'a rien d'un cas dégénéré : c'est
 * exactement ce que fait une purification, puisque purifier consiste à croiser
 * une couleur avec elle-même. Le bébé né de ce croisement porte bien
 * `[Indigo, Indigo]` en généalogie — relevé sur la monture obtenue, ce qui
 * confirme que la purification concentre réellement la lignée.
 *
 * On annulait ici la masse de réussite sans la rendre. La liste ne sommait plus
 * à 1 — 69,7 % sur deux Indigo du vrac — et `drawOutcome` versait tout le manque
 * sur sa **dernière** ligne, faute de mieux : la simulation créditait donc 30 %
 * de ces croisements à la couleur la **moins** probable de l'ascendance.
 */
export const matingOutcomes = (
  male: Mate,
  female: Mate,
  colors: BreedingColor[],
  generations: Map<string, number>,
  /**
   * Taux de réussite imposé, ou `undefined` pour celui que les niveaux donnent.
   *
   * Sert au portage de la recherche : le taux y suit le **niveau de la fournée**,
   * que la Mangeoire monte d'un bloc, et non le niveau propre de chaque monture.
   * Voir `PairDelta` — côté Rust c'est `mating_outcomes_at` qui porte la même
   * surcharge, pour la même raison.
   */
  rate?: number
): MatingOutcome[] => {
  const outlook = pairOutlook(male, female, colors, generations);
  if (!outlook) return [];

  const outcomes = new Map<string, MatingOutcome>();
  const add = (colorId: string, probability: number, kind: MatingOutcome['kind']) => {
    const current = outcomes.get(colorId);
    if (current) current.probability += probability;
    else outcomes.set(colorId, { colorId, probability, kind });
  };

  // Sans couleur à la génération visée, il n'y a pas de réussite possible : toute
  // la masse revient à la recopie.
  const successRate = rate ?? outlook.successRate;
  const targetMass = outlook.targetColors.length > 0 ? successRate : 0;
  const totalWeight = outlook.targetColors.reduce((sum, color) => sum + color.weight, 0);
  for (const color of outlook.targetColors) {
    add(
      color.colorId,
      targetMass * (totalWeight > 0 ? color.weight / totalWeight : 1 / outlook.targetColors.length),
      'target'
    );
  }

  // Le complément de la réussite, réparti par la loi de l'échec. Les parts
  // sortent normalisées à 1 : les remettre à l'échelle de `failureMass` est tout
  // ce qui sépare la loi conditionnelle de la fenêtre du jeu.
  const failureMass = 1 - targetMass;
  const failures = crossingFailureShares(
    [male, female],
    colors,
    generations,
    outlook.targetGeneration
  );
  for (const [colorId, share] of failures) add(colorId, share * failureMass, 'other');

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
