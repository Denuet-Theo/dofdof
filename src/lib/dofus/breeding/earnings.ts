/**
 * Ce qu'une fournée rapporte, et ce que ça fait par mois.
 *
 * ## Pourquoi le chiffre existe
 *
 * Les mesures qui ont décidé de la politique sont en **millions de kamas par
 * mois** : c'est l'unité dans laquelle l'échelle a battu le champion, le glouton
 * et la valeur myope, et c'est celle que le Rust imprime (`table --heures`). Rien
 * ne la rendait à l'écran. L'éleveur voyait une fournée — trente-deux
 * accouplements, quatre clonages, deux achats — et devait la traduire lui-même en
 * kamas pour savoir si sa semaine valait la manipulation.
 *
 * ## Ce que le chiffre est, et ce qu'il n'est pas
 *
 * C'est un **rythme**, pas une prévision. Il dit « à cette fournée-là, répétée,
 * voilà ce que le mois rend » — et rien de plus. Trois raisons de ne pas le lire
 * comme un horizon :
 *
 * - **La fournée d'aujourd'hui n'est pas celle de demain.** L'échelle compose sur
 *   l'écurie qu'elle a ; celle-ci grossit, monte, et la fournée change avec elle.
 *   Mesuré côté Rust sur le muldo : 57,5 M le premier mois — dont l'essentiel est
 *   la liquidation de l'écurie de départ — puis +15,5, +16,0 et +14,6. Le premier
 *   mois d'une écurie neuve est donc **surévalué** par ce calcul, et le régime
 *   permanent est la moitié basse de la fourchette.
 * - **Les naissances sont en espérance.** Un croisement à 70 % rend 0,7 poulain
 *   ici et 0 ou 1 en jeu. Sur une fournée de trente c'est juste ; sur un
 *   accouplement, non.
 * - **Le marché ne s'écoule pas.** Le Rust baisse une couleur de 10 % à chaque
 *   vente et la laisse remonter de 1 % par jour. Vendre trente Ébène le même jour
 *   rapporte donc moins que trente fois la première, et ce calcul-ci l'ignore.
 *
 * ## Calibré contre le Rust, et l'écart est connu
 *
 * Sur l'écurie réelle du 27/08 — 240 montures, 83 gen 1, 48 gen 4, 3 gen 10 — les
 * deux côtés donnent :
 *
 * | | par fournée | par mois |
 * | --- | --- | --- |
 * | ce calcul, sur les prix de l'éleveur | 1,00 M | **30,05 M** |
 * | `table muldo --ecurie … --heures 720 --niveau 67`, 100 fournées | 0,577 M | 17,3 M |
 *
 * L'écart est d'un facteur 1,7 et il n'est pas une erreur d'arithmétique — c'est la
 * somme des trois réserves ci-dessus, plus une quatrième :
 *
 * - le Rust joue `economy.toml`, ce calcul joue les **prix saisis par l'éleveur**,
 *   qui sont ceux de son hôtel de vente et non ceux de l'entraînement ;
 * - le Rust amortit sur cent fournées la liquidation du stock de départ, qui vaut
 *   ici 1,28 M de ventes dans la **première** ;
 * - le Rust écoule le marché à chaque vente, ce calcul non.
 *
 * Les trois poussent dans le même sens : **ce chiffre est le haut de la
 * fourchette**, et le régime permanent est plus bas. C'est pour ça que le titre du
 * bloc dit « à ce rythme » et non « par mois ».
 *
 * ## Une fournée par jour
 *
 * `BATCHES_PER_MONTH` vaut trente, et ce n'est pas une hypothèse de confort : la
 * Mangeoire monte le lot d'un bloc, un chargement tient la journée, et l'éleveur
 * fait une fournée par jour. C'est la contrainte réelle, et c'est pour ça que les
 * mesures se lisent en mois et non en heures de simulation.
 */

/** Une fournée par jour. Voir l'en-tête : c'est la contrainte de la Mangeoire. */
export const BATCHES_PER_MONTH = 30;

/** Ce que la fournée déplace, poste par poste. Tout en kamas. */
export type BatchEarnings = {
  /**
   * Les génétons des croisements retenus, **en espérance**.
   *
   * Ils ne tombent qu'à la réussite, donc chaque croisement compte pour son taux.
   * C'est la seule recette qui n'attend pas la vente : les génétons arrivent avec
   * le poulain.
   */
  genetons: number;
  /**
   * Ce que les sacrifices rendent — vente à l'hôtel ou extraction d'ambre, au
   * mieux des deux. Voir `liquidationValue`.
   *
   * C'est la recette principale en régime permanent : le sommet s'écoule, les
   * stériles que le clonage n'a pas appariées aussi.
   */
  sales: number;
  /** Le chargement de la Mangeoire, payé une fois par fournée qui croise. */
  loadKamas: number;
  /** Les gen 1 achetées à l'hôtel de vente. */
  purchases: number;
  /**
   * Les Optimakina des croisements qui en prennent.
   *
   * Nul en pratique aujourd'hui : `optimakinaFrom` vaut 11 et aucune cible ne
   * dépasse 10, donc la fournée n'en achète pas. Le poste reste parce que le
   * conseil d'achat, lui, en propose — et parce qu'un zéro qui se calcule vaut
   * mieux qu'un zéro qu'on suppose.
   */
  optimakina: number;
  /** Recettes moins dépenses. Peut être négatif : une fournée d'amorçage l'est. */
  net: number;
  /** `net × BATCHES_PER_MONTH`. Le chiffre que le Rust imprime. */
  perMonth: number;
  /**
   * Le géneton a-t-il un prix saisi ?
   *
   * `genetonValue` vaut `valuePerGeneton ?? 0` : sans saisie de l'éleveur, le poste
   * `genetons` est nul — non parce que la fournée n'en rend pas, mais parce que
   * personne n'a dit ce qu'ils valent. Les deux zéros se ressemblent à l'écran et
   * ne disent pas la même chose : sur la fixture des tests, ce zéro-là fait passer
   * le rythme de positif à **-1,56 M par mois**, ce qui se lirait comme une
   * politique qui perd de l'argent.
   *
   * C'est la même règle que partout ici : un état qu'on n'a pas pu lire n'est pas
   * un état connu, et l'écran doit le dire au lieu de l'afficher comme un fait.
   */
  genetonsPriced: boolean;
};

/**
 * Assemble le compte, et en déduit le rythme mensuel.
 *
 * Séparé de `readPlan` pour une raison qui a déjà coûté : l'arithmétique d'un
 * chiffre affiché doit être lisible sans lire la boucle qui l'alimente. Les postes
 * arrivent bruts, le net et le mois se calculent ici, et il n'y a qu'un endroit à
 * corriger si la contrainte de la Mangeoire change.
 */
export const batchEarnings = (parts: {
  genetons: number;
  sales: number;
  loadKamas: number;
  purchases: number;
  optimakina: number;
  /** Le prix saisi du géneton. Zéro veut dire « pas de saisie », pas « sans valeur ». */
  genetonValue: number;
}): BatchEarnings => {
  const { genetonValue, ...posts } = parts;
  const net = posts.genetons + posts.sales - posts.loadKamas - posts.purchases - posts.optimakina;
  return {
    ...posts,
    net,
    perMonth: net * BATCHES_PER_MONTH,
    genetonsPriced: genetonValue > 0,
  };
};

/** Le rythme en millions, arrondi au centième — comme le Rust l'imprime. */
export const millionsPerMonth = (earnings: BatchEarnings): number =>
  Math.round((earnings.perMonth / 1e6) * 100) / 100;
