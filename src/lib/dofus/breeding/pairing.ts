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
 * manqué. Le graphe de recettes la range parmi les feuilles sauvages ; c'est l'une
 * des montures les plus précieuses de l'écurie, et `hdv.ts` la chiffre.
 *
 * **Mais la gen 9 dans l'ascendance n'y est pas un détail.** Ce qui donne sa
 * valeur à cette gen 1, c'est que « gen 9 × gen 1 » nomme une gen 10. Une gen 1
 * née d'un croisement **gen 10** manqué ne vaut rien de particulier : une gen 10
 * ne se compose avec rien, c'est le sommet de l'arbre, donc la monture vise la
 * gen 2 comme n'importe quelle gen 1. Voir plus bas — la cible est ce qu'une
 * recombinaison sait nommer, et cette conséquence-là ne se voyait pas tant qu'on
 * la calculait sur le maximum de l'ascendance.
 *
 * ## La cible est ce qu'on sait nommer
 *
 * Deux erreurs successives sur la même ligne de code, et la seconde ne s'est vue
 * qu'une fois la première corrigée.
 *
 * **On refusait le couple** dès que le maximum de l'ascendance atteignait le
 * plafond de la famille : la cible aurait valu 11, la gen 11 n'existe pas, donc
 * `pairOutlook` rendait `null` — 9 250 couples sur 13 800 du catalogue muldo. Le
 * relevé du 14/08 (issue #185) l'a réfuté : trois fenêtres sur une mère
 * Azur-Turquoise gen 10 niveau 46, généalogie Azur (gen 9) + Pourpre (gen 1),
 * toutes trois avec une ligne « Génération cible » pleine de gen 10.
 *
 * | ♂ | niv. | Génération cible | somme | taux prédit |
 * | --- | --- | --- | --- | --- |
 * | Ébène g1 capturé | 44 | Azur-Turquoise 27,19 · Azur-Ébène 16,31 | 43,50 % | 43,50 % |
 * | Doré g1 [Doré, Pourpre] | 44 | Azur-Doré 11,86 · Azur-Turquoise 27,19 · Azur-Pourpre 4,45 | 43,50 % | 43,50 % |
 * | Doré-Amande g4 [Doré, Amande] | 61 | Azur-Doré 7,74 · Azur-Turquoise 30,57 · Azur-Amande 7,74 | 46,05 % | 46,05 % |
 *
 * **On a alors plafonné** : `cible = min(max(ascendance) + 1, plafond)`. Ça
 * reproduisait les trois fenêtres, et c'était encore une formule là où il fallait
 * une lecture. Relevé du 17/08, deux fenêtres aux deux bouts de l'arbre :
 *
 * | couple | ascendance + 1 | ce que le jeu affiche | somme du bloc |
 * | --- | --- | --- | --- |
 * | Doré-Indigo g2 [Doré, Indigo] × Ébène g1 capturée | gen 3 | **gen 2** | 43,80 % |
 * | Turquoise-Doré g6 [Turquoise g5, Doré g1] × Ébène g1 capturée | gen 7 | **gen 6** | 37,05 % |
 *
 * Dans les deux cas la case la plus haute est la couleur **propre** d'une monture,
 * et elle ne compose avec rien : une gen 3 demande deux gen 2, une gen 7 demande
 * deux gen 6, et le couple n'en porte qu'une. La formule visait donc une
 * génération que personne ne nomme, trouvait la cible vide, et déclarait le
 * croisement en **recopie** — « rien à gagner ». Sur l'écurie du 17/08,
 * **3 566 couples sur 6 630** étaient dans ce cas.
 *
 * La loi est : **la cible est la plus haute génération qu'une recombinaison du
 * couple sache nommer.** `null` quand aucune ne nomme rien, et c'est la seule
 * porte vers la recopie. Voir `crossingShares`.
 *
 * Le **plafond disparaît** avec la formule, et c'est le signe qu'on tient la bonne
 * loi : une recombinaison de deux couleurs du catalogue nomme une couleur du
 * catalogue, donc elle ne peut pas dépasser le sommet. Il n'y a plus à borner ce
 * qui ne peut pas déborder.
 *
 * ### Ce n'est pas un cas particulier, c'est la même loi
 *
 * Deux choses s'ensuivent, et aucune n'est une clause spéciale :
 *
 * 1. **Les couleurs de lignée à la génération visée rejoignent le bloc cible**,
 *    avec leur poids de lignée. C'est ce qui met Azur-Turquoise — la couleur de la
 *    mère — à 27,19 % en réussite et à **0 %** en échec, et Doré-Indigo à 6,84 %
 *    dans la fenêtre du 17/08.
 * 2. **L'échec se normalise sur ce qui reste**, et non sur `2 + w`. Quand aucune
 *    couleur de lignée n'est à la cible — c'est-à-dire quand le croisement monte
 *    pour de bon — chaque lignée pèse 1 et on retrouve exactement `2 + w`.
 *
 * `pairTargetColors` et `crossingFailureShares` sont les deux moitiés d'un même
 * calcul : voir `crossingShares`, qui lit la cible, pose les poids une fois et les
 * sépare par génération. **Six relevés reproduits, écart maximal 0,005 point** —
 * les trois du 14/08, les deux du 17/08, la recopie de #68 — plus #49 et #59 au
 * centième, sans une clause de plus.
 *
 * ### Zéro géneton quand la cible ne dépasse pas l'ascendance
 *
 * Les cinq fenêtres du 14/08 et du 17/08 n'en annoncent aucun, et
 * `genetonsForCrossing` le dit déjà : un enfant ne **dépasse** pas une ascendance
 * qui porte déjà sa génération. Il faut seulement lui passer l'ascendance
 * **réelle** — voir `pairAncestryGeneration` — et non `cible − 1`, qui la
 * sous-estime dès que le croisement ne monte pas.
 *
 * ### Ce que ça ne change pas : l'admissibilité
 *
 * `climbs` reste ce sur quoi la politique décide, et il reste faux ici : une gen 6
 * qui rend une gen 6 ne monte pas. Ce que la correction rend, c'est la **valeur**
 * de ces croisements — les 37 ou 44 % de la cible cessent d'être versés à
 * l'ascendance — et la possibilité de les représenter. Les exploiter est un autre
 * sujet : voir la duplication du sommet, mesurée et éteinte par défaut.
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
 * Le plafond de la famille : la génération la plus haute que son arbre porte.
 *
 * Lu sur le catalogue et non posé en constante. Les trois familles plafonnent à
 * 10 aujourd'hui, mais c'est une donnée du jeu, pas du calcul — et c'est cette
 * borne-là qui arrête la cible.
 */
export const topGenerationOf = (colors: BreedingColor[]): number =>
  colors.reduce((highest, color) => Math.max(highest, color.generation), 0);

/**
 * La génération la plus haute des six cases : ce que le couple **porte** déjà.
 *
 * `null` dès qu'une couleur de l'ascendance est inconnue du catalogue. Combler
 * par un zéro rabaisserait la lecture en silence, ce qui est exactement l'erreur
 * que ce module corrige.
 *
 * C'est elle, et non `cible − 1`, qui décide des génétons : sous le plafond les
 * deux coïncident, au plafond elles diffèrent d'un cran et c'est tout l'écart
 * entre « zéro géneton » et 500.
 */
export const pairAncestryGeneration = (
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
  return top > 0 ? top : null;
};

/**
 * La génération que vise un couple : **la plus haute qu'une de ses
 * recombinaisons sache nommer**.
 *
 * `null` quand aucune n'en nomme aucune — le régime de recopie, celui des deux
 * Indigo de #68, où le poulain reprend forcément une couleur de la généalogie.
 *
 * Ce n'est pas le maximum de l'ascendance plus un, et c'était l'erreur : voir
 * `crossingShares` pour les deux relevés du 17/08 qui la corrigent, et pour
 * pourquoi le plafond de la famille disparaît avec elle.
 */
export const pairTargetGeneration = (
  male: Mate,
  female: Mate,
  colors: BreedingColor[],
  generations: Map<string, number>
): number | null => crossingShares([male, female], colors, generations).targetGeneration;

/**
 * La génération qu'un couple viserait si seuls comptaient ses deux parents —
 * c'est-à-dire ce que le graphe de recettes sait voir. Plafonnée à la famille :
 * une recette ne peut pas annoncer une génération qui n'existe pas.
 */
export const recipeTargetGeneration = (
  male: Mate,
  female: Mate,
  generations: Map<string, number>,
  topGeneration: number
): number | null => {
  const first = generations.get(male.colorId);
  const second = generations.get(female.colorId);
  if (first === undefined || second === undefined) return null;
  return Math.min(Math.max(first, second) + 1, topGeneration);
};

/**
 * Générations gagnées par rapport à ce que la recette annoncerait.
 *
 * `0` sur un croisement ordinaire — les deux lectures coïncident dès que
 * l'ascendance ne dépasse pas les parents, ce qui est le cas de toutes les
 * recettes des arbres. `1` ou plus sur un **raccourci**, où une case d'ascendance
 * ouvre une génération que les deux couleurs seules n'atteindraient pas.
 *
 * Et **négatif** depuis le relevé du 17/08 : la recette peut promettre plus que
 * le couple ne sait nommer. Un Turquoise-Doré gen 6 apparié à un gen 1 donnerait
 * une gen 7 selon la recette, mais aucune de ses recombinaisons ne nomme une
 * gen 7 — il vise la gen 6, et le leap vaut −1. C'est le cas le plus fréquent des
 * trois, et celui que le modèle prenait pour une recopie.
 */
export const generationLeap = (
  male: Mate,
  female: Mate,
  colors: BreedingColor[],
  generations: Map<string, number>,
  topGeneration: number
): number | null => {
  const target = pairTargetGeneration(male, female, colors, generations);
  const byRecipe = recipeTargetGeneration(male, female, generations, topGeneration);
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
 * L'index, **toutes générations confondues**, et il n'y en a plus qu'un.
 *
 * Il en existait un second, restreint à la génération visée, qui servait à la
 * cible pendant que celui-ci servait à l'échec. Les deux tas se posant
 * maintenant en une seule passe — voir `crossingShares` —, un seul index les
 * sert : on demande « quelle couleur nomment ces deux teintes », et c'est la
 * génération de la réponse qui décide du tas.
 *
 * Le raccourci que l'index par génération permettait — « aucune composition à ce
 * rang, donc pas de cible » — est **devenu faux** avec le plafond : une couleur
 * de lignée peut être à la génération visée sans qu'aucune recombinaison ne la
 * nomme. Le supprimer n'est donc pas un nettoyage, c'est une correction.
 *
 * Le « premier arrivé » de `compositionIndex` ne tranche jamais rien : vérifié
 * sur les trois familles, aucune paire de teintes ne nomme deux couleurs
 * différentes — 63 clés pour la dragodinde, 162 pour le muldo, 157 pour le
 * volkorne, zéro collision.
 *
 * Clé faible sur le tableau de couleurs : il vient de `trees.json` et ne change
 * pas de la session, mais rien n'oblige l'appelant à le garantir.
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

/** Ce dont la loi du croisement a besoin d'un parent : sa couleur et son ascendance. */
export type CrossingParent = Pick<Mate, 'colorId' | 'parents'>;

/**
 * Les deux moitiés d'un croisement, et la génération qu'il vise.
 *
 * C'est **la** loi de la fenêtre d'accouplement, et elle tient en quatre gestes :
 *
 * 1. Les **couleurs de lignée** des deux montures, chacune avec sa part — donc
 *    une masse de 1 par lignée, 2 en tout.
 * 2. Les **recombinaisons croisées** — une teinte prise à gauche, l'autre à
 *    droite — chacune du produit des deux parts.
 * 3. La **cible** : la génération la plus haute que ces recombinaisons savent
 *    nommer. `null` quand aucune ne nomme rien.
 * 4. On **sépare par génération** : ce qui est à la cible d'un côté, le reste de
 *    l'autre.
 *
 * Les deux tas sortent en poids bruts, non normalisés ; c'est l'appelant qui les
 * remet à l'échelle, la cible sur le taux et l'échec sur son complément.
 *
 * ## La cible est ce qu'on sait nommer, pas ce qu'on porte plus un
 *
 * On la calculait — `min(max(ascendance) + 1, plafond de la famille)` — et c'est
 * faux. Relevé du 17/08, deux fenêtres aux deux bouts de l'arbre :
 *
 * | couple | ascendance + 1 | ce que le jeu affiche |
 * | --- | --- | --- |
 * | Doré-Indigo g2 [Doré, Indigo] × Ébène g1 capturée | gen 3 | **gen 2** |
 * | Turquoise-Doré g6 [Turquoise g5, Doré g1] × Ébène g1 capturée | gen 7 | **gen 6** |
 *
 * Dans les deux cas la case la plus haute est la couleur **propre** d'une
 * monture, et elle ne compose avec rien : une gen 3 demande deux gen 2, une gen 7
 * demande deux gen 6, et il n'y en a qu'une. Le mieux atteignable est donc une
 * génération **en dessous** de ce que le calcul annonçait — et c'est celle que la
 * fenêtre affiche, bloc cible sommant exactement au taux.
 *
 * Ce que ça coûtait : le modèle visait une génération que personne ne nomme,
 * trouvait la cible vide, et déclarait le croisement en **recopie** — « rien à
 * gagner ». Sur l'écurie du 17/08, **3 566 couples sur 6 630** étaient dans ce
 * cas, à qui le jeu propose une cible pleine à 37 ou 44 %.
 *
 * Le **plafond de la famille disparaît** comme cas particulier, et c'est le signe
 * que la loi est la bonne : une recombinaison de deux couleurs du catalogue nomme
 * une couleur du catalogue, donc elle ne peut pas dépasser le sommet. Il n'y a
 * plus à borner ce qui ne peut pas déborder.
 *
 * ## Pourquoi une seule passe, et pas deux lois
 *
 * On écrivait les deux moitiés séparément — les recombinaisons pour la cible,
 * tout le reste pour l'échec — et cette séparation cachait une hypothèse qu'on
 * n'avait jamais eu à examiner : **aucune couleur de lignée ne peut être à la
 * génération visée**. Elle est fausse dès que la cible ne dépasse pas
 * l'ascendance. Une mère gen 10 est elle-même à la génération visée, et le jeu la
 * range bien dans « Génération cible » — 27,19 % en réussite, 0 % en échec ; le
 * père Doré-Indigo gen 2 du relevé du 17/08 de même, à 6,84 %.
 *
 * Le geste 4 est donc la loi entière, et les deux anciennes en sont le cas où la
 * cible dépasse l'ascendance : aucune couleur de lignée ne tombe alors dans
 * `target`, `failure` reçoit les 2 lignées plus les recombinaisons, et sa
 * normalisation retrouve exactement le `2 + w` mesuré sur #68.
 *
 * L'ordre des additions est celui d'avant — lignées, puis produit croisé dans le
 * même parcours — et il n'est pas cosmétique : la garde de parité compare au
 * milliardième, et une somme flottante ne commute pas. La cible se lit dans une
 * passe préalable, qui n'additionne rien.
 */
const crossingShares = (
  parents: readonly [CrossingParent, CrossingParent],
  colors: BreedingColor[],
  generations: Map<string, number>
): {
  target: Map<string, number>;
  failure: Map<string, number>;
  /** La génération visée, ou `null` quand aucune recombinaison ne nomme rien. */
  targetGeneration: number | null;
} => {
  const lineages = parents.map((parent) =>
    lineageDistribution(parent.colorId, parent.parents, generations)
  );
  const index = compositionIndexAnywhere(colors);
  const names = (colorA: string, colorB: string) =>
    index.get([colorA, colorB].sort().join('+'));

  // Geste 3, en premier parce que les deux tas en dépendent : la plus haute
  // génération qu'une recombinaison sait nommer.
  let targetGeneration: number | null = null;
  for (const colorA of lineages[0].keys()) {
    for (const colorB of lineages[1].keys()) {
      const colorId = names(colorA, colorB);
      if (!colorId) continue;
      const generation = generations.get(colorId);
      if (generation !== undefined && (targetGeneration === null || generation > targetGeneration)) {
        targetGeneration = generation;
      }
    }
  }

  const target = new Map<string, number>();
  const failure = new Map<string, number>();
  const add = (weights: Map<string, number>, colorId: string, weight: number) =>
    weights.set(colorId, (weights.get(colorId) ?? 0) + weight);
  /**
   * Le tas où va une couleur : sa génération, et rien d'autre.
   *
   * Sans cible — `null` — la comparaison est fausse pour tout le monde et tout
   * part dans `failure`. C'est la recopie, et elle tombe d'elle-même.
   */
  const heap = (colorId: string) =>
    generations.get(colorId) === targetGeneration ? target : failure;

  for (const distribution of lineages) {
    for (const [colorId, share] of distribution) add(heap(colorId), colorId, share);
  }

  for (const [colorA, shareA] of lineages[0]) {
    for (const [colorB, shareB] of lineages[1]) {
      const colorId = names(colorA, colorB);
      if (!colorId) continue;
      add(heap(colorId), colorId, shareA * shareB);
    }
  }

  return { target, failure, targetGeneration };
};

/**
 * Les couleurs que le croisement peut rendre à la génération visée.
 *
 * Le mécanisme principal est celui que `lineage.ts` appelle **recombinaison
 * croisée** : un composant pris à gauche, l'autre à droite. Sur le relevé de
 * l'issue #59, les deux lignées valent `{Amande 42,19 %, Doré 42,19 %,
 * Ébène-Orchidée 15,63 %}` — et la seule paire qui nomme une couleur de
 * génération 4 est `{Doré, Amande}`, soit exactement la couleur annoncée par la
 * fenêtre d'accouplement.
 *
 * S'y ajoutent les couleurs de lignée déjà à la génération visée, ce qui n'arrive
 * que lorsque la cible ne dépasse pas l'ascendance : voir `crossingShares`.
 * Ailleurs il n'y en a jamais, et cette fonction rend alors exactement ce qu'elle
 * rendait avant.
 *
 * La liste est ordonnée et non réduite à une réponse unique : plusieurs paires
 * peuvent nommer une couleur de la bonne génération, et les trois fenêtres du
 * 14/08 en montrent jusqu'à trois d'un coup.
 */
/**
 * Le tas de la cible, ordonné : la plus probable devant, l'identifiant pour
 * départager. Le tri est ici plutôt qu'à deux endroits parce que `pairShape`
 * garde le résultat de `crossingShares` — il ne peut pas rappeler
 * `pairTargetColors` sans refaire le produit croisé, qui est la partie coûteuse.
 */
const sortedTargets = (target: Map<string, number>): TargetColor[] =>
  [...target]
    .map(([colorId, weight]) => ({ colorId, weight }))
    .sort((a, b) => b.weight - a.weight || a.colorId.localeCompare(b.colorId));

export const pairTargetColors = (
  male: Mate,
  female: Mate,
  colors: BreedingColor[],
  generations: Map<string, number>
): TargetColor[] => sortedTargets(crossingShares([male, female], colors, generations).target);

/** Ce qu'un couple donné promet, une fois son ascendance lue. */
export type PairOutlook = {
  male: Mate;
  female: Mate;
  targetGeneration: number;
  /**
   * La génération la plus haute des six cases : ce que le couple porte déjà.
   *
   * Elle valait toujours `targetGeneration - 1` et n'avait donc rien à dire. Le
   * plafond les décolle, et c'est elle qui répond à la seule question qui compte
   * en haut de l'échelle : le poulain peut-il **dépasser** ses parents ?
   */
  ancestryGeneration: number;
  /** Générations gagnées sur ce que la recette annoncerait. `0` hors raccourci. */
  leap: number;
  successRate: number;
  /** Génétons rendus, qui suivent la génération des **parents** (relevé #59). */
  genetons: number;
  /** Les couleurs possibles à la génération visée, la plus probable devant. */
  targetColors: TargetColor[];
};

/**
 * Ce croisement peut-il rendre une monture plus haute que ce que le couple porte ?
 *
 * Deux façons de répondre non, et c'est la même : l'enfant ne dépasse pas
 * l'ascendance.
 *
 * 1. **Personne ne nomme la cible.** Toute la masse retombe sur la généalogie —
 *    la recopie, celle des deux Indigo de #68.
 * 2. **La cible est plafonnée.** Une gen 10 dans l'une des six cases, et la
 *    génération visée vaut celle qu'on porte déjà : la fenêtre est pleine, les
 *    couleurs changent, la génération non.
 *
 * La seconde n'existait pas tant que le couple était refusé, et c'est elle qui
 * demande que la question soit posée à part. « A une cible » et « monte » se
 * confondaient ; ce n'est plus le cas, et tout ce qui décide d'un accouplement
 * veut la seconde — l'admissibilité de l'échelle comme les génétons.
 */
export const climbs = (outlook: PairOutlook): boolean =>
  outlook.targetColors.length > 0 && outlook.targetGeneration > outlook.ancestryGeneration;

/**
 * Ce que vise un couple, tout compris.
 *
 * `null` dans un seul cas désormais : **une couleur de l'ascendance manque au
 * catalogue**, et la cible serait bâtie sur une généalogie à moitié lue. Ne rien
 * annoncer vaut mieux qu'annoncer faux.
 *
 * Le second refus a été retiré. On rendait aussi `null` quand la cible dépassait
 * la génération la plus haute de la famille — 67 % des couples du catalogue
 * muldo — au motif qu'une gen 11 n'existe pas. Elle n'existe pas, en effet, et
 * le jeu ne refuse pas pour autant : il **plafonne**. Voir l'en-tête et le relevé
 * du 14/08.
 *
 * Reste la porte principale vers la recopie, qui n'a jamais été celle-là : une
 * cible parfaitement licite que **aucune paire ne nomme**. Deux Indigo visent la
 * gen 2, mais « Indigo et Indigo » n'est pas une couleur. `pairOutlook` répond
 * alors normalement, avec une liste de cibles vide, et `matingOutcomes` rend les
 * 100 % à l'ascendance. Refuser de répondre serait ici une faute : c'est
 * exactement le croisement d'une purification.
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
  ancestryGeneration: number;
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

  const top = topGenerationOf(colors);
  const ancestryGeneration = pairAncestryGeneration(male, female, generations);
  const byRecipe = recipeTargetGeneration(male, female, generations, top);

  // Le seul refus qui reste : une couleur de l'ascendance manque au catalogue,
  // donc la cible serait bâtie sur une généalogie à moitié lue. Le refus sur le
  // plafond, lui, a disparu — c'est l'objet de #185, voir l'en-tête.
  if (ancestryGeneration === null || byRecipe === null) {
    byPair.set(key, null);
    return null;
  }

  const { target, targetGeneration: named } = crossingShares([male, female], colors, generations);
  const targetColors = sortedTargets(target);

  /**
   * Sans recombinaison qui nomme quoi que ce soit, la cible **est** ce que le
   * couple porte : le poulain ne peut pas dépasser sa généalogie, il en reprend
   * une couleur. On y posait `ascendance + 1`, une génération que personne ne
   * nomme — de quoi faire croire à une montée là où il n'y en a aucune, et c'est
   * cette valeur inventée qui a fondé la panne que #185 corrige.
   */
  const targetGeneration = named ?? ancestryGeneration;

  const shape: PairShape = {
    targetGeneration,
    ancestryGeneration,
    leap: targetGeneration - byRecipe,
    // L'ascendance décide de la **validité** du croisement, les parents de la
    // quantité : quatre génétons sur deux parents gen 2, quelle que soit la
    // génération visée. Voir `genetonsForCrossing`.
    //
    // Deux cas rendent zéro, et c'est la même raison — l'enfant ne dépasse rien :
    //
    // - aucune recombinaison ne nomme quoi que ce soit, donc le bébé reprend une
    //   couleur de la généalogie. Relevé sur deux Indigo capturés (issue #68), où
    //   la fenêtre annonce « Indigo 100 %, 0 géneton » ;
    // - la cible ne **dépasse pas** l'ascendance : la fenêtre est pleine, les
    //   couleurs changent, la génération non. Les trois fenêtres du 14/08
    //   l'affichent au sommet, et les deux du 17/08 en pleine échelle — cible
    //   pleine, zéro géneton dans les cinq.
    //
    // D'où l'ascendance réelle passée ici, et non `targetGeneration - 1` : les
    // deux ne coïncident que quand le croisement monte pour de bon.
    genetons:
      targetColors.length === 0
        ? 0
        : genetonsForCrossing(
            targetGeneration,
            [generations.get(male.colorId)!, generations.get(female.colorId)!],
            ancestryGeneration
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
 * Le tout se normalisait sur `2 + w`, où `w` est la somme des poids des
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
 * ## Le diviseur est « ce qui reste », dont `2 + w` est le cas courant
 *
 * On normalise sur la masse d'échec effective et non sur `2 + w`. La différence
 * ne se voit qu'au plafond : là, une couleur de lignée peut être **à** la
 * génération visée, elle part alors vers la cible et sa lignée ne pèse plus 1.
 * C'est ce qui met Azur-Turquoise à 0 % dans le bloc « Autres » des trois
 * fenêtres du 14/08, et ce qui remonte d'autant les couleurs qui restent.
 *
 * Sous le plafond aucune couleur de lignée n'est à la cible, chaque lignée pèse
 * toujours 1, le diviseur vaut exactement `2 + w` — et les relevés antérieurs
 * tombent au centième comme avant. La loi n'est pas remplacée, elle est
 * généralisée.
 *
 * ## Ce que la cible exclut
 *
 * Aucune couleur de la génération visée n'apparaît ici : celles-là sont la
 * réussite. Et aucune ne peut la dépasser, la cible valant le maximum de
 * l'ascendance plus un ou le plafond de la famille. Toutes les couleurs rendues
 * sont donc **au plus** à la cible — strictement en dessous partout sauf au
 * plafond, ce qui vaut à `computeBreedingCosts` de les trouver déjà chiffrées
 * dans son parcours par génération croissante.
 */
export const crossingFailureShares = (
  parents: readonly [CrossingParent, CrossingParent],
  colors: BreedingColor[],
  generations: Map<string, number>
): Map<string, number> => {
  const { failure } = crossingShares(parents, colors, generations);

  const total = [...failure.values()].reduce((sum, weight) => sum + weight, 0);
  // Tout est à la cible : l'échec n'a aucune issue, et il n'y a rien à partager.
  // `matingOutcomes` en tire que la réussite est certaine ; les autres appelants
  // valorisent une carte vide, ce qui est le bon prix d'un raté impossible.
  if (total <= 0) return new Map();

  const shares = new Map<string, number>();
  for (const [colorId, weight] of failure) shares.set(colorId, weight / total);
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

  // Le complément de la réussite, réparti par la loi de l'échec. Les parts
  // sortent normalisées à 1 : les remettre à l'échelle de `failureMass` est tout
  // ce qui sépare la loi conditionnelle de la fenêtre du jeu.
  const failures = crossingFailureShares([male, female], colors, generations);

  // Les deux régimes dégénérés, et ce sont les deux bords du même partage :
  //
  // - **rien à viser** : la masse de réussite n'a nulle part où aller et retombe
  //   entièrement sur l'ascendance. C'est la recopie, celle des deux Indigo ;
  // - **rien à rater** : toute l'ascendance est déjà à la génération visée, donc
  //   aucune issue ne la manque. Le cas ne s'atteint qu'au plafond, avec six
  //   cases gen 10, et il n'a pas de relevé — mais lui donner la masse d'échec
  //   ferait sommer la fenêtre à moins de 1, ce qui est le bug que #68 a coûté
  //   cher à trouver.
  const successRate = rate ?? outlook.successRate;
  const targetMass =
    outlook.targetColors.length === 0 ? 0 : failures.size === 0 ? 1 : successRate;
  const totalWeight = outlook.targetColors.reduce((sum, color) => sum + color.weight, 0);
  for (const color of outlook.targetColors) {
    add(
      color.colorId,
      targetMass * (totalWeight > 0 ? color.weight / totalWeight : 1 / outlook.targetColors.length),
      'target'
    );
  }

  const failureMass = 1 - targetMass;
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
