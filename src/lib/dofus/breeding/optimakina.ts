/**
 * L'Optimakina d'une génération : ce qu'elle coûte, et si elle vaut son prix.
 *
 * ## Ce que le calcul décidait déjà, et que l'écran ne montrait pas
 *
 * `fixedParentLevel` tranche depuis toujours — il compare le coût **espéré** d'un
 * croisement avec et sans, et rend `useOptimakina`. C'est le bon test, et il vaut
 * mieux qu'une règle de coin de table : il compte les tentatives ratées et la
 * valeur du bébé qu'un raté donne quand même, là où « dix pour cent de ce qu'un
 * succès rapporte » les oublie.
 *
 * Mais `useOptimakina` ne sortait pas de `costs.ts`. L'éleveur ne pouvait donc ni
 * savoir laquelle acheter avant la fournée, ni la voir au moment d'accoupler.
 *
 * ## Acheter ou fabriquer
 *
 * Les deux sources ne se comparent pas au même endroit : l'hôtel de vente donne
 * un prix, la fabrication en donne un autre, et le seuil est le même. Une
 * génération qui vaut le geste paraît donc dans **une** liste — la moins chère —
 * plutôt que dans les deux, sans quoi les deux listes se recouvrent et ne
 * disent plus quoi faire.
 *
 * Relevé de l'éleveur le 27/08 : la gen 6 se fabrique pour 11 000 là où l'hôtel
 * la vend 15 000, et le seuil est à 14 940. Elle passe donc en fabrication, et
 * elle ne passerait pas en achat.
 */

import { OPTIMAKINA_BONUS } from './costs';
import { targetGenerationRate } from './mating';

/** Une Optimakina et les deux prix auxquels on peut l'avoir. */
export type OptimakinaOffer = {
  generation: number;
  itemId: number;
  name: string;
  /** Prix à l'hôtel de vente, ou `null` si aucun n'est relevé. */
  buy: number | null;
  /** Coût de fabrication, ou `null` si la recette ou un ingrédient manque. */
  craft: number | null;
};

/** Ce qu'on conseille d'une Optimakina, une fois les deux prix connus. */
export type OptimakinaAdvice = {
  generation: number;
  name: string;
  /** La source la moins chère parmi celles qui passent le seuil. */
  source: 'achat' | 'fabrication';
  price: number;
  /** Le prix au-delà duquel elle ne vaut plus le geste. */
  ceiling: number;
};

/**
 * Le prix au-delà duquel l'Optimakina ne se rembourse plus.
 *
 * Elle achète `OPTIMAKINA_BONUS` de taux de réussite, donc elle vaut cette
 * fraction de ce qu'un succès rapporte. Au-dessus, on paie plus que ce qu'on
 * gagne à réussir plus souvent.
 */
export const optimakinaCeiling = (valuePerSuccess: number): number =>
  OPTIMAKINA_BONUS * valuePerSuccess;

/**
 * Les Optimakina qui valent le geste, rangées par source la moins chère.
 *
 * `valueOfSuccess` rend ce qu'un succès vers cette génération rapporte —
 * génétons des deux parents plus le bébé — et c'est l'appelant qui le sait,
 * puisqu'il dépend des prix de l'éleveur.
 */
export const worthwhileOptimakina = (
  offers: OptimakinaOffer[],
  valueOfSuccess: (generation: number) => number
): OptimakinaAdvice[] =>
  offers
    .flatMap((offer) => {
      const ceiling = optimakinaCeiling(valueOfSuccess(offer.generation));
      // Les deux sources, celles qui passent le seuil seulement.
      const candidates: { source: 'achat' | 'fabrication'; price: number }[] = [];
      if (offer.buy !== null && offer.buy > 0 && offer.buy <= ceiling) {
        candidates.push({ source: 'achat', price: offer.buy });
      }
      if (offer.craft !== null && offer.craft > 0 && offer.craft <= ceiling) {
        candidates.push({ source: 'fabrication', price: offer.craft });
      }
      if (candidates.length === 0) return [];
      // La moins chère, et à prix égal l'achat : il est immédiat.
      const best = candidates.reduce((cheapest, candidate) =>
        candidate.price < cheapest.price ? candidate : cheapest
      );
      return [
        {
          generation: offer.generation,
          name: offer.name,
          source: best.source,
          price: best.price,
          ceiling,
        },
      ];
    })
    // Par génération croissante : c'est l'ordre où on les rencontre en montant.
    .sort((a, b) => a.generation - b.generation);

/** Le taux qu'un croisement atteint avec l'Optimakina, plafonné à 1. */
export const rateWithOptimakina = (level: number): number =>
  Math.min(1, targetGenerationRate(level, level) + OPTIMAKINA_BONUS);
