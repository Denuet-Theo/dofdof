/**
 * L'écurie, et la seule question qu'elle sache trancher : **qui peut s'accoupler
 * avec qui, maintenant**.
 *
 * Jusqu'ici l'écurie n'était qu'un compteur par couleur, et le planificateur
 * appariait deux montures de même couleur avec un `Math.floor(libres / 2)`. Ça
 * suppose que deux montures suffisent à faire un couple. Elles ne suffisent
 * pas : il faut **un mâle et une femelle**. Dix mâles Doré et aucune femelle
 * donnent zéro accouplement là où l'ancien calcul en annonçait cinq — et c'est
 * le cas le plus courant en fin de série, quand les naissances sont tombées du
 * même côté.
 *
 * ## Deux représentations, et pourquoi
 *
 * Les basses générations se comptent, les hautes se suivent une par une :
 *
 * - **Gen 1 et 2** : achetées ou capturées en volume, interchangeables entre
 *   elles, sans ascendance qui compte. Un couple `(mâles, femelles)` par couleur
 *   suffit, et c'est ce qui rend la saisie supportable à cent montures.
 * - **Gen 3 et au-delà** : produites une par une, chères, et leur **généalogie
 *   décide** de la distribution des couleurs à l'échec (voir `lineageValue`).
 *   Deux muldos Amande ne se valent pas selon d'où ils viennent, donc les
 *   confondre dans un compteur perdrait exactement ce qui les distingue. C'est
 *   aussi ce qui rend la purification vérifiable : elle consiste à fabriquer des
 *   individus à ascendance homogène, ce qu'un compteur ne peut pas représenter.
 *
 * Le seuil est à 3 et non ailleurs parce que c'est la première génération dont
 * les grands-parents peuvent tomber du côté de l'échec : une gen 2 a des parents
 * gen 1, qui ne peuvent être que des feuilles.
 *
 * Mais il se lit sur l'**ascendance** et non sur la couleur — voir
 * `tracksIndividually`. Une gen 2 achetée est du vrac ; une gen 2 née d'un
 * croisement gen 3 n'en est pas, parce qu'elle traîne une gen 3 qui relève la
 * cible de ses propres accouplements.
 */

/** Le sexe d'une monture. Un accouplement en demande un de chaque. */
export type Sex = 'M' | 'F';

/**
 * Génération à partir de laquelle on suit les montures une par une.
 *
 * En deçà, un couple de compteurs par couleur suffit et évite une écurie de
 * plusieurs centaines de lignes à saisir à la main.
 */
export const INDIVIDUAL_TRACKING_FROM = 3;

/**
 * Si une monture doit être suivie une par une, ascendance comprise.
 *
 * Le seuil ne peut pas se lire sur la seule couleur, et c'est le relevé de
 * l'issue #59 qui l'a montré : deux **gen 2** portant une *Amande* gen 3 en
 * ascendance visent la **gen 4**. Ces gen 2-là ne sont pas interchangeables avec
 * les autres — elles valent bien plus — et le compteur de vrac perdait
 * exactement ce qui les distingue, c'est-à-dire le raccourci lui-même.
 *
 * D'où un critère sur toute la généalogie plutôt que sur la génération propre.
 * Le compromis d'origine tient : une gen 1 ou 2 **achetée ou capturée** n'a pas
 * d'ascendance et reste dans le vrac, donc la saisie à cent montures reste une
 * saisie à deux chiffres. Seules montent en individus celles qui sont **nées**
 * d'un croisement assez haut — et elles se comptent sur les doigts.
 *
 * Ce sont précisément les bébés hors cible d'un croisement de haute génération :
 * ceux que `creditOffTarget` décrivait comme « des couleurs de génération 2 dont
 * on ne fera rien ».
 */
export const tracksIndividually = (
  generation: number,
  /** Générations des deux parents, ou `null` pour une monture sans ascendance. */
  parentGenerations: [number, number] | null = null
): boolean => Math.max(generation, ...(parentGenerations ?? [])) >= INDIVIDUAL_TRACKING_FROM;

/** Les effectifs d'une couleur en vrac, pour les générations basses. */
export type BulkStock = {
  males: number;
  females: number;
};

/**
 * Une monture suivie individuellement.
 *
 * `parents` porte les identifiants des deux ascendants directs quand ils sont
 * connus, et `null` quand la monture a été achetée ou capturée — auquel cas elle
 * n'a pas d'ascendance dans notre écurie, et sa part de grands-parents lui
 * revient (voir `lineageValue`).
 */
export type Individual = {
  id: string;
  colorId: string;
  sex: Sex;
  /** Niveau courant, qui décide du taux de réussite de ses accouplements. */
  level: number;
  /**
   * `false` dès que la monture a servi de parent. Une stérile ne s'accouple
   * plus ; elle ne vaut plus que par le clonage ou l'extraction.
   */
  fertile: boolean;
  /** Les deux ascendants directs, ou `null` pour une monture achetée ou capturée. */
  parents: [string, string] | null;
};

/**
 * L'écurie complète : le vrac des générations basses et les individus des
 * hautes.
 *
 * Les deux se lisent ensemble par `availableBySex`, qui est le seul point où le
 * planificateur a besoin de savoir combien de mâles et de femelles fertiles une
 * couleur porte — peu importe de quel côté ils viennent.
 */
export type Stable = {
  /** Effectifs fertiles par couleur, pour les générations en deçà du seuil. */
  bulk: Map<string, BulkStock>;
  /** Montures suivies une par une, toutes générations confondues au-dessus du seuil. */
  individuals: Individual[];
};

export const emptyStable = (): Stable => ({ bulk: new Map(), individuals: [] });

/**
 * Mâles et femelles **fertiles** d'une couleur, vrac et individus confondus.
 *
 * Les stériles sont écartées ici et non chez l'appelant : elles ne sont pas une
 * ressource d'accouplement, seulement de clonage et d'extraction, et les laisser
 * passer ferait promettre des fournées que rien ne permet de lancer.
 */
export const availableBySex = (stable: Stable, colorId: string): BulkStock => {
  const bulk = stable.bulk.get(colorId);
  const counts = { males: bulk?.males ?? 0, females: bulk?.females ?? 0 };

  for (const mount of stable.individuals) {
    if (mount.colorId !== colorId || !mount.fertile) continue;
    if (mount.sex === 'M') counts.males += 1;
    else counts.females += 1;
  }

  return counts;
};

/**
 * Toute l'écurie fertile ramenée à des effectifs par couleur et par sexe.
 *
 * C'est la vue dont le découpage en vagues a besoin : à ce niveau-là, savoir
 * *quel* Amande on met dans la fournée n'importe pas encore, seulement combien
 * de mâles et de femelles la couleur porte. La désignation nominative des
 * montures se fait plus tard, par `formCouples`.
 */
export const stableBySex = (stable: Stable): Map<string, BulkStock> => {
  const counts = new Map<string, BulkStock>();

  const bump = (colorId: string, sex: Sex, by: number) => {
    const current = counts.get(colorId) ?? { males: 0, females: 0 };
    if (sex === 'M') current.males += by;
    else current.females += by;
    counts.set(colorId, current);
  };

  for (const [colorId, bulk] of stable.bulk) {
    bump(colorId, 'M', bulk.males);
    bump(colorId, 'F', bulk.females);
  }
  for (const mount of stable.individuals) {
    if (mount.fertile) bump(mount.colorId, mount.sex, 1);
  }

  return counts;
};

/**
 * Répartit `count` montures de sexe inconnu entre mâles et femelles.
 *
 * Les naissances, les achats et les clones tombent à peu près à moitié-moitié,
 * et rien dans le jeu ne permet de choisir. Le découpage en vagues raisonne donc
 * sur cette espérance — c'est la seule hypothèse tenable tant que les montures
 * n'existent pas encore. Les sexes **réels** n'entrent dans l'écurie qu'à la
 * saisie des naissances, et c'est là que l'écart se rattrape.
 *
 * Le surplus impair va aux femelles sans que ça tire à conséquence : sur une
 * recette à deux couleurs les deux sexes sont interchangeables, et sur une
 * recette à couleur unique c'est le minimum des deux qui décide, insensible au
 * côté où tombe l'unité.
 */
export const splitBySex = (count: number): BulkStock => ({
  males: Math.floor(count / 2),
  females: count - Math.floor(count / 2),
});

/**
 * Accouplements réalisables entre deux couleurs, sexes pris en compte.
 *
 * Un accouplement consomme un mâle et une femelle. Quand les deux parents sont
 * de couleurs **différentes**, deux formes de couple existent — mâle de A avec
 * femelle de B, ou femelle de A avec mâle de B — et elles ne se disputent aucune
 * monture : les optimiser séparément donne donc bien le maximum, sans qu'il
 * faille chercher un couplage plus malin.
 *
 * Quand les deux parents sont de la **même** couleur — le cas de la purification
 * — les deux sexes sortent du même vivier et le nombre de couples est celui du
 * sexe le moins représenté. C'est là que le déséquilibre mord le plus fort :
 * huit mâles et deux femelles ne font pas cinq couples mais deux.
 */
export const maxPairings = (first: BulkStock, second: BulkStock, sameColor: boolean): number =>
  sameColor
    ? Math.min(first.males, first.females)
    : Math.min(first.males, second.females) + Math.min(first.females, second.males);

/**
 * Un couple retenu pour une fournée, et les deux montures qui le composent.
 *
 * `mountId` est `null` du côté du vrac : il n'y a pas d'individu à désigner,
 * seulement un effectif à décrémenter. C'est ce qui permet à la liste d'une
 * fournée de nommer les montures de gen 3 et plus — les seules qu'on distingue
 * réellement en jeu — sans exiger de saisir une par une les gen 1.
 */
export type Pairing = {
  colorId: string;
  sex: Sex;
  mountId: string | null;
};

export type Couple = {
  /** La couleur que ce croisement vise. */
  targetColorId: string;
  male: Pairing;
  female: Pairing;
};

/**
 * Forme concrètement `count` couples pour la recette `[a, b]`, en désignant les
 * individus quand ils existent.
 *
 * Les individus partent avant le vrac, et les plus **bas niveau** d'abord. Ce
 * n'est pas un détail d'ordonnancement : le taux de réussite dépend de la somme
 * des niveaux des deux parents, donc garder les hauts niveaux pour les
 * croisements qui restent à faire vaut mieux que de les dépenser au premier
 * tour. À niveau égal l'ordre est celui de l'écurie, stable d'un rendu à l'autre.
 *
 * Ne modifie rien : rend les couples et laisse l'appelant décider quand marquer
 * les montures stériles. Une fournée proposée n'est pas une fournée lancée.
 */
export const formCouples = (
  stable: Stable,
  /** La couleur visée, que les couples formés portent pour l'affichage. */
  targetColorId: string,
  recipe: readonly [string, string],
  count: number
): Couple[] => {
  if (count <= 0) return [];

  const [first, second] = recipe;
  const sameColor = first === second;

  /** Les individus fertiles d'une couleur et d'un sexe, les plus bas niveau devant. */
  const pool = (colorId: string, sex: Sex) =>
    stable.individuals
      .filter((mount) => mount.colorId === colorId && mount.fertile && mount.sex === sex)
      .sort((a, b) => a.level - b.level)
      .map((mount) => mount.id);

  const pools = new Map<string, string[]>();
  const bulkLeft = new Map<string, BulkStock>();

  for (const colorId of new Set([first, second])) {
    pools.set(`${colorId}:M`, pool(colorId, 'M'));
    pools.set(`${colorId}:F`, pool(colorId, 'F'));
    const bulk = stable.bulk.get(colorId);
    bulkLeft.set(colorId, { males: bulk?.males ?? 0, females: bulk?.females ?? 0 });
  }

  /** Prend une monture, individu d'abord, vrac ensuite. `null` si épuisé. */
  const take = (colorId: string, sex: Sex): Pairing | null => {
    const individuals = pools.get(`${colorId}:${sex}`);
    const id = individuals?.shift();
    if (id !== undefined) return { colorId, sex, mountId: id };

    const bulk = bulkLeft.get(colorId);
    const key = sex === 'M' ? 'males' : 'females';
    if (!bulk || bulk[key] <= 0) return null;
    bulk[key] -= 1;
    return { colorId, sex, mountId: null };
  };

  const couples: Couple[] = [];

  for (let made = 0; made < count; made += 1) {
    // Sur deux couleurs distinctes, les deux formes de couple sont
    // interchangeables : on prend celle qui reste possible, en alternant pour ne
    // pas vider un sexe d'un côté avant d'avoir touché à l'autre.
    const orientations: [Sex, Sex][] = sameColor
      ? [['M', 'F']]
      : made % 2 === 0
        ? [
            ['M', 'F'],
            ['F', 'M'],
          ]
        : [
            ['F', 'M'],
            ['M', 'F'],
          ];

    let formed = false;

    for (const [firstSex, secondSex] of orientations) {
      const a = take(first, firstSex);
      if (!a) continue;
      const b = take(second, secondSex);
      if (!b) {
        // Rendre la première : sans son partenaire elle reste disponible pour
        // l'autre orientation, et la reperdre fausserait le compte.
        if (a.mountId === null) bulkLeft.get(first)![firstSex === 'M' ? 'males' : 'females'] += 1;
        else pools.get(`${first}:${firstSex}`)!.unshift(a.mountId);
        continue;
      }

      couples.push({
        targetColorId,
        male: a.sex === 'M' ? a : b,
        female: a.sex === 'F' ? a : b,
      });
      formed = true;
      break;
    }

    if (!formed) break;
  }

  return couples;
};
