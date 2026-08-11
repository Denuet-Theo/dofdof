/**
 * L'ordonnancement d'une fournée : combien de temps, à quel prix, et quand chaque
 * jauge tourne.
 *
 * Portage de `rust/breeding-sim/src/schedule.rs`. Cinquième pièce, après le
 * réseau, le recensement, l'effet d'un croisement et la recherche — et la seule
 * qui ne dépende d'aucun champion : c'est de l'ordonnancement pur, donc son
 * garde-fou compare **16 384 durées** à la seconde près plutôt que des plans.
 *
 * ## Pourquoi l'app en a besoin
 *
 * Les plans embarqués sont joués sur les bandes du champion, pas sur celles de
 * l'éleveur. Or les bandes sont un réglage personnel — on n'a pas tous les mêmes
 * jauges au même niveau, ni le même budget de carburant — et la fournée qui en
 * découle change du simple au double. Un plan compilé ailleurs ne peut pas le
 * dire.
 *
 * ## Deux places, sept tâches
 *
 * L'enclos ne fait tourner que **deux** jauges à la fois, et l'ordre n'est pas
 * libre : la sérénité ouvre et ferme les fenêtres des autres. La montée d'abord,
 * puis la Dragofesse qui ne tourne qu'en positif ; la descente est **coupée en
 * deux** parce qu'une jauge hors de sa fenêtre s'arrête net au lieu de ralentir,
 * donc franchir zéro avant que la Dragofesse ait fini la couperait. Une fois garé
 * à −1, tout reste ouvert : −1 est à la fois dans `[-2000, +2000]` pour
 * l'Abreuvoir et dans `[-5000, -1]` pour le Foudroyeur.
 *
 * ## Trois ordonnanceurs, et on garde le plus court
 *
 * Aucun ne domine les autres, et c'est mesuré : sur les 4 096 répartitions de
 * bandes à quatre niveaux, la version préemptive seule raccourcit 2 193 fournées
 * **et en allonge 512**. On calcule donc les trois et on prend le meilleur, ce qui
 * coûte quelques microsecondes contre des heures de fournée en jeu.
 */

/** Les six jauges, dans l'ordre qui **est** le contrat avec le Rust. */
export const GAUGE_NAMES = [
  'Baffeur',
  'Caresseur',
  'Foudroyeur',
  'Dragofesse',
  'Abreuvoir',
  'Mangeoire',
] as const;

export const GAUGES = 6;
export const BAFFEUR = 0;
export const CARESSEUR = 1;
export const FOUDROYEUR = 2;
export const DRAGOFESSE = 3;
export const ABREUVOIR = 4;
export const MANGEOIRE = 5;

/** Points de sérénité pour ouvrir les stats positives. */
export const SERENITY_CLIMB = 10_000;
/** Points pour redescendre de +5000 à −1. */
export const SERENITY_RETURN = 5_001;
export const STAT_POINTS = 20_000;
/** Descendre jusqu'à +2000 ouvre l'Abreuvoir sans couper la stat en cours. */
export const ABREUVOIR_GATE = 3_000;

/** Ce que l'enclos fait tourner à la fois. */
export const PARALLEL_SLOTS = 2;

const TASKS = 7;

/** Points de Mangeoire pour atteindre un niveau : `3,795 × niveau^2,329`. */
export const mountXpForLevel = (level: number): number => 3.795 * level ** 2.329;

/** Ce que l'ordonnancement réclame au parc de l'éleveur. */
export type GaugeEconomy = {
  /** Points par seconde d'une bande, index 0 à 3. */
  bandRate: (band: number) => number;
  /** Kamas par point, par jauge et par bande. */
  gaugePrice: (gauge: number, band: number) => number;
};

type Task = {
  gauge: number;
  points: number;
  /** `[tâche, seuil de points]` à franchir avant de pouvoir démarrer. */
  after: [number, number] | null;
};

/** Une tranche continue : une jauge tourne, sans interruption, de `start` à `end`. */
export type Slot = {
  gauge: number;
  /** Points servis **dans cette tranche**, et non ceux de la tâche entière. */
  points: number;
  /** Secondes depuis le début de la fournée. */
  start: number;
  end: number;
};

export type Schedule = {
  hours: number;
  /** Carburant pour un enclos. */
  costPerEnclos: number;
  /** Quelle jauge porte la montée de sérénité, l'autre portant la descente. */
  climber: number;
};

/** Les deux jauges de sérénité sont interchangeables : la moins chère monte. */
const climbAndReturn = (economy: GaugeEconomy, bands: number[]): [number, number] =>
  economy.gaugePrice(BAFFEUR, bands[BAFFEUR]) <= economy.gaugePrice(CARESSEUR, bands[CARESSEUR])
    ? [BAFFEUR, CARESSEUR]
    : [CARESSEUR, BAFFEUR];

const taskList = (climber: number, returner: number, xpPoints: number): Task[] => [
  { gauge: climber, points: SERENITY_CLIMB, after: null },
  { gauge: MANGEOIRE, points: xpPoints, after: null },
  { gauge: returner, points: ABREUVOIR_GATE, after: [0, SERENITY_CLIMB] },
  { gauge: DRAGOFESSE, points: STAT_POINTS, after: [0, SERENITY_CLIMB] },
  { gauge: ABREUVOIR, points: STAT_POINTS, after: [2, ABREUVOIR_GATE] },
  // Franchir zéro coupe la première stat : on attend qu'elle ait fini.
  { gauge: returner, points: SERENITY_RETURN - ABREUVOIR_GATE, after: [3, STAT_POINTS] },
  // Le Foudroyeur ne tourne qu'en sérénité négative.
  { gauge: FOUDROYEUR, points: STAT_POINTS, after: [5, SERENITY_RETURN - ABREUVOIR_GATE] },
];

/** Un ordonnancement rendu : sa durée, et les tranches réellement jouées. */
type Placement = { total: number; segments: Slot[] };

const finish = (segments: Slot[]): Placement => ({
  total: segments.reduce((longest, slot) => Math.max(longest, slot.end), 0),
  segments,
});

/**
 * Deux tranches consécutives d'une même tâche n'en font qu'une : c'est le
 * découpage de la boucle d'événements, pas une interruption réelle.
 */
const recorder = (tasks: Task[], segments: Slot[]) => {
  const owner = new Map<Slot, number>();
  return (index: number, from: number, to: number, points: number) => {
    if (to <= from + 1e-9) return;
    for (let at = segments.length - 1; at >= 0; at -= 1) {
      if (owner.get(segments[at]) !== index) continue;
      if (Math.abs(segments[at].end - from) < 1e-9) {
        segments[at].end = to;
        segments[at].points += points;
        return;
      }
      break;
    }
    const slot: Slot = { gauge: tasks[index].gauge, points, start: from, end: to };
    owner.set(slot, index);
    segments.push(slot);
  };
};

/**
 * La hauteur d'une tâche : sa durée plus le plus long chemin qui en dépend.
 *
 * C'est la priorité de Hu, et elle remplace « la plus longue d'abord » — laquelle
 * est optimale sans contrainte de précédence et franchement mauvaise avec : la
 * Mangeoire est de loin la plus longue, donc elle monopolise une place et affame
 * la chaîne qui décide de la fin.
 */
const heights = (tasks: Task[], rate: (gauge: number) => number): number[] => {
  const length = (index: number) => {
    const speed = rate(tasks[index].gauge);
    return speed > 0 ? tasks[index].points / speed : 0;
  };
  const height = new Array<number>(TASKS).fill(0);
  for (let index = TASKS - 1; index >= 0; index -= 1) {
    let below = 0;
    for (let successor = 0; successor < TASKS; successor += 1) {
      if (tasks[successor].after?.[0] === index) below = Math.max(below, height[successor]);
    }
    height[index] = length(index) + below;
  }
  return height;
};

/** Le placement d'origine : une tâche lancée occupe sa place jusqu'au bout. */
const blocking = (tasks: Task[], rate: (gauge: number) => number): Placement => {
  const segments: Slot[] = [];
  const record = recorder(tasks, segments);
  const duration = (index: number) => {
    const speed = rate(tasks[index].gauge);
    return speed > 0 ? tasks[index].points / speed : 0;
  };
  const started = new Array<number>(TASKS).fill(Infinity);
  const finished = new Array<number>(TASKS).fill(Infinity);
  let running: [number, number][] = [];
  let pending = [...Array(TASKS).keys()].filter((index) => tasks[index].points > 0);
  let now = 0;

  const readyAt = (index: number): number | null => {
    const after = tasks[index].after;
    if (!after) return 0;
    const [predecessor, progress] = after;
    const start = started[predecessor];
    if (!Number.isFinite(start)) return null;
    const speed = rate(tasks[predecessor].gauge);
    return speed > 0 ? start + progress / speed : Infinity;
  };

  for (let guard = 0; guard < 64; guard += 1) {
    if (pending.length === 0 && running.length === 0) break;
    const launchable = pending
      .filter((index) => {
        const at = readyAt(index);
        return at !== null && at <= now + 1e-9;
      })
      .sort((a, b) => duration(b) - duration(a) || a - b);

    for (const index of launchable) {
      if (running.length >= PARALLEL_SLOTS) break;
      // Une jauge déjà en train de tourner ne peut pas porter une seconde tâche :
      // les deux segments de descente sont sur la **même** jauge de sérénité.
      if (running.some(([other]) => tasks[other].gauge === tasks[index].gauge)) continue;
      started[index] = now;
      const end = now + duration(index);
      finished[index] = end;
      record(index, now, end, tasks[index].points);
      running.push([index, end]);
      pending = pending.filter((other) => other !== index);
    }

    const nextFinish = running.reduce((soonest, [, end]) => Math.min(soonest, end), Infinity);
    const nextGate = pending.reduce((soonest, index) => {
      const at = readyAt(index);
      return at !== null && at > now + 1e-9 ? Math.min(soonest, at) : soonest;
    }, Infinity);
    const next = running.length < PARALLEL_SLOTS ? Math.min(nextFinish, nextGate) : nextFinish;
    if (!Number.isFinite(next)) break;
    now = next;
    running = running.filter(([, end]) => end > now + 1e-9);
  }

  return finish(segments);
};

/** Ce qui est prêt à tourner, trié par hauteur, une seule tâche par jauge. */
const eligibleAt = (
  tasks: Task[],
  remaining: number[],
  done: number[],
  height: number[]
): number[] => {
  const ready = [...Array(TASKS).keys()]
    .filter((index) => remaining[index] > 1e-9)
    .filter((index) => {
      const after = tasks[index].after;
      return !after || done[after[0]] >= after[1] - 1e-9;
    })
    .sort((a, b) => height[b] - height[a] || a - b);

  const eligible: number[] = [];
  for (const index of ready) {
    if (!eligible.some((other) => tasks[other].gauge === tasks[index].gauge)) eligible.push(index);
  }
  return eligible;
};

/**
 * Préemptif : une jauge se met en pause et reprend où elle en était.
 *
 * C'est une règle du jeu, et le modèle faisait l'hypothèse inverse. Elle change
 * aussi le calcul des dépendances : `after` porte un **seuil de points**, qu'on
 * pouvait convertir en date tant qu'une tâche ne s'interrompait pas.
 */
const preemptive = (tasks: Task[], rate: (gauge: number) => number): Placement => {
  const segments: Slot[] = [];
  const record = recorder(tasks, segments);
  const height = heights(tasks, rate);
  const speed = (index: number) => rate(tasks[index].gauge);
  const remaining = tasks.map((task, index) => (speed(index) > 0 ? task.points : 0));
  const done = new Array<number>(TASKS).fill(0);
  let now = 0;

  for (let guard = 0; guard < 256; guard += 1) {
    const eligible = eligibleAt(tasks, remaining, done, height);
    const running = eligible.slice(0, PARALLEL_SLOTS);
    if (running.length === 0) break;

    let step = Infinity;
    for (const index of running) step = Math.min(step, remaining[index] / speed(index));
    for (let index = 0; index < TASKS; index += 1) {
      if (remaining[index] <= 1e-9) continue;
      const after = tasks[index].after;
      if (!after) continue;
      const [predecessor, progress] = after;
      if (done[predecessor] < progress && running.includes(predecessor)) {
        step = Math.min(step, (progress - done[predecessor]) / speed(predecessor));
      }
    }
    if (!Number.isFinite(step) || step <= 0) break;

    for (const index of running) {
      const served = Math.min(step * speed(index), remaining[index]);
      record(index, now, now + step, served);
      done[index] += served;
      remaining[index] -= served;
      if (remaining[index] <= 1e-9) remaining[index] = 0;
    }
    now += step;
  }

  return finish(segments);
};

/**
 * Muntz–Coffman : on répartit du **débit**, pas des tâches.
 *
 * Quand deux tâches prêtes se disputent une seule place, les servir l'une après
 * l'autre laisse la seconde place chômer à la fin ; les faire avancer ensemble à
 * mi-vitesse les amène à égalité, si bien qu'elles finissent de front dès qu'une
 * place se libère.
 *
 * Les parts redeviennent des créneaux par la règle de **McNaughton** : on remplit
 * la première place de bout en bout, puis la seconde, et une tâche qui déborde se
 * coupe au passage. Elle ne se retrouve jamais sur deux places au même instant —
 * sa charge vaut au plus une place entière, donc le morceau laissé sur la place
 * suivante finit avant que le premier ne commence.
 */
const shared = (tasks: Task[], rate: (gauge: number) => number): Placement => {
  const segments: Slot[] = [];
  const record = recorder(tasks, segments);
  const height = heights(tasks, rate);
  const speed = (index: number) => rate(tasks[index].gauge);
  const remaining = tasks.map((task, index) => (speed(index) > 0 ? task.points : 0));
  const done = new Array<number>(TASKS).fill(0);
  let now = 0;

  for (let guard = 0; guard < 512; guard += 1) {
    const eligible = eligibleAt(tasks, remaining, done, height);
    if (eligible.length === 0) break;

    // Les plus hautes d'abord ; le palier qui déborde se partage également ce
    // qui reste.
    const share = new Array<number>(TASKS).fill(0);
    let free = PARALLEL_SLOTS;
    let at = 0;
    while (at < eligible.length && free > 1e-9) {
      const tier = [eligible[at]];
      while (
        at + tier.length < eligible.length &&
        Math.abs(height[eligible[at + tier.length]] - height[eligible[at]]) < 1e-9
      ) {
        tier.push(eligible[at + tier.length]);
      }
      const each = Math.min(free / tier.length, 1);
      for (const index of tier) share[index] = each;
      free -= each * tier.length;
      at += tier.length;
    }

    let step = Infinity;
    for (let index = 0; index < TASKS; index += 1) {
      if (share[index] > 1e-9) {
        step = Math.min(step, remaining[index] / (speed(index) * share[index]));
      }
    }
    for (let index = 0; index < TASKS; index += 1) {
      if (remaining[index] <= 1e-9) continue;
      const after = tasks[index].after;
      if (!after) continue;
      const [predecessor, progress] = after;
      if (done[predecessor] < progress && share[predecessor] > 1e-9) {
        step = Math.min(
          step,
          (progress - done[predecessor]) / (speed(predecessor) * share[predecessor])
        );
      }
    }
    if (!Number.isFinite(step) || step <= 0) break;

    let cursor = 0;
    for (const index of eligible) {
      if (share[index] <= 1e-9) continue;
      let left = share[index] * step;
      while (left > 1e-12) {
        const machine = Math.floor(cursor / step);
        const within = cursor - machine * step;
        const take = Math.min(left, step - within);
        if (take <= 1e-12) break;
        record(index, now + within, now + within + take, take * speed(index));
        cursor += take;
        left -= take;
      }
      const served = Math.min(step * speed(index) * share[index], remaining[index]);
      done[index] += served;
      remaining[index] -= served;
      if (remaining[index] <= 1e-9) remaining[index] = 0;
    }
    now += step;
  }

  return finish(segments);
};

/** La durée d'un cycle : la plus courte des trois heuristiques. */
const makespan = (tasks: Task[], rate: (gauge: number) => number): Placement => {
  let best = blocking(tasks, rate);
  for (const other of [preemptive(tasks, rate), shared(tasks, rate)]) {
    if (other.total < best.total - 1e-9) best = other;
  }
  return best;
};

/** La durée et le coût d'une fournée, pour un choix de bande par jauge. */
export const schedule = (
  economy: GaugeEconomy,
  bands: number[],
  xpPoints: number
): Schedule => {
  const [climber, returner] = climbAndReturn(economy, bands);
  const tasks = taskList(climber, returner, xpPoints);
  const costPerEnclos = tasks.reduce(
    (total, task) => total + task.points * economy.gaugePrice(task.gauge, bands[task.gauge]),
    0
  );
  const rate = (gauge: number) => economy.bandRate(bands[gauge]);
  return { hours: makespan(tasks, rate).total / 3600, costPerEnclos, climber };
};

/**
 * Le même ordonnancement, rendu tranche par tranche.
 *
 * Une entrée par **tranche continue** et non par tâche : une jauge qui s'interrompt
 * puis reprend produit deux créneaux, ce qui est la vérité de l'enclos. Un créneau
 * unique étalé sur les trous annoncerait une jauge qui tourne alors qu'elle est à
 * l'arrêt.
 *
 * Les tâches de points nuls sont écartées : une Mangeoire à zéro point n'est pas un
 * événement de durée nulle, c'est un événement qui n'existe pas.
 */
export const slots = (economy: GaugeEconomy, bands: number[], xpPoints: number): Slot[] => {
  const [climber, returner] = climbAndReturn(economy, bands);
  const tasks = taskList(climber, returner, xpPoints);
  const rate = (gauge: number) => economy.bandRate(bands[gauge]);
  return makespan(tasks, rate)
    .segments.filter((slot) => slot.end > slot.start)
    .sort((a, b) => a.start - b.start);
};

/**
 * Le plus haut niveau que la Mangeoire livre **sans allonger la fournée**.
 *
 * Elle occupe une des deux places, donc monter les montures allonge le cycle dès
 * que ses points dépassent ce que les autres jauges laissent passer. En deçà,
 * c'est gratuit en temps — mais jamais en kamas : la Mangeoire consomme, elle ne
 * fait que ne pas faire attendre.
 */
export const freeLevel = (economy: GaugeEconomy, bands: number[], maxLevel = 200): number => {
  const floor = schedule(economy, bands, 0).hours;
  let free = 0;
  for (let level = 1; level <= maxLevel; level += 1) {
    if (schedule(economy, bands, mountXpForLevel(level)).hours > floor + 1e-9) break;
    free = level;
  }
  return free;
};
