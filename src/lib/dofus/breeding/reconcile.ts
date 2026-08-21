import {
  countOf,
  matches,
  NO_FILTERS,
  type RosterEntry,
  type RosterFilters,
} from './roster';
import { MOUNT_STATUS_LABEL, type MountStatus, type Sex } from './stable';

/**
 * Trouver où l'app et le jeu ne disent pas la même chose, en le moins de
 * questions possible.
 *
 * ## Le problème, tel qu'il se pose devant les deux écrans
 *
 * L'écurie du jeu ne s'exporte pas. La seule chose qu'elle rende sans compter
 * les lignes une à une est le panneau FILTRES : un **effectif exact par
 * critère**, recalculé dès qu'on croise deux filtres. Confronter deux cents
 * montures nom par nom est possible, et personne ne le fait deux fois ; ce qui
 * se fait, c'est lire un nombre et dire s'il colle.
 *
 * D'où la forme : une suite de questions **oui/non**, et le moins de questions
 * possible.
 *
 * ## Une question est une **colonne**, pas une case
 *
 * C'est la décision qui tient tout le reste, et elle vient d'une mesure.
 *
 * La première version demandait le total, puis coupait la population en deux et
 * n'interrogeait qu'une moitié — l'autre se déduisant de l'écart. Élégant, et
 * faux : sur le scénario « quatre fécondes saisies fertiles », elle répondait
 * **« tout va bien » en une question**. Le total est inchangé, les montures sont
 * là, seul leur état a bougé. Commencer par le total ne valide que le *compte*,
 * jamais la *répartition* — et la répartition est précisément là où se logent
 * les erreurs de saisie.
 *
 * Or le panneau du jeu affiche **toute une colonne d'un coup** : les trois
 * fertilités ensemble, les deux sexes ensemble, les dix générations ensemble.
 * Confronter une colonne entière ne coûte donc pas plus cher à l'éleveur qu'une
 * seule case — un coup d'œil, un OK — mais valide infiniment plus.
 *
 * Une question porte donc sur une colonne. Quatre colonnes suffisent à valider
 * les quatre marges de l'écurie, et c'est ce qu'on demande quand tout va bien.
 *
 * ## Ce qui rend N petit : l'élagage
 *
 * Une case qui colle **sort définitivement** de la recherche. On ne croise les
 * filtres que dans les cases qui portent un écart, et l'écart chiffré dit
 * combien il en reste à expliquer — donc quand s'arrêter.
 *
 * ## L'ordre des axes n'est pas celui qui minimise les questions
 *
 * C'est celui qui minimise le travail **devant le jeu**. FERTILITÉ et SEXE sont
 * deux ou trois cases à lire au même endroit ; GÉNÉRATION en fait dix ; COULEURS
 * en fait trente et demande de faire défiler. On descend donc dans cet ordre, et
 * on s'arrête bien avant les couleurs dès que la cellule tient dans un écran.
 *
 * Un axe qui ne sépare rien est sauté : demander « les mâles ? » à une cellule
 * qui n'a que des mâles est une question dont on connaît la réponse, et elle
 * coûte autant qu'une vraie.
 *
 * ## Là où ça s'arrête, et pourquoi ce n'est pas un aveu
 *
 * Dès qu'une cellule tient en `NAME_THRESHOLD` montures, on cesse de couper et
 * on rend la liste. C'est exactement la consigne de la compétence
 * `ecurie-en-jeu` : les agrégats donnent la **forme** du problème, le diff nom
 * par nom le **ferme**. Continuer sous ce seuil coûterait plus de questions que
 * de lire douze noms.
 *
 * ## Ce qu'un « OK » ne prouve pas, et il faut le dire
 *
 * Deux erreurs qui se compensent exactement **dans la même case** passent au
 * vert. Ce n'est pas une hypothèse : le 16/08, une féconde en trop sur
 * `G1 IN F DO-IN` et une en moins sur `G1 IN M DO-IN` ont rendu verts les
 * totaux, les compteurs par couleur *et* par génération. Seul le nom par nom les
 * a trouvées.
 *
 * Croiser les colonnes réduit ces cases sans les supprimer. L'élagage est ce qui
 * rend N petit, et c'est son prix exact : on l'affiche plutôt que de le taire.
 */

/** Sous ce nombre de montures, on cesse de couper et on lit les noms. */
export const NAME_THRESHOLD = 12;

/** Les axes, dans l'ordre du moins cher à lire en jeu au plus cher. */
export type Axis = 'status' | 'sex' | 'generation' | 'color';
const AXES: Axis[] = ['status', 'sex', 'generation', 'color'];

/** Une colonne posée sur une cellule : l'axe, ses cases, et si on l'a demandée. */
export type Column = { axis: Axis; children: CensusNode[]; answered: boolean };

export type CensusNode = {
  cell: RosterFilters;
  /** Ce que l'app compte dans cette cellule. */
  held: number;
  /** Ce que le jeu y montre. `null` = pas encore su. */
  seen: number | null;
  used: Axis[];
  columns: Column[];
  /**
   * Balaie **tous** les axes restants, au lieu du premier seulement.
   *
   * Vrai à la racine et nulle part ailleurs, et c'est la frontière entre les
   * deux métiers de cet outil. À la racine on **valide** : les quatre marges de
   * l'écurie, quatre coups d'œil, et une écurie saine est déclarée saine.
   * En dessous on **localise** : un seul axe à la fois, celui qui coupe le plus
   * vite, parce qu'on sait déjà qu'il y a quelque chose à trouver.
   *
   * Sans ce balayage, un « OK » sur la fertilité arrêtait tout : le compte et
   * l'état étaient validés, le sexe et les générations jamais regardés.
   */
  sweep: boolean;
};

/** Une case d'une colonne : la cellule, ce que l'app y compte, comment la nommer. */
export type ProbeCell = { cell: RosterFilters; held: number; label: string };

/**
 * La question : une **colonne** du panneau FILTRES, à confronter d'un coup.
 *
 * `axis` vaut `'total'` pour la première, qui ne pose aucun filtre et demande le
 * nombre affiché à l'ouverture de l'écurie.
 */
export type Probe = {
  path: number[];
  axis: Axis | 'total';
  /** Les filtres déjà posés pour atteindre cette colonne — à recopier en jeu. */
  within: RosterFilters;
  cells: ProbeCell[];
  /**
   * L'écart **déjà déclaré** sur la cellule qui porte cette colonne, ou `null`
   * si elle colle encore.
   *
   * Une colonne partitionne sa cellule : chaque monture y tombe dans une case et
   * une seule. Donc si l'éleveur vient de dire « il y a un fertile mâle de plus
   * qu'annoncé », les générations de ces fertiles mâles **ne peuvent pas** toutes
   * coller — demander « est-ce pareil ? » serait demander une réponse dont on
   * sait qu'elle est non. Ce qui reste à savoir, c'est **où**, et c'est la seule
   * chose à demander.
   */
  owed: number | null;
};

/** Ça colle, ou voici ce que le jeu montre, case par case. */
export type Answer = { ok: true } | { ok: false; seen: number[] };

const countIn = (entries: RosterEntry[], cell: RosterFilters, nameOf: (id: string) => string) =>
  countOf(entries.filter((entry) => matches(entry, cell, nameOf)));

export const censusRoot = (
  entries: RosterEntry[],
  nameOf: (colorId: string) => string
): CensusNode => ({
  cell: NO_FILTERS,
  held: countIn(entries, NO_FILTERS, nameOf),
  seen: null,
  used: [],
  columns: [],
  sweep: true,
});

const withAxis = (cell: RosterFilters, axis: Axis, value: string | number): RosterFilters => {
  if (axis === 'sex') return { ...cell, sexes: [value as Sex] };
  if (axis === 'status') return { ...cell, statuses: [value as MountStatus] };
  if (axis === 'generation') return { ...cell, generations: [value as number] };
  return { ...cell, colorIds: [value as string] };
};

const STATUS_ORDER: MountStatus[] = ['fertile', 'feconde', 'sterile'];

/**
 * Les valeurs d'un axe, telles que **le panneau les affiche** — celles que le
 * croisement ramène à zéro comprises.
 *
 * C'est l'énumération de `BreedingStockFilters`, et il faut que ce soit
 * exactement la même. Une ligne montrée sans case pour la corriger est un
 * chiffre que l'éleveur voit faux et ne peut pas dire : sous Fertile ⋅ Mâle,
 * « Génération 10 — 0 » s'affichait sans champ, alors que le jeu en montrait
 * une. L'énumération se faisait **dans la cellule**, donc une case vide n'y
 * existait pas — et une monture entièrement inconnue de l'app est précisément
 * ce qu'on vient chercher.
 *
 * Les fertilités et les sexes sont donc les listes fixes du panneau, les
 * générations et les couleurs celles de l'écurie entière. Un zéro qui colle ne
 * coûte rien : la case reste vide, ça vaut « pareil », et la cellule sort de la
 * recherche comme les autres.
 */
const valuesOn = (entries: RosterEntry[], axis: Axis): (string | number)[] => {
  if (axis === 'status') return [...STATUS_ORDER];
  if (axis === 'sex') return ['M', 'F'];
  const seen = new Set<string | number>();
  for (const entry of entries) seen.add(axis === 'generation' ? entry.generation : entry.colorId);
  return [...seen];
};

/**
 * L'ordre d'affichage d'un axe — celui du jeu, pour lire les deux écrans en
 * vis-à-vis.
 *
 * Les générations se rangent par **chaîne**, donc 1, 10, 2, 3… C'est l'ordre du
 * jeu, et c'est le seul qui permette de descendre les deux listes ligne à ligne
 * sans chercher.
 */
const ordered = (axis: Axis, values: (string | number)[]): (string | number)[] => {
  if (axis === 'status') return STATUS_ORDER.filter((status) => values.includes(status));
  if (axis === 'sex') return (['M', 'F'] as (string | number)[]).filter((s) => values.includes(s));
  return [...values].sort((a, b) => String(a).localeCompare(String(b)));
};

/** Découpe une cellule le long du premier axe qui la sépare vraiment. */
export const splitCell = (
  node: CensusNode,
  axis: Axis,
  entries: RosterEntry[],
  nameOf: (colorId: string) => string
): Column | null => {
  if (node.used.includes(axis)) return null;
  const values = ordered(axis, valuesOn(entries, axis));
  // Un axe qui ne porte qu'une valeur ne sépare rien : le demander serait une
  // question dont on connaît la réponse, et elle coûte autant qu'une vraie.
  if (values.length < 2) return null;

  const children = values.map((value) => {
    const cell = withAxis(node.cell, axis, value);
    return {
      cell,
      held: countIn(entries, cell, nameOf),
      seen: null,
      used: [...node.used, axis],
      columns: [],
      sweep: false,
    };
  });
  return { axis, children, answered: false };
};


const settled = (node: CensusNode): boolean => node.seen !== null && node.seen === node.held;

/** Vrai quand la cellule porte un écart et tient assez peu pour se lire nom par nom. */
const readable = (node: CensusNode): boolean =>
  node.seen !== null && !settled(node) && node.held <= NAME_THRESHOLD;

/** Comment nommer une case, pour que l'éleveur sache quel filtre cocher. */
export const cellLabel = (
  axis: Axis,
  cell: RosterFilters,
  nameOf: (colorId: string) => string
): string => {
  if (axis === 'status') return MOUNT_STATUS_LABEL[cell.statuses[0]];
  if (axis === 'sex') return cell.sexes[0] === 'M' ? 'Monture mâle' : 'Monture femelle';
  if (axis === 'generation') return `Génération ${cell.generations[0]}`;
  return nameOf(cell.colorIds[0]);
};

/**
 * Les axes qu'un nœud doit encore interroger.
 *
 * La racine les balaie tous — c'est la validation. En dessous on n'en prend
 * qu'un, le premier disponible : on sait déjà qu'il y a quelque chose à trouver,
 * et poser quatre colonnes dans chaque cellule ferait exploser N.
 */
const axesFor = (node: CensusNode): Axis[] => {
  const left = AXES.filter((axis) => !node.used.includes(axis));
  return node.sweep ? left : left.slice(0, 1);
};

/** La colonne d'un axe, construite à la demande et mémorisée sur le nœud. */
const columnFor = (
  node: CensusNode,
  axis: Axis,
  entries: RosterEntry[],
  nameOf: (colorId: string) => string
): Column | null => {
  const known = node.columns.find((column) => column.axis === axis);
  if (known) return known;
  const built = splitCell(node, axis, entries, nameOf);
  if (built) node.columns.push(built);
  return built;
};

/**
 * La prochaine question, ou `null` quand il n'y a plus rien à demander.
 *
 * La première est le **total**, seule question qui ne pose aucun filtre. Les
 * suivantes sont des colonnes. On descend dans une case dès qu'elle porte un
 * écart, et on n'y revient jamais si elle colle.
 */
export const nextProbe = (
  root: CensusNode,
  entries: RosterEntry[],
  nameOf: (colorId: string) => string
): Probe | null => {
  if (root.seen === null) {
    return {
      path: [],
      axis: 'total',
      within: NO_FILTERS,
      cells: [{ cell: root.cell, held: root.held, label: 'Toutes' }],
      owed: null,
    };
  }

  const walk = (node: CensusNode, path: number[]): Probe | null => {
    // Elle porte un écart et tient dans un écran : la dichotomie s'arrête, et
    // c'est la liste nominative qui prend le relais.
    if (readable(node)) return null;
    // Elle colle, et rien ne l'oblige à balayer : élaguée.
    if (settled(node) && !node.sweep) return null;

    for (const [index, axis] of axesFor(node).entries()) {
      const column = columnFor(node, axis, entries, nameOf);
      if (!column) continue;

      if (!column.answered) {
        return {
          path,
          axis,
          within: node.cell,
          cells: column.children.map((child) => ({
            cell: child.cell,
            held: child.held,
            label: cellLabel(axis, child.cell, nameOf),
          })),
          owed: node.seen === null || settled(node) ? null : node.seen - node.held,
        };
      }

      /*
       * Une colonne qui colle ne dit rien de plus : on passe à la marge
       * suivante, et c'est la validation qui continue.
       *
       * Une colonne qui **trouve** arrête le balayage. Sans ça, la même monture
       * manquante se fait localiser une fois par axe — mesuré : quatre cellules
       * pointées et vingt-trois questions pour une seule femelle disparue, là où
       * une seule descente en demande cinq. Les marges restantes ne diraient que
       * la même chose sous un autre angle.
       */
      const gapped = column.children.filter((child) => !settled(child));
      if (gapped.length === 0) continue;

      for (const [at, child] of column.children.entries()) {
        if (settled(child)) continue;
        const found = walk(child, [...path, index, at]);
        if (found) return found;
      }
      return null;
    }
    return null;
  };
  return walk(root, []);
};

/** Retrouve un nœud par son chemin — paires (colonne, case). */
const nodeAt = (root: CensusNode, path: number[]): CensusNode | null => {
  let node: CensusNode = root;
  for (let step = 0; step < path.length; step += 2) {
    const column = node.columns[path[step]];
    if (!column) return null;
    const child = column.children[path[step + 1]];
    if (!child) return null;
    node = child;
  }
  return node;
};

/**
 * Enregistre une réponse — le total, ou toute une colonne d'un coup.
 *
 * L'arbre est muté en place et rendu tel quel : il porte des colonnes
 * construites paresseusement, et les recopier à chaque réponse recalculerait
 * tous les effectifs de la branche pour rien. L'appelant garde la racine.
 */
export const recordAnswer = (
  root: CensusNode,
  probe: Probe,
  answer: Answer,
  entries: RosterEntry[],
  nameOf: (colorId: string) => string
): CensusNode => {
  const node = nodeAt(root, probe.path);
  if (!node) return root;

  if (probe.axis === 'total') {
    node.seen = answer.ok ? node.held : answer.seen[0];
    return root;
  }

  const column = columnFor(node, probe.axis, entries, nameOf);
  if (!column) return root;
  column.answered = true;
  column.children.forEach((child, index) => {
    child.seen = answer.ok ? child.held : (answer.seen[index] ?? child.held);
  });
  return root;
};

/** Une cellule où l'écart est localisé et qu'il faut lire nom par nom. */
export type Pinned = { cell: RosterFilters; held: number; seen: number; label: string };

/**
 * Les cellules où la recherche s'est arrêtée avec un écart : le bout du travail.
 *
 * Ce sont elles qu'on ouvre dans la liste, filtres posés, pour finir nom par
 * nom — et elles seules. Tout le reste a été élagué.
 *
 * Une cellule dont les colonnes ont été explorées n'est pas rendue : ce sont ses
 * cases qui portent l'écart, et remonter la parente ferait relire cent montures
 * pour en trouver deux.
 */
export const pinned = (root: CensusNode, nameOf: (colorId: string) => string): Pinned[] => {
  const found: Pinned[] = [];
  const walk = (node: CensusNode, label: string) => {
    /*
     * Les colonnes explorées d'abord, **avant** de juger le nœud lui-même.
     *
     * Un nœud dont l'effectif colle n'est pas pour autant sain : c'est très
     * exactement le cas « quatre fécondes saisies fertiles », où le total est
     * juste et la répartition fausse. Sortir sur `settled` à la racine faisait
     * rendre zéro cellule sur ce scénario — l'outil trouvait l'écart en sept
     * questions puis ne le montrait pas.
     */
    const explored = node.columns.filter((column) => column.answered);
    if (explored.length === 0) {
      if (node.seen === null || settled(node)) return;
      found.push({ cell: node.cell, held: node.held, seen: node.seen, label });
      return;
    }
    const before = found.length;
    for (const column of explored) {
      for (const child of column.children) {
        walk(child, cellLabel(column.axis, child.cell, nameOf));
      }
    }
    /*
     * L'écart du nœud que **rien en dessous** n'explique.
     *
     * Le cas se lit d'un mot : le total ne colle pas, et pourtant chaque colonne
     * colle. C'est contradictoire, donc c'est un résultat — une saisie fautive,
     * ou un écart dans une dimension que le panneau ne montre pas. Sans cette
     * remontée, la réponse « le jeu en montre 202, pas 203 » était prise, rangée,
     * et l'écran concluait « l'écurie colle au jeu » : une question posée pour
     * rien, ce qui est pire que ne pas la poser.
     */
    if (node.seen !== null && !settled(node) && found.length === before) {
      found.push({ cell: node.cell, held: node.held, seen: node.seen, label });
    }
  };
  walk(root, 'Toute l’écurie');
  return found;
};

/** Combien de questions ont été posées — le chiffre qui juge l'outil. */
export const asked = (root: CensusNode): number => {
  let total = root.seen === null ? 0 : 1;
  const walk = (node: CensusNode) => {
    for (const column of node.columns) {
      if (!column.answered) continue;
      total += 1;
      for (const child of column.children) walk(child);
    }
  };
  walk(root);
  return total;
};
