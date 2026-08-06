/**
 * Le nom à donner en jeu à une monture, et pourquoi il porte sa généalogie.
 *
 * Le jeu laisse renommer une monture — **20 caractères**, « Anonyme » par
 * défaut. C'est le seul endroit où l'on peut inscrire quelque chose qui se lise
 * depuis la liste de l'écurie, et c'est exactement ce qui manquait : devant
 * quarante montures toutes nommées « Anonyme », rien ne distingue la gen 2 qui
 * traîne une Amande gen 3 — celle qui vise la gen 4 — des trente-neuf autres qui
 * ne visent que la gen 3. Il faut ouvrir chaque fiche pour le savoir.
 *
 * D'où un nom qui dit ce que la monture **vaut** plutôt que ce qu'elle est : sa
 * couleur, le jeu l'affiche déjà.
 *
 * ## La forme
 *
 * `G3 AMA-DOR` : la génération la plus haute de sa généalogie, puis les codes de
 * ses deux parents.
 *
 * Le chiffre passe devant parce que c'est lui qu'on cherche. Trié
 * alphabétiquement, ce que fait l'écurie du jeu, il regroupe les montures par ce
 * qu'elles permettent — et « G9 » se repère d'un coup d'œil au milieu des
 * « Anonyme ».
 *
 * ## Pourquoi trois lettres et non les noms entiers
 *
 * Dix caractères au plus, contre vingt disponibles : la moitié reste libre pour
 * une annotation à la main — un numéro, un « vendu », un « à monter ». Un nom
 * complet aurait mangé la place et se serait fait tronquer sur les couleurs
 * longues, là où un code ne se tronque jamais.
 *
 * ## Découper un nom de couleur
 *
 * Les couleurs composées s'affichent avec un tiret — « Doré-Amande » — mais le
 * tiret sert aussi **à l'intérieur** d'un nom simple : « Aigue-marine » est une
 * couleur, pas une composition. Ce qui les sépare est la casse : un composant
 * commence par une majuscule, une continuation par une minuscule. Vérifié sur
 * les 226 couleurs des trois familles — « marine » est la seule continuation
 * existante, et après recollage aucune couleur ne porte plus de deux composants.
 *
 * D'où un code d'au plus six lettres par parent, et un nom d'au plus dix-sept
 * caractères dans le pire cas (`G10 AIGTUR-AIGEME`). La limite des vingt n'est
 * donc jamais atteinte, et rien n'a besoin d'être tronqué.
 */

/** Ce que le jeu accepte comme nom de monture. */
export const MOUNT_NAME_MAX_LENGTH = 20;

/** Le nom par défaut du jeu, et donc celui d'une monture qu'on n'a pas nommée. */
export const ANONYMOUS_NAME = 'Anonyme';

/**
 * Les composants d'un nom de couleur, tirets internes recollés.
 *
 * « Aigue-marine-Dore » rend `['Aiguemarine', 'Dore']` : la minuscule de
 * « marine » dit qu'elle continue le composant précédent au lieu d'en ouvrir un
 * nouveau.
 */
export const colorParts = (name: string): string[] => {
  const parts: string[] = [];
  for (const piece of name.split('-')) {
    if (!piece) continue;
    // Une minuscule continue le composant précédent ; une majuscule en ouvre un.
    if (parts.length > 0 && piece[0] === piece[0].toLowerCase()) {
      parts[parts.length - 1] += piece;
    } else {
      parts.push(piece);
    }
  }
  return parts;
};

/**
 * Le code d'une couleur : trois lettres par composant, sans accent.
 *
 * Les accents tombent parce que le jeu ne garantit pas de les rendre dans un
 * champ de nom, et qu'un « É » qui s'affiche « ? » ne se lit pas mieux qu'un
 * « E ». Trois lettres suffisent à distinguer : au sein d'une famille, aucune
 * paire de couleurs simples ne partage ses trois premières lettres.
 */
export const colorCode = (name: string): string =>
  colorParts(name)
    .map((part) =>
      part
        // NFD détache l'accent de sa lettre, et le filtre qui suit l'emporte
        // avec tout ce qui n'est pas une lettre latine : « Doré » devient
        // « Dor ». Une plage de diacritiques explicite ferait la même chose,
        // avec des caractères invisibles dans le source.
        .normalize('NFD')
        .replace(/[^A-Za-z]/g, '')
        .slice(0, 3)
        .toUpperCase()
    )
    .join('');

/**
 * Le nom à inscrire en jeu sur une monture, ou `ANONYMOUS_NAME` si elle n'a pas
 * d'ascendance.
 *
 * Une monture achetée ou capturée n'a rien à porter : sa généalogie est vide,
 * elle ne fera jamais viser plus haut que sa propre génération. La laisser
 * « Anonyme » est donc exact et non un aveu d'ignorance — c'est même
 * l'information utile, puisque tout ce qui n'est pas anonyme mérite un regard.
 */
export const mountName = (
  /** La génération la plus haute de la généalogie : la sienne ou celle d'un parent. */
  carriedGeneration: number,
  /** Les noms affichés des deux parents, ou `null` sans ascendance connue. */
  parentNames: [string, string] | null
): string => {
  if (!parentNames) return ANONYMOUS_NAME;

  // Les deux codes se rangent par ordre alphabétique, et ce n'est pas une
  // coquetterie : l'ordre des parents n'est pas une propriété de la généalogie.
  // Le même accouplement, selon que l'Amande est le mâle ou la femelle, donnait
  // « G4 AMA-DOR » à un poulain et « G4 DOR-AMA » à son jumeau. Deux montures
  // rigoureusement identiques sous deux noms — et le tri de l'écurie, qui est
  // toute la raison d'être de ce nom, cessait de les rapprocher.
  const codes = [colorCode(parentNames[0]), colorCode(parentNames[1])].sort();

  return `G${carriedGeneration} ${codes[0]}-${codes[1]}`.slice(0, MOUNT_NAME_MAX_LENGTH);
};

/**
 * La génération qu'une monture **porte** : la plus haute de sa généalogie.
 *
 * C'est elle qui décide de ce que ses accouplements viseront, et non la sienne
 * propre — voir `pairTargetGeneration`. Un poulain gen 2 né d'une Amande gen 3
 * porte un 3, et c'est ce 3 qu'il faut voir sur son nom.
 */
export const carriedGeneration = (
  ownGeneration: number,
  parentGenerations: [number, number] | null
): number => Math.max(ownGeneration, ...(parentGenerations ?? []));
