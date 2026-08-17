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
 * Les parts se normalisent à l'intérieur de chaque lignée. Entre les deux
 * lignées, le partage n'est 50/50 que lorsque rien ne se recombine — voir plus
 * bas, et `crossingFailureShares` pour la loi complète.
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
 * ## « Composée » se lit sur la génération, et la gen 9 en est
 *
 * On l'a lue successivement sur le souligné de l'identifiant, puis sur la parité
 * du nom affiché — « une couleur composée porte deux teintes ». Les deux
 * lectures sont **fausses au même endroit** : la génération 9. Le relevé du
 * 14/08 (issue #185) la prend en défaut de trois façons indépendantes, sur une
 * mère Azur-Turquoise dont la généalogie porte Azur (gen 9) et Pourpre (gen 1) :
 *
 * | rapport relevé | ce que le nom prédisait | ce qu'il vaut |
 * | --- | --- | --- |
 * | Azur 3,28 % contre Pourpre 14,75 % | 1 — deux grands-parents simples | **1/4,5** |
 * | Amande gen 3 9,91 % contre Doré gen 1 9,91 % | 1 | 1 ✓ |
 * | Doré-Amande gen 4 3,67 % contre ses gen 1 9,91 % | (5/4,5)/3 | (5/4,5)/3 ✓ |
 *
 * Azur et Pourpre occupent la **même position** — grands-parents de la mère — et
 * portent tous deux un nom d'un seul mot. Le jeu les sépare pourtant d'un facteur
 * 4,5, qui est le facteur de composition et rien d'autre. Les gen 9 *sont* des
 * compositions de deux gen 8 ; elles reçoivent seulement un nom d'un seul mot.
 *
 * `aigue_marine` cesse du même coup d'être une exception à nommer : elle est
 * gen 9, donc composée, et son souligné n'a plus voix au chapitre. C'est le seul
 * bénéfice net d'un changement qui, par ailleurs, remplace une règle par un
 * ajustement.
 *
 * ## Ce qui reste ouvert, et il faut le dire
 *
 * `paire OU 9` **ajuste les données ; ce n'est pas encore une loi.** Un cas
 * particulier sur une seule génération sent l'erreur de modèle. Les deux
 * généralisations naturelles sont réfutées : « impaire ⇒ simple » par la gen 9,
 * « ≥ 2 ⇒ composée » par la gen 3, qui pèse exactement autant qu'une gen 1.
 *
 * | génération | statut | d'où |
 * | --- | --- | --- |
 * | 1 (Doré, Pourpre, Ébène) | simple | #59, fenêtres 1–3 |
 * | 2 (Ébène-Orchidée) | composée | #49, #59 |
 * | 3 (Amande) | **simple** | #59, fenêtre 3 |
 * | 4 (Doré-Amande) | composée | fenêtre 3 |
 * | 5 (Turquoise) | **simple** | relevé du 17/08 |
 * | 6, 8 | composées | paires, et rien ne les contredit |
 * | 7 (Prune, Émeraude) | **inconnue** | — |
 * | 9 (Azur) | **composée** | fenêtres 1 et 3 |
 * | 10 (Azur-Turquoise) | composée | fenêtres 1–3 |
 *
 * La gen 5 est tombée le 17/08, sur un Turquoise-Doré gen 6 dont la généalogie
 * porte Turquoise (gen 5) et Doré (gen 1) : deux grands-parents, même position, et
 * le jeu les affiche **exactement égaux** — 11,72 % chacun. La règle survit à son
 * premier appui direct, et « impaire ≥ 5 ⇒ composée », qui aurait expliqué la
 * gen 9 sans exception, est réfutée à 13,1 points.
 *
 * Il ne reste donc qu'une inconnue : une **gen 7** — Prune ou Émeraude — dans
 * l'une des six cases. Le moins cher n'est pas de l'acheter : une gen 8 en porte
 * une dans sa généalogie, et ouvrir la fenêtre ne consomme rien. Une fenêtre de
 * plus épingle la règle sur tout l'arbre.
 *
 * ## Ce que ceci ne décrit pas
 *
 * **Les recombinaisons croisées.** Quand les deux lignées portent des teintes
 * qui se composent, le bébé peut sortir avec une couleur qui n'est dans aucune
 * des deux généalogies — un composant pris à gauche, l'autre à droite. Sur le
 * relevé 4, cela emporte 26 % de la masse d'échec.
 *
 * Leur loi est **connue depuis l'issue #68** : chaque lignée pèse 1, chaque
 * recombinaison qui nomme une couleur sous la cible pèse le produit des deux
 * parts, et le tout se normalise sur `2 + w`. Elle vit dans
 * `crossingFailureShares`, et pas ici — une recombinaison naît de la rencontre
 * des **deux** lignées, là où les fonctions ci-dessous n'en voient qu'une à la
 * fois. C'est structurel, pas un manque à combler.
 *
 * `costs.ts` chiffrait autrefois l'échec en sommant deux appels d'ici, un par
 * parent. Il omettait donc la branche entière des recombinaisons, et
 * sous-estimait le crédit d'un raté — de 688 kamas en moyenne sur le muldo,
 * jusqu'à 9 436 sur les gen 9. Il valorise maintenant `crossingFailureShares`,
 * et ce module n'a plus à connaître les coûts du tout.
 *
 * **Le régime « recopie ».** Quand aucune génération n'est à gagner, la masse de
 * réussite n'a nulle part où aller et retombe entièrement sur les cases de
 * l'ascendance. Mesuré au centième sur le relevé 6, puis confirmé par #68 sur
 * deux Indigo capturés — la fenêtre annonce Indigo 100 %, et zéro géneton.
 *
 * On y voyait « un appariement qu'on ne monte pas volontairement ». C'est
 * l'inverse : **c'est la purification**. Croiser une couleur avec elle-même n'a
 * par définition aucune génération à gagner, donc tout ce que l'outil conseille
 * sur la concentration des lignées repose sur ce régime-là.
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
 * Une couleur composée voit son poids divisé par 4,5.
 *
 * La génération décide, et elle seule — voir l'en-tête pour les rapports relevés
 * qui l'imposent, et pour ce que cette règle a encore d'inachevé. Le `|| 9` est un
 * ajustement en attente d'un relevé de **gen 7** ; il est écrit comme tel plutôt
 * que noyé dans une expression, pour qu'on le retrouve le jour où ce relevé
 * arrive. La gen 5 est tombée le 17/08 et elle est **simple**, ce qui laisse ce
 * `|| 9` seul contre l'arbre.
 */
export const isComposite = (generation: number) => generation % 2 === 0 || generation === 9;

/** Le poids d'une case, position et composition combinées. */
export const slotWeight = (position: number, generation: number) =>
  position * (isComposite(generation) ? COMPOSITE_FACTOR : 1);

/**
 * La génération prêtée à une couleur que le catalogue ne connaît pas.
 *
 * Gen 1 plutôt que zéro : zéro est **pair**, donc composé, et une couleur
 * inconnue verrait son poids divisé par 4,5 en silence. Un croisement dont une
 * case manque au catalogue est de toute façon refusé en amont par `pairOutlook`
 * ; ce défaut ne sert que les lectures d'écran, où mieux vaut le poids plein.
 */
const UNKNOWN_GENERATION = 1;

/**
 * Les parts d'une lignée, cases cumulées, sommant à 1.
 *
 * C'est elle qui rend la **purification** lisible : croiser une couleur avec
 * elle-même donne un bébé dont les deux grands-parents portent la même couleur,
 * si bien que leurs poids se cumulent sur une seule entrée. La lignée cesse de
 * s'éparpiller — et comme la couleur cible obtenue suit les poids de la lignée
 * d'en face, le tirage se concentre au lieu de se diluer.
 *
 * Ce raisonnement se lisait sur les poids seuls ; il est **vérifié en jeu**
 * depuis l'issue #68. Deux Indigo capturés, sans généalogie affichée ni d'un
 * côté ni de l'autre, rendent un Indigo dont la fiche d'étable porte bien
 * `[Indigo, Indigo]`. C'est ce qui donne sa valeur à la purification : le bébé
 * ne se contente pas de reprendre la couleur, il en fait une lignée pure.
 *
 * Purifier une génération **impaire sauf la 9** est doublement gagnant : ces
 * couleurs-là sont simples, donc déjà de poids plein, et concentrer leur lignée
 * porte la part dominante à 100 %. La gen 9 fait exception depuis le relevé du
 * 14/08 — elle est composée comme les paires, et sa purification ne gagne que le
 * second terme.
 */
export const lineageDistribution = (
  parentColorId: string,
  grandparentColorIds: string[] | null,
  /**
   * Les générations du catalogue, seule chose qui dise si une case est composée.
   *
   * Passées en argument plutôt que lues sur l'identifiant : c'est la génération
   * qui porte la règle depuis le relevé du 14/08, et l'identifiant s'en trompait
   * — dans les deux sens, `azur` sans souligné et `aigue_marine` avec.
   */
  generations: Map<string, number>
): Map<string, number> => {
  const shares = new Map<string, number>();
  const add = (colorId: string, share: number) =>
    shares.set(colorId, (shares.get(colorId) ?? 0) + share);
  const generationOf = (colorId: string) => generations.get(colorId) ?? UNKNOWN_GENERATION;

  // Sans ascendance connue — monture achetée ou capturée — le parent prend tout.
  if (!grandparentColorIds || grandparentColorIds.length === 0) {
    add(parentColorId, 1);
    return shares;
  }

  const weights: [string, number][] = [
    [parentColorId, slotWeight(PARENT_WEIGHT, generationOf(parentColorId))],
    ...grandparentColorIds.map(
      (colorId): [string, number] => [colorId, slotWeight(GRANDPARENT_WEIGHT, generationOf(colorId))]
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
