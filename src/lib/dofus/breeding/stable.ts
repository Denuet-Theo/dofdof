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
 *   décide** de la distribution des couleurs à l'échec (voir
 *   `crossingFailureShares`).
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
 *
 * ## Pourquoi 2 et non 3
 *
 * Le vrac ne représente qu'une chose : une monture **sans généalogie**. Or il n'y
 * a qu'une façon d'en obtenir une, et c'est de se la procurer sans l'élever —
 * acheter ou capturer. Les deux sont bornées à la première génération :
 *
 * - la capture l'est déjà, structurellement — `costs.ts` ne la propose que pour
 *   `color.recipes.length === 0`, « au-delà de la première génération, aucun filet
 *   ne la sort d'une zone » ;
 * - l'achat l'est dans le jeu, et `search.rs` en tient compte depuis toujours :
 *   ses `starters` sont `catalog.ids_at_generation(1)`, donc le modèle n'a jamais
 *   pu acheter une gen 2.
 *
 * Un seuil à 3 laissait donc entrer au vrac une chose qui n'existe pas : la gen 2
 * sans ascendance. Le seul endroit qui en fabriquait était `costs.ts`, qui propose
 * encore d'acheter n'importe quelle couleur tarifée (#105) — un défaut, pas un
 * régime à représenter — et la saisie manuelle, qui offrait un compteur de vrac
 * aux gen 2 parce que ce seuil le lui disait.
 *
 * Ce qu'il faut savoir avant de croire au gain que la mesure montre en régime
 * « gen 1-2 achetables » : ce régime **n'est pas jouable**. Il n'est là que pour
 * dire ce que le changement fait au défaut de #105, pas pour l'arbitrer.
 */
export const INDIVIDUAL_TRACKING_FROM = 2;

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
 *
 * ## Pourquoi le seuil a fini par sauter
 *
 * Le critère s'est resserré deux fois, et les deux fois il ratait la même chose.
 * `>= 3` sur toute la généalogie ratait le **Doré gen 1 né d'un Roux manqué**, qui
 * porte `[Doré-Pourpre, Doré-Orchidée]` et vise la gen 3. Ajouter « l'ascendance
 * dépasse la couleur » rattrapait celui-là — mais **il ne peut pas naître**, parce
 * que ses parents, deux gen 2 nées de gen 1, partent eux-mêmes au vrac.
 *
 * Or le vrac n'enregistre aucune ascendance. Une monture de vrac est donc traitée
 * comme achetée : `lineageDistribution` lui donne sa moitié entière, et son raté
 * ne peut rendre **que sa propre couleur**. Le raccourci ne s'amorce jamais. Le
 * verrou était toujours un cran plus bas que le correctif.
 *
 * D'où la règle actuelle, qui n'a plus de seuil du tout du côté des naissances :
 * **toute monture née garde son ascendance**. Seules les montures **achetées ou
 * capturées** vont au vrac — elles n'ont réellement pas de généalogie, et ce sont
 * elles qu'on possède par centaines, donc la saisie en volume reste une saisie à
 * deux chiffres.
 *
 * Mesuré sur dix fournées de cinquante places, parc plein et budget identique de
 * 250 croisements, 24 graines : **10,13 Roux contre 13,75**, soit +3,63
 * (t = 4,44), et 388 550 kamas par Roux au lieu de 525 279 — **26 % moins cher**.
 * L'écart tient entièrement aux 12,2 croisements hors recette par partie que
 * `driftSignals` peut alors proposer, contre **zéro** quand les gen 2 perdent leur
 * ascendance.
 *
 * Le piège à connaître, parce qu'il annule tout le gain : ces montures doivent
 * être appariées **entre elles**. Un Doré `[Doré-Pourpre, Doré-Orchidée]` croisé
 * avec un Doré capturé ne vise plus rien du tout — 89,47 % de Doré, zéro géneton.
 * Il faut les deux côtés pour que le raccourci existe.
 *
 * C'est aussi ce qui rend `driftSignals` capable de les voir : il ne lit que
 * `individuals`, donc une monture laissée au vrac n'est signalée nulle part et
 * personne ne songe à la réserver.
 *
 * Ce que ça coûte, et c'est assumé : l'écurie affiche une ligne par monture née.
 * C'est le prix de la seule information qui distingue deux montures de même
 * couleur, et que rien d'autre ne rattrape une fois perdue.
 */
export const tracksIndividually = (
  generation: number,
  /** Générations des deux parents, ou `null` pour une monture sans ascendance. */
  parentGenerations: [number, number] | null = null
): boolean => {
  // Née chez nous : on connaît ses parents, donc elle vaut d'être suivie. C'est
  // cette ascendance-là qui décide de ce que ses propres accouplements viseront,
  // et le vrac est précisément ce qui l'efface.
  if (parentGenerations !== null) return true;
  // Achetée ou capturée : pas de généalogie à perdre, le compteur suffit.
  return generation >= INDIVIDUAL_TRACKING_FROM;
};

/** Les effectifs d'une couleur en vrac, pour les générations basses. */
export type BulkStock = {
  males: number;
  females: number;
  /**
   * Parmi `males`, combien sont **fécondes** — leur cycle est payé, donc elles
   * s'accouplent sans repasser par l'enclos.
   *
   * Un sous-ensemble et non une partition : `males` continue de compter tout ce
   * qui garde sa reproduction, exactement comme `FERTILE_*` face à `CYCLED_*`
   * dans l'encodage du réseau. La différence des deux est la dette de cycle.
   *
   * Le vrac l'ignorait, et ça se payait : le seuil de suivi individuel commence à
   * la génération 2, donc une gen 1 féconde n'avait nulle part où être dite. La
   * politique la voyait fertile ordinaire, lui réservait une place d'enclos, et
   * proposait d'acheter des gen 1 pendant que les fécondes attendaient.
   */
  cycledMales?: number;
  cycledFemales?: number;
};

/** Les fécondes d'un stock de vrac, absentes valant zéro. */
export const cycledOf = (stock: BulkStock): { males: number; females: number } => ({
  males: Math.min(stock.cycledMales ?? 0, stock.males),
  females: Math.min(stock.cycledFemales ?? 0, stock.females),
});

/**
 * Une monture suivie individuellement.
 *
 * `parents` porte les identifiants des deux ascendants directs quand ils sont
 * connus, et `null` quand la monture a été achetée ou capturée — auquel cas elle
 * n'a pas d'ascendance dans notre écurie, et sa part de grands-parents lui
 * revient (voir `lineageDistribution`).
 */
export type Individual = {
  id: string;
  colorId: string;
  /**
   * Le nom porté **dans le jeu**, 20 caractères au plus, ou `null` tant qu'il
   * vaut le défaut « Anonyme ».
   *
   * C'est la seule chose qui se lise depuis la liste de l'écurie du jeu, donc
   * le seul moyen de retrouver devant l'enclos la monture que l'outil désigne.
   * Voir `naming.ts` : le nom porte la généalogie parce que c'est elle qui
   * distingue deux montures de même couleur, et qu'elle est invisible autrement.
   */
  name: string | null;
  sex: Sex;
  /** Niveau courant, qui décide du taux de réussite de ses accouplements. */
  level: number;
  /**
   * `false` dès que la monture a servi de parent. Une stérile ne s'accouple
   * plus ; elle ne vaut plus que par le clonage ou l'extraction.
   *
   * Vrai pour une **fertile comme pour une féconde** : les deux peuvent encore
   * s'accoupler, et c'est bien la question que ce champ pose partout où il est
   * lu.
   */
  fertile: boolean;
  /**
   * Le cycle de fécondité est déjà payé : la monture est « féconde » au sens du
   * jeu. Voir `mountStatus`.
   */
  cycled: boolean;
  /** Les deux ascendants directs, ou `null` pour une monture achetée ou capturée. */
  parents: [string, string] | null;
};

/**
 * L'état d'une monture, tel que le jeu le nomme.
 *
 * ```
 * fertile --(cycle de jauges)--> féconde --(accouplement)--> stérile
 * ```
 *
 * Les deux premiers sont **disponibles** : ils s'accouplent tous les deux. Ce
 * qui les sépare est le cycle de fécondité — sérénité alignée, stats montées à
 * l'extrême, voir `CYCLE_STEPS` — qu'une féconde a déjà payé et qu'une fertile
 * devra payer avant de servir. Une féconde qui n'est pas accouplée le reste ;
 * elle ne retombe pas fertile.
 *
 * Il n'y a **pas de gestation** : un mâle fécond, une femelle féconde, un clic,
 * les deux parents passent stériles et le poulain est en écurie. Le confondre
 * avec une grossesse a coûté une migration — voir 20260809210000, qui la
 * répare, et le défaut qu'elle décrit.
 */
export type MountStatus = 'fertile' | 'feconde' | 'sterile';

export const MOUNT_STATUS_LABEL: Record<MountStatus, string> = {
  fertile: 'Fertile',
  feconde: 'Féconde',
  sterile: 'Stérile',
};

export const mountStatus = (mount: Pick<Individual, 'fertile' | 'cycled'>): MountStatus =>
  mount.fertile ? (mount.cycled ? 'feconde' : 'fertile') : 'sterile';

/**
 * Les deux booléens d'un état — le seul endroit où la traduction se fait.
 *
 * Quatre combinaisons pour trois états : « stérile et cyclée » n'existe pas,
 * puisque l'accouplement qui stérilise consomme justement le cycle. La base le
 * refuse aussi (migration 20260809210000). Passer par cette fonction plutôt que
 * d'écrire les deux champs à la main est ce qui garantit qu'on ne fabrique
 * jamais la quatrième.
 */
export const statusFlags = (status: MountStatus): { fertile: boolean; cycled: boolean } => ({
  fertile: status !== 'sterile',
  cycled: status === 'feconde',
});

/**
 * Ce qu'on peut cloner : les stériles, et elles seules.
 *
 * C'est exactement `!fertile` — une féconde n'est pas une monture empêchée, elle
 * est prête — mais la fonction reste, parce que « stérile » est ce que le
 * clonage cherche et que le lire en négation d'un autre état est ce qui a permis
 * la confusion la première fois.
 */
export const isSterile = (mount: Pick<Individual, 'fertile'>): boolean => !mount.fertile;

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
 * Une écurie de travail, qu'on peut consommer sans toucher à la vraie.
 *
 * Tout ce qui projette — la fournée à charger, les fournées suivantes, une
 * partie simulée — avance en dépensant des montures. Le faire sur l'écurie
 * réelle effacerait le parc de l'éleveur à chaque rendu.
 */
export const copyStable = (stable: Stable): Stable => ({
  bulk: new Map([...stable.bulk].map(([id, counts]) => [id, { ...counts }])),
  individuals: stable.individuals.map((mount) => ({ ...mount })),
});

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
 * Le stock qu'un plan peut déduire de ses besoins : ce qui **s'apparie**.
 *
 * `breedingPlan` compte des exemplaires et ignore les sexes — c'est légitime en
 * régime stationnaire, où les naissances tombent moitié-moitié. Mais une écurie
 * réelle dévie de ce partage, et une couleur dont on ne tient qu'un sexe ne fait
 * **aucun** couple. La compter en stock fige le plan sur une étape qu'il croit
 * faite : il n'en produit plus, l'appariement n'aboutit pas, et rien ne rattrape
 * puisque rien ne le signale.
 *
 * Mesuré en simulant : la route s'arrêtait en génération 4 dans vingt parties
 * sur vingt, sur des couleurs de génération 2 tenues à trois mâles et zéro
 * femelle.
 *
 * On ne crédite donc une couleur que si l'écurie en porte des deux
 * sexes — et alors en entier, parce que les deux orientations d'un croisement
 * s'utilisent aussi bien l'une que l'autre.
 *
 * ## « Les deux sexes présents » ne suffisait pas
 *
 * Le compte restait trop généreux dès que le déséquilibre penchait du même côté
 * des deux parents d'une recette. Neuf mâles et une femelle de Doré-Pourpre face
 * à huit mâles et deux femelles de Doré-Orchidée : **vingt exemplaires annoncés,
 * trois couples formables**. Le plan se croyait approvisionné, **supprimait
 * l'étape** qui produit ces couleurs, et laissait des places d'enclos vides sans
 * rien signaler — puisque de son point de vue rien ne manquait. Relevé sur une
 * route complète vers la gen 10 : 36 fournées sur 119 à l'enclos incomplet.
 *
 * On compte donc des **paires** : `2 × min(mâles, femelles)`. C'est ce qui
 * s'apparie à coup sûr, quelle que soit la recette. Sous-estimer est sans danger
 * — le plan produit un peu trop, le surplus reste en écurie et se recrédite à la
 * fournée suivante, où `min` remonte. Surestimer ne se rattrape jamais : le plan
 * cesse de produire l'étape et rien ne le lui redemande.
 *
 * Le premier arbitrage avait retenu l'inverse, sur une mesure en kamas qui
 * donnait le comptage en paires 13 % plus cher. Cette mesure était aveugle : le
 * coût d'un croisement compte les parents et le carburant, et **une place vide ne
 * coûte rien** dans ce modèle. Or elle coûte une fournée, qui se paie pleine ou
 * non. L'unité qui tranche est donc la fournée, pas le kama.
 *
 * `keepWhole` est la couleur **visée**, qu'on possède au lieu de la consommer :
 * elle se compte en entier, son sexe n'y fait rien.
 */
export const breedableStock = (
  stable: Stable,
  keepWhole: string | null = null
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const [colorId, { males, females }] of stableBySex(stable)) {
    const usable = colorId === keepWhole || (males > 0 && females > 0) ? males + females : 0;
    if (usable > 0) counts.set(colorId, usable);
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
  /**
   * Cette monture-là **n'est pas encore à nous** : le plan propose de l'acheter.
   *
   * Sans ce drapeau elle se confond avec une monture de vrac — les deux ont un
   * `mountId` nul — et les écrans le montraient : la fenêtre d'accouplement
   * affichait « Anonyme, prends-en une dans le tas » pour une gen 1 qu'il fallait
   * d'abord aller chercher à l'hôtel de vente. L'éleveur cherchait dans son
   * coffre une monture qu'il n'avait pas.
   */
  bought?: boolean;
};

export type Couple = {
  /** La couleur que ce croisement vise. */
  targetColorId: string;
  male: Pairing;
  female: Pairing;
};

/**
 * Retire d'une écurie de travail les montures que ces couples mobilisent.
 *
 * Un accouplement rend ses deux parents **stériles**, définitivement : la
 * monture reste en écurie, elle ne s'accouple plus. C'est pourquoi on ne la
 * supprime pas — il lui reste le clonage et l'extraction, et les deux comptent.
 *
 * ## Ceci n'est que la **moitié** du geste
 *
 * Un accouplement consomme deux parents *et* rend un poulain. Cette fonction ne
 * fait que la première moitié, et c'est voulu : à l'intérieur d'une même fournée
 * le poulain n'est pas encore là, donc `loadout.ts` a raison de ne pas l'ajouter.
 *
 * Mais tout appel qui **replanifie ensuite** sur l'écurie ainsi obtenue lit une
 * écurie que l'éleveur n'aura jamais : celle où les parents ont disparu sans que
 * rien ne soit né. Il doit donc appeler `projectBirths` à la suite. C'est le
 * défaut mesuré de #165, revenu par une troisième porte après `afterClonings` —
 * voir `couplesToRecordAll`.
 */
export const consumeCouples = (
  stable: Stable,
  couples: Couple[],
  /**
   * Décrémenter aussi les compteurs de fécondité du vrac.
   *
   * Le vrac n'a pas d'identité : on sait combien de montures il porte et combien
   * d'entre elles sont fécondes, jamais lesquelles. Quand les couples consommés
   * sont **tous à zéro place**, leurs deux parents étaient forcément fécondes —
   * c'est la définition d'une place gratuite — donc l'effectif fécond baisse avec
   * l'effectif total. C'est exactement ce que `recordBirths` écrit en base.
   *
   * Faux par défaut, parce qu'un couple d'enclos consomme au contraire des
   * **non**-fécondes : c'est la place qui paie leur cycle. Décrémenter là
   * inventerait une pénurie de fécondes, et `loadout.ts` décide des fournées
   * avec ce compteur.
   */
  { spendCycled = false }: { spendCycled?: boolean } = {}
) => {
  for (const couple of couples) {
    for (const side of [couple.male, couple.female]) {
      if (side.mountId) {
        const mount = stable.individuals.find((candidate) => candidate.id === side.mountId);
        if (mount) mount.fertile = false;
        continue;
      }
      const bulk = stable.bulk.get(side.colorId);
      if (!bulk) continue;
      const banked = cycledOf(bulk);
      if (side.sex === 'M') {
        bulk.males = Math.max(0, bulk.males - 1);
        if (spendCycled) bulk.cycledMales = Math.max(0, banked.males - 1);
      } else {
        bulk.females = Math.max(0, bulk.females - 1);
        if (spendCycled) bulk.cycledFemales = Math.max(0, banked.females - 1);
      }
    }
  }
};

/**
 * Le préfixe des poulains **projetés** : ceux qu'un accouplement rendra, et qui
 * n'ont pas encore de ligne en base.
 *
 * Même règle que `clone-a-venir:` — voir `isProjected`, qui reconnaît les deux.
 * Un identifiant fabriqué qui ressemblerait à un uuid est le piège de #165 :
 * Postgres refuse la valeur, et un `.in()` sur une ligne qui n'existe pas ne rend
 * **aucune erreur**.
 */
export const PROJECTED_BIRTH_PREFIX = 'naissance-a-venir:';

/**
 * L'autre moitié du geste : les poulains que ces couples rendront.
 *
 * ## Pourquoi une projection suffit, alors que la couleur est un tirage
 *
 * On ne peut pas savoir ce qui va naître : un croisement a une distribution
 * d'issues, pas un résultat. On projette donc la **cible** — ce que l'écran
 * demande d'aller viser — et c'est assez, parce que l'enjeu est borné : un
 * poulain naît fertile et **non fécond**, donc il ne peut entrer dans aucun
 * couple à zéro place. Il ne pèse que sur les arbitrages du plan, jamais sur les
 * gestes qu'on saisit. Même raisonnement que `afterClonings` pour `keep`.
 *
 * Ce qui compte, et qui est exact, c'est qu'il y ait **une monture de plus** :
 * sans elle la replanification lit une écurie qui s'est vidée sans rien produire,
 * et change d'avis. Mesuré sur l'écurie du 15/08 : 19 accouplements proposés,
 * les 19 saisis, **1 de plus** au rafraîchissement. Avec la projection : 20
 * proposés, 20 saisis, **0** de plus.
 *
 * ## L'ascendance, elle, n'est pas un tirage
 *
 * Les deux couleurs parentes sont connues, et c'est elles qui décideront des
 * cibles de ce poulain-là — voir `lineageDistribution`. C'est ce que
 * `recordBirths` écrit dans `parent_a_color` / `parent_b_color`, donc on le
 * projette pareil : une naissance est toujours suivie individuellement.
 */
export const projectBirths = (stable: Stable, couples: Couple[], pass: number) => {
  couples.forEach((couple, index) => {
    stable.individuals.push({
      id: `${PROJECTED_BIRTH_PREFIX}${pass}-${index}`,
      colorId: couple.targetColorId,
      // Pas de nom : la monture n'existe pas, elle n'a rien à recopier en jeu.
      name: null,
      // Le sexe est un tirage à pile ou face que rien ne permet de connaître.
      // On alterne, comme `addExpectedBirths` : sur une vague, ça rend le
      // rapport des sexes que la fournée suivante rencontrera.
      sex: index % 2 === 0 ? 'M' : 'F',
      level: 1,
      // Fertile et non fécond, comme ce que `recordBirths` insère.
      fertile: true,
      cycled: false,
      parents: [couple.male.colorId, couple.female.colorId],
    });
  });
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
