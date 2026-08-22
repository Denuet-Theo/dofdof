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
 * `G4 DO M AM-DO` : la génération la plus haute de sa généalogie, sa couleur,
 * son sexe, puis les codes de ses deux parents.
 *
 * Le chiffre passe devant parce que c'est lui qu'on cherche. Trié
 * alphabétiquement, ce que fait l'écurie du jeu, il regroupe les montures par ce
 * qu'elles permettent — et « G9 » se repère d'un coup d'œil au milieu des
 * « Anonyme ».
 *
 * ## Pourquoi tout y est, couleur comprise
 *
 * Un accouplement rend un poulain dont le sexe et la couleur sont tirés : tous
 * les poulains d'un même croisement portaient donc le **même nom**. Or c'est par
 * le nom qu'on retrouve une monture dans l'écurie du jeu, et l'écurie ne sait
 * filtrer que sur un critère à la fois : chercher « G4 AM-DO » rendait des
 * Doré et des Pourpre, des mâles et des femelles, et il fallait ensuite
 * repasser un filtre de couleur par-dessus.
 *
 * Mettre les trois dans le nom, c'est ramener ce tri à **une seule recherche**.
 * C'est aussi ce qui décide de l'ordre des champs : de la question la plus large
 * à la plus fine, si bien qu'une recherche partielle — « G4 DO » — reste juste.
 *
 * Rien n'est laissé dehors au motif que le jeu l'afficherait par ailleurs : la
 * vignette montre bien la couleur et la fiche bien le sexe, mais ni l'une ni
 * l'autre ne se cherchent, et c'est chercher qu'on fait devant l'enclos.
 *
 * ## Pourquoi des codes et non les noms entiers
 *
 * Un nom complet aurait mangé toute la place et se serait fait tronquer sur les
 * couleurs longues, là où un code ne se tronque jamais. Sur la longueur des
 * codes eux-mêmes, voir `colorCoder` : deux lettres, et c'est ce qui fait tenir
 * la couleur dans les vingt caractères du jeu.
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
 * D'où un code d'au plus quatre lettres par couleur, et un nom d'au plus vingt
 * caractères dans le pire cas (`G10 ABDO M DOOR-DOPO`). La limite du jeu est
 * atteinte pile, et rien n'a besoin d'être tronqué.
 */

import type { Sex } from './stable';

/** Ce que le jeu accepte comme nom de monture. */
export const MOUNT_NAME_MAX_LENGTH = 20;

/** Le nom par défaut du jeu, et donc celui d'une monture qu'on n'a pas nommée. */
export const ANONYMOUS_NAME = 'Anonyme';

/**
 * Le nom sous lequel une monture se lit — **celui de l'écran**, jamais `null`.
 *
 * Le jeu écrit « Anonyme » sur toute monture non renommée, et le vrac n'en porte
 * aucun. Une monture sans nom se cherche, se compte et se range donc sous ce
 * nom-là. C'était écrit `?? ANONYMOUS_NAME` à sept endroits — la recherche, le
 * tri de l'écurie, le clonage, l'hôtel de vente, les puces de naissance — et
 * chacun était une occasion d'en oublier un et de faire disparaître les
 * anonymes d'un compte ou d'un tri.
 */
export const borneName = (mount: { name: string | null }): string =>
  mount.name ?? ANONYMOUS_NAME;

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
 * Un composant réduit à ses lettres latines majuscules.
 *
 * NFD détache l'accent de sa lettre, et le filtre qui suit l'emporte avec tout
 * ce qui n'est pas une lettre latine : « Doré » devient « DORE ». Les accents
 * tombent parce que le jeu ne garantit pas de les rendre dans un champ de nom,
 * et qu'un « É » qui s'affiche « ? » ne se lit pas mieux qu'un « E ».
 */
const plain = (part: string): string =>
  part.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase();

/** Traduit un nom de couleur en code, dans le vocabulaire d'une famille. */
export type ColorCoder = (colorName: string) => string;

/** Les tables déjà construites, une par catalogue de couleurs. */
const coderCache = new WeakMap<readonly { name: string }[], ColorCoder>();

/**
 * Le codeur d'une famille : deux lettres par composant, sans collision.
 *
 * La première lettre, puis **la première qui départage** — d'où `AM` pour
 * Amande et `AB` pour Ambre, qui se disputent le préfixe `AM`. Les composants
 * sont servis par ordre alphabétique, si bien que la table est la même d'une
 * session à l'autre, et le codeur est relatif à une famille : c'est le seul
 * périmètre où deux couleurs ont besoin de se distinguer.
 *
 * ## Pourquoi deux lettres et non trois
 *
 * Trois lettres se lisaient mieux — `DOR`, `AMA` — mais depuis que le nom porte
 * aussi la **couleur** de la monture, elles ne tiennent plus : mesuré sur les
 * 84 876 combinaisons (couleur née, ascendance, sexe) des trois familles, la
 * forme à trois lettres dépasse les vingt caractères dans **35 %** des cas et
 * fabrique 2 800 noms tronqués qui recouvrent plusieurs montures distinctes —
 * c'est-à-dire qu'elle reperd exactement ce qu'on venait de gagner.
 *
 * À deux lettres, le pire cas tombe à **vingt caractères pile**
 * (`G10 ABDO M DOOR-DOPO`) : zéro troncature, zéro collision, sur les trois
 * familles. La marge libre pour une annotation manuscrite disparaît, et c'est
 * l'arbitrage assumé — un nom qui désigne une monture sans ambiguïté vaut mieux
 * qu'un nom court avec de la place à côté.
 */
export const colorCoder = (colors: readonly { name: string }[]): ColorCoder => {
  const cached = coderCache.get(colors);
  if (cached) return cached;

  const components = [...new Set(colors.flatMap((color) => colorParts(color.name).map(plain)))]
    .sort();

  const codeOf = new Map<string, string>();
  const taken = new Set<string>();

  for (const component of components) {
    // La première lettre reste, la seconde est la première qui n'est pas déjà
    // prise : `AM` pour Amande, puis `AB` pour Ambre.
    let code = '';
    for (let index = 1; index < component.length; index += 1) {
      const candidate = component[0] + component[index];
      if (!taken.has(candidate)) {
        code = candidate;
        break;
      }
    }
    // Aucun couple de lettres libre — inatteignable sur les trois familles, mais
    // le composant entier est toujours unique, donc il fait un repli sûr.
    if (!code) code = component;
    codeOf.set(component, code);
    taken.add(code);
  }

  const coder: ColorCoder = (colorName) =>
    colorParts(colorName)
      .map((part) => codeOf.get(plain(part)) ?? plain(part).slice(0, 2))
      .join('');

  coderCache.set(colors, coder);
  return coder;
};

/**
 * Le chemin inverse : d'un code lu dans un nom vers la couleur qu'il désigne.
 *
 * `null` en valeur signale un code **ambigu** — deux couleurs le portent — et
 * c'est délibérément distinct de « absent ». Un code ambigu arbitré au hasard
 * rendrait une relecture de nom silencieusement fausse, alors que la ligne
 * concernée mérite d'être montrée à l'éleveur. `colorCoder` n'en produit aucun
 * sur les trois familles, mais ça ne se vérifie qu'ici.
 *
 * Vit à côté de `colorCoder` et non dans l'écran d'import parce que deux écrans
 * relisent maintenant un nom dicté : l'import d'une liste, et la correction d'un
 * clonage saisi de travers — qui rattrape la monture que le jeu a réellement
 * rendue. Deux tables construites séparément dériveraient au premier code qui
 * change, et un code qui change renomme toute une écurie.
 */
export const colorsByCode = (
  colors: readonly { id: string; name: string }[]
): Map<string, string | null> => {
  const code = colorCoder(colors);
  const seen = new Map<string, string | null>();
  for (const color of colors) {
    const key = code(color.name);
    seen.set(key, seen.has(key) ? null : color.id);
  }
  return seen;
};

/**
 * Le nom à inscrire en jeu sur une monture, ou `ANONYMOUS_NAME` si elle n'a pas
 * d'ascendance.
 *
 * Une monture achetée ou capturée n'a rien à porter : sa généalogie est vide,
 * elle ne fera jamais viser plus haut que sa propre génération. La laisser
 * « Anonyme » est donc exact et non un aveu d'ignorance — c'est même
 * l'information utile, puisque tout ce qui n'est pas anonyme mérite un regard.
 */
export type MountNameParts = {
  /** La génération la plus haute de la généalogie : la sienne ou celle d'un parent. */
  carriedGeneration: number;
  /** Le nom affiché de la couleur de la monture elle-même. */
  colorName: string;
  /**
   * Le sexe, qui sépare les deux poulains d'un même croisement.
   *
   * Sans lui, la moitié de l'écurie répondait au même nom — et comme un
   * accouplement demande un mâle **et** une femelle, c'était l'attribut sur
   * lequel on butait à chaque fournée.
   */
  sex: Sex;
  /** Les noms affichés des deux parents, ou `null` sans ascendance connue. */
  parentNames: [string, string] | null;
  /** Le codeur de la famille — voir `colorCoder`. */
  code: ColorCoder;
};

export const mountName = ({
  carriedGeneration,
  colorName,
  sex,
  parentNames,
  code,
}: MountNameParts): string => {
  if (!parentNames) return ANONYMOUS_NAME;

  // Les deux codes se rangent par ordre alphabétique, et ce n'est pas une
  // coquetterie : l'ordre des parents n'est pas une propriété de la généalogie.
  // Le même accouplement, selon que l'Amande est le mâle ou la femelle, donnait
  // « G4 AM-DO » à un poulain et « G4 DO-AM » à son jumeau. Deux montures
  // rigoureusement identiques sous deux noms — et le tri de l'écurie, qui est
  // toute la raison d'être de ce nom, cessait de les rapprocher.
  const parents = [code(parentNames[0]), code(parentNames[1])].sort();

  return `G${carriedGeneration} ${code(colorName)} ${sex} ${parents[0]}-${parents[1]}`.slice(
    0,
    MOUNT_NAME_MAX_LENGTH
  );
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

/** Une couleur du catalogue, réduite à ce qu'un nom en a besoin. */
export type NamedColor = { id: string; name: string; generation: number };

/**
 * Le nom qu'une monture **devrait** porter en jeu, d'après ce qu'elle est.
 *
 * `null` pour une monture sans ascendance : il n'y a rien à inscrire, et
 * « Anonyme » est déjà son nom dans le jeu.
 *
 * ## Pourquoi ce calcul est un instrument de contrôle et pas seulement d'écriture
 *
 * Le nom est **dérivé** — couleur, sexe, ascendance — donc il se recalcule à tout
 * moment, et l'écart entre le nom porté et le nom dû est la preuve locale que
 * quelque chose a bougé sans que l'autre suive. Deux façons d'y arriver, et les
 * deux sont arrivées : corriger le sexe d'une monture dans « Mes stocks » sans
 * la renommer en jeu, et importer une ligne dont le nom ne décrit pas ce qu'on
 * a tapé à côté.
 *
 * Ça compte plus qu'une étiquette de travers. Le nom est **la seule chose qui se
 * lise depuis la liste de l'écurie du jeu** : une monture dont le nom ment n'est
 * plus retrouvable devant l'enclos, et c'est là qu'on la cherche.
 *
 * Extrait de `BreedingStocks`, où il vivait en fermeture locale, le jour où le
 * relevé d'écurie a eu besoin de compter les écarts au lieu de les afficher un
 * par un au fil d'une liste de deux cents lignes.
 */
export const dictatedNameFor = (
  mount: { colorId: string; sex: Sex; parents: readonly string[] | null },
  colors: readonly NamedColor[]
): string | null => {
  if (!mount.parents || mount.parents.length !== 2) return null;

  const byId = new Map(colors.map((color) => [color.id, color]));
  const own = byId.get(mount.colorId);
  const parents = mount.parents.map((id) => byId.get(id));
  // Une couleur absente du catalogue rendrait un code inventé, donc un « écart »
  // qui n'en est pas un et un bouton qui renomme de travers. On préfère ne rien
  // dire : c'est la même règle que `purityOf` sur une ascendance à moitié connue.
  if (!own || !parents[0] || !parents[1]) return null;

  return mountName({
    carriedGeneration: carriedGeneration(own.generation, [
      parents[0].generation,
      parents[1].generation,
    ]),
    colorName: own.name,
    sex: mount.sex,
    parentNames: [parents[0].name, parents[1].name],
    code: colorCoder(colors),
  });
};

/**
 * Un nom relu — l'inverse de `mountName`.
 *
 * Le nom n'est pas qu'une étiquette : il porte la couleur, le sexe et les deux
 * parents, c'est-à-dire **tout ce que la base enregistre d'une monture** sauf
 * son niveau et son état. Il se relit donc, et c'est ce qui permet de recharger
 * une écurie entière depuis la liste du jeu plutôt que fiche par fiche.
 *
 * On rend des **codes** et non des couleurs : la table qui les traduit dépend de
 * la famille, et ce module ne la connaît pas. L'appelant, qui a le catalogue,
 * fait la correspondance — voir `colorCoder`, dont il suffit d'inverser la
 * sortie sur les couleurs qu'il possède.
 *
 * La génération est rendue telle qu'écrite bien qu'elle soit **déductible** de
 * la couleur et des parents. C'est exprès : la recalculer et la comparer est le
 * seul contrôle disponible sur une ligne saisie à la main, et une divergence
 * signale un nom retapé de travers plutôt qu'un nom dicté par l'outil.
 */
export type ParsedMountName = {
  carriedGeneration: number;
  colorCode: string;
  sex: Sex;
  /** Les deux codes de parents, dans l'ordre où le nom les porte — donc triés. */
  parentCodes: [string, string];
};

/**
 * `G4 DO M AM-DO` → ses quatre morceaux, ou `null` si la ligne n'est pas un nom.
 *
 * Tolère les espaces multiples et la casse : une liste recopiée depuis le jeu
 * traverse un presse-papier, parfois un tableur, et se fait maltraiter en
 * chemin. Ce qu'on ne tolère pas, c'est un nom **tronqué** — il ne désignerait
 * plus une monture unique, et l'importer reviendrait à inventer.
 */
export const parseMountName = (raw: string): ParsedMountName | null => {
  const match = raw
    .trim()
    .toUpperCase()
    .match(/^G(\d{1,2})\s+([A-Z]+)\s+([MF])\s+([A-Z]+)-([A-Z]+)$/);
  if (!match) return null;

  const carriedGeneration = Number(match[1]);
  if (!Number.isFinite(carriedGeneration) || carriedGeneration < 1) return null;

  return {
    carriedGeneration,
    colorCode: match[2],
    sex: match[3] as Sex,
    parentCodes: [match[4], match[5]],
  };
};
