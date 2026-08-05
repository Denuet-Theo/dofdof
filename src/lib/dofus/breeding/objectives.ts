/**
 * Ce qu'on cherche à faire — et donc ce qui départage deux couleurs.
 *
 * Le classement répondait à une seule question : « quelle couleur rapporte le
 * plus par heure d'enclos ». C'est la bonne question pour vivre de l'élevage, et
 * la mauvaise pour monter en génération : les hautes générations perdent
 * toujours à ce jeu-là, puisqu'elles mobilisent le parc des dizaines de fois
 * plus longtemps pour une seule monture. Un éleveur qui veut des gen 10 ne
 * verra jamais sa route arriver en tête, et pourtant c'est bien elle qu'il
 * cherche.
 *
 * D'où des objectifs explicites plutôt qu'un tri unique. Ils ne changent aucun
 * chiffre : le coût, la durée et la marge d'un plan sont ce qu'ils sont. Ils
 * changent **le critère** qui désigne le gagnant, et c'est tout ce qui les
 * sépare.
 */

export type ObjectiveId = 'profit' | 'gen10_fast' | 'gen10_profit' | 'color';

export type Objective = {
  id: ObjectiveId;
  label: string;
  /** Ce que l'objectif cherche, en une phrase, pour l'écran. */
  hint: string;
  /** L'unité du score affiché à côté de chaque ligne. */
  unit: 'kamas/h' | 'heures' | 'kamas' | null;
};

export const OBJECTIVES: Objective[] = [
  {
    id: 'profit',
    label: 'Rentabilité maximale',
    hint: 'La meilleure marge par heure d’enclos, quelle que soit la génération. Ne cherche pas à monter — la plupart du temps, une gen 4 vendue en série bat une gen 10.',
    unit: 'kamas/h',
  },
  {
    id: 'gen10_fast',
    label: 'Gen 10 au plus vite',
    hint: 'La route vers la génération 10 qui immobilise le parc le moins longtemps. Le coût passe après : c’est le délai qu’on minimise.',
    unit: 'heures',
  },
  {
    id: 'gen10_profit',
    label: 'Gen 10 au moins cher',
    hint: 'La route vers la génération 10 qui coûte le moins, temps d’enclos non compté. À prendre quand on n’est pas pressé mais qu’on compte ses kamas.',
    unit: 'kamas',
  },
  {
    id: 'color',
    label: 'Une couleur précise',
    hint: 'Le classement complet, trié par marge horaire. À prendre quand la couleur est déjà choisie.',
    unit: 'kamas/h',
  },
];

/** Ce que l'objectif a besoin de savoir d'une couleur pour la départager. */
export type Candidate = {
  colorId: string;
  generation: number;
  /** `null` si la couleur ne s'élève pas — elle n'a alors pas de route. */
  planMargin: number | null;
  marginPerHour: number | null;
  /** Heures d'enclos du plan, la vraie ressource rare. */
  enclosHours: number | null;
  /**
   * Accouplements du plan. Dernier recours pour classer « au plus vite » quand
   * aucune durée n'est chiffrable : il en faut toujours un, sinon l'écran
   * annonce qu'aucune route n'existe alors qu'il y en a.
   */
  crossings: number | null;
  /** Délai réel, parc de l'éleveur compris. */
  wallClockHours: number | null;
  totalCost: number | null;
  breedable: boolean;
};

export type Ranked<T> = {
  /**
   * Le candidat lui-même. Nommé `item` et non `row` parce que les lignes de la
   * page portent déjà ce nom : `ranked.row.row` était illisible.
   */
  item: T;
  /** Le score selon l'objectif courant, déjà orienté « plus grand = mieux ». */
  score: number;
  /** La valeur à afficher, dans l'unité de l'objectif. */
  display: number | null;
};

/**
 * La génération que visent les objectifs « gen 10 ».
 *
 * Lue sur l'arbre plutôt que codée en dur : les trois familles plafonnent à 10
 * aujourd'hui, mais c'est une donnée du jeu et non une propriété du calcul.
 */
export const topGeneration = (candidates: Candidate[]) =>
  candidates.reduce((top, candidate) => Math.max(top, candidate.generation), 0);

/**
 * Les couleurs qu'un objectif retient, et dans quel ordre.
 *
 * Rend une liste vide plutôt qu'un repli silencieux quand rien ne convient —
 * une route vers la gen 10 qui n'est chiffrable nulle part est une information,
 * pas un cas dégénéré à masquer derrière le classement par défaut.
 */
export const rankFor = <T extends Candidate>(rows: T[], objective: ObjectiveId): Ranked<T>[] => {
  const breedable = rows.filter((row) => row.breedable);

  if (objective === 'gen10_fast' || objective === 'gen10_profit') {
    const top = topGeneration(rows);
    const reachable = breedable.filter((row) => row.generation === top);

    if (objective === 'gen10_fast') {
      return (
        reachable
          .map((row) => {
            // Trois mesures de la même chose, de la plus fine à la plus grossière.
            // Le délai réel suppose les carburants tarifés ; à défaut, les heures
            // d'enclos ; à défaut, le **nombre d'accouplements**, qui reste un
            // ordre de grandeur du travail à fournir. Rendre une liste vide parce
            // qu'une durée manque serait le pire des trois : l'écran dirait
            // « aucune route » là où il y en a une, simplement pas chiffrée.
            const hours = row.wallClockHours ?? row.enclosHours;
            const score = hours !== null ? -hours : -(row.crossings ?? Infinity);
            return { item: row, score, display: hours };
          })
          // Une route sans aucune de ces trois mesures n'est pas classable.
          .filter((ranked) => Number.isFinite(ranked.score))
          .sort((a, b) => b.score - a.score)
      );
    }

    return reachable
      .filter((row) => row.totalCost !== null)
      .map((row) => ({ item: row, score: -row.totalCost!, display: row.totalCost }))
      .sort((a, b) => b.score - a.score);
  }

  // « Rentabilité » et « couleur précise » partagent le même critère : la marge
  // par heure d'enclos, qui est la seule mesure comparable entre générations.
  // Ils ne diffèrent que par ce que l'écran en fait — l'un désigne un gagnant,
  // l'autre laisse choisir.
  const hourly = breedable.some((row) => row.marginPerHour !== null);
  return breedable
    .map((row) => {
      const value = hourly ? row.marginPerHour : row.planMargin;
      return { item: row, score: value ?? -Infinity, display: value };
    })
    .sort((a, b) => b.score - a.score);
};

/** La couleur que l'objectif recommande, ou `null` si aucune ne convient. */
export type Recommendation<T> = {
  item: T;
  /** `false` quand aucune route finançable n'existe et qu'on désigne quand même. */
  affordable: boolean;
};

export const recommendedFor = <T extends Candidate>(
  rows: T[],
  objective: ObjectiveId,
  /** Ce que le budget permet. Tout est réputé finançable sans cette fonction. */
  isAffordable: (row: T) => boolean = () => true
): Recommendation<T> | null => {
  if (objective === 'color') return null;

  const ranked = rankFor(rows, objective);
  if (ranked.length === 0) return null;

  // Une route à marge négative reste une route : sur les objectifs « gen 10 »,
  // c'est même le cas courant, et refuser de la désigner reviendrait à dire que
  // la génération 10 est hors d'atteinte. Sur la rentabilité, en revanche, une
  // marge négative ne se recommande pas — c'est précisément ce qu'on cherchait
  // à éviter.
  const eligible =
    objective === 'profit' ? ranked.filter((entry) => (entry.display ?? 0) > 0) : ranked;
  if (eligible.length === 0) return null;

  // Le budget **trie**, il n'élimine pas. Une route trop chère reste la bonne
  // route : dire « aucune route ne convient » à qui vise la génération 10 avec
  // dix millions lui cache qu'elle existe et qu'il lui manque seulement de quoi
  // la payer.
  const affordable = eligible.find((entry) => isAffordable(entry.item));
  if (affordable) return { item: affordable.item, affordable: true };

  return { item: eligible[0].item, affordable: false };
};
