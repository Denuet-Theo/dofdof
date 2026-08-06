/**
 * Ce qu'un croisement rend quand il ne rend pas la génération visée.
 *
 * Un accouplement **produit toujours un bébé** : les 30 à 90 % portent sur sa
 * génération, pas sur son existence. Une tentative « ratée » rend donc une
 * monture d'une autre couleur, tirée dans la généalogie proche — et ce qu'elle
 * vaut décide du coût attendu de chaque croisement, donc du niveau auquel il
 * vaut la peine de monter les parents, donc du classement des couleurs.
 *
 * Les poids étaient posés par symétrie (25 % chaque parent, 12,5 % chaque
 * grand-parent) et n'avaient jamais été mesurés. Ils le sont maintenant, sur
 * huit relevés en jeu consignés dans l'issue #49 — et ils sont faux.
 *
 * ## La loi
 *
 * Chaque case d'ascendance porte un poids, produit de deux facteurs :
 *
 * 1. **Sa position** : le parent vaut 5, chaque grand-parent 3.
 * 2. **La nature de sa couleur** : une couleur **composée** — « Doré et
 *    Amande », par opposition aux couleurs simples comme « Amande » ou
 *    « Doré » — voit son poids divisé par **4,5**.
 *
 * La masse d'échec se partage ensuite **exactement 50/50** entre les deux
 * lignées, et les parts se normalisent à l'intérieur de chacune.
 *
 * Trois configurations mesurées, toutes reproduites au centième :
 *
 * | Parent | Grands-parents | Parent | Chaque gp | Relevés |
 * | --- | --- | --- | --- | --- |
 * | simple | composés | 78,95 % | 10,53 % | 1, 2, 3, 7 |
 * | simple | simples | 45,45 % | 27,27 % | 1, 3, 7 |
 * | composé | simples | 15,63 % | 42,19 % | 4, 8, 59 |
 *
 * Le relevé 59 mérite d'être signalé à part : il porte sur un croisement dont la
 * cible **saute deux générations** (voir `pairTargetGeneration`), et la
 * répartition d'échec y est reproduite au centième — 42,19 % pour chacune des
 * deux couleurs de grands-parents, 15,63 % pour la couleur composée du parent.
 * Le raccourci de génération ne change donc rien à la loi ci-dessous : il déplace
 * la cible, pas les poids.
 *
 * Le facteur 4,5 est le même dans les deux sens : qu'on compose le parent ou
 * qu'on compose les grands-parents, le rapport bascule d'autant. C'est ce qui
 * fait qu'il s'agit d'une loi et non de trois tables.
 *
 * Un parent **acheté ou capturé** n'a pas d'ascendance dans notre plan : sa part
 * de grands-parents lui revient, et il prend sa moitié entière. Confirmé par le
 * relevé 2, où un Doré capturé emporte 29,9 % sur une masse d'échec de 59,81.
 *
 * Une couleur qui occupe plusieurs cases cumule leurs poids. Rien à traiter à
 * part : la valeur d'une lignée étant une somme pondérée de coûts, compter deux
 * fois la même couleur avec ses deux poids revient exactement à la fusionner.
 *
 * ## « Composée » et « génération paire » ne font qu'un
 *
 * On a longtemps cru le contraire : la génération 9 du muldo passait pour une
 * exception, et c'est ce qui justifiait de lire la composition sur
 * l'identifiant. **Il n'y a pas d'exception.** Sur les 306 couleurs des trois
 * familles, lue sur le nom affiché, la parité est parfaite — générations
 * impaires 0 % composées, paires 100 %.
 *
 * L'exception venait du slug. « Aigue-marine » est **une** couleur de deux
 * mots, comme n'importe quel nom composé de mots ; son identifiant
 * `aigue_marine` porte donc un souligné sans être une composition. Elle était
 * seule dans ce cas sur tout le catalogue, et elle voyait son poids divisé par
 * 4,5 à tort — sa part de lignée tombait à 15,63 % au lieu de 45,45 %, ce qui
 * sous-estimait de 150 % le crédit d'un raté sur les routes qui la traversent.
 *
 * On continue de lire la composition sur l'identifiant, faute d'avoir la
 * génération ou le nom sous la main ici, mais avec l'exception nommée : voir
 * `SIMPLE_COLORS_WITH_UNDERSCORE`.
 *
 * ## Ce que ceci ne décrit pas
 *
 * **Les recombinaisons croisées.** Quand les deux lignées portent des couleurs
 * composées **différentes**, le bébé peut sortir avec une couleur qui n'est dans
 * aucune des deux généalogies — un composant pris à gauche, l'autre à droite.
 * Sur le relevé 4, cela emporte 26 % de la masse d'échec. Le modèle ci-dessous
 * ne les produit pas : il surestime donc les couleurs de l'ascendance quand ce
 * cas se présente. Les croisements d'un plan propre n'y tombent qu'en génération
 * paire.
 *
 * **Le régime « recopie ».** Quand aucune génération n'est à gagner, le jeu ne
 * partage plus par lignée : la masse restante se répartit sur les cases
 * survivantes, toutes lignées confondues. Mesuré au centième sur le relevé 6.
 * Ce régime décrit un appariement qu'on ne monte pas volontairement.
 */

/** Poids de position : le parent pèse 5, chaque grand-parent 3. */
export const PARENT_WEIGHT = 5;
export const GRANDPARENT_WEIGHT = 3;

/**
 * Ce qu'une couleur composée conserve de son poids : deux neuvièmes, soit une
 * division par 4,5. Mesuré dans les deux sens sur les relevés 4 et 8.
 */
export const COMPOSITE_FACTOR = 2 / 9;

/**
 * Les couleurs **simples** dont l'identifiant porte quand même un souligné.
 *
 * Le souligné sépare deux teintes dans `dore_amande`, mais il sépare deux
 * **mots d'un même nom** dans `aigue_marine` — « Aigue-marine », la couleur de
 * génération 9 du muldo, qui n'est pas plus une composition d'« Aigue » et de
 * « marine » que « Prune » n'en est une.
 *
 * La liste est courte et elle est exhaustive : sur les 306 couleurs des trois
 * familles, c'est la **seule** dont la composition lue sur l'identifiant
 * contredise celle lue sur le nom affiché. Le discriminant sur le nom est la
 * casse — un composant commence par une majuscule (« Aigue-marine-Doré »), une
 * continuation par une minuscule — et il donne la parité parfaite.
 *
 * Pour revérifier après une mise à jour des arbres : comparer, sur chaque
 * couleur, `id.includes('_')` au fait que le nom porte plus d'un mot capitalisé.
 * Toute nouvelle divergence est à ajouter ici.
 */
export const SIMPLE_COLORS_WITH_UNDERSCORE = new Set(['aigue_marine']);

/**
 * Une couleur composée porte deux teintes — « doré_amande », affiché « Doré et
 * Amande ». Les couleurs simples n'en portent qu'une.
 *
 * Lu sur l'identifiant, parce que c'est tout ce dont `lineageDistribution`
 * dispose : elle reçoit des identifiants de couleurs, pas des générations ni des
 * noms. L'exception nommée rattrape le seul cas où le slug ment.
 *
 * `aigue_marine_dore` reste composée, et sans traitement particulier : ce n'est
 * pas `aigue_marine`, donc l'exception ne s'y applique pas.
 */
export const isComposite = (colorId: string) =>
  colorId.includes('_') && !SIMPLE_COLORS_WITH_UNDERSCORE.has(colorId);

/** Le poids d'une case, position et composition combinées. */
export const slotWeight = (position: number, colorId: string) =>
  position * (isComposite(colorId) ? COMPOSITE_FACTOR : 1);

/** Part de la masse d'échec qui revient à chaque lignée. */
export const LINEAGE_SHARE = 0.5;

/** Une case d'ascendance : sa couleur, et ce qu'elle coûterait à se procurer. */
export type LineageSlot = {
  colorId: string;
  cost: number;
};

/**
 * Les parts d'une lignée, cases cumulées, sommant à 1.
 *
 * C'est elle qui rend la **purification** lisible : croiser une couleur avec
 * elle-même donne un bébé dont les deux grands-parents portent la même couleur,
 * si bien que leurs poids se cumulent sur une seule entrée. La lignée cesse de
 * s'éparpiller — et comme la couleur cible obtenue suit les poids de la lignée
 * d'en face, le tirage se concentre au lieu de se diluer.
 *
 * Purifier une génération **impaire** est doublement gagnant : ces couleurs sont
 * simples, donc déjà de poids plein, et concentrer leur lignée porte la part
 * dominante à 100 %.
 */
export const lineageDistribution = (
  parentColorId: string,
  grandparentColorIds: string[] | null
): Map<string, number> => {
  const shares = new Map<string, number>();
  const add = (colorId: string, share: number) =>
    shares.set(colorId, (shares.get(colorId) ?? 0) + share);

  // Sans ascendance connue — monture achetée ou capturée — le parent prend tout.
  if (!grandparentColorIds || grandparentColorIds.length === 0) {
    add(parentColorId, 1);
    return shares;
  }

  const weights: [string, number][] = [
    [parentColorId, slotWeight(PARENT_WEIGHT, parentColorId)],
    ...grandparentColorIds.map(
      (colorId): [string, number] => [colorId, slotWeight(GRANDPARENT_WEIGHT, colorId)]
    ),
  ];

  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) {
    add(parentColorId, 1);
    return shares;
  }

  for (const [colorId, weight] of weights) add(colorId, weight / total);
  return shares;
};

/**
 * Ce qu'une lignée apporte à la valeur d'un bébé hors cible.
 *
 * Une couleur vaut ce qu'elle aurait coûté à se procurer : l'obtenir sans payer
 * économise exactement cela. Les coûts sont bornés à zéro par l'appelant — une
 * monture ne peut pas valoir moins que rien.
 */
export const lineageValue = (
  parent: LineageSlot,
  grandparents: LineageSlot[] | null
): number => {
  const distribution = lineageDistribution(
    parent.colorId,
    grandparents?.map((grandparent) => grandparent.colorId) ?? null
  );

  const costOf = new Map<string, number>([[parent.colorId, parent.cost]]);
  for (const grandparent of grandparents ?? []) {
    // Une couleur présente deux fois a un coût unique : le premier vu fait foi.
    if (!costOf.has(grandparent.colorId)) costOf.set(grandparent.colorId, grandparent.cost);
  }

  let value = 0;
  for (const [colorId, share] of distribution) value += share * (costOf.get(colorId) ?? 0);
  return LINEAGE_SHARE * value;
};

/**
 * À quel point une lignée est concentrée, entre 0 et 1 : la part de sa couleur
 * la mieux dotée.
 *
 * Une lignée purifiée — les deux grands-parents de la couleur du parent — monte
 * à 1. Une lignée éparpillée sur une couleur simple plafonne à 15/19, et une
 * couleur composée à 10/64. Sert à départager deux montures de même couleur : à
 * niveau égal, la plus concentrée rend le résultat plus sûr.
 */
export const lineagePurity = (distribution: Map<string, number>): number =>
  Math.max(0, ...distribution.values());
