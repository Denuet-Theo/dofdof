/**
 * Quand l'éleveur peut **agir** : des préréglages nommés, et celui du jour.
 *
 * Les jauges tournent en continu — une monture monte pendant qu'on dort — mais
 * lancer et récupérer une fournée demande d'être devant le jeu. Un plan qui ne
 * connaît qu'un budget d'heures propose donc des gestes à quatre heures du matin.
 *
 * ## Des préréglages, et non deux patterns
 *
 * Coder « journée de travail » et « journée de repos » ne tient pas : les horaires
 * d'un télétravail ne sont pas ceux d'un bureau, et surtout ce sont ceux **de
 * cette personne-là**. Le joueur nomme et modifie donc les siens, et choisit
 * lequel s'applique aujourd'hui.
 */

/** Le jumeau du modèle Rust — voir `Economy::availability`. */
export type AvailabilityWindow = {
  /** Minutes depuis minuit. */
  from: number;
  /**
   * Minutes depuis minuit, **pouvant dépasser 1440**.
   *
   * Une soirée de 20 h à 2 h se dit `{ from: 1200, to: 1560 }` plutôt que d'être
   * coupée en deux morceaux dont l'un appartiendrait au lendemain — ce qui
   * obligerait chaque lecteur à recoller les deux.
   */
  to: number;
};

export type AvailabilityPreset = {
  id: string;
  name: string;
  windows: AvailabilityWindow[];
};

export type AvailabilityState = {
  presets: AvailabilityPreset[];
  /**
   * Le préréglage retenu, et **pour quel jour**.
   *
   * La date compte : le préréglage se choisit le matin pour la journée, donc
   * rouvrir l'écran le même jour doit retrouver le choix, et le lendemain doit le
   * redemander plutôt que de rejouer celui d'hier — sans quoi une journée de
   * repos héritée d'un dimanche ferait planifier un lundi de travail.
   */
  chosen: { presetId: string; date: string } | null;
};

export const MINUTES_PER_DAY = 1440;
/** Au-delà, un préréglage devient une liste qu'on ne lit plus. */
export const MAX_WINDOWS = 4;

const minutes = (hours: number, mins = 0) => hours * 60 + mins;

/**
 * Ce qu'on propose au départ : les trois formes que l'éleveur a décrites.
 *
 * Des exemples à modifier, pas une vérité — d'où des noms qui disent la situation
 * et non l'horaire, pour que renommer ne soit pas nécessaire quand les heures
 * changent.
 */
export const DEFAULT_PRESETS: AvailabilityPreset[] = [
  {
    id: 'teletravail',
    name: 'Télétravail',
    windows: [
      { from: minutes(8), to: minutes(10) },
      { from: minutes(12), to: minutes(14) },
      { from: minutes(19), to: minutes(26) },
    ],
  },
  {
    id: 'bureau',
    name: 'Au bureau',
    windows: [
      { from: minutes(7, 30), to: minutes(8, 30) },
      { from: minutes(13), to: minutes(14) },
      { from: minutes(20), to: minutes(26) },
    ],
  },
  {
    id: 'repos',
    name: 'Jour de repos',
    windows: [{ from: minutes(10), to: minutes(26) }],
  },
];

export const EMPTY_STATE: AvailabilityState = { presets: DEFAULT_PRESETS, chosen: null };

/** La date locale au format `AAAA-MM-JJ`, qui est la clé du choix du jour. */
export const today = (at: Date = new Date()): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

/** `500` → `08:20`. Les minutes au-delà de 1440 se replient sur le lendemain. */
export const formatMinutes = (value: number): string => {
  const wrapped = ((value % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(wrapped / 60);
  return `${String(hours).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};

/** `08:20` → `500`, ou `null` si ce n'est pas une heure. */
export const parseMinutes = (raw: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 47 || mins > 59) return null;
  return hours * 60 + mins;
};

/**
 * Remet un préréglage en ordre : créneaux triés, vides écartés, chevauchements
 * fusionnés.
 *
 * La fusion n'est pas de la cosmétique. Deux créneaux qui se recouvrent donnent
 * des réponses contradictoires à « suis-je disponible », et un plan qui les lit
 * dans l'ordre du tableau dépendrait de l'ordre de saisie.
 */
export const normaliseWindows = (windows: AvailabilityWindow[]): AvailabilityWindow[] => {
  const clean = windows
    .filter((slot) => Number.isFinite(slot.from) && Number.isFinite(slot.to) && slot.to > slot.from)
    .sort((a, b) => a.from - b.from);

  const merged: AvailabilityWindow[] = [];
  for (const slot of clean) {
    const last = merged[merged.length - 1];
    if (last && slot.from <= last.to) {
      last.to = Math.max(last.to, slot.to);
    } else {
      merged.push({ ...slot });
    }
  }
  return merged.slice(0, MAX_WINDOWS);
};

/** Les heures de présence d'un préréglage, pour l'afficher à côté de son nom. */
export const presetHours = (preset: AvailabilityPreset): number =>
  normaliseWindows(preset.windows).reduce((sum, slot) => sum + (slot.to - slot.from), 0) / 60;

/**
 * Le premier instant à partir de `at` où l'on peut agir, ou `at` si le préréglage
 * n'a aucun créneau.
 *
 * Le jumeau de `Economy::actionable` côté Rust, et il porte la même subtilité :
 * un créneau peut déborder sur le lendemain, donc un instant à minuit trente
 * appartient à un créneau **de la veille**. Ne regarder que le jour courant le
 * manquerait, d'où le passage par la veille.
 */
export const nextActionable = (
  preset: AvailabilityPreset,
  at: Date,
  limitDays = 8
): Date | null => {
  const windows = normaliseWindows(preset.windows);
  if (windows.length === 0) return at;

  const midnight = new Date(at);
  midnight.setHours(0, 0, 0, 0);
  const sinceMidnight = (at.getTime() - midnight.getTime()) / 60_000;

  for (let day = -1; day <= limitDays; day += 1) {
    for (const slot of windows) {
      const from = day * MINUTES_PER_DAY + slot.from;
      const to = day * MINUTES_PER_DAY + slot.to;
      if (to <= sinceMidnight) continue;
      const when = Math.max(from, sinceMidnight);
      return new Date(midnight.getTime() + when * 60_000);
    }
  }
  return null;
};

/** Est-on disponible à cet instant ? */
export const isActionable = (preset: AvailabilityPreset, at: Date): boolean => {
  const next = nextActionable(preset, at);
  return next !== null && next.getTime() <= at.getTime();
};

/**
 * Recolle ce qui vient de la base sur les défauts.
 *
 * Tolérant à dessein, comme `parseFilters` de la page Farm : une forme inconnue
 * ne doit pas vider l'écran, et un champ ajouté depuis la dernière visite ne doit
 * pas casser la relecture. Ce qui n'est pas reconnu est ignoré.
 */
export const parseAvailability = (raw: unknown): AvailabilityState => {
  if (typeof raw !== 'object' || raw === null) return EMPTY_STATE;
  const source = raw as Partial<Record<keyof AvailabilityState, unknown>>;

  const presets: AvailabilityPreset[] = Array.isArray(source.presets)
    ? source.presets
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .map((entry) => ({
          id: typeof entry.id === 'string' ? entry.id : '',
          name: typeof entry.name === 'string' ? entry.name : 'Sans nom',
          windows: Array.isArray(entry.windows)
            ? normaliseWindows(
                entry.windows
                  .filter(
                    (slot): slot is AvailabilityWindow =>
                      typeof slot === 'object' &&
                      slot !== null &&
                      typeof (slot as AvailabilityWindow).from === 'number' &&
                      typeof (slot as AvailabilityWindow).to === 'number'
                  )
                  .map((slot) => ({ from: slot.from, to: slot.to }))
              )
            : [],
        }))
        .filter((preset) => preset.id !== '')
    : [];

  // Un compte sans aucun préréglage lisible repart des exemples : un écran vide
  // ne dit pas quoi faire, et il n'y a rien à perdre à proposer.
  if (presets.length === 0) return EMPTY_STATE;

  const raw_chosen = source.chosen;
  let chosen: AvailabilityState['chosen'] = null;
  if (typeof raw_chosen === 'object' && raw_chosen !== null) {
    const entry = raw_chosen as Record<string, unknown>;
    if (typeof entry.presetId === 'string' && typeof entry.date === 'string') {
      // Un choix qui ne pointe plus sur rien — préréglage supprimé — vaut pas de
      // choix, ce qui redemande plutôt que de planifier sur du vide.
      if (presets.some((preset) => preset.id === entry.presetId)) {
        chosen = { presetId: entry.presetId, date: entry.date };
      }
    }
  }

  return { presets, chosen };
};

/** Le préréglage qui s'applique maintenant, si le choix est celui d'aujourd'hui. */
export const activePreset = (
  state: AvailabilityState,
  at: Date = new Date()
): AvailabilityPreset | null => {
  if (state.chosen === null || state.chosen.date !== today(at)) return null;
  return state.presets.find((preset) => preset.id === state.chosen?.presetId) ?? null;
};
