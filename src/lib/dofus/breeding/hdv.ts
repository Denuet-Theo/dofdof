import { HDV_TAX_RATE, type BreedingColor } from './costs';
import { carriedGeneration } from './naming';
import { mateGroups, matingOutcomes, pairOutlook, type Mate } from './pairing';
import type { Individual, Sex, Stable } from './stable';

/**
 * Ce qu'une monture vaut à l'hôtel de vente, dans les deux sens.
 *
 * L'écran chiffrait déjà le coût de revient d'une **couleur** — le moins cher
 * entre acheter, capturer et élever — et ne l'affichait nulle part depuis #178.
 * Ce module en fait les deux réponses qu'on cherche devant l'HDV : à combien je
 * mets la mienne en vente, et jusqu'à combien je paie celle qui passe.
 *
 * ## Les deux marges sont posées, pas calculées
 *
 * `+25 %` pour vendre, `−25 %` pour acheter, sur le coût de revient. Ce ne sont
 * pas des optima dérivés de quoi que ce soit : c'est la règle que l'éleveur
 * applique, et elle est écrite ici en un endroit pour qu'elle se change en un
 * endroit. La taxe de l'hôtel de vente, elle, est réelle et se déduit du prix
 * affiché — un prix de vente conseillé qui rendrait moins que le revient +25 %
 * net ne conseillerait rien.
 *
 * ## Ce qui se groupe et ce qui ne se groupe pas
 *
 * Le coût de revient est une propriété de la **couleur** : `computeBreedingCosts`
 * chiffre la recette, pas l'individu. Deux Doré-Amande se valent donc, et l'écran
 * les compte sur une ligne — c'est le regroupement maximal que le modèle
 * supporte, et le seul qui ne mente pas.
 *
 * Sauf celles qui portent un **raccourci**. Une gen 1 dont un parent est gen 9
 * traîne un 9 dans son ascendance, et « gen 9 × gen 1 » nomme une gen 10 : elle
 * vise donc la gen 10, là où sa couleur seule viserait la gen 2. Elle ne vaut pas
 * le prix de sa couleur, et la vendre à ce prix est la pire affaire de l'écurie.
 * Celles-là sont **nommées une par une**, jamais groupées.
 *
 * **Une ascendance gen 10, en revanche, n'ouvre rien**, et c'est contre-intuitif
 * au point de mériter d'être dit : la cible est ce qu'une recombinaison sait
 * nommer, et une gen 10 ne se compose avec rien — c'est le sommet de l'arbre. Une
 * gen 1 née d'un croisement gen 10 manqué vise la gen 2 comme n'importe quelle
 * gen 1. Mesuré sur l'écurie du 17/08 : `bestShortcut` ne lui trouve aucun gain,
 * et c'est juste. Le commentaire de `pairing.ts` qui la disait « la monture la plus
 * précieuse de l'écurie » parlait d'une gen 9 ; il vaut pour elle, pas pour une
 * gen 10.
 *
 * ## Ce que vaut un raccourci, et pourquoi la soustraction est exacte
 *
 * On compare la monture à ce qu'un exemplaire **ordinaire** de sa couleur
 * vaudrait — même couleur, aucune ascendance — face au **même partenaire** :
 *
 * ```
 * gain = espérance(monture × partenaire) − espérance(ordinaire × partenaire)
 * ```
 *
 * Prendre le même partenaire des deux côtés est ce qui rend le chiffre honnête :
 * le cycle de jauges, la place d'enclos et le partenaire consommé sont identiques
 * dans les deux termes, donc ils **s'annulent** au lieu d'être estimés. Le gain
 * ne porte que sur ce que l'ascendance change à la fenêtre, ce qui est exactement
 * la question.
 *
 * L'espérance valorise chaque issue à son coût de revient, la convention que
 * `costs.ts` applique déjà à `offTargetValue` : ce qu'une monture vaut, c'est ce
 * qu'il coûterait d'en obtenir une autre.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne lit pas le marché. Les prix saisis nourrissent `computeBreedingCosts` en
 * amont ; ici on ne compare pas le conseil à une offre réelle, faute de savoir ce
 * qui est en vente. L'écran affiche donc un seuil, pas une bonne affaire.
 */

/** Ce qu'on ajoute au revient pour vendre, et ce qu'on en retire pour acheter. */
export const SELL_MARKUP = 1.25;
export const BUY_DISCOUNT = 0.75;

/** Le catalogue et les coûts, tels que l'écran les tient déjà. */
export type HdvContext = {
  colors: BreedingColor[];
  generations: Map<string, number>;
  /** Coût de revient d'une couleur, ou `null` quand rien ne la chiffre. */
  costOf: (colorId: string) => number | null;
  /** La stratégie retenue par le chiffrage, pour la dire à l'écran. */
  strategyOf: (colorId: string) => 'buy' | 'capture' | 'breed' | null;
};

/** Ce qu'une ascendance ouvre, et le partenaire qui le saisirait. */
export type Shortcut = {
  partner: Mate;
  targetGeneration: number;
  successRate: number;
  /** Kamas que l'ascendance ajoute, à partenaire égal. Toujours > 0. */
  gain: number;
};

/** Un prix conseillé, dans les deux sens. */
export type HdvQuote = {
  colorId: string;
  /** Ce que coûte un exemplaire ordinaire de cette couleur. `null` si non chiffré. */
  base: number | null;
  /** Ce que l'ascendance ajoute, ou `null` quand elle n'ouvre rien. */
  shortcut: Shortcut | null;
  /** `base` plus le gain du raccourci — la base des deux marges. */
  revient: number | null;
  strategy: 'buy' | 'capture' | 'breed' | null;
  /** Prix à afficher en vente, taxe non déduite : c'est ce qu'on tape à l'HDV. */
  sell: number | null;
  /** Ce que la vente rend réellement, taxe de 2 % déduite. */
  sellNet: number | null;
  /** Plafond d'achat : au-dessus, mieux vaut la produire soi-même. */
  buy: number | null;
};

/** Une monture ordinaire de cette couleur : rien d'autre que sa couleur. */
const plainMate = (colorId: string, sex: Sex, level: number): Mate => ({
  id: null,
  colorId,
  sex,
  level,
  parents: null,
});

/**
 * L'espérance d'un croisement, chaque issue valorisée à son coût de revient.
 *
 * `0` quand aucune issue n'est chiffrée, ce qui arrive sur une écurie dont les
 * prix ne sont pas saisis. Le zéro se propage alors dans le gain, qui devient nul
 * — c'est-à-dire « on ne sait pas », et non « ça ne vaut rien ». L'écran le dit.
 */
const expectedValue = (male: Mate, female: Mate, context: HdvContext): number => {
  let value = 0;
  for (const outcome of matingOutcomes(male, female, context.colors, context.generations)) {
    value += outcome.probability * Math.max(context.costOf(outcome.colorId) ?? 0, 0);
  }
  return value;
};

/**
 * Les ascendances distinctes que l'écurie offre comme partenaires.
 *
 * Repliées par `mateGroups` : deux gen 1 achetées visent la même chose, donc les
 * confronter toutes les deux ne fait que doubler le travail. À calculer **une
 * fois** par écran — chaque appel replie les deux cents montures.
 */
export const partnersOf = (stable: Stable): Mate[] =>
  [...mateGroups(stable).values()].map(({ sample }) => sample);

/**
 * Ce que l'ascendance d'une monture ajoute à sa valeur, face au meilleur
 * partenaire de l'écurie.
 *
 * `null` quand l'ascendance ne dépasse pas la couleur — la monture est alors
 * exactement ce que sa couleur dit — ou quand aucun partenaire n'en tire rien.
 *
 * On retient le partenaire qui **maximise le gain**, et non celui qui vise le
 * plus haut : viser la gen 10 à 3 % vaut moins qu'une gen 8 à 45 %, et c'est le
 * genre d'arbitrage qu'un tri par génération rate. `drift.ts` trie par génération
 * parce qu'il signale une occasion ; ici on met un prix, donc c'est l'espérance
 * qui décide.
 */
export const bestShortcut = (
  mate: Mate,
  partners: Mate[],
  context: HdvContext
): Shortcut | null => {
  const own = context.generations.get(mate.colorId) ?? 0;
  const carried = carriedGeneration(
    own,
    mate.parents
      ? [
          context.generations.get(mate.parents[0]) ?? 0,
          context.generations.get(mate.parents[1]) ?? 0,
        ]
      : null
  );
  if (carried <= own) return null;

  const plain = plainMate(mate.colorId, mate.sex, mate.level);
  let best: Shortcut | null = null;

  for (const sample of partners) {
    // Une monture ne s'accouple ni avec elle-même ni avec son sexe.
    if (sample.sex === mate.sex || (sample.id !== null && sample.id === mate.id)) continue;

    const [male, female] = mate.sex === 'M' ? [mate, sample] : [sample, mate];
    const outlook = pairOutlook(male, female, context.colors, context.generations);
    // Sans cible nommée il n'y a pas de raccourci mais une recopie, et sans gain
    // sur la recette le couple est déjà dans l'arbre : le plan sait le proposer.
    if (!outlook || outlook.leap <= 0 || outlook.targetColors.length === 0) continue;

    const [plainMale, plainFemale] = mate.sex === 'M' ? [plain, sample] : [sample, plain];
    const gain =
      expectedValue(male, female, context) - expectedValue(plainMale, plainFemale, context);
    if (gain <= 0) continue;

    if (best === null || gain > best.gain) {
      best = {
        partner: sample,
        targetGeneration: outlook.targetGeneration,
        successRate: outlook.successRate,
        gain,
      };
    }
  }

  return best;
};

/** Les deux marges et la taxe, appliquées à un revient. */
const priced = (
  colorId: string,
  base: number | null,
  shortcut: Shortcut | null,
  strategy: 'buy' | 'capture' | 'breed' | null
): HdvQuote => {
  const revient = base === null ? null : base + (shortcut?.gain ?? 0);
  /**
   * Un revient nul ou négatif ne se marge pas.
   *
   * Il est **exact** et pas rare : les génétons et l'extraction peuvent dépasser
   * la dépense, et `costs.ts` le dit déjà. Mais `−4 230 × 1,25` ne conseille rien,
   * et « payer jusqu'à −3 172 » se lit comme une panne. On ne conseille donc rien
   * du tout, et l'écran dit pourquoi : cette couleur se paie toute seule, donc
   * n'importe quel prix de vente est un gain et aucun prix d'achat ne se justifie.
   */
  const advisable = revient !== null && revient > 0;
  const sell = advisable ? Math.round(revient * SELL_MARKUP) : null;
  return {
    colorId,
    base,
    shortcut,
    revient,
    strategy,
    sell,
    // La taxe se prend sur le prix affiché, donc le net est ce qui tombe en
    // banque. `Math.floor` sur la taxe comme dans `costs.ts`.
    sellNet: sell === null ? null : sell - Math.floor(sell * HDV_TAX_RATE),
    buy: advisable ? Math.round(revient * BUY_DISCOUNT) : null,
  };
};

/** Ce qu'on met en vente : un prix conseillé pour une monture qu'on possède. */
export type SellLine = HdvQuote & {
  /** Combien on en tient, à ce prix-là. `1` sur une ligne nommée. */
  count: number;
  /**
   * La monture désignée, quand elle ne se groupe pas.
   *
   * `null` sur une ligne de couleur : les exemplaires y sont interchangeables, et
   * les nommer ferait deux cents lignes pour rien.
   */
  mount: Individual | null;
};

/**
 * Ce que l'écurie peut mettre en vente, et à quel prix.
 *
 * Deux listes, et la séparation porte tout le sens du module : les couleurs
 * groupées d'un côté, les montures **à ne pas vendre au prix de leur couleur** de
 * l'autre.
 *
 * Le vrac et les individus se fondent dans les lignes de couleur : le vrac est
 * une commodité de saisie, et une monture sans ascendance enregistrée est
 * exactement ce que sa couleur dit.
 *
 * Les stériles comptent. Elles se vendent comme les autres — c'est même souvent
 * la seule sortie qui leur reste, l'extraction mise à part — et les omettre
 * cacherait la moitié d'une écurie mûre.
 */
export const sellSheet = (
  stable: Stable,
  context: HdvContext
): { colors: SellLine[]; named: SellLine[] } => {
  const counts = new Map<string, number>();
  const named: SellLine[] = [];
  // Une fois, et non par monture : `mateGroups` replie les 200 montures de
  // l'écurie à chaque appel, et le raccourci se cherche contre la même liste.
  const partners = partnersOf(stable);

  const bump = (colorId: string, by: number) =>
    counts.set(colorId, (counts.get(colorId) ?? 0) + by);

  for (const [colorId, stock] of stable.bulk) {
    const held = stock.males + stock.females;
    if (held > 0) bump(colorId, held);
  }

  for (const mount of stable.individuals) {
    const shortcut = mount.fertile
      ? bestShortcut(
          {
            id: mount.id,
            colorId: mount.colorId,
            sex: mount.sex,
            level: mount.level,
            parents: mount.parents,
          },
          partners,
          context
        )
      : // Une stérile ne s'accouple plus : son ascendance ne vaut plus rien de
        // particulier, et la ranger avec sa couleur est exact.
        null;

    if (shortcut) {
      named.push({
        ...priced(mount.colorId, context.costOf(mount.colorId), shortcut, context.strategyOf(mount.colorId)),
        count: 1,
        mount,
      });
      continue;
    }
    bump(mount.colorId, 1);
  }

  const colorLines = [...counts]
    .map(([colorId, count]) => ({
      ...priced(colorId, context.costOf(colorId), null, context.strategyOf(colorId)),
      count,
      mount: null,
    }))
    .sort((a, b) => (b.revient ?? -1) - (a.revient ?? -1) || a.colorId.localeCompare(b.colorId));

  return {
    colors: colorLines,
    named: named.sort((a, b) => (b.revient ?? -1) - (a.revient ?? -1)),
  };
};

/**
 * Ce qu'on accepte de payer pour une monture qu'on n'a pas encore.
 *
 * Les deux champs qui changent la réponse sont la **couleur** et les **parents**.
 * Le sexe et le niveau n'entrent pas dans le coût de revient : le premier ne
 * décide de rien, le second se rattrape en montant la monture — c'est
 * `levelUpCost`, qui est une dépense à part et non le prix de la bête. Ne pas les
 * demander est délibéré ; un champ sans effet sur un écran de prix se lit comme
 * un prix qui en dépend.
 *
 * `sex` sert seulement à chercher un partenaire du bon côté quand on évalue le
 * raccourci, et il est donc **essayé dans les deux sens** : on ne sait pas encore
 * quel sexe on achètera, et le meilleur des deux est ce que l'annonce vaut au
 * mieux.
 */
export const buyQuote = (
  colorId: string,
  parents: [string, string] | null,
  stable: Stable,
  context: HdvContext
): HdvQuote => {
  const base = context.costOf(colorId);
  const strategy = context.strategyOf(colorId);
  if (parents === null) return priced(colorId, base, null, strategy);

  const partners = partnersOf(stable);
  let best: Shortcut | null = null;
  for (const sex of ['M', 'F'] as Sex[]) {
    const shortcut = bestShortcut({ id: null, colorId, sex, level: 1, parents }, partners, context);
    if (shortcut && (best === null || shortcut.gain > best.gain)) best = shortcut;
  }

  return priced(colorId, base, best, strategy);
};
