import { borneName } from './naming';
import {
  cycledOf,
  mountStatus,
  MOUNT_STATUS_LABEL,
  SEX_LABEL,
  type BulkStock,
  type Individual,
  type MountStatus,
  type Sex,
  type Stable,
} from './stable';

/**
 * L'écurie telle que le jeu la compte, pour qu'on puisse comparer les deux
 * écrans chiffre à chiffre.
 *
 * ## Pourquoi ce module existe
 *
 * L'app et le jeu ne rangent pas l'écurie de la même façon. Le jeu a une liste
 * plate de montures et six filtres à facettes qui en comptent les sous-ensembles.
 * L'app a **deux** réservoirs — les montures suivies une par une et le vrac des
 * générations basses — et n'affichait le total d'aucune facette. Constater un
 * écart entre les deux était donc possible ; le **localiser** ne l'était pas.
 *
 * Ce module rend l'écurie sous la forme que le jeu compte : une suite d'entrées
 * portant couleur, génération, sexe, état et niveau. Le vrac y entre avec son
 * effectif, sans quoi les totaux ne pourraient pas se comparer — c'est
 * précisément là que les gen 1 se trouvent, et elles font le gros du compte.
 *
 * ## Les deux choses que le vrac ne sait pas dire
 *
 * Elles ne sont pas des détails : ce sont les deux endroits où un écart avec le
 * jeu est **attendu**, et les taire ferait chercher un bug là où il n'y a qu'une
 * limite de représentation.
 *
 * 1. **Aucun niveau.** `BulkStock` est un effectif, pas une liste. Une ligne de
 *    vrac ne peut donc ni entrer ni sortir d'une plage de niveaux. Voir
 *    `LEVEL_MIN` / `LEVEL_MAX` et `unranked`.
 *
 * 2. **Aucune stérile.** `BulkStock` compte ce qui garde sa reproduction — voir
 *    son en-tête — et la table `user_breeding_mounts` n'a pas de colonne pour
 *    autre chose. Une gen 1 stérilisée par un accouplement n'a donc **nulle
 *    part** où être dite dans le vrac. Le compte des stériles de l'app est celui
 *    des seules montures suivies, et il sera en deçà de celui du jeu de tout ce
 *    que l'éleveur a consommé en génération basse.
 */

/** Les bornes que le jeu propose, et qui valent « plage entière ». */
export const LEVEL_MIN = 1;
export const LEVEL_MAX = 200;

/**
 * Une ligne d'écurie à compter.
 *
 * `count` porte l'effectif parce qu'une entrée de vrac en représente plusieurs.
 * Une monture suivie vaut toujours 1, et c'est la seule qui porte un `mount` —
 * les écrans qui éditent une monture en ont besoin, ceux qui comptent, non.
 */
export type RosterEntry = {
  colorId: string;
  generation: number;
  sex: Sex;
  status: MountStatus;
  /** `null` pour le vrac, qui n'enregistre aucun niveau. */
  level: number | null;
  /** Le nom porté en jeu, `null` pour une anonyme et pour tout le vrac. */
  name: string | null;
  /** La monture suivie, ou `null` quand la ligne vient du vrac. */
  mount: Individual | null;
  count: number;
};

export type RosterFilters = {
  query: string;
  levelMin: number;
  levelMax: number;
  /** Vide vaut **toutes**, comme en jeu où ne rien cocher ne filtre rien. */
  generations: number[];
  statuses: MountStatus[];
  sexes: Sex[];
  colorIds: string[];
  /**
   * Les noms portés, en **exact** — et non la recherche libre de `query`.
   *
   * Le jeu n'a pas de filtre par nom : c'est la liste de l'écurie qui les
   * montre. Celui-ci n'existe donc pas pour imiter une case du panneau, mais
   * pour désigner la dernière chose qui sépare deux montures quand les quatre
   * facettes ne les séparent plus — six Amande gen 3 mâles fertiles ne diffèrent
   * que par là. Voir l'axe `name` de `reconcile.ts`.
   *
   * Exact et pas « contient » : `query` retient `G1 DO F DO-IN` sur un
   * `G1 DO F DO-INDI`, ce qui suffit à compter une monture de trop et à envoyer
   * chercher un écart qui n'existe pas.
   */
  names: string[];
};

export const NO_FILTERS: RosterFilters = {
  query: '',
  levelMin: LEVEL_MIN,
  levelMax: LEVEL_MAX,
  generations: [],
  statuses: [],
  sexes: [],
  colorIds: [],
  names: [],
};

/** Un filtre à plage entière ne filtre rien — et laisse donc passer le vrac. */
export const wholeRange = (filters: RosterFilters): boolean =>
  filters.levelMin <= LEVEL_MIN && filters.levelMax >= LEVEL_MAX;

export const isPristine = (filters: RosterFilters): boolean =>
  filters.query.trim() === '' &&
  wholeRange(filters) &&
  filters.generations.length === 0 &&
  filters.statuses.length === 0 &&
  filters.sexes.length === 0 &&
  filters.colorIds.length === 0 &&
  filters.names.length === 0;

/**
 * Les quatre lignes qu'une couleur de vrac produit.
 *
 * Quatre et non deux : le vrac distingue les fécondes des fertiles par sexe, et
 * c'est une facette du jeu. `cycledOf` borne les fécondes à l'effectif, parce
 * qu'une ligne écrite avant la migration peut porter plus de fécondes que de
 * montures.
 */
const bulkEntries = (colorId: string, stock: BulkStock, generation: number): RosterEntry[] => {
  const banked = cycledOf(stock);
  const rows: [Sex, MountStatus, number][] = [
    ['M', 'feconde', banked.males],
    ['M', 'fertile', stock.males - banked.males],
    ['F', 'feconde', banked.females],
    ['F', 'fertile', stock.females - banked.females],
  ];

  return rows
    .filter(([, , count]) => count > 0)
    .map(([sex, status, count]) => ({
      colorId,
      generation,
      sex,
      status,
      level: null,
      name: null,
      mount: null,
      count,
    }));
};

/** L'écurie entière, suivies et vrac confondus, dans la forme que le jeu compte. */
export const rosterOf = (
  stable: Stable,
  generationOf: (colorId: string) => number
): RosterEntry[] => {
  const entries: RosterEntry[] = stable.individuals.map((mount) => ({
    colorId: mount.colorId,
    generation: generationOf(mount.colorId),
    sex: mount.sex,
    status: mountStatus(mount),
    level: mount.level,
    name: mount.name,
    mount,
    count: 1,
  }));

  for (const [colorId, stock] of stable.bulk) {
    entries.push(...bulkEntries(colorId, stock, generationOf(colorId)));
  }

  return entries;
};

/**
 * Les facettes qui classent une monture par **valeur** : celles qui ont des
 * lignes dans le panneau, et donc celles qu'une question peut couper.
 *
 * La recherche et le texte n'en sont pas : on ne coche pas un niveau, on borne
 * une plage, et rien ne s'y nomme.
 */
export type ValueFacet = 'generation' | 'status' | 'sex' | 'color' | 'name';

/** Les facettes, nommées, pour pouvoir en exclure une du compte qui la décore. */
export type Facet = 'query' | 'level' | ValueFacet;

/**
 * La valeur qu'une cellule fixe sur une facette, ou `null` si elle ne la fixe pas.
 *
 * Une cellule de rapprochement ne pose jamais qu'une valeur par facette — c'est
 * ce qui en fait une case du panneau et non un filtre libre.
 */
export const valueOn = (cell: RosterFilters, facet: ValueFacet): string | number | null => {
  if (facet === 'status') return cell.statuses[0] ?? null;
  if (facet === 'sex') return cell.sexes[0] ?? null;
  if (facet === 'generation') return cell.generations[0] ?? null;
  if (facet === 'name') return cell.names[0] ?? null;
  return cell.colorIds[0] ?? null;
};

/**
 * Le nom d'une valeur de facette, **tel que le panneau écrit sa ligne**.
 *
 * Une seule fonction pour les deux écrans, et c'est le point : le panneau nomme
 * ses lignes avec, le rapprochement nomme ses cellules avec, donc une cellule
 * pointée se retrouve dans le panneau mot pour mot. Les deux listes vivaient à
 * deux endroits, et « Monture mâle » d'un côté n'engageait à rien de l'autre.
 */
export const facetLabel = (
  facet: ValueFacet,
  value: string | number,
  nameOf: (colorId: string) => string
): string => {
  if (facet === 'status') return MOUNT_STATUS_LABEL[value as MountStatus];
  if (facet === 'sex') return SEX_LABEL[value as Sex];
  if (facet === 'generation') return `Génération ${value}`;
  // Un nom se nomme lui-même : c'est celui que le jeu écrit sur la monture.
  if (facet === 'name') return String(value);
  return nameOf(String(value));
};

/**
 * Une entrée passe-t-elle le filtre, à une facette près ?
 *
 * `except` sert aux compteurs : le nombre affiché à côté de « Génération 3 » doit
 * dire ce que cocher cette case donnerait, donc il se calcule avec toutes les
 * **autres** facettes appliquées et pas la sienne. Sans quoi cocher une
 * génération mettrait toutes les autres à zéro et la liste ne servirait plus à
 * rien.
 */
export const matches = (
  entry: RosterEntry,
  filters: RosterFilters,
  nameOf: (colorId: string) => string,
  except?: Facet
): boolean => {
  if (except !== 'query') {
    const needle = filters.query.trim().toLowerCase();
    if (needle) {
      // Une monture sans nom se cherche sous **celui qu'elle porte à l'écran**,
      // et c'est « Anonyme » — ici comme dans l'écurie du jeu, qui l'écrit sur
      // toute monture non renommée. `?? ''` la rendait introuvable : la seule
      // façon d'isoler les non renommées était de lire les cent trente lignes.
      // Or c'est le tri qu'on vient faire — les nommées portent leur généalogie
      // dans leur nom, les autres sont interchangeables.
      //
      // Le vrac tombe dedans, et c'est juste : il n'a pas de nom non plus, et le
      // jeu le montre lui aussi anonyme.
      const hit =
        nameOf(entry.colorId).toLowerCase().includes(needle) ||
        borneName(entry).toLowerCase().includes(needle);
      if (!hit) return false;
    }
  }

  if (except !== 'level' && !wholeRange(filters)) {
    // Le vrac n'a pas de niveau : il ne peut pas prétendre être dans une plage
    // qu'on a resserrée. On l'écarte plutôt que de le laisser passer — un compte
    // trop bas se voit et se lit, un compte trop haut se confond avec le jeu.
    if (entry.level === null) return false;
    if (entry.level < filters.levelMin || entry.level > filters.levelMax) return false;
  }

  if (except !== 'generation' && filters.generations.length > 0) {
    if (!filters.generations.includes(entry.generation)) return false;
  }

  if (except !== 'status' && filters.statuses.length > 0) {
    if (!filters.statuses.includes(entry.status)) return false;
  }

  if (except !== 'sex' && filters.sexes.length > 0) {
    if (!filters.sexes.includes(entry.sex)) return false;
  }

  if (except !== 'color' && filters.colorIds.length > 0) {
    if (!filters.colorIds.includes(entry.colorId)) return false;
  }

  // Le vrac tombe sous « Anonyme » et c'est juste : le jeu l'y range aussi.
  if (except !== 'name' && filters.names.length > 0) {
    if (!filters.names.includes(borneName(entry))) return false;
  }

  return true;
};

/** Les montures — et non les lignes — que le filtre retient. */
export const countOf = (entries: RosterEntry[]): number =>
  entries.reduce((total, entry) => total + entry.count, 0);

/**
 * Le compte d'une valeur de facette, les autres facettes appliquées.
 *
 * `keyOf` rend `null` pour une entrée que la facette ne classe pas, ce qui
 * n'arrive pas aujourd'hui mais garde la porte ouverte sans forcer un compte
 * faux.
 */
export const facetCounts = <K>(
  entries: RosterEntry[],
  filters: RosterFilters,
  nameOf: (colorId: string) => string,
  facet: Facet,
  keyOf: (entry: RosterEntry) => K | null
): Map<K, number> => {
  const counts = new Map<K, number>();
  for (const entry of entries) {
    if (!matches(entry, filters, nameOf, facet)) continue;
    const key = keyOf(entry);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + entry.count);
  }
  return counts;
};

/**
 * Les montures qu'une plage de niveaux ne peut pas classer, sous le filtre
 * courant.
 *
 * C'est le chiffre qui explique l'écart avec le jeu plutôt que de le laisser
 * deviner : à plage resserrée, l'app en écarte exactement autant, et le jeu, lui,
 * les classe puisqu'il connaît leurs niveaux.
 */
export const unranked = (
  entries: RosterEntry[],
  filters: RosterFilters,
  nameOf: (colorId: string) => string
): number =>
  countOf(
    entries.filter((entry) => entry.level === null && matches(entry, filters, nameOf, 'level'))
  );

/**
 * Les générations, dans l'ordre où le jeu les range : **celui des chaînes**.
 *
 * « Génération 1, Génération 10, Génération 2… » n'est pas une coquetterie
 * recopiée pour la forme. Les deux listes se lisent côte à côte, ligne à ligne,
 * et c'est tout l'objet de cet écran ; les ranger dans l'ordre des nombres
 * obligerait à chercher la correspondance à chaque comparaison.
 */
export const gameGenerationOrder = (generations: Iterable<number>): number[] =>
  [...new Set(generations)].sort((a, b) => String(a).localeCompare(String(b)));
