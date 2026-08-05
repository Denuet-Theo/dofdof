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

export type ObjectiveId = 'profit' | 'gen10_balanced' | 'gen10_profit';

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
    id: 'gen10_balanced',
    label: 'Gen 10 en restant à l’équilibre',
    hint: 'La route vers la génération 10 dont les recettes couvrent le mieux les dépenses. À prendre pour monter sans avoir à alterner : sans elle, on enchaîne des sessions de rentabilité pour financer des sessions de montée, ce qui fait deux plans au lieu d’un.',
    unit: 'kamas',
  },
  {
    id: 'gen10_profit',
    label: 'Gen 10 au moins cher',
    hint: 'La route vers la génération 10 qui coûte le moins, quoi qu’elle rapporte. À prendre quand c’est la mise de départ qui contraint, et non le solde.',
    unit: 'kamas',
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
  /** Accouplements du plan, pour l'affichage du volume de travail. */
  crossings: number | null;
  /** Délai réel, parc de l'éleveur compris. */
  wallClockHours: number | null;
  totalCost: number | null;
  /**
   * Marge de la couleur hors plan — ce qu'elle rapporte quand on l'achète ou la
   * capture plutôt que de l'élever. Sert à classer les couleurs sauvages, qui
   * n'ont pas de plan mais sont souvent les plus rentables à l'heure.
   */
  bestMargin: number | null;
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

  if (objective === 'gen10_balanced' || objective === 'gen10_profit') {
    const top = topGeneration(rows);
    const reachable = breedable.filter((row) => row.generation === top);

    if (objective === 'gen10_balanced') {
      // Au **solde**, et non au coût : ce qui compte ici n'est pas la mise de
      // départ mais de quel montant la route s'auto-finance. Deux routes au
      // même prix ne se valent pas si l'une rend deux fois plus en génétons,
      // en extractions et en couleurs revendables.
      return reachable
        .filter((row) => row.planMargin !== null)
        .map((row) => ({ item: row, score: row.planMargin!, display: row.planMargin }))
        .sort((a, b) => b.score - a.score);
    }

    return reachable
      .filter((row) => row.totalCost !== null)
      .map((row) => ({ item: row, score: -row.totalCost!, display: row.totalCost }))
      .sort((a, b) => b.score - a.score);
  }

  // La rentabilité se classe à la marge par heure d'enclos, la seule mesure
  // comparable entre générations — et elle n'écarte **aucune** couleur, ce qui
  // en fait aussi la vue où l'on va chercher une couleur précise à la main.
  const hourly = rows.some((row) => row.marginPerHour !== null);

  /**
   * Une couleur qu'on achète ou capture ne mobilise **aucun** enclos : elle ne
   * concourt pas pour la ressource dont ce classement parle. À marge positive
   * elle bat donc tout ce qui en demande — c'est du gain sans immobiliser le
   * parc — et à marge négative elle ne vaut rien de plus. Les renvoyer toutes en
   * queue dirait l'inverse de la vérité sur les couleurs sauvages, qui sont
   * justement les plus rentables à l'heure.
   */
  const score = (row: T) => {
    if (!hourly) return row.planMargin ?? row.bestMargin ?? -Infinity;
    if (row.marginPerHour !== null) return row.marginPerHour;
    const margin = row.bestMargin;
    return margin !== null && margin > 0 ? Infinity : -Infinity;
  };

  return rows
    .map((row) => {
      const value = hourly ? row.marginPerHour : (row.planMargin ?? row.bestMargin);
      return { item: row, score: score(row), display: value };
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
