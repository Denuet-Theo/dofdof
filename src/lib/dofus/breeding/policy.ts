/**
 * La politique entraînée, jouée sur **votre** écurie et **vos** prix.
 *
 * C'est le point où le portage sert à quelque chose. Le Rust ne connaît ni votre
 * écurie ni vos cours : il produit des poids, et rien d'autre. Ici on lit l'écurie
 * saisie dans l'app, les prix du jour, et on fait tourner la même recherche —
 * `check-search.mjs` vérifie qu'elle rend le plan que le Rust rendrait.
 *
 * ## Ce que la politique remplace
 *
 * `buildLoadout` déroule un **plan de recettes** : viser telle couleur, donc
 * croiser tels parents. Il répond à « comment atteindre cette couleur-là ». La
 * politique répond à autre chose : « que faire de cette écurie-ci », sans cible
 * imposée. Elle apparie, elle met en banque, elle clone, elle achète — et le
 * départage entre ces quatre-là est précisément ce que la neuroévolution a appris
 * et qu'aucune heuristique n'a su écrire.
 *
 * ## Les échelles ne sont pas les vôtres, et c'est voulu
 *
 * Trois des 74 entrées sont des prix, normalisés sur le **milieu de leur
 * fourchette**. Ces fourchettes décrivent le marché sur lequel le réseau a
 * appris — trente jours de relevés dans `rust/economy.toml`. Les remplacer par
 * les vôtres mettrait les trois entrées sur une échelle que le réseau n'a jamais
 * vue, et il lirait « ambre au plus bas » là où vous avez saisi un cours normal.
 *
 * Vos prix, eux, entrent bien : ce sont les **numérateurs**. Voir `EconomyView`.
 *
 * ## L'ambre est fermée
 *
 * Le champion embarqué vient du tapis roulant, qui s'entraîne sans extraction —
 * l'ambre y convertirait du stock en kamas dans un environnement qui n'a pas
 * d'économie. Lui ouvrir l'action ici la lui proposerait dans une situation qu'il
 * n'a jamais rencontrée. Voir `SearchConfig.sacrifices`.
 */

import championArtifact from './champion.json';
import { compile, evaluate, isConnected, type Champion } from './network';
import { featuresOf, pairDelta, type EconomyView } from './census';
import {
  createSearcher,
  flatten,
  parseCountedMountId,
  planUnit,
  type SearchStrategy,
  type UnitPlan,
} from './search';
import { seededRandom } from './random';
import { BULK_MATE_LEVEL, canonicalParents, type Mate } from './pairing';
import { aimsAt, crownedLadderOf } from './ladder';
import type { BreedingColor } from './costs';
import type { Couple, Individual, Sex, Stable } from './stable';

/**
 * Les échelles du marché sur lequel le réseau a appris.
 *
 * Recopiées de `rust/economy.toml`, section `[valeurs]` et `[genetons]`. Elles ne
 * servent qu'à **normaliser** les trois entrées de prix : chacune est divisée par
 * le milieu de sa fourchette, donc elle vaut environ 1 en marché ordinaire et
 * s'écarte quand le cours s'écarte.
 *
 * Elles ne décrivent donc pas votre marché mais celui de l'entraînement, et il ne
 * faut les toucher que si `economy.toml` change — auquel cas tous les champions
 * antérieurs deviennent mal calibrés, ce qui se corrige en réentraînant, pas ici.
 */
export const TRAINING_SCALES = {
  /** L'échelle des kamas : `KAMAS` et `LIQUIDATION` s'y rapportent. */
  startingKamas: 10_000_000,
  /** L'ambre a oscillé entre 11 000 et 30 000 sur trente jours. */
  amberRange: [11_000, 30_000] as [number, number],
  /** Le géneton, net de la taxe HDV, entre 490 et 980. */
  genetonRange: [490, 980] as [number, number],
  /** Une gen 10 entre 300 000 et 1 000 000 — la plus large des trois. */
  topValueRange: [300_000, 1_000_000] as [number, number],
  /** Ce que l'Optimakina ajoute au taux de réussite. */
  optimakinaBonus: 0.1,
};

/** Ce que la politique réclame au marché du jour, tel que l'app le connaît. */
export type BreederMarket = {
  /**
   * Prix HDV du poulain, couleur par couleur. Une couleur sans prix saisi vaut
   * zéro, donc la politique ne cherchera pas à la produire : c'est honnête, mais
   * ça vaut d'être su.
   *
   * Ce n'est **pas** ce qu'une monture vaut : voir `liquidationValue`, qui prend
   * le plus haut entre ce prix et l'extraction en ambre.
   */
  marketPrice: (colorId: string) => number;
  /** Ce qu'un géneton rapporte, via le meilleur parchemin d'échange. */
  genetonValue: number;
  /** Prix d'une unité de la ressource de sacrifice — l'ambre, pour le muldo. */
  amberPerGeneration: number;
  /** Prix d'une Optimakina par génération visée, index 0 à 10. */
  optimakina: number[];
};

const generationsOf = (colors: BreedingColor[]) =>
  new Map(colors.map((color) => [color.id, color.generation]));

/**
 * Le prix d'une gen 1 anonyme.
 *
 * Le modèle n'en connaît qu'**un**, alors que l'app connaît le prix de chaque
 * couleur : la recherche facture le même montant quelle que soit la gen 1
 * achetée. On prend la médiane des prix connus plutôt que le minimum — le
 * minimum ferait paraître tous les achats aussi bon marché que la couleur la
 * moins chère, y compris ceux qui portent sur une autre.
 */
const starterPriceOf = (colors: BreedingColor[], marketPrice: (colorId: string) => number): number => {
  const prices = colors
    .filter((color) => color.generation === 1)
    .map((color) => marketPrice(color.id))
    .filter((price) => price > 0)
    .sort((a, b) => a - b);
  if (prices.length === 0) return 0;
  return prices[Math.floor(prices.length / 2)];
};

/**
 * Ce que la valeur d'une gen 10 vaut « en général », pour l'entrée de prix.
 *
 * Le modèle porte un `topValue` unique là où l'app connaît les cinquante. La
 * liquidation, elle, reste exacte : `valueOf` est consulté couleur par couleur.
 * Cette moyenne-ci ne sert qu'à la troisième entrée de prix — « le marché des
 * gen 10 est-il haut cette semaine » — qui est bien une question globale.
 */
const topValueOf = (colors: BreedingColor[], valueOf: (colorId: string) => number): number => {
  const top = colors.reduce((highest, color) => Math.max(highest, color.generation), 0);
  const prices = colors
    .filter((color) => color.generation === top)
    .map((color) => valueOf(color.id))
    .filter((price) => price > 0);
  if (prices.length === 0) return 0;
  return prices.reduce((sum, price) => sum + price, 0) / prices.length;
};

/**
 * Ce qu'une monture vaut quand on s'en sépare : **le plus haut** entre son prix à
 * l'hôtel de vente et ce que son extraction en ambre rend.
 *
 * On ne fait pas les deux — extraire détruit la monture, vendre aussi — donc c'est
 * un maximum et jamais une somme. L'app ne lisait que le marché, ce qui sous-évalue
 * les rangs intermédiaires : une gen 5 rend cinq unités d'ambre, soit cent mille
 * kamas au cours ordinaire, quand son prix de poulain est souvent bien moindre.
 *
 * ## La gen 1 reste à zéro, et c'est délibéré
 *
 * Le modèle la compte pour rien — `value_at_generation` rend `0` en deçà de la
 * gen 2 — et le réseau a été noté sur cette convention. Une écurie d'éleveur porte
 * surtout du vrac de gen 1 : leur donner leur prix de poulain gonflerait l'entrée
 * `LIQUIDATION` d'un facteur que le réseau n'a jamais vu, sur le rang le plus
 * peuplé. On corrige ce qu'on peut corriger sans déplacer l'échelle.
 *
 * ## Côté Rust, ce maximum est sans effet
 *
 * Le modèle ne connaît pas de prix de marché sous la gen 10, donc `max(ambre,
 * marché)` y vaut toujours l'ambre. Les deux côtés disent donc la même chose dès
 * que l'app applique la même règle — et le jour où le Rust portera les cinquante
 * prix intermédiaires, la règle sera déjà la bonne des deux côtés.
 */
export const liquidationValue = (
  market: BreederMarket,
  generations: Map<string, number>,
  colorId: string
): number => {
  const generation = generations.get(colorId) ?? 1;
  if (generation <= 1) return 0;
  const amber = generation * market.amberPerGeneration;
  return Math.max(market.marketPrice(colorId), amber);
};

/** Assemble la vue du marché que l'encodage réclame. */
export const economyView = (colors: BreedingColor[], market: BreederMarket): EconomyView => ({
  startingKamas: TRAINING_SCALES.startingKamas,
  amberPerGeneration: market.amberPerGeneration,
  amberRange: TRAINING_SCALES.amberRange,
  genetonValue: market.genetonValue,
  genetonRange: TRAINING_SCALES.genetonRange,
  topValue: topValueOf(colors, (colorId) => market.marketPrice(colorId)),
  topValueRange: TRAINING_SCALES.topValueRange,
  valueOf: (colorId) => liquidationValue(market, generationsOf(colors), colorId),
  optimakina: market.optimakina,
  optimakinaBonus: TRAINING_SCALES.optimakinaBonus,
  starterPrice: starterPriceOf(colors, market.marketPrice),
});

/* --------------------------------------------------------------- le plan -- */

/** Un côté de couple : la couleur, et les montures nommément. */
export type CoupleSide = {
  colorId: string;
  /** Identifiants des montures engagées. Vides pour un achat. */
  mountIds: string[];
  /** Le cycle est payé : l'accouplement est un clic, sans passer par l'enclos. */
  cycled: boolean;
};

export type CoupleLine = {
  male: CoupleSide;
  female: CoupleSide;
  count: number;
  /**
   * Le rang que le croisement **produira**, ou `null` s'il n'en produit aucun.
   *
   * `null` couvre deux cas qu'il faut lire pareil devant l'enclos : le jeu ne
   * propose pas l'accouplement, ou aucune couleur ne nomme le rang visé. Le second
   * est la **recopie** — deux Ébène visent la génération 2 et rendent un Ébène —
   * et c'est celui qu'on annonçait « gen 2 » à tort.
   */
  targetGeneration: number | null;
  /**
   * La couleur la plus probable **au rang visé**, ou `null` sur une recopie.
   *
   * Le croisement rend une distribution et non une couleur : celle-ci n'est donc
   * pas une promesse, c'est ce qu'on écrit dans « viser » faute de mieux. La
   * saisie de naissance, elle, propose toutes les issues.
   */
  targetColorId: string | null;
  /** Places d'enclos que la ligne engage : une par parent qui doit son cycle. */
  places: number;
};

/** Une couleur à sortir de l'écurie, sexes détaillés — ils ne s'échangent pas. */
export type PullLine = {
  colorId: string;
  males: number;
  females: number;
  /** La fournée vide cette couleur : il n'en restera aucune fertile. */
  exhausts: boolean;
};

export type StablePlan = {
  /**
   * Les accouplements, groupés par couple identique et **les immédiats d'abord**.
   *
   * « Immédiat » veut dire zéro place d'enclos : les deux parents sont déjà
   * féconds, donc l'accouplement est un clic, avec ce qu'on tient. Les faire passer
   * après une liste d'achats revient à faire attendre ce qui ne demande rien
   * derrière ce qui demande une course à l'hôtel de vente — c'est déjà la raison
   * pour laquelle la piste « Écurie » ouvre le ruban de la timeline.
   *
   * À coût égal, l'ordre de la recherche est conservé : il n'a pas de sens en
   * lui-même, et le brasser rendrait deux lectures successives incomparables.
   */
  couples: CoupleLine[];
  /**
   * Les montures mises en enclos **sans être croisées** : elles en sortent
   * fécondes et restent en écurie.
   *
   * C'est l'action que le découplage a ouverte, et elle n'a de sens que parce que
   * la fécondité ne se perd qu'à la naissance : une place occupée ainsi n'est pas
   * un croisement de moins, c'est un croisement de plus **au tour suivant**,
   * gratuit, dès que le partenaire existe.
   */
  cycles: { colorId: string; mountIds: string[] }[];
  /** Les clonages, par génération — deux stériles n'en font qu'à rang égal. */
  clonings: { generation: number; mountIds: string[] }[];
  /** Les gen 1 à acheter à l'hôtel de vente. */
  purchases: { colorId: string; males: number; females: number }[];
  pull: PullLine[];
  /**
   * Les accouplements que la politique a proposés et que l'échelle a refusés.
   *
   * Ils ne sont pas silencieusement effacés : un plan amputé sans rien dire est
   * exactement ce qui rend un outil impossible à croire. Le compte se rend à
   * l'écran, séparé par motif — voir `ladder.ts` pour la règle.
   */
  refused: {
    /** Ne nomme aucune couleur : recopie de l'ascendance, zéro géneton. */
    barren: number;
    /** Nomme une couleur, mais hors du plan de l'échelle. */
    offPlan: number;
  };
  /** Places engagées, sur celles du parc. */
  places: number;
  capacity: number;
  /** Le plan brut, pour qui veut les indices. */
  raw: UnitPlan;
  /** L'écurie à plat, dans l'ordre auquel les indices se rapportent. */
  mounts: Individual[];
};

export type PolicyInput = {
  stable: Stable;
  colors: BreedingColor[];
  market: BreederMarket;
  /** Places d'enclos du parc : dix par enclos, et non un croisement par enclos. */
  capacity: number;
  /** Ce que coûte le chargement dès qu'une place est occupée. */
  loadKamas: number;
  /** Le solde de l'éleveur. `0` vaut « pas de contrainte », comme ailleurs. */
  kamas: number;
  /**
   * Autoriser la politique à se **procurer** des gen 1 — achat à l'hôtel de
   * vente ou capture au filet — pour compléter la fournée.
   *
   * Vrai par défaut, et c'est ce que la mesure impose : fermé, une écurie
   * réelle ne remplissait que **7 places sur 40**. Une gen 1 coûte mille kamas
   * là où une fournée en coûte cent cinquante mille ; laisser trente-trois
   * places vides pour ne pas en dépenser trois mille est le mauvais côté de
   * l'arbitrage.
   *
   * Ce que « commencer par mon stock » veut dire est un **ordre**, pas une
   * interdiction, et c'est le parcours qui le porte : « D'abord, sans enclos »
   * liste ce que le stock permet tout de suite, la fournée à charger vient
   * après.
   *
   * Le levier reste là pour composer sans rien acquérir — et c'est aussi le
   * seul régime que le champion n'a **jamais** vu à l'entraînement, ce qui vaut
   * d'être su avant de s'en servir : sa fonction de valeur a été notée avec
   * l'achat disponible.
   */
  purchases?: boolean;
  /**
   * La graine de la montée de colline.
   *
   * Fixe par défaut : le même écran rouvert deux fois doit proposer la même
   * fournée, sans quoi on ne saurait plus si on a déjà chargé celle d'avant.
   */
  seed?: number;
  iterations?: number;
};

const DEFAULT_SEED = 1;

/**
 * Le nombre de mutations que la recherche tire par fournée.
 *
 * Six cents, qui est le défaut de `breeding-neat` — donc le régime dans lequel le
 * champion a été noté. La recherche est stochastique et la fonction de valeur a
 * été sélectionnée **pour ce budget-là** : lui en donner deux fois plus n'est pas
 * « chercher mieux », c'est la mettre dans un régime qu'elle n'a pas connu.
 */
const TRAINING_ITERATIONS = 600;

/**
 * Ce que la politique ferait de cette écurie, ou `null` si elle ne peut pas
 * répondre.
 *
 * Trois raisons de rendre `null`, et elles se disent : l'artefact n'a pas la bonne
 * arité, sa sortie ne reçoit rien, ou l'écurie est vide. Aucune n'est un défaut
 * d'affichage — mieux vaut ne rien montrer qu'une fournée inventée.
 */
export const stablePlan = (input: PolicyInput): StablePlan | null => {
  const champion = championArtifact as Champion;
  const mounts = flatten(input.stable);
  if (mounts.length === 0) return null;

  const network = compile(champion);
  if (network.inputs !== champion.features || !isConnected(network)) return null;

  const generations = new Map(input.colors.map((color) => [color.id, color.generation]));
  const economy = economyView(input.colors, input.market);
  const strategy = strategyOf(champion);

  /**
   * Le plan **couronné**, et pas le plan brut.
   *
   * `ladderOf` s'arrête au dernier barreau impair en gardant **toutes** ses
   * couleurs, parce qu'à ce moment-là on ne sait pas encore laquelle servira. La
   * politique mesurée, elle, tranche à sa première fournée : une seule gen 10,
   * donc une seule gen 9, et tout ce que plus rien ne réclame sort du plan.
   *
   * Sans ce couronnement, `aimsAt` admettait ici des croisements que le Rust
   * refuse là-bas — 154 paires de couleurs admissibles au lieu de 114 chez le
   * muldo — et le « 0 % d'accouplements sans cible » publié en tête de
   * `ladder.ts` était celui d'un plan que le navigateur n'appliquait pas.
   *
   * `economy.valueOf` est l'équivalent de `Economy::value_of` : pour une gen 10,
   * le plus haut entre son prix HDV et son extraction en ambre. Les deux ne sont
   * pas à la même échelle, ce qui est sans effet — la couronne ne compare les
   * gen 10 qu'**entre elles**, jamais à un seuil, donc seul leur classement
   * compte. Une famille dont l'éleveur n'a saisi aucun prix les rend toutes
   * égales : le critère se rabat alors sur le partenaire, qui ne dépend pas du
   * marché.
   */
  const ladder = crownedLadderOf(input.colors, economy.valueOf);

  const plan = planUnit(
    createSearcher({
      iterations: input.iterations ?? TRAINING_ITERATIONS,
      // Voir l'en-tête : le champion du tapis n'a jamais vu l'extraction.
      sacrifices: false,
      // Rouvert, et c'est la fournée qui l'a tranché : sans procurement, le parc
      // tombait à **7 places sur 40**. Une gen 1 à mille kamas est le moyen le
      // moins cher de ne pas laisser une place vide, et trente-trois places
      // vides coûtent une fournée entière.
      //
      // « Commencer par ce que j'ai » ne veut pas dire « ne jamais se
      // procurer » : c'est un **ordre**, et c'est le parcours qui le porte —
      // « D'abord, sans enclos » liste les accouplements que le stock permet
      // tout de suite, puis vient la fournée à charger, où les gen 1 procurées
      // occupent les places qui restaient. Voir `SearchConfig.purchases`, qui
      // garde le levier pour qui veut composer sans rien acquérir.
      purchases: input.purchases ?? true,
      // La règle de l'échelle entre **dans** la recherche et non après elle.
      // Filtrer le plan rendu laissait la recherche dépenser ses quarante places
      // en croisements qu'on jetait ensuite : 22 propositions écartées sur 26, et
      // une fournée retombée à 10 places sur 40. Ici, les places vont d'emblée à
      // ce qui peut payer.
      admissible: (male, female) => aimsAt(male, female, input.colors, generations, ladder) !== null,
    }),
    {
      mounts,
      colors: input.colors,
      generations,
      economy,
      strategy,
      // Un solde à zéro veut dire « non renseigné », donc pas de contrainte —
      // même lecture que `planFunding`. Refuser toute fournée à qui n'a pas saisi
      // son budget serait la pire interprétation d'un champ vide.
      kamas: input.kamas > 0 ? input.kamas : Number.MAX_SAFE_INTEGER,
      capacity: input.capacity,
      loadKamas: input.loadKamas,
    },
    seededRandom(input.seed ?? DEFAULT_SEED),
    (census) => evaluate(network, featuresOf(census, input.colors, economy))
  );

  return readPlan(plan, mounts, input, generations, economy, strategy);
};

/**
 * Les réglages que le génome porte, pour l'unité de tête.
 *
 * Ils ne viennent pas de la recherche mais de l'évolution : une bande rapide ne se
 * justifie que par les chargements supplémentaires qu'elle laisse faire, ce qui
 * n'apparaît nulle part dans l'écurie qu'un chargement laisse derrière lui. Seuls
 * le niveau et le seuil d'Optimakina comptent ici — les bandes règlent les jauges,
 * que cet écran-ci ne pilote pas.
 */
const strategyOf = (champion: Champion): SearchStrategy => {
  const first = (champion.strategies ?? [])[0] as
    | { level?: number; optimakina_from?: number }
    | undefined;
  return {
    level: first?.level ?? 0,
    optimakinaFrom: first?.optimakina_from ?? 11,
  };
};

/**
 * Regroupe deux montures interchangeables : même couleur, même ascendance, même
 * état de cycle.
 *
 * La même réduction que la recherche, et il faut que ce soit la même : sans elle
 * l'écran listerait deux lignes « ♂ Ébène + ♀ Ébène » là où la recherche n'a vu
 * qu'un seul groupe, l'une pour les achetés et l'autre pour les nés de recopie.
 * Voir `canonicalParents`.
 */
const signatureOf = (mount: Pick<Individual, 'colorId' | 'parents' | 'cycled'>) =>
  `${mount.colorId}|${(canonicalParents(mount.colorId, mount.parents) ?? []).join('+')}` +
  `|${mount.cycled ? 1 : 0}`;

const mateOf = (mount: Individual): Mate => ({
  id: mount.id,
  colorId: mount.colorId,
  sex: mount.sex,
  level: BULK_MATE_LEVEL,
  parents: mount.parents,
});

/**
 * Le plan brut, relu en gestes.
 *
 * Les indices de `UnitPlan` sont virtuels : au-delà de `mounts.length` ils
 * désignent un achat, dans l'ordre où les achats sont listés. C'est le contrat de
 * `materialise`, et le seul endroit où il se dénoue.
 */
const readPlan = (
  plan: UnitPlan,
  mounts: Individual[],
  input: PolicyInput,
  generations: Map<string, number>,
  economy: EconomyView,
  strategy: SearchStrategy
): StablePlan => {
  const bought = (index: number) => plan.purchases[index - mounts.length] ?? null;

  /**
   * Ce que le couple vise : le rang, et la couleur la plus probable à ce rang.
   *
   * `null` sur une recopie — aucune couleur ne nomme le rang, donc il n'y a rien à
   * viser. La couleur n'est pas une promesse : le croisement rend une distribution,
   * et c'est la saisie de naissance qui propose toutes les issues.
   */
  const aimedAt = (maleMate: Mate | null, femaleMate: Mate | null) => {
    if (!maleMate || !femaleMate) return null;
    const delta = pairDelta(
      maleMate,
      femaleMate,
      input.colors,
      generations,
      economy,
      strategy.level,
      strategy.optimakinaFrom
    );
    if (!delta?.namesTarget) return null;
    const best = delta.births
      .filter(([colorId]) => (generations.get(colorId) ?? 1) === delta.targetGeneration)
      .sort((a, b) => b[1] - a[1])[0];
    return { generation: delta.targetGeneration, colorId: best?.[0] ?? null };
  };

  const couples = new Map<string, CoupleLine>();
  const refused = { barren: 0, offPlan: 0 };
  let places = 0;

  /**
   * La règle de l'échelle, appliquée à ce que la politique entraînée propose.
   *
   * Elle n'est pas un filtre d'affichage : un croisement qui ne nomme rien
   * **stérilise ses deux parents** et ne rend aucun géneton, donc le proposer
   * coûte deux montures pour rien. La politique entraînée en propose — mesuré à
   * 50,5 % des accouplements sur deux cents graines, contre 0 % pour l'échelle —
   * et rien ne les écartait avant d'arriver à l'écran.
   *
   * ## Pourquoi ce filet reste, alors que la recherche filtre déjà
   *
   * `SearchConfig.admissible` écarte ces croisements **avant** qu'ils coûtent une
   * place, ce qui est le vrai correctif : filtrer ici seulement laissait la
   * fournée retomber à dix places sur quarante, les places jetées n'étant
   * reprises par personne. Ce qui suit ne devrait donc plus rien compter.
   *
   * On le garde parce qu'un compte à zéro est une **vérification**, pas un coût :
   * le jour où les deux règles divergeront — un plan chargé d'ailleurs, un
   * champion régénéré, un catalogue changé — le bandeau le dira au lieu de
   * laisser passer.
   *
   * Le plan lu ici est le **couronné**, comme celui que la recherche a employé :
   * comparer le filet d'affichage à un plan plus large que celui du filtre ferait
   * compter zéro refus par construction, ce qui ne vérifierait rien.
   */
  const ladder = crownedLadderOf(input.colors, economy.valueOf);

  for (const [maleIndex, femaleIndex] of plan.crossings) {
    const side = (index: number, sex: Sex): [CoupleSide, Mate | null, boolean] => {
      const mount = mounts[index];
      if (mount) {
        return [
          { colorId: mount.colorId, mountIds: [mount.id], cycled: mount.cycled },
          mateOf(mount),
          mount.cycled,
        ];
      }
      const purchase = bought(index);
      if (!purchase) return [{ colorId: '?', mountIds: [], cycled: false }, null, false];
      return [
        { colorId: purchase[0], mountIds: [], cycled: false },
        { id: null, colorId: purchase[0], sex, level: BULK_MATE_LEVEL, parents: null },
        false,
      ];
    };

    const [male, maleMate, maleCycled] = side(maleIndex, 'M');
    const [female, femaleMate, femaleCycled] = side(femaleIndex, 'F');
    const aimed = aimedAt(maleMate, femaleMate);

    // « Un croisement est admissible si et seulement si ses couleurs cibles sont
    // non vides et toutes dans le plan. » Les deux moitiés se comptent à part :
    // la première est une faute du couple, la seconde un désaccord avec la
    // route, et l'éleveur ne les corrige pas du même geste.
    if (maleMate && femaleMate) {
      if (!aimed) {
        refused.barren += 1;
        continue;
      }
      if (!aimsAt(maleMate, femaleMate, input.colors, generations, ladder)) {
        refused.offPlan += 1;
        continue;
      }
    }

    const cost = (maleCycled ? 0 : 1) + (femaleCycled ? 0 : 1);
    places += cost;

    const key = `${signatureOf({ colorId: male.colorId, parents: mounts[maleIndex]?.parents ?? null, cycled: male.cycled })}/${signatureOf({ colorId: female.colorId, parents: mounts[femaleIndex]?.parents ?? null, cycled: female.cycled })}`;
    const line = couples.get(key);
    if (line) {
      line.count += 1;
      line.male.mountIds.push(...male.mountIds);
      line.female.mountIds.push(...female.mountIds);
      line.places += cost;
      continue;
    }
    couples.set(key, {
      male,
      female,
      count: 1,
      // Le rang visé n'est affichable que si une couleur le nomme : sinon le
      // couple recopie, et l'annoncer serait promettre une génération qui ne
      // viendra pas. `PairDelta` porte le drapeau, on le lui redemande.
      targetGeneration: aimed?.generation ?? null,
      targetColorId: aimed?.colorId ?? null,
      places: cost,
    });
  }

  // Une fécondation occupe une place et ne consomme pas la reproduction : c'est
  // ce qui la distingue d'un croisement, et ce qui la rend lisible seulement si
  // on la compte à part.
  const cycles = new Map<string, string[]>();
  for (const index of plan.cycles) {
    const mount = mounts[index];
    if (!mount) continue;
    places += 1;
    const list = cycles.get(mount.colorId) ?? [];
    list.push(mount.id);
    cycles.set(mount.colorId, list);
  }

  const clonings = new Map<number, string[]>();
  for (const [first, second] of plan.clonings) {
    const mount = mounts[first];
    if (!mount) continue;
    const generation = generations.get(mount.colorId) ?? 1;
    const list = clonings.get(generation) ?? [];
    list.push(mount.id, mounts[second]?.id ?? '');
    clonings.set(generation, list.filter(Boolean));
  }

  const purchases = new Map<string, { colorId: string; males: number; females: number }>();
  for (const [colorId, sex] of plan.purchases) {
    const row = purchases.get(colorId) ?? { colorId, males: 0, females: 0 };
    if (sex === 'M') row.males += 1;
    else row.females += 1;
    purchases.set(colorId, row);
  }

  return {
    refused,
    couples: [...couples.values()].sort((a, b) => a.places - b.places),
    cycles: [...cycles].map(([colorId, mountIds]) => ({ colorId, mountIds })),
    clonings: [...clonings].map(([generation, mountIds]) => ({ generation, mountIds })),
    purchases: [...purchases.values()],
    pull: pullOf(plan, mounts),
    places,
    capacity: input.capacity,
    raw: plan,
    mounts,
  };
};

/**
 * Le plan déroulé en croisements **un par un**, pour la saisie.
 *
 * `CoupleLine` regroupe les couples identiques parce qu'on lit une liste ; la
 * fenêtre d'accouplement, elle, en traite un à la fois — c'est le geste du jeu, et
 * chaque naissance a sa couleur et son sexe. On déplie donc, en gardant l'ordre du
 * plan : les immédiats d'abord.
 *
 * Un parent acheté porte `mountId: null`, ce qui est exactement ce que la saisie
 * attend d'une monture de vrac — sans généalogie, interchangeable, sans nom à
 * chercher. Il porte en plus `bought`, parce qu'il n'est **pas** dans le coffre.
 *
 * ## Seuls les couples réalisables **maintenant**
 *
 * Un accouplement demande deux fécondes. Un couple qui coûte une place d'enclos
 * n'en a donc pas deux : il lui manque au moins un cycle, et cette monture-là est
 * peut-être encore à l'hôtel de vente. Proposer d'en saisir la naissance revient
 * à demander le résultat d'un croisement qui ne peut pas avoir eu lieu — c'est ce
 * que la fenêtre faisait, jusqu'à afficher « Anonyme » du côté d'une gen 1 pas
 * encore achetée.
 *
 * On ne déplie donc que les couples à **zéro place**. Les autres reviendront
 * d'eux-mêmes : la sortie d'enclos passe leurs parents en fécondes, la politique
 * recompose, et le couple retombe à zéro place — c'est-à-dire réalisable.
 */
/**
 * L'identifiant de **ligne** d'une monture, ou `null` si elle se compte.
 *
 * `Pairing.mountId` vaut `null` du côté du vrac — voir `stable.ts` — parce qu'il
 * n'y a pas d'individu à désigner, seulement un effectif à décrémenter. Or
 * `flatten` fabrique un identifiant à chaque tête de vrac pour que le plan puisse
 * la nommer par son indice, et le recopier tel quel ici le faisait passer pour un
 * uuid.
 *
 * C'est le défaut de #165, et il se payait deux fois sur la même saisie : la
 * naissance rangeait `dore#M0` parmi les lignes à passer stériles, donc aucun
 * effectif de vrac n'était décrémenté — le même stock revenait au coup suivant —
 * et Postgres refusait l'identifiant sur une colonne `uuid`, ce qui faisait
 * repartir la fournée en lecture **après** que les poulains, eux, aient été
 * insérés. Les parents suivis restaient fertiles avec. D'où la fournée qui
 * repoussait à chaque rafraîchissement, plusieurs fois de suite.
 */
const rowIdOf = (id: string | undefined): string | null =>
  id !== undefined && parseCountedMountId(id) === null ? id : null;

export const couplesToRecord = (plan: StablePlan): Couple[] => {
  const out: Couple[] = [];
  for (const line of plan.couples) {
    if (line.places > 0) continue;
    for (let index = 0; index < line.count; index += 1) {
      out.push({
        // Faute de cible nommée — une recopie — on met la couleur du mâle : le
        // champ ne sert qu'à intituler la fenêtre, et mentir sur un rang serait
        // pire que de nommer ce qu'on a sous la main.
        targetColorId: line.targetColorId ?? line.male.colorId,
        // `mountIds` vide veut dire achat : la politique a proposé une gen 1
        // qu'on n'a pas encore. Le drapeau suit jusqu'à la fenêtre
        // d'accouplement, qui affichait sinon « Anonyme » — indiscernable d'une
        // monture du coffre.
        male: {
          colorId: line.male.colorId,
          sex: 'M',
          mountId: rowIdOf(line.male.mountIds[index]),
          bought: line.male.mountIds.length === 0,
        },
        female: {
          colorId: line.female.colorId,
          sex: 'F',
          mountId: rowIdOf(line.female.mountIds[index]),
          bought: line.female.mountIds.length === 0,
        },
      });
    }
  }
  return out;
};

/**
 * Les clonages déroulés un par un, chacun avec ses deux stériles.
 *
 * Deux stériles ne se clonent qu'à génération affichée égale, et il en sort **une**
 * monture : c'est celle des deux dont on garde le nom, et l'éleveur choisit
 * laquelle. D'où une paire et non une monture — la fenêtre doit pouvoir proposer
 * les deux.
 */
export type CloningToRecord = {
  generation: number;
  first: string;
  second: string;
};

export const cloningsToRecord = (
  plan: StablePlan,
  generations: Map<string, number>
): CloningToRecord[] =>
  plan.raw.clonings
    .map(([first, second]) => {
      const a = plan.mounts[first];
      const b = plan.mounts[second];
      if (!a || !b) return null;
      return {
        generation: generations.get(a.colorId) ?? 1,
        first: a.id,
        second: b.id,
      };
    })
    .filter((entry): entry is CloningToRecord => entry !== null);

/**
 * Ce qu'on va chercher dans l'écurie, une fois pour toute la fournée.
 *
 * On y va une fois, pas une fois par couple — et les sexes restent détaillés
 * parce qu'ils ne sont pas interchangeables : deux Doré mâles ne remplacent pas un
 * mâle et une femelle, et c'est devant le coffre qu'on s'en aperçoit.
 */
const pullOf = (plan: UnitPlan, mounts: Individual[]): PullLine[] => {
  const taken = new Map<string, { males: number; females: number }>();
  const note = (index: number) => {
    const mount = mounts[index];
    if (!mount) return;
    const row = taken.get(mount.colorId) ?? { males: 0, females: 0 };
    if (mount.sex === 'M') row.males += 1;
    else row.females += 1;
    taken.set(mount.colorId, row);
  };

  // Ce qu'on sort du coffre : les croisements **et** les fécondations, puisque les
  // deux passent par l'enclos.
  const consumed = new Map<string, number>();
  for (const [male, female] of plan.crossings) {
    for (const index of [male, female]) {
      note(index);
      const mount = mounts[index];
      // Seul un croisement consomme la reproduction. Une fécondation occupe une
      // place et rend la monture telle quelle — la compter ici ferait annoncer
      // « vidée » une couleur qu'on récupère entière.
      if (mount) consumed.set(mount.colorId, (consumed.get(mount.colorId) ?? 0) + 1);
    }
  }
  for (const index of plan.cycles) note(index);

  // Ce qui reste fertile après la fournée, pour dire ce qu'elle vide. Une écurie
  // vidée d'une couleur n'est pas une erreur, mais c'est ce qu'on veut voir venir.
  const fertile = new Map<string, { males: number; females: number }>();
  for (const mount of mounts) {
    if (!mount.fertile) continue;
    const row = fertile.get(mount.colorId) ?? { males: 0, females: 0 };
    if (mount.sex === 'M') row.males += 1;
    else row.females += 1;
    fertile.set(mount.colorId, row);
  }

  return [...taken].map(([colorId, row]) => {
    const held = fertile.get(colorId) ?? { males: 0, females: 0 };
    return {
      colorId,
      males: row.males,
      females: row.females,
      exhausts: (consumed.get(colorId) ?? 0) >= held.males + held.females,
    };
  });
};
