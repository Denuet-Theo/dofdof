import type { BreedingColor } from './costs';
import { carriedGeneration } from './naming';
import {
  ascendanceKey,
  BULK_MATE_LEVEL,
  mateGroups,
  mateSignature,
  pairOutlook,
  type Mate,
} from './pairing';
import {
  isSterile,
  PROJECTED_BIRTH_PREFIX,
  type Individual,
  type Sex,
  type Stable,
} from './stable';

/**
 * Quelles deux stériles appairer pour cloner — et laquelle on espère récupérer.
 *
 * L'écran du jeu pose les règles : deux montures de **même génération affichée**
 * entrent, les deux sont détruites, **l'une des deux au hasard** ressort. Elle
 * conserve la couleur, le genre, le nom et la généalogie de l'originale ; seules
 * les jauges repartent à zéro.
 *
 * ## La règle qui prime sur tout le reste : on ne perd jamais une génération
 *
 * Le tirage est celui du **jeu**, pas de l'éleveur. Apparier une monture qui
 * porte une gén. 3 avec une qui porte une gén. 1, c'est donc perdre la gén. 3
 * une fois sur deux — et il n'y a aucun geste pour l'en empêcher une fois les
 * deux montures engagées.
 *
 * On n'apparie donc **que des ascendances de même génération portée**. Ce qui
 * reste dépareillé n'est pas proposé du tout : il va à l'extraction, où il ne
 * vaut que son ambre, ce qui est très inférieur — mais un pile ou face sur une
 * lignée n'est pas un arbitrage, c'est une perte à moitié du temps, et
 * l'espérance ne console pas d'une gén. 4 disparue.
 *
 * Cette règle a coûté deux détours avant d'être posée au bon endroit. Elle a
 * d'abord été un **bouton désactivé** dans la fenêtre de saisie, puis un **refus
 * au point d'écriture**. Les deux supposaient que l'éleveur choisit la
 * survivante. Il ne choisit pas : il **constate**. Un garde à la saisie
 * l'empêchait donc d'enregistrer ce que le jeu venait de lui rendre, c'est-à-dire
 * de faire mentir l'écurie sur son propre contenu — pendant que la paire, elle,
 * continuait d'être proposée. Les deux sont retirés, et la règle vit ici, à
 * l'appariement, seul endroit où elle protège quelque chose.
 *
 * Trois conséquences, et c'est la troisième qui décide.
 *
 * ## 1. Une stérile ne vaut rien jusqu'à ce qu'on la clone
 *
 * Elle ne s'accouple plus. Il ne lui reste que l'extraction — sa génération en
 * ressource — ou de servir d'entrée à un clonage. Le clonage n'est donc pas un
 * arbitrage entre deux emplois d'une monture précieuse : c'est le seul moyen de
 * lui rendre une valeur.
 *
 * ## 2. Ce qui fait la valeur d'une monture, c'est son ascendance
 *
 * Depuis #59, une gen 1 dont un parent est gen 9 vise la gen 10 — comme une
 * gen 9, qui coûte cent fois plus cher. On valorise donc une monture par
 * **ce qu'il faudrait payer pour la remplacer dans son rôle** : le prix de la
 * couleur la moins chère de la génération que son ascendance porte. Pas par sa
 * propre couleur, qui ne dit rien de ce qu'elle permet.
 *
 * ## 3. Ce qui compte n'est pas qui va avec qui, mais qui reste dépareillée
 *
 * L'intuition dit qu'il ne faut jamais dépenser une porteuse pour en sauver une
 * autre. **C'est faux en espérance**, et il vaut mieux le dire : une paire rend
 * la moitié de la somme des deux valeurs, donc la somme sur tout un parc apparié
 * vaut la moitié de la somme des montures appariées — quel que soit l'appariement.
 * Appairer deux porteuses ou les appairer chacune à une banale donne exactement
 * le même total, la seconde option laissant les deux banales s'appairer entre
 * elles.
 *
 * Ce qui change le total, c'est **qui ne trouve pas de partenaire**. Avec deux
 * porteuses et une seule banale, appairer la meilleure porteuse à la banale
 * laisse l'autre porteuse sur le carreau — et une stérile dépareillée ne vaut
 * plus que son extraction. Il faut alors appairer les deux porteuses.
 *
 * D'où l'appariement retenu : on **écarte la moins précieuse** quand l'effectif
 * est impair, puis on apparie la plus haute avec la plus basse, la deuxième plus
 * haute avec la deuxième plus basse, et ainsi de suite. Rien de précieux n'est
 * jamais laissé de côté, et les porteuses partent de préférence avec une banale
 * — ce qui ne change pas le total mais **décorrèle les tirages** : deux porteuses
 * distinctes appairées ensemble ne peuvent jamais survivre toutes les deux,
 * appairées séparément elles ont une chance sur quatre.
 *
 * ## L'exception : quand il n'y a pas de tirage du tout
 *
 * Tout ce qui précède raisonne sur une pièce qu'on lance. Deux stériles de même
 * couleur **et de même ascendance** n'en lancent aucune : le clone est le même
 * des deux côtés. Les apparier rend donc la même espérance avec **zéro
 * variance**, et la décorrélation ci-dessus ne s'y applique pas — on n'a jamais
 * voulu deux exemplaires de la même monture, on en voulait une, certaine.
 *
 * Or « la plus haute avec la plus basse » ne les rapproche jamais : à valeur
 * égale elles se rangent côte à côte, donc du même côté du tri. Sur l'écurie
 * réelle du 14/08, **douze propositions, toutes à pile ou face**, pendant que six
 * clonages à ascendance certaine dormaient dans la même écurie. C'était #163.
 * Elles passent donc en premier, et le reste garde la règle ci-dessus.
 *
 * ## Le sexe, qui est gratuit et qu'on oublie
 *
 * Le clone garde le genre de celle qui est clonée. Appairer deux stériles du
 * **même sexe** rend donc ce sexe certain, sans rien changer aux chances sur
 * l'ascendance. C'est strictement meilleur, et c'est le remède direct au
 * déséquilibre qui bloque les fournées : huit mâles et deux femelles ne font que
 * deux couples.
 *
 * ## Ce que le prix d'un rang ne sait pas dire : le projet
 *
 * Tout ce qui précède valorise une stérile par `cheapestAt(carried)`, le prix de
 * la couleur la moins chère de son rang. C'est un prix de **rang**, et il ignore
 * la seule chose qui décide vraiment du sort d'une monture : ce que l'éleveur
 * cherche à obtenir.
 *
 * Le relevé du 14/08 le montre sur la monture qui a coûté le plus cher à
 * comprendre — une **Azur-Turquoise gen 10, généalogie Azur (gen 9) + Pourpre**,
 * celle de l'en-tête de `pairing.ts`. Croisée avec un simple Doré gen 1 à mille
 * kamas, elle nomme **Azur-Doré**, la couleur visée. Le modèle le sait déjà :
 * `pairTargetColors` la rend à 13,95 %.
 *
 * Le prix de rang, lui, disait autre chose. `cheapestAt` lit `estimate.cost`,
 * qui est un coût de production **net des génétons** (`costs.ts`) — et les
 * génétons explosent avec la génération, 250 pour un parent gen 9. Le coût net
 * n'est donc pas croissant en génération : sur l'écurie du 16/08, la gen 10
 * valait **22 594** contre 63 502 pour une gen 2. L'écran d'extraction, qui trie
 * par valeur croissante, plaçait donc les deux gen 10 **en tête** — les moins
 * intéressantes à reproduire de toute l'écurie — et leur ambre (170 000 kamas)
 * dépassant leur « valeur », il proposait de les détruire.
 *
 * D'où `objective`. Une stérile dont le clone, croisé avec un partenaire à
 * portée, peut **nommer la couleur visée** est protégée : elle ne va jamais à
 * l'extraction, et son clonage passe devant tous les autres quel que soit son
 * gain en kamas. Ce n'est pas un arbitrage de prix — le projet n'est pas une
 * ligne de compte, et une gen 10 détruite ne se rachète nulle part.
 *
 * « À portée » se lit largement, parce que le partenaire manquant coûte mille
 * kamas : l'écurie féconde, **plus toutes les feuilles du catalogue**, qui sont
 * les seules couleurs qu'on se procure sans les élever (voir la même borne dans
 * `costs.ts`). Exiger le Doré en écurie ferait dépendre la survie d'une gen 10
 * d'un achat qu'on n'a pas encore fait.
 *
 * ## Protégée doit vouloir dire irremplaçable : la moitié rare, et elle seule
 *
 * « Peut nommer la couleur visée » protégeait les deux camps, et c'était trop
 * large de moitié. Azur-Doré se compose d'**Azur** et de **Doré**, un croisement
 * le nomme dès qu'un parent apporte l'une et l'autre l'autre — mais les deux
 * moitiés n'ont aucun rapport en rareté :
 *
 * - **Azur** est gen 9. L'écurie en tient une, elle ne se rachète nulle part.
 * - **Doré** est gen 1, à mille kamas à l'hôtel de vente, et l'écurie en tient
 *   des dizaines.
 *
 * Mesuré sur l'écurie du 15/08 : **20 stériles protégées, dont 19 par le même
 * partenaire** — un Azur-Pourpre fécond qui apportait l'Azur pendant qu'elles
 * n'apportaient que le Doré. Une protection que tout porte ne trie plus rien, et
 * elle sanctuarisait des gen 2 qu'un achat remplace.
 *
 * Le seuil est donc `carried >= cible − 1` : ce qui porte la génération juste
 * sous la couleur visée, c'est-à-dire la moitié qu'on ne rachète pas. Pour
 * Azur-Doré, gen 10, c'est **gen 9 et au-dessus** — l'Azur-Turquoise, et rien
 * d'autre.
 *
 * Il se lit sur la **cible** et non sur un 9 en dur, pour la même raison que les
 * bornes de `costs.ts` se lisent sur la recette : un projet qui viserait une
 * gen 4 protégerait ses porteuses de gen 3, et la phrase resterait la même — la
 * moitié qu'on ne peut pas racheter.
 *
 * Ce que ça change, mesuré sur la même écurie : **rien en volume**. Trois lignes
 * à extraire et 153 000 kamas dans les deux régimes — protéger une monture ne
 * fait que déplacer laquelle de ses sœurs de rang finit dépareillée. Ce sont les
 * montures qu'on détruit qui changent, pas leur nombre.
 */

/** Une monture stérile, réduite à ce que l'arbitrage a besoin d'en savoir. */
export type SterileMount = Mate & {
  /**
   * Le nom porté en jeu, ou `null` pour une anonyme.
   *
   * C'est le seul repère que l'écurie du jeu donne, donc la seule chose qui
   * permette d'exécuter une consigne portant sur une monture précise. Voir
   * `cloneOptions` : les anonymes n'y entrent pas.
   */
  name: string | null;
  /** La génération affichée, celle que le jeu compare pour autoriser le clonage. */
  generation: number;
  /** La génération que son ascendance porte : ce qu'elle permet réellement. */
  carried: number;
  /** Ce qu'il faudrait payer pour la remplacer dans son rôle. */
  value: number;
  /**
   * Elle apporte au projet la **moitié qu'on ne rachète pas**, et son clone peut
   * nommer la couleur visée.
   *
   * Les deux conditions comptent. « Peut nommer la couleur visée » seul protégeait
   * aussi bien la gen 2 qui apporte un Doré à mille kamas que la gen 10 qui
   * apporte l'Azur — 20 montures sur 20 sur l'écurie du 15/08. D'où le seuil sur
   * la génération portée, `cible − 1`. Voir l'en-tête.
   *
   * `false` partout tant qu'aucun projet n'est choisi. Ce drapeau prime sur
   * `value`, qui est un prix de rang et ne sait rien du but.
   */
  servesObjective: boolean;
};

/** Le projet en cours, tel que l'arbitrage a besoin de le lire. */
export type Objective = {
  /** La couleur visée. */
  colorId: string;
  /** Le catalogue de la famille : `pairOutlook` en a besoin pour lire les lignées. */
  colors: BreedingColor[];
};

export type CloneContext = {
  generations: Map<string, number>;
  /** Ce qu'une couleur coûte à se procurer. */
  costOf: (colorId: string) => number;
  /**
   * La couleur la moins chère d'une génération donnée — le prix de remplacement
   * du **rôle**, puisque n'importe quelle monture de cette génération le tient.
   *
   * Un prix de rang, et rien de plus : il ne sait pas ce que le projet vise, et
   * il n'est même pas croissant en génération. Voir l'en-tête, § « le projet ».
   */
  cheapestAt: (generation: number) => number;
  /** Ce que l'extraction rend par unité, pour chiffrer ce qu'on renonce à sacrifier. */
  sacrificeUnitValue: number;
  /**
   * Le projet en cours, ou `null`. Absent, rien ne change : aucune stérile n'est
   * protégée et l'arbitrage reste celui des kamas seuls — c'est le régime dans
   * lequel tourne la simulation, qui n'a pas d'éleveur devant l'écran.
   */
  objective?: Objective | null;
  /**
   * Apparier aussi les montures **anonymes**, que l'éleveur ne peut pas désigner
   * en jeu.
   *
   * `false` par défaut, et c'est le sens qui protège : un écran ne doit jamais
   * proposer un geste inexécutable, et l'oubli d'un futur appelant tombe du bon
   * côté. Le seul régime qui l'active est la **simulation**, où toutes les
   * montures naissent sans nom (`simulate.ts` les crée à `name: null`) : les y
   * écarter ne rendrait pas la politique plus prudente, ça lui interdirait le
   * clonage tout court, et on mesurerait une économie qui n'existe pas.
   */
  allowAnonymous?: boolean;
};

/**
 * Les partenaires qu'un clone peut trouver : l'écurie féconde, plus les feuilles
 * du catalogue.
 *
 * Les feuilles comptent parce qu'elles s'achètent — c'est la borne que `costs.ts`
 * pose déjà pour l'achat et la capture, « une couleur sans recette est une feuille
 * de l'arbre, et c'est la seule chose qu'on se procure sans l'élever ». Un Doré
 * gen 1 coûte mille kamas, et faire dépendre la survie d'une gen 10 de sa présence
 * en écurie serait la détruire pour un achat qu'on n'a pas encore fait.
 *
 * Les autres stériles n'y sont pas : un clonage consomme deux montures et n'en
 * rend qu'une, donc deux stériles clonées ensemble ne peuvent pas ensuite se
 * croiser l'une avec l'autre.
 */
const reachableMates = (stable: Stable, objective: Objective): Mate[] => [
  ...[...mateGroups(stable).values()].map((group) => group.sample),
  ...objective.colors
    .filter((color) => color.recipes.length === 0)
    .map((color) => ({
      id: null,
      colorId: color.id,
      sex: 'M' as Sex,
      level: BULK_MATE_LEVEL,
      parents: null,
    })),
];

/** Les stériles suivies individuellement, valorisées par ce qu'elles permettent. */
export const sterileMounts = (stable: Stable, context: CloneContext): SterileMount[] => {
  const mounts = stable.individuals
    .filter((mount: Individual) => isSterile(mount))
    .map((mount) => {
      const generation = context.generations.get(mount.colorId) ?? 1;
      const carried = carriedGeneration(
        generation,
        mount.parents
          ? [
              context.generations.get(mount.parents[0]) ?? 1,
              context.generations.get(mount.parents[1]) ?? 1,
            ]
          : null
      );
      return {
        id: mount.id,
        colorId: mount.colorId,
        name: mount.name,
        sex: mount.sex,
        level: mount.level,
        parents: mount.parents,
        generation,
        carried,
        value: context.cheapestAt(carried),
        servesObjective: false,
      };
    });

  const objective = context.objective;
  if (!objective) return mounts;

  // Le sexe n'entre pas dans ce qu'un croisement peut nommer — `pairShape` range
  // ses deux signatures avant de mettre en cache — donc l'ordre des deux montures
  // n'a pas à être celui d'un vrai couple.
  const mates = reachableMates(stable, objective);

  /**
   * La moitié qu'on ne rachète pas : ce qui porte la génération juste sous la
   * couleur visée. Voir l'en-tête — sans ce seuil, une gen 2 qui n'apporte qu'un
   * Doré à mille kamas était protégée comme la gen 10 qui apporte l'Azur.
   */
  const scarceFrom = (context.generations.get(objective.colorId) ?? 1) - 1;

  for (const mount of mounts) {
    if (mount.carried < scarceFrom) continue;
    mount.servesObjective = mates.some((mate) =>
      pairOutlook(mount, mate, objective.colors, context.generations)?.targetColors.some(
        (color) => color.colorId === objective.colorId
      )
    );
  }

  return mounts;
};

/** Un appairage de clonage proposé, et ce qu'on en attend. */
export type CloneOption = {
  /** Celle qu'on espère récupérer : la plus précieuse des deux. */
  keep: SterileMount;
  partner: SterileMount;
  /**
   * Chance de récupérer `keep` : **1** quand les deux portent la même
   * ascendance — le tirage ne change alors rien — et **0,5** sinon.
   */
  keepChance: number;
  /** Valeur espérée du clone obtenu. */
  expectedValue: number;
  /** Ce qu'on renonce à extraire en détruisant les deux. */
  sacrificed: number;
  /** Gain net de l'opération. Négatif : mieux vaut extraire. */
  gain: number;
  /** `true` quand les deux sont du même sexe, donc le sexe du clone est certain. */
  certainSex: boolean;
  /** Le sexe obtenu, ou `null` s'il dépend du tirage. */
  sex: Sex | null;
  /**
   * L'une des deux au moins sert le projet. Ces clonages passent devant tous les
   * autres, et `gain` cesse d'avoir son mot à dire — voir l'en-tête.
   */
  servesObjective: boolean;
};

/**
 * Ce que rend l'extraction d'une monture : une ressource par génération, et
 * rien du tout en génération 1 — elles ne s'extraient pas.
 */
const sacrificeValue = (mount: SterileMount, { sacrificeUnitValue }: CloneContext) =>
  mount.generation > 1 ? mount.generation * sacrificeUnitValue : 0;

/**
 * Un clonage chiffré : ce qu'il rend en espérance, contre ce qu'il renonce à
 * extraire.
 *
 * `keepChance` vaut **1** quand les deux portent la même ascendance — le tirage
 * ne change alors rien, l'une comme l'autre rend le même clone — et 0,5 sinon.
 */
const optionFor = (
  keep: SterileMount,
  partner: SterileMount,
  context: CloneContext
): CloneOption => {
  const keepChance = mateSignature(keep) === mateSignature(partner) ? 1 : 0.5;
  const expectedValue = keepChance * keep.value + (1 - keepChance) * partner.value;
  const sacrificed = sacrificeValue(keep, context) + sacrificeValue(partner, context);
  const certainSex = keep.sex === partner.sex;

  return {
    keep,
    partner,
    keepChance,
    expectedValue,
    sacrificed,
    gain: expectedValue - sacrificed,
    certainSex,
    sex: certainSex ? keep.sex : null,
    servesObjective: keep.servesObjective || partner.servesObjective,
  };
};

/** Ce qui sert le projet passe devant, avant toute comparaison de kamas. */
/**
 * Deux stériles **indiscernables** : même couleur, même ascendance, même sexe,
 * même nom porté.
 *
 * ## Pourquoi le nom, alors que l'ascendance suffisait
 *
 * Pour l'espérance, elle suffit : c'est elle qui met `keepChance` à 1. Mais le
 * geste se fait dans le jeu, et là c'est le **nom** qui compte — cloner deux
 * exemplaires du même nom se fait en une recherche au lieu de deux, et l'éleveur
 * le mesure à environ **cinq fois plus rapide**. C'est un gain de temps réel, pas
 * une préférence d'affichage.
 *
 * ## Les deux critères coïncident, et on ne fait pas semblant
 *
 * « Même nom donc même ascendance » est une invariante de cet outil : le nom est
 * généré depuis la couleur, l'ascendance et le sexe (voir `naming.ts`). Vérifiée
 * sur l'écurie réelle du 17/08 — 145 montures nommées, 83 noms distincts, dont
 * `G1 DO F DO-IN` porté par sept montures : **aucun** nom porté par deux
 * ascendances différentes.
 *
 * On la vérifie quand même à chaque paire au lieu de s'y fier. Si elle cassait un
 * jour — une monture achetée qu'on renomme comme une autre — une paire de même
 * nom serait mise en tête alors que son clone est à pile ou face, et l'écran
 * conseillerait la vitesse au prix d'une lignée sans le dire. Le prédicat, lui,
 * refuse simplement de la reconnaître.
 *
 * ## L'ascendance se compare par `ascendanceKey`, jamais à la main
 *
 * Elle se comparait par un `join` sur l'ordre stocké, et deux montures nées du
 * même croisement joué dans les deux sens n'étaient donc pas reconnues — alors
 * qu'elles portent le même nom, ce que le critère d'au-dessus exige déjà. Les
 * deux `G2 DOPO M DO-PO` de l'écurie du 15/08 s'affichaient ainsi en paire à
 * départager au lieu d'un « × 2 » certain.
 */
export const indistinguishablePair = (
  a: { colorId: string; sex: Sex; name: string | null; parents: readonly string[] | null },
  b: { colorId: string; sex: Sex; name: string | null; parents: readonly string[] | null }
): boolean =>
  a.colorId === b.colorId &&
  a.sex === b.sex &&
  a.name === b.name &&
  ascendanceKey(a.colorId, a.parents) === ascendanceKey(b.colorId, b.parents);

/** Les doublons en tête : voir `indistinguishablePair`. */
const duplicateFirst = (a: CloneOption, b: CloneOption) =>
  Number(indistinguishablePair(b.keep, b.partner)) -
  Number(indistinguishablePair(a.keep, a.partner));

const objectiveFirst = (a: { servesObjective: boolean }, b: { servesObjective: boolean }) =>
  Number(b.servesObjective) - Number(a.servesObjective);

/**
 * Les clonages à faire, du plus rentable au moins.
 *
 * Glouton par génération, puisque le jeu n'apparie qu'à génération affichée
 * égale. Dans chaque génération, les **jumelles** partent ensemble d'abord — le
 * clone y est certain, voir l'en-tête — puis la plus précieuse du reste part avec
 * la moins précieuse, en préférant une partenaire du même sexe pour rendre le
 * sexe du clone certain.
 *
 * Les appairages à gain négatif sont rendus quand même, en queue : ils disent
 * qu'il vaut mieux extraire, et c'est une décision autant qu'une autre.
 */
export const cloneOptions = (
  stable: Stable,
  context: CloneContext,
  limit = 10
): CloneOption[] => {
  /**
   * Deux clés, et il faut les deux.
   *
   * La **génération affichée** est la contrainte du jeu : il refuse d'apparier
   * au-delà. La **génération portée** est la nôtre : le tirage étant celui du
   * jeu, apparier une porteuse de gén. 3 à une porteuse de gén. 1 perd la gén. 3
   * une fois sur deux, et rien ne peut le rattraper une fois les deux montures
   * engagées. Voir l'en-tête.
   *
   * Ce qui n'a pas de partenaire à génération portée égale n'est donc pas
   * proposé. Ce n'est pas un oubli : c'est le refus d'un pile ou face sur une
   * lignée.
   */
  const byGeneration = new Map<string, SterileMount[]>();
  for (const mount of sterileMounts(stable, context)) {
    /**
     * **Aucune anonyme, jamais.**
     *
     * Une consigne de clonage désigne deux montures précises, et le nom est le
     * seul repère que l'écurie du jeu donne — une anonyme ne se cherche pas, elle
     * se compte dans un tas. « Clone cet Orchidée-là » devant quarante Orchidée
     * identiques n'est pas une consigne.
     *
     * Et il n'y a rien à y perdre : une monture est anonyme parce qu'elle n'a pas
     * d'ascendance à porter (voir `naming.ts`), donc son clone n'en portera pas
     * davantage. C'est une gen 1 nue, ce qui s'achète au filet pour mille kamas.
     * `cloningsToRecord` écartait déjà les paires anonymes **des deux côtés** ; la
     * règle est simplement devenue celle qu'elle aurait toujours dû être, et elle
     * vit ici, dans la seule liste que les deux écrans lisent.
     *
     * La simulation lève la règle — voir `allowAnonymous` : elle n'a pas
     * d'éleveur à qui donner une consigne, et ses montures naissent toutes sans
     * nom.
     */
    if (mount.name === null && !context.allowAnonymous) continue;

    const key = `${mount.generation}|${mount.carried}`;
    const group = byGeneration.get(key) ?? [];
    group.push(mount);
    byGeneration.set(key, group);
  }

  const options: CloneOption[] = [];

  for (const group of byGeneration.values()) {
    // Ce qui sert le projet se range en tête, donc jamais du côté que
    // `pool.pop()` laisse sur le carreau quand l'effectif est impair. Une gen 10
    // dépareillée n'a plus que l'ambre, et c'est exactement ce qu'on refuse.
    const sorted = [...group].sort(
      (a, b) => objectiveFirst(a, b) || b.value - a.value || a.id!.localeCompare(b.id!)
    );

    /**
     * D'abord les **jumelles** : deux stériles dont le clone est le même, quel
     * que soit le côté de la pièce.
     *
     * « La plus haute avec la plus basse » ne les rapproche jamais, puisqu'elles
     * ont exactement la même valeur et se rangent donc côte à côte du même côté
     * du tri. Sur l'écurie réelle du 14/08 ça donnait **douze propositions,
     * toutes à pile ou face**, pendant que six clonages à ascendance certaine
     * dormaient dans la même écurie. C'est le défaut de #163.
     *
     * Les apparier ne change **rien à l'espérance** — l'argument du §3 tient, un
     * parc apparié vaut la moitié de la somme quel que soit l'appariement — mais
     * il retire la variance là où elle n'achète rien. Deux jumelles appariées
     * séparément se perdent toutes les deux une fois sur quatre ; ensemble, il en
     * ressort une à coup sûr.
     *
     * Et la décorrélation du §3 ne s'y oppose pas : elle vaut pour deux porteuses
     * **distinctes**, qu'on voudrait garder toutes les deux. De deux jumelles on
     * n'en a jamais voulu deux — le jeu ne conserve que la couleur, le sexe, le
     * nom et la généalogie, et elles les partagent toutes. On en voulait une,
     * certaine.
     *
     * Deux passes, et l'ordre dit ce qui prime. Le même sexe d'abord, parce qu'il
     * rend le clone certain sur les deux tableaux à la fois. Puis l'ascendance
     * seule : un sexe tiré à pile ou face se rachète à l'hôtel de vente, une
     * ascendance perdue ne se rachète pas.
     */
    const taken = new Set<SterileMount>();
    const pairTwins = (keyOf: (mount: SterileMount) => string) => {
      const twins = new Map<string, SterileMount[]>();
      for (const mount of sorted) {
        if (taken.has(mount)) continue;
        const key = keyOf(mount);
        twins.set(key, [...(twins.get(key) ?? []), mount]);
      }
      for (const sisters of twins.values()) {
        for (let i = 0; i + 1 < sisters.length; i += 2) {
          options.push(optionFor(sisters[i], sisters[i + 1], context));
          taken.add(sisters[i]);
          taken.add(sisters[i + 1]);
        }
      }
    };
    pairTwins((mount) => `${mateSignature(mount)}|${mount.sex}`);
    pairTwins((mount) => mateSignature(mount));

    // Ce qui n'a pas trouvé sa jumelle garde la règle d'origine.
    const pool = sorted.filter((mount) => !taken.has(mount));

    // Effectif impair : c'est la moins précieuse qui reste sur le carreau, et
    // c'est le seul choix qui coûte quelque chose. Laisser une porteuse
    // dépareillée la réduirait à son extraction.
    if (pool.length % 2 === 1) pool.pop();

    while (pool.length >= 2) {
      const keep = pool.shift()!;

      // La plus basse restante, et à valeur égale celle du même sexe : le sexe
      // certain ne coûte rien et débloque les fournées.
      let index = pool.length - 1;
      for (let i = pool.length - 1; i >= 0; i -= 1) {
        if (pool[i].value > pool[index].value) break;
        if (pool[i].sex === keep.sex) {
          index = i;
          break;
        }
      }
      const partner = pool.splice(index, 1)[0];
      options.push(optionFor(keep, partner, context));
    }
  }

  /**
   * Par **génération croissante**, comme les accouplements.
   *
   * L'ordre suit la façon dont on les fait : on descend la liste devant l'écurie,
   * et une progression basse-vers-haute se suit sans perdre sa place. C'est l'ordre
   * que l'éleveur a demandé.
   *
   * Puis, **à génération égale, les doublons** : deux stériles de même nom se
   * clonent en une recherche au lieu de deux, ce qui va environ cinq fois plus
   * vite dans le jeu. Voir `indistinguishablePair`. À génération égale ils ne
   * coûtent rien à privilégier — ils ont déjà `keepChance` à 1, donc le meilleur
   * gain aussi.
   *
   * Ce que ça relègue au départage : « ce qui sert le projet passe devant », puis le
   * meilleur gain. Les deux tenaient — le premier surtout, qui met en tête ce qu'il
   * ne faut pas détruire. Ils restent, mais **à génération égale** seulement, si
   * bien qu'une paire de gen 2 sans intérêt passe maintenant devant une gen 8 qui
   * sert le projet. C'est le prix de l'ordre demandé.
   *
   * `objectiveFirst` n'est qu'un ordre d'affichage, pas une protection : ce qui
   * garde une stérile hors des propositions est le filtre de `servesObjective` en
   * amont, et il n'est pas touché.
   */
  return options
    .sort(
      (a, b) =>
        a.keep.generation - b.keep.generation ||
        duplicateFirst(a, b) ||
        objectiveFirst(a, b) ||
        b.gain - a.gain
    )
    .slice(0, limit);
};

/**
 * Les stériles qu'un clonage apparie, quel que soit le rang où elles tombent.
 *
 * `limit` est levé : le plafond de `cloneOptions` sert à ne pas noyer un écran de
 * conseils, alors que la question posée ici est « existe-t-il un clonage pour
 * elle », et elle se pose sur toute l'écurie.
 *
 * **On le demande à `cloneOptions`** plutôt que de refaire le calcul, et c'est le
 * résultat d'une mesure. Le jeu n'appariant qu'à génération affichée égale, un
 * effectif impair laisse forcément une monture dehors, et `cloneOptions` documente
 * laquelle : la moins précieuse du rang. Rejouer cette règle ailleurs paraissait
 * sûr — elle tient en trois lignes — et elle est fausse : les deux passes de
 * **jumelles** consomment d'abord les montures à ascendance identique, si bien que
 * la dépareillée est la moins précieuse de ce qui **reste**, pas du rang. Sur 200
 * écuries tirées au hasard, 94 désaccords, dans les deux sens.
 *
 * Or les écrans qui la lisent parlent du même geste, et il est irréversible :
 * « dépareillée, il ne lui reste que l'ambre » sur une monture que l'onglet
 * Clonage propose d'apparier est exactement l'erreur qu'on ne peut pas rattraper.
 */
export const pairedSterileIds = (stable: Stable, context: CloneContext): Set<string> => {
  const ids = new Set<string>();
  for (const option of cloneOptions(stable, context, Number.POSITIVE_INFINITY)) {
    if (option.keep.id) ids.add(option.keep.id);
    if (option.partner.id) ids.add(option.partner.id);
  }
  return ids;
};

/**
 * Les stériles que le projet protège et qu'**aucun clonage ne peut apparier**.
 *
 * Elles n'ont leur place sur aucune des deux listes : l'extraction ne les prend
 * pas — elles servent le but — et le clonage ne les propose pas, faute d'une
 * seconde stérile à leur génération affichée. Sans cette liste elles
 * disparaîtraient des deux écrans, ce qui est précisément la panne que l'onglet
 * Extraction avait été écrit pour éviter.
 *
 * Ce qu'elles attendent n'est pas un geste mais une monture : une autre stérile
 * de leur rang, qu'une naissance produira. En attendant, la seule consigne utile
 * est « ne la détruis pas », et elle doit être écrite quelque part.
 *
 * Les anonymes n'y sont pas, pour la même raison qu'ailleurs et une de plus :
 * elles ne se désignent pas en jeu, et elles ne risquent rien — sans ascendance,
 * elles sont gen 1, et l'extraction ne prend pas les gen 1. Les lister
 * noierait les deux ou trois montures qui comptent sous les quarante Doré du tas.
 */
export const unpairedObjectiveSteriles = (
  stable: Stable,
  context: CloneContext
): SterileMount[] => {
  if (!context.objective) return [];
  const paired = pairedSterileIds(stable, context);
  return sterileMounts(stable, context).filter(
    (mount) =>
      mount.servesObjective &&
      mount.name !== null &&
      !(mount.id !== null && paired.has(mount.id))
  );
};

/**
 * Le préfixe des montures **projetées** : celles qu'un clonage rendra, et qui
 * n'ont pas encore de ligne en base.
 *
 * Un identifiant fabriqué qui ressemble à un uuid est exactement le piège de
 * #165 — Postgres refuse `dore#M0` sur une colonne `uuid`, et un `.in()` sur une
 * ligne qui n'existe pas ne rend **aucune erreur**. Celui-ci ne ressemble à rien
 * de ce que la base porte, et `isProjected` permet de le reconnaître partout où
 * il pourrait déborder vers une écriture.
 */
const PROJECTED_PREFIX = 'clone-a-venir:';

/**
 * `true` pour une monture **projetée**, donc sans ligne en base : le clone qu'un
 * clonage rendra comme le poulain qu'un accouplement rendra.
 *
 * Les deux préfixes, et non le seul clonage : c'est le même risque, et il n'y a
 * aucune raison qu'un appelant ait à savoir laquelle des deux projections l'a
 * fabriquée. Ce qu'il demande, c'est « cet identifiant désigne-t-il une ligne que
 * je peux écrire ? ».
 */
export const isProjected = (id: string | null | undefined): boolean =>
  typeof id === 'string' &&
  (id.startsWith(PROJECTED_PREFIX) || id.startsWith(PROJECTED_BIRTH_PREFIX));

/**
 * L'écurie **telle qu'elle sera** une fois les clonages proposés exécutés.
 *
 * ## Le défaut que ça ferme
 *
 * L'écran donne quatre consignes du jour, dont « clone ces vingt paires » et
 * « accouple ces couples-là ». La seconde était calculée sur une écurie que la
 * première allait démolir : vingt clonages retirent quarante stériles et
 * rendent vingt fertiles, et le plan est une optimisation sur l'écurie
 * **entière**. La recherche réaffectait donc ses fécondes, et des couples
 * gratuits qu'elle avait laissés de côté apparaissaient — après coup.
 *
 * Vu le 17/08 : 18 naissances saisies, puis 24 clonages, puis un
 * rafraîchissement qui proposait 4 accouplements de plus. Ils étaient réels —
 * quatre paires de fécondes que la base n'avait jamais vues s'accoupler — mais
 * l'éleveur avait fermé le jeu. Mesuré sur son écurie : **3 accouplements avant
 * les clonages, 7 après**, à fécondes identiques. Les clonages n'avaient rien
 * rendu possible ; ils avaient fait changer d'avis la politique.
 *
 * On planifie donc sur l'écurie d'après, qui est celle où l'éleveur exécutera.
 *
 * ## La survivante retenue est `keep`
 *
 * Le jeu tire au hasard laquelle des deux ressort — `keepChance` vaut 1/2 dès
 * que les ascendances diffèrent. Mais `keep` est celle que l'écran **nomme** et
 * celle sur laquelle `expectedValue` est chiffrée : projeter autre chose ferait
 * planifier l'app sur une écurie qu'elle ne conseille à personne. Et l'enjeu est
 * borné — un clone ressort fertile et **non fécond**, donc il ne peut entrer
 * dans aucun couple à zéro place ; il ne pèse que par le plan, pas par les
 * gestes qu'on saisit.
 */
export const afterClonings = (stable: Stable, clonings: CloneOption[]): Stable => {
  if (clonings.length === 0) return stable;

  const gone = new Set<string>();
  const survivors: Individual[] = [];
  const byId = new Map(stable.individuals.map((mount) => [mount.id, mount]));

  for (const option of clonings) {
    const keep = option.keep.id;
    const partner = option.partner.id;
    // Une stérile est toujours une monture suivie — le vrac ne porte que des
    // fertiles — donc les deux identifiants existent. On le relit quand même :
    // sans les deux lignes, il n'y a pas de clonage à projeter.
    if (keep === null || partner === null) continue;
    const original = byId.get(keep);
    if (!original) continue;

    gone.add(keep);
    gone.add(partner);
    survivors.push({
      ...original,
      id: `${PROJECTED_PREFIX}${keep}`,
      // Le clone a retrouvé sa reproduction, et son cycle est à payer : c'est
      // exactement ce que `recordClonings` écrit en base.
      fertile: true,
      cycled: false,
    });
  }

  if (gone.size === 0) return stable;

  return {
    bulk: stable.bulk,
    individuals: [
      ...stable.individuals.filter((mount) => !gone.has(mount.id)),
      ...survivors,
    ],
  };
};
