/**
 * Le plan d'exécution dans le temps : quoi faire, et dans combien de temps.
 *
 * ## Ce que le reste de l'élevage ne peut pas dire
 *
 * Tout le module est **sans horloge**. `objectives.ts` classe, `loadout.ts`
 * charge une fournée, `waves.ts` compte des vagues — aucun ne sait quelle heure
 * il est, et c'est juste : leurs réponses n'en dépendent pas.
 *
 * L'optimiseur, lui, ne rend pas une liste de croisements mais un
 * **ordonnancement**. Les jauges d'un enclos ne tournent que deux à la fois, une
 * jauge hors de sa fenêtre de sérénité s'arrête au lieu de ralentir, et la
 * Mangeoire occupe une des deux places — d'où un chemin critique, des attentes,
 * et des instants précis où il faut intervenir. C'est ce que ce contrat porte,
 * et rien d'autre.
 *
 * ## Le contrat, et pourquoi il est en offsets
 *
 * Un événement se date en **secondes depuis le départ du plan**, jamais en
 * horodatage absolu. Deux raisons, et la seconde décide :
 *
 * 1. Le modèle raisonne en durées ; lui faire produire des dates l'obligerait à
 *    connaître l'heure à laquelle on lancera son plan, qu'il ignore.
 * 2. **La pause devient une soustraction.** Un plan en offsets ne bouge pas
 *    quand on s'arrête trois jours : c'est l'horloge qui recule, pas le plan qui
 *    se réécrit. Avec des dates absolues, une pause de week-end demanderait de
 *    réémettre les 40 événements — et le moindre arrondi les désynchroniserait
 *    des enclos réels.
 *
 * ## L'horloge, et ce que « mettre en pause » veut dire
 *
 * Une seule horloge pour toute la timeline. Mettre en pause la gèle, et tout ce
 * qui restait à faire glisse d'autant.
 *
 * C'est le bon modèle parce que c'est ce qui se passe : arrêter de jouer, c'est
 * cesser de nourrir les jauges, et une jauge qu'on ne nourrit plus **fige sa
 * progression sans rien perdre** — elle ne se vide pas toute seule (voir
 * `schedule.rs`, « Mettre une jauge en pause est gratuit »). Une timeline qui
 * aurait continué de courir pendant le week-end désignerait au retour une pile
 * d'actions déjà manquées, alors que le parc, lui, attend exactement là où on
 * l'a laissé.
 *
 * ## Le modèle l'émet
 *
 * `rust/breeding-neat/src/bin/plan.rs` produit ce JSON, et rien d'écrit ici n'a
 * bougé pour l'accueillir — c'était l'intérêt d'avoir posé le contrat d'abord.
 * `scripts/check-plan.mjs` valide chaque sortie avec `parsePlan`, donc c'est ce
 * fichier qui arbitre, pas une seconde idée de ce qu'est un plan valide.
 *
 * `samplePlan()` reste, en second : ses durées sont celles de `schedule.rs`
 * toutes jauges en bande haute, ce qui en fait un repère quand le plan du
 * modèle surprend. Et il a servi à juger l'écran avant que le modèle converge,
 * ce qui était son vrai travail.
 *
 * Ce fichier n'importe **rien**, et cela se garde : `check-plan.mjs` le compile
 * seul pour valider une sortie du Rust sans monter tout le bundle. Le plan
 * embarqué vit donc à côté, dans `model-plan.ts`.
 */

/* ------------------------------------------------------------------ contrat */

/**
 * Version du contrat. Un plan d'une autre version se refuse plutôt que de se
 * deviner.
 *
 * Ajouter un **genre** ne la fait pas bouger, et c'est délibéré. La version
 * garde un écran de lire un plan qu'il ne comprend pas ; or un genre en plus ne
 * casse que le sens inverse — un vieil écran devant un plan neuf — et les deux
 * partent dans le même déploiement. La bousculer, en revanche, ferait refuser
 * le plan déjà enregistré dans le compte du joueur, qui n'a rien demandé.
 */
export const TIMELINE_VERSION = 1;

/**
 * Les six jauges d'un enclos, dans l'ordre de `GAUGE_NAMES` côté Rust
 * (`breeding-sim/src/schedule.rs`). L'ordre est le contrat : le modèle peut
 * émettre un indice, et il doit tomber sur la même jauge des deux côtés.
 */
export const GAUGE_IDS = [
  'baffeur',
  'caresseur',
  'foudroyeur',
  'dragofesse',
  'abreuvoir',
  'mangeoire',
] as const;

export type GaugeId = (typeof GAUGE_IDS)[number];

export const GAUGE_LABELS: Record<GaugeId, string> = {
  baffeur: 'Baffeur',
  caresseur: 'Caresseur',
  foudroyeur: 'Foudroyeur',
  dragofesse: 'Dragofesse',
  abreuvoir: 'Abreuvoir',
  mangeoire: 'Mangeoire',
};

/**
 * Ce qu'un événement demande.
 *
 * Deux familles, et la distinction porte toute la lecture de l'écran :
 *
 * - `gauge` **dure** — une jauge qui tourne, donc une barre. On n'a rien à y
 *   faire, c'est le parc qui travaille.
 * - les autres sont **instantanés** — un geste à poser, donc un point. C'est ce
 *   qui appelle une présence devant l'enclos, et c'est ce que l'agenda liste.
 *
 * Confondre les deux était le défaut d'une première version : une barre de trois
 * heures se lisait comme « trois heures de manipulation ».
 */
export const EVENT_KINDS = ['gauge', 'refuel', 'collect', 'mate', 'clone', 'buy', 'note'] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * Les genres qui demandent une présence : ceux que l'agenda égrène.
 *
 * `buy` en fait partie, et c'est le seul dont le `at` n'est pas l'instant où on
 * agit mais **la date limite** : il faut avoir les montures et le carburant
 * *avant* de charger l'enclos, pas au moment où on le charge. Le compte à
 * rebours de l'agenda se lit donc « il reste tant » et non « ça commence dans
 * tant » — c'est la seule lecture utile, puisqu'un achat à l'HDV peut demander
 * plusieurs passages.
 */
const ACTIONABLE: ReadonlySet<EventKind> = new Set<EventKind>([
  'refuel',
  'collect',
  'mate',
  'clone',
  'buy',
]);

export const isActionable = (kind: EventKind) => ACTIONABLE.has(kind);

export type TimelineEvent = {
  /** Unique dans le plan. Sert de clé de rendu, et de repère si le modèle réémet. */
  id: string;
  kind: EventKind;
  /** Offset depuis le départ du plan, en secondes. Jamais une date. */
  at: number;
  /** Durée en secondes. Zéro pour un geste, positif pour une jauge qui tourne. */
  duration: number;
  label: string;
  /** Le détail qu'on ne lit qu'en survol : le pourquoi, le combien. */
  detail?: string;
  /** La jauge concernée, quand il y en a une. */
  gauge?: GaugeId;
  /** Un effectif, quand il compte : dix montures récupérées, trois clonages. */
  count?: number;
};

/**
 * Une piste : un enclos en pratique, parfois l'écurie ou le marché.
 *
 * Une piste par enclos et non une seule liste, parce que les cinq enclos
 * tournent **en parallèle** : aplatis sur une ligne, deux rechargements
 * simultanés sur deux enclos différents se liraient comme une file d'attente.
 */
export type TimelineTrack = {
  id: string;
  label: string;
  events: TimelineEvent[];
};

export type TimelinePlan = {
  version: number;
  /** Ce que le plan vise, en une ligne. Affiché tel quel. */
  label?: string;
  /**
   * Jusqu'où le modèle s'est prononcé, en secondes.
   *
   * Distinct du dernier événement : un ordonnanceur qui n'a rien à faire pendant
   * les six dernières heures dit quand même qu'il a regardé jusque-là. Sans
   * cela, l'écran ne peut pas distinguer « rien à faire » de « je ne sais pas ».
   */
  horizon?: number;
  tracks: TimelineTrack[];
};

/* ------------------------------------------------------------------ horloge */

/** La fenêtre que l'écran couvre : les douze heures qui viennent. */
export const WINDOW_SECONDS = 12 * 3600;

/**
 * Le talon de passé gardé à gauche du curseur.
 *
 * Sans lui, « maintenant » est collé au bord et on ne voit pas ce qu'on vient de
 * faire — or c'est précisément ce qu'on cherche en rouvrant l'écran après une
 * absence : est-ce que j'ai raté quelque chose.
 */
export const LEAD_IN_SECONDS = 30 * 60;

/** L'étendue totale du ruban, talon compris. */
export const RIBBON_SECONDS = LEAD_IN_SECONDS + WINDOW_SECONDS;

export type TimelineClock = {
  /** Départ du plan, en millisecondes epoch. */
  startedAt: number;
  /**
   * Le départ propre à chaque piste, quand elle en a un.
   *
   * Le parc ne se charge pas d'un bloc : on remplit un enclos, on le lance, on
   * passe au suivant. Le temps de nommer les poulains et de chercher les montures
   * dans le coffre, le premier a une heure d'avance sur le dernier — et une
   * horloge unique obligeait à les faire partir ensemble, ce qui n'arrive jamais.
   *
   * Une piste absente suit `startedAt`, ce qui est le comportement d'avant.
   */
  trackStarts?: Record<string, number>;
  /** Instant de la pause en cours, ou `null` si la timeline tourne. */
  pausedAt: number | null;
  /** Cumul des pauses **terminées**, en secondes. La pause en cours n'y est pas. */
  pausedSeconds: number;
};

export const isPaused = (clock: TimelineClock) => clock.pausedAt !== null;

/**
 * Où l'on en est dans le plan, en secondes de plan.
 *
 * En pause, `pausedAt` remplace `maintenant` : l'horloge s'arrête là où on l'a
 * arrêtée, et tout le reste — comptes à rebours, curseur, fenêtre — en découle
 * sans avoir à connaître l'état de pause.
 */
/**
 * Le temps écoulé **pour une piste**, qui peut avoir son propre départ.
 *
 * La pause, elle, reste globale : on ne quitte pas le jeu enclos par enclos, et
 * décompter les pauses piste par piste demanderait de savoir laquelle tournait
 * quand — une complication pour une distinction qui n'existe pas.
 */
export const elapsedFor = (clock: TimelineClock, trackId: string, now: number): number => {
  const started = clock.trackStarts?.[trackId];
  if (started === undefined) return elapsedSeconds(clock, now);
  const stopped = clock.pausedAt ?? now;
  // `pausedSeconds` est le cumul du **plan**, pas celui de la piste : une pause
  // antérieure au départ de cette piste-ci se retrouve donc retranchée à tort.
  // C'est une approximation assumée — on lance un enclos juste après l'avoir
  // chargé, et on part en week-end après, pas avant. La borne à zéro empêche le
  // cas pathologique de produire un temps négatif.
  return Math.max(0, (stopped - started) / 1000 - clock.pausedSeconds);
};

export const elapsedSeconds = (clock: TimelineClock, now: number): number =>
  Math.max(0, ((clock.pausedAt ?? now) - clock.startedAt) / 1000 - clock.pausedSeconds);

/** Depuis combien de temps la timeline est arrêtée, en secondes. Zéro si elle tourne. */
export const pausedForSeconds = (clock: TimelineClock, now: number): number =>
  clock.pausedAt === null ? 0 : Math.max(0, (now - clock.pausedAt) / 1000);

/**
 * L'instant réel où un offset de plan tombera, ou `null` en pause.
 *
 * Le `null` n'est pas un manque d'information mais la bonne réponse : une horloge
 * arrêtée ne peut pas dater. Afficher « 14 h 32 » sur une timeline en pause
 * serait un mensonge, et c'est justement celui qu'on croit en rouvrant lundi.
 */
export const wallClockAt = (
  clock: TimelineClock,
  at: number,
  now: number
): Date | null => {
  if (clock.pausedAt !== null) return null;
  return new Date(now + (at - elapsedSeconds(clock, now)) * 1000);
};

/** Reprendre : la pause écoulée rejoint le cumul, et le plan glisse d'autant. */
export const resumed = (clock: TimelineClock, now: number): TimelineClock =>
  clock.pausedAt === null
    ? clock
    : {
        startedAt: clock.startedAt,
        pausedAt: null,
        pausedSeconds: clock.pausedSeconds + Math.max(0, (now - clock.pausedAt) / 1000),
      };

/* -------------------------------------------------------------- lecture ---- */

/** Un événement replacé dans sa piste, pour les vues qui aplatissent. */
export type PlacedEvent = TimelineEvent & { trackId: string; trackLabel: string };

/** Tous les événements du plan, pistes confondues, dans l'ordre du temps. */
export const allEvents = (plan: TimelinePlan): PlacedEvent[] =>
  plan.tracks
    .flatMap((track) =>
      track.events.map((event) => ({
        ...event,
        trackId: track.id,
        trackLabel: track.label,
      }))
    )
    .sort((a, b) => a.at - b.at || precedence(a) - precedence(b) || a.trackId.localeCompare(b.trackId));

/**
 * La piste de l'écurie, celle qui ne dépend d'aucun enclos.
 *
 * Son identifiant est le contrat : `plan.rs` l'émet sous ce nom, et c'est lui qui
 * dit « ces gestes-là se font tout de suite, avec ce qu'on a déjà ».
 */
export const STABLE_TRACK = 'ecurie';

/**
 * Ce qui passe devant, à égalité d'instant.
 *
 * Trois rangs, et ils suivent l'ordre dans lequel on agit réellement :
 *
 * 1. **L'écurie d'abord.** Accoupler deux fécondes et cloner deux stériles ne
 *    demandent ni enclos, ni course, ni attente — un clic, avec ce qu'on tient
 *    déjà. Les faire passer après une liste d'achats reviendrait à faire attendre
 *    ce qui est immédiat derrière ce qui ne l'est pas.
 * 2. **Puis les achats**, qui sont le prérequis du geste portant la même date : il
 *    faut les montures avant de charger l'enclos, le carburant avant que les
 *    jauges partent.
 * 3. **Puis le reste**, chargements compris.
 *
 * Le rang 1 est ce qui manquait : rangés par piste, les six « Charger l'enclos »
 * se listaient d'abord et la course arrivait dessous — l'ordre exactement inverse
 * de celui dans lequel on agit. Vu à l'écran, pas déduit.
 */
const precedence = (event: { kind: EventKind; trackId: string }) => {
  if (event.trackId === STABLE_TRACK) return 0;
  return event.kind === 'buy' ? 1 : 2;
};

/**
 * Ce que l'agenda égrène : les gestes à venir, dans la fenêtre.
 *
 * Les jauges qui tournent en sont exclues — elles se voient sur le ruban, et les
 * lister noierait les quelques actions réelles sous une trentaine de lignes
 * « le Foudroyeur tourne ». L'agenda répond à « qu'est-ce que je dois faire »,
 * pas à « que se passe-t-il ».
 *
 * Le passé récent reste, borné par `grace` : rouvrir l'écran avec dix minutes de
 * retard doit montrer ce qui vient d'échoir, pas l'escamoter.
 */
export const agenda = (
  plan: TimelinePlan,
  elapsed: number | ((trackId: string) => number),
  { window = WINDOW_SECONDS, grace = LEAD_IN_SECONDS } = {}
): PlacedEvent[] => {
  // Un `elapsed` par piste depuis qu'un enclos peut partir sans les autres : les
  // offsets d'un événement se comptent depuis le départ de **sa** piste, donc les
  // comparer tous au même « maintenant » décalerait chaque enclos de son avance.
  const at = typeof elapsed === 'function' ? elapsed : () => elapsed;
  return allEvents(plan).filter((event) => {
    const now = at(event.trackId);
    return isActionable(event.kind) && event.at >= now - grace && event.at <= now + window;
  });
};

/** Ce que le ruban dessine : tout ce qui recoupe la fenêtre, jauges comprises. */
export const inRibbon = (
  plan: TimelinePlan,
  elapsed: number | ((trackId: string) => number)
): PlacedEvent[] => {
  const at = typeof elapsed === 'function' ? elapsed : () => elapsed;
  return allEvents(plan).filter((event) => {
    const now = at(event.trackId);
    return event.at + event.duration >= now - LEAD_IN_SECONDS && event.at <= now + WINDOW_SECONDS;
  });
};

/**
 * Range les barres d'une piste en couloirs qui ne se chevauchent pas.
 *
 * Un enclos fait tourner **deux jauges à la fois** — c'est la contrainte
 * centrale du modèle, celle dont découle tout l'ordonnancement. Empilées sur une
 * seule ligne, les deux barres se recouvrent et le ruban donne à lire exactement
 * l'inverse de ce qu'il devrait : une file d'attente là où il y a du
 * parallélisme.
 *
 * Le rangement se fait sur la piste **entière** et non sur la fenêtre visible :
 * sinon une barre changerait de couloir au fil des minutes, sous l'œil de qui la
 * regarde.
 *
 * Glouton au premier couloir libre, ce qui est optimal pour un placement
 * d'intervalles : le nombre de couloirs obtenu est le recouvrement maximal, donc
 * le minimum possible. En pratique deux, comme les deux places de l'enclos.
 */
export const packLanes = (events: TimelineEvent[]): Map<string, number> => {
  const ends: number[] = [];
  const lanes = new Map<string, number>();

  for (const event of [...events].sort((a, b) => a.at - b.at)) {
    // Les gestes ne prennent pas de place : ils se posent par-dessus, sur toute
    // la hauteur de la piste, puisqu'ils concernent l'enclos et non une jauge.
    if (event.duration <= 0) {
      lanes.set(event.id, 0);
      continue;
    }

    let lane = ends.findIndex((end) => end <= event.at);
    if (lane === -1) {
      lane = ends.length;
      ends.push(0);
    }
    ends[lane] = event.at + event.duration;
    lanes.set(event.id, lane);
  }

  return lanes;
};

/** Le prochain geste, celui qui commande. `null` si la fenêtre est vide. */
export const nextAction = (
  plan: TimelinePlan,
  elapsed: number | ((trackId: string) => number)
): PlacedEvent | null => {
  const at = typeof elapsed === 'function' ? elapsed : () => elapsed;
  return (
    allEvents(plan).find((event) => isActionable(event.kind) && event.at >= at(event.trackId)) ??
    null
  );
};

/**
 * Les instants où **ce qui tourne change** : un début ou une fin de jauge.
 *
 * C'est ce qui demande une présence, et ce n'est pas la même chose que l'agenda.
 * L'agenda liste les gestes — recharger, récupérer, accoupler ; ceci liste les
 * bascules, y compris celle qui consiste à déplacer une monture d'une jauge vers
 * la suivante, laquelle n'est un « geste » nulle part et se rate pourtant.
 *
 * Les deux bornes et pas seulement les débuts : une jauge qui s'arrête libère une
 * place, et c'est l'instant où l'on a quelque chose à y mettre. Depuis que
 * l'ordonnanceur sait interrompre une jauge et la reprendre, une même jauge peut
 * en produire plusieurs — c'est voulu, ce sont bien autant de passages devant
 * l'enclos.
 */
export const gaugeChanges = (plan: TimelinePlan): number[] => {
  const instants = new Set<number>();
  for (const event of allEvents(plan)) {
    if (event.kind !== 'gauge') continue;
    instants.add(event.at);
    if (event.duration > 0) instants.add(event.at + event.duration);
  }
  return [...instants].sort((a, b) => a - b);
};

/** Jusqu'où le plan porte : son horizon déclaré, ou son dernier événement. */
export const planHorizon = (plan: TimelinePlan): number =>
  plan.horizon ??
  plan.tracks.reduce(
    (furthest, track) =>
      track.events.reduce((end, event) => Math.max(end, event.at + event.duration), furthest),
    0
  );

/* -------------------------------------------------------------- affichage -- */

/**
 * Une durée telle qu'on l'attend, du côté court.
 *
 * `formatHours` de `utils/date` ne convient pas : il bascule en jours au-delà de
 * 48 h et arrondit au quart d'heure près, ce qui est bon pour un plan de six
 * mois et illisible pour « dans 18 min ».
 */
export const formatCountdown = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return '—';

  const late = seconds < 0;
  const total = Math.round(Math.abs(seconds));

  if (total < 60) return late ? "à l'instant" : 'moins d’1 min';

  const minutes = Math.floor(total / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const value =
    days >= 2
      ? `${days} j`
      : hours >= 1
        ? `${hours} h ${String(minutes % 60).padStart(2, '0')}`
        : `${minutes} min`;

  return late ? `il y a ${value}` : value;
};

/** L'heure d'un événement, quand l'horloge tourne. */
export const formatWallClock = (date: Date): string =>
  date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/* -------------------------------------------------------------- validation - */

/**
 * Discriminé sur `ok` et non sur la présence de `plan`.
 *
 * Un `error: string` optionnel ne discrimine rien pour TypeScript — `string`
 * n'est pas un type unité — et l'appelant se retrouvait avec un `plan` possiblement
 * absent après avoir pourtant testé l'erreur.
 */
export type ParseResult =
  | { ok: true; plan: TimelinePlan }
  | { ok: false; error: string };

const failed = (error: string): ParseResult => ({ ok: false, error });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Lit un plan venu du dehors — un fichier du modèle, une ligne de base, un
 * collage.
 *
 * Valide plutôt que de caster : le JSON est écrit par un autre programme, dans
 * un autre langage, qui évolue de son côté. Un champ renommé côté Rust doit
 * donner un message lisible ici, pas un `undefined` qui se propage jusqu'à un
 * ruban vide qu'on mettra une heure à expliquer.
 */
export const parsePlan = (raw: unknown): ParseResult => {
  if (!isRecord(raw)) return failed('Le plan doit être un objet JSON.');

  if (raw.version !== TIMELINE_VERSION) {
    return failed(
      `Version de plan ${String(raw.version)} non reconnue — cet écran lit la version ${TIMELINE_VERSION}.`
    );
  }

  if (!Array.isArray(raw.tracks)) return failed('Le plan doit porter un tableau `tracks`.');
  if (raw.tracks.length === 0) return failed('Le plan ne contient aucune piste.');

  const tracks: TimelineTrack[] = [];

  for (const [index, candidate] of raw.tracks.entries()) {
    if (!isRecord(candidate)) return failed(`Piste ${index} : ce n'est pas un objet.`);
    if (typeof candidate.id !== 'string' || candidate.id === '') {
      return failed(`Piste ${index} : \`id\` manquant.`);
    }
    if (!Array.isArray(candidate.events)) {
      return failed(`Piste ${candidate.id} : \`events\` manquant.`);
    }

    const events: TimelineEvent[] = [];

    for (const [position, rawEvent] of candidate.events.entries()) {
      if (!isRecord(rawEvent)) {
        return failed(`Piste ${candidate.id}, événement ${position} : ce n'est pas un objet.`);
      }

      const { id, kind, at, duration, label, detail, gauge, count } = rawEvent;

      if (typeof id !== 'string' || id === '') {
        return failed(`Piste ${candidate.id}, événement ${position} : \`id\` manquant.`);
      }
      if (typeof kind !== 'string' || !EVENT_KINDS.includes(kind as EventKind)) {
        return failed(`Événement ${id} : genre « ${String(kind)} » inconnu.`);
      }
      if (!finite(at) || at < 0) {
        return failed(`Événement ${id} : \`at\` doit être un nombre de secondes positif.`);
      }
      // Une durée absente vaut zéro : un geste n'a pas à la déclarer, et
      // l'exiger alourdirait tout ce que le modèle émet.
      if (duration !== undefined && (!finite(duration) || duration < 0)) {
        return failed(`Événement ${id} : \`duration\` doit être une durée positive.`);
      }
      if (typeof label !== 'string' || label === '') {
        return failed(`Événement ${id} : \`label\` manquant.`);
      }
      if (gauge !== undefined && !GAUGE_IDS.includes(gauge as GaugeId)) {
        return failed(`Événement ${id} : jauge « ${String(gauge)} » inconnue.`);
      }

      events.push({
        id,
        kind: kind as EventKind,
        at,
        duration: finite(duration) ? duration : 0,
        label,
        ...(typeof detail === 'string' ? { detail } : {}),
        ...(gauge !== undefined ? { gauge: gauge as GaugeId } : {}),
        ...(finite(count) ? { count } : {}),
      });
    }

    tracks.push({
      id: candidate.id,
      label: typeof candidate.label === 'string' ? candidate.label : candidate.id,
      events: events.sort((a, b) => a.at - b.at),
    });
  }

  return {
    ok: true,
    plan: {
      version: TIMELINE_VERSION,
      ...(typeof raw.label === 'string' ? { label: raw.label } : {}),
      ...(finite(raw.horizon) ? { horizon: raw.horizon } : {}),
      tracks,
    },
  };
};

/* ------------------------------------------------------------------ exemple */

/**
 * Un plan d'exemple, le temps que l'optimiseur converge.
 *
 * Les durées ne sont pas inventées : ce sont celles de `schedule.rs` avec toutes
 * les jauges en bande haute (4 pt/s), c'est-à-dire montée de sérénité 10 000
 * points en 42 min, une stat 20 000 points en 1 h 23, Mangeoire d'un niveau 23
 * (5 628 points) à 1 pt/s en 1 h 34. L'ordonnancement à deux places donne alors
 * une fournée de 3 h 36, et les cinq enclos se décalent de 40 min pour que les
 * manipulations ne tombent pas toutes ensemble — c'est la contrainte d'usage qui
 * justifie déjà, côté Rust, que les cinq enclos soient identiques.
 *
 * Le tenir fidèle a un intérêt concret : si le vrai plan du modèle ne ressemble
 * pas à celui-ci, c'est l'un des deux qui a tort, et on le verra tout de suite.
 */
export const samplePlan = (): TimelinePlan => {
  const MINUTE = 60;
  const HOUR = 3600;

  /** Le cycle complet : récupération à 3 h 36, rechargement dix minutes après. */
  const CYCLE = 226 * MINUTE;

  /** Une fournée d'enclos, décalée de `offset` secondes. */
  const cycle = (index: number, offset: number, round: number): TimelineEvent[] => {
    const id = `enclos-${index}-t${round}`;
    const event = (
      suffix: string,
      kind: EventKind,
      at: number,
      duration: number,
      label: string,
      extra: Partial<TimelineEvent> = {}
    ): TimelineEvent => ({
      id: `${id}-${suffix}`,
      kind,
      at: offset + at,
      duration,
      label,
      ...extra,
    });

    // L'ordonnancement de `schedule.rs`, déroulé : montée et Mangeoire d'abord,
    // puis la première stat dès la sérénité au bout, la descente en deux temps
    // parce que franchir zéro couperait cette première stat, et les deux
    // dernières stats ensemble une fois garé à −1.
    return [
        event('climb', 'gauge', 0, 42 * MINUTE, 'Sérénité → +5000', {
          gauge: 'baffeur',
          detail: '10 000 points à 4 pt/s. Seule la Mangeoire peut tourner pendant ce temps.',
        }),
        event('xp', 'gauge', 0, 94 * MINUTE, 'Mangeoire — niveau 23', {
          gauge: 'mangeoire',
          detail: '5 628 points à 1 pt/s. Occupe une des deux places : elle allonge la fournée.',
        }),
        event('fuel-baffeur', 'refuel', 40 * MINUTE, 0, 'Recharger le Baffeur', {
          gauge: 'baffeur',
          detail: 'La bande haute ne tient qu’au-dessus de 90 000.',
        }),
        event('stat-1', 'gauge', 42 * MINUTE, 83 * MINUTE, 'Dragofesse', {
          gauge: 'dragofesse',
          detail: '20 000 points. Ne tourne qu’en sérénité positive.',
        }),
        event('fuel-dragofesse', 'refuel', 82 * MINUTE, 0, 'Recharger la Dragofesse', {
          gauge: 'dragofesse',
        }),
        event('descent-gate', 'gauge', 94 * MINUTE, 12 * MINUTE, 'Sérénité → +2000', {
          gauge: 'caresseur',
          detail: '3 000 points : ouvre l’Abreuvoir sans couper la stat en cours.',
        }),
        event('abreuvoir', 'gauge', 106 * MINUTE, 83 * MINUTE, 'Abreuvoir', {
          gauge: 'abreuvoir',
          detail: 'Fenêtre de sérénité [−2000, +2000].',
        }),
        event('descent-zero', 'gauge', 125 * MINUTE, 8 * MINUTE, 'Sérénité → −1', {
          gauge: 'caresseur',
          detail: 'On attend que la Dragofesse ait fini : franchir zéro la couperait net.',
        }),
        event('fuel-abreuvoir', 'refuel', 2 * HOUR + 10 * MINUTE, 0, 'Recharger l’Abreuvoir', {
          gauge: 'abreuvoir',
        }),
        event('stat-3', 'gauge', 133 * MINUTE, 83 * MINUTE, 'Foudroyeur', {
          gauge: 'foudroyeur',
          detail: '−1 ouvre l’Abreuvoir et le Foudroyeur à la fois : les deux tournent ensemble.',
        }),
        event('collect', 'collect', 216 * MINUTE, 0, 'Récupérer la fournée', {
          count: 10,
          detail: 'Fournée de 3 h 36. Les dix places finissent ensemble.',
        }),
        event('mate', 'mate', 226 * MINUTE, 0, 'Recharger l’enclos', {
          count: 10,
          detail: 'Dix montures fécondes à replacer, puis le cycle repart.',
        }),
    ];
  };

  // Les enclos enchaînent : un parc ne s'arrête pas après une fournée, et un
  // ruban qui se viderait à mi-parcours ne montrerait pas ce qu'on vient y
  // chercher — les trous, justement, sont ceux qui séparent deux cycles.
  //
  // Décalés de 40 min l'un sur l'autre : cinq enclos qui finiraient ensemble
  // demanderaient cinquante montures d'un coup, ce qu'aucune session ne permet.
  const tracks: TimelineTrack[] = [1, 2, 3, 4, 5].map((index) => {
    const stagger = (index - 1) * 40 * MINUTE;
    const events: TimelineEvent[] = [];

    for (let round = 0; stagger + round * CYCLE < 12 * HOUR; round += 1) {
      events.push(...cycle(index, stagger + round * CYCLE, round));
    }

    return { id: `enclos-${index}`, label: `Enclos ${index}`, events };
  });

  // L'écurie n'est pas un enclos : ses gestes ne dépendent d'aucune jauge, ils
  // se placent dans les trous. D'où une piste à part.
  tracks.push({
    id: STABLE_TRACK,
    label: 'Écurie',
    events: [
      // Par quoi on commence, et ça ne dépend d'aucun enclos : accoupler ce qui
      // est déjà fécond et cloner ce qui est stérile se font tout de suite, avec
      // ce qu'on tient. C'est ce que `plan.rs` émettra en tête une fois le
      // champion du tapis entraîné — l'exemple le porte d'avance pour que la
      // mise en page se juge sans attendre.
      {
        id: 'ecurie-mate-0',
        kind: 'mate',
        at: 0,
        duration: 0,
        label: 'Accoupler 12 couples',
        count: 12,
        detail:
          '♂ Amande-Pere × ♀ Dore ×2 · ♂ Dore × ♀ Amande-Mere ×1 · ♂ Ebene × ♀ Orchidee ×7 — ' +
          'aucun enclos, aucune attente : deux fécondes s’accouplent d’un clic.',
      },
      {
        id: 'ecurie-clone-0',
        kind: 'clone',
        at: 0,
        duration: 0,
        label: 'Cloner 8 stériles',
        count: 8,
        detail:
          '4 paires de génération 3, 2 de génération 5, 2 de génération 8. ' +
          'Deux stériles ne se clonent qu’à génération affichée égale, donc le choix n’est pas libre.',
      },
      {
        id: 'ecurie-clone-1',
        kind: 'clone',
        at: 75 * MINUTE,
        duration: 0,
        label: 'Cloner 3 stériles',
        count: 3,
        detail: 'Une stérile ne vaut plus rien tant qu’on ne la clone pas.',
      },
      {
        id: 'ecurie-clone-2',
        kind: 'clone',
        at: 5 * HOUR + 20 * MINUTE,
        duration: 0,
        label: 'Cloner 4 stériles',
        count: 4,
      },
      {
        id: 'ecurie-note',
        kind: 'note',
        at: 8 * HOUR,
        duration: 4 * HOUR,
        label: 'Rien de prévu — le parc tourne',
        detail: 'Le modèle a regardé jusqu’à 12 h et n’a pas trouvé d’intervention utile ici.',
      },
    ],
  });

  return {
    version: TIMELINE_VERSION,
    label: 'Exemple — 5 enclos en bande haute, Mangeoire niveau 23',
    horizon: 12 * HOUR,
    tracks,
  };
};
