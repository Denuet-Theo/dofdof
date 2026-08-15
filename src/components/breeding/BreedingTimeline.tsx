'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Dna,
  LogOut,
  Egg,
  Fuel,
  Gem,
  Heart,
  Bell,
  BellOff,
  Pause,
  Play,
  RotateCcw,
  ShoppingCart,
  Trash2,
  Upload,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/Skeleton';
import {
  LEAD_IN_SECONDS,
  RIBBON_SECONDS,
  agenda,
  elapsedSeconds,
  formatCountdown,
  elapsedFor,
  needsLoading,
  blockedOn,
  formatWallClock,
  gaugeChanges,
  isTrackPaused,
  inRibbon,
  isPaused,
  nextAction,
  packLanes,
  parsePlan,
  pausedForSeconds,
  planHorizon,
  samplePlan,
  STABLE_TRACK,
  wallClockAt,
  GAUGE_LABELS,
  type EventKind,
  type GaugeId,
  type PlacedEvent,
  type TimelinePlan,
} from '@/lib/dofus/breeding/timeline';
import {
  MODEL_PLAN_SOURCE,
  modelPlan,
  type ModelPlan,
} from '@/lib/dofus/breeding/model-plan';
import CopyableText from '@/components/ui/CopyableText';
import { chime, unlock } from '@/lib/dofus/breeding/alarm';
import BreedingBirthDialog from '@/components/breeding/BreedingBirthDialog';
import BreedingCloneDialog from '@/components/breeding/BreedingCloneDialog';
import BreedingEnclosExitDialog from '@/components/breeding/BreedingEnclosExitDialog';
import {
  cloningsToRecord,
  couplesToRecord,
  type StablePlan,
} from '@/lib/dofus/breeding/policy';
import type { BirthEntry } from '@/lib/hooks/useBreeding';
import { ANONYMOUS_NAME } from '@/lib/dofus/breeding/naming';
// Les montures que le plan se procure n'ont pas d'identité : la liste de sortie
// leur en fabrique une, dans l'espace de noms que `search.ts` définit.
import { acquiredMountId } from '@/lib/dofus/breeding/search';
import { BULK_MATE_LEVEL } from '@/lib/dofus/breeding/pairing';
import type { Couple, Individual, Sex } from '@/lib/dofus/breeding/stable';
import type { CloneOption } from '@/lib/dofus/breeding/cloning';
import type { ExtractionCandidate } from '@/lib/dofus/breeding/extraction';
import BreedingCloneAdvice from '@/components/breeding/BreedingCloneAdvice';
import BreedingExtraction from '@/components/breeding/BreedingExtraction';
import type { BreedingColor } from '@/lib/dofus/breeding/costs';
import type { BreedingTimelineState } from '@/lib/hooks/useBreedingTimeline';

/**
 * Les douze prochaines heures du parc, et le bouton qui les arrête.
 *
 * ## Deux vues, deux questions
 *
 * Le **ruban** répond à « où sont les trous » : cinq pistes parallèles, les
 * jauges en barres, les gestes en points. C'est la seule forme qui montre qu'un
 * enclos travaille pendant qu'un autre attend — une liste unique les aplatirait
 * en file d'attente alors qu'ils tournent ensemble.
 *
 * L'**agenda** répond à « qu'est-ce que je fais maintenant » : les gestes seuls,
 * dans l'ordre, avec leur compte à rebours. Les jauges en sont absentes et c'est
 * délibéré — trente lignes « le Foudroyeur tourne » noieraient les quatre
 * interventions réelles.
 *
 * ## Le bouton pause n'est pas un confort
 *
 * Partir en week-end, c'est cesser de nourrir les jauges, et une jauge qu'on ne
 * nourrit plus fige sa progression sans rien perdre. La timeline doit faire
 * pareil : au retour, tout ce qui restait à faire est décalé de la durée de
 * l'absence, et rien n'a été « manqué ». Une horloge qui aurait continué de
 * courir afficherait au retour une pile de rendez-vous ratés qui n'ont jamais
 * existé.
 *
 * ## D'où vient le plan
 *
 * Trois entrées, et elles ne se remplacent pas. Le **plan du modèle** est
 * embarqué (`model-plan.ts`) : c'est la sortie du champion, un clic, le cas
 * courant. Le **fichier** sert quand on vient d'en régénérer un. Le **collage**
 * sert quand on bricole un ordonnancement à la main. Toutes passent par
 * `parsePlan`.
 *
 * L'exemple reste en second parce qu'il tient les durées de `schedule.rs`
 * toutes jauges en bande haute : quand le plan du modèle surprend — et il
 * surprend, il laisse les cinq enclos synchronisés en bande basse — c'est à lui
 * qu'on le compare.
 *
 * ## Pourquoi la fournée réelle est ici
 *
 * Le plan du modèle dit **quand** charger l'enclos, et il ne peut pas dire
 * **quoi** : il est joué sur une graine, donc ses montures sont celles d'une
 * partie simulée. « Charger l'enclos ×10 » n'envoie personne devant son coffre.
 *
 * Ce que l'écurie réelle permet de charger, `buildLoadout` le sait et le nomme.
 * Les deux réponses vont ensemble — c'est ce que disait déjà le panneau de
 * fournée avant d'être masqué. On en reprend ici la seule partie qui soit sûre :
 * **ce qu'on sort de l'écurie**. Pas la liste d'achats, qui propose des couleurs
 * qui ne s'achètent pas (#105) et qui est la raison pour laquelle le panneau
 * entier a été retiré.
 */

type Props = {
  timeline: BreedingTimelineState;
  /**
   * Le parc de l'éleveur, qui décide **de quel** plan du modèle on parle.
   *
   * Il y en a un par taille, joué sur cette taille-là : un plan de six enclos
   * montré à qui en possède cinq annonce une piste de trop et des achats qu'il
   * ne peut pas honorer. Voir `model-plan.ts`.
   */
  enclosCount: number;
  /**
   * Ce que la politique entraînée ferait de l'écurie, ou `null` si elle ne peut
   * pas répondre — écurie vide, ou artefact d'une autre arité.
   *
   * C'est la réponse au « quoi » que le plan du modèle laisse ouvert : lui est
   * joué sur une graine, donc ses montures sont celles d'une partie simulée, et
   * « Charger l'enclos ×10 » n'envoie personne devant son coffre. Voir
   * `policy.ts`.
   */
  fill?: StablePlan | null;
  /**
   * Tous les accouplements réalisables maintenant, bouclés jusqu'au point fixe
   * par la page — elle seule tient l'entrée de la politique. Voir #165.
   */
  couples?: Couple[];
  /**
   * Ce que valent les stériles de l'écurie, affiché à l'étape « cloner ». Voir
   * `Fill` et `cloning.ts`.
   */
  cloneAdvice?: CloneOption[];
  /**
   * Toutes les stériles de l'écurie, de la moins intéressante à reproduire à la
   * plus, affichées à l'étape « extraction ». Voir `extraction.ts` : ce n'est pas
   * la même liste que `cloneAdvice`, qui n'énumère que les stériles appariables.
   */
  extraction?: ExtractionCandidate[];
  /** Ambre, neurone ou corne : ce que l'extraction rend dans cette famille. */
  sacrificeName?: string;
  /**
   * Les couleurs et leurs générations, pour la saisie des naissances et des
   * clonages — la fenêtre d'accouplement propose les issues, donc elle a besoin du
   * catalogue et pas seulement des noms.
   */
  colors?: BreedingColor[];
  generations?: Map<string, number>;
  /** Enregistre les naissances saisies. Sans lui, le parcours n'est que lecture. */
  onRecordBirths?: (entries: BirthEntry[]) => Promise<void>;
  /** Enregistre les clonages : deux stériles partent, une fertile entre. */
  onRecordClonings?: (entries: { keep: string; drop: string }[]) => Promise<void>;
  /**
   * Sort les montures de l'enclos : niveaux relevés, lot passé en fécondes.
   *
   * Sans lui, le chargement ne laissait aucune trace en base — et rien ne disait
   * à la politique que le cycle était payé.
   */
  onEnclosExit?: (entries: { id: string; level: number }[]) => Promise<number>;
  nameOf: (colorId: string) => string;
  /**
   * Les montures suivies, pour retrouver leur **nom en jeu**.
   *
   * Une couleur et un sexe suffisent pour le vrac, où les montures sont
   * interchangeables. Dès qu'une monture est suivie, non : deux Doré de même
   * couleur n'ont pas la même ascendance, et le nom est la seule chose que
   * l'écurie du jeu laisse lire. Voir `stable.ts` sur `name`.
   */
  individuals?: Individual[];
};

/* ------------------------------------------------------------ vocabulaire -- */

const KIND_ICON: Record<EventKind, typeof Fuel> = {
  refuel: Fuel,
  buy: ShoppingCart,
  collect: Egg,
  mate: Heart,
  clone: Dna,
  gauge: CalendarClock,
  note: CalendarClock,
};

/** La couleur d'un geste, prise dans les jetons de l'app. */
const KIND_TONE: Record<EventKind, string> = {
  refuel: 'text-kamas',
  buy: 'text-kamas',
  collect: 'text-gain',
  mate: 'text-info',
  clone: 'text-craft',
  gauge: 'text-dark-400',
  note: 'text-dark-500',
};

/**
 * La même teinte en fond, pour les losanges du ruban.
 *
 * Écrite en clair plutôt que dérivée de `KIND_TONE` : Tailwind scanne le source,
 * une classe fabriquée à l'exécution ne serait jamais générée et les points
 * sortiraient transparents.
 */
const KIND_DOT: Record<EventKind, string> = {
  refuel: 'bg-kamas',
  buy: 'bg-kamas',
  collect: 'bg-gain',
  mate: 'bg-info',
  clone: 'bg-craft',
  gauge: 'bg-dark-400',
  note: 'bg-dark-500',
};

/**
 * Le remplissage d'une barre de jauge.
 *
 * Trois teintes et non six : ce qui se lit d'un coup d'œil est le **rôle** de la
 * jauge, pas son nom. Les trois stats sont le chemin critique, la sérénité n'est
 * qu'une manœuvre, et la Mangeoire est le coût caché — celui qui allonge la
 * fournée sans rien rapporter à la génération visée.
 *
 * Volontairement pâles. Une première version les peignait en ambre plein : sur
 * cinq enclos qui tournent douze heures, le ruban devenait un mur orange où le
 * curseur « maintenant » et les gestes à faire — qui sont eux aussi ambre —
 * disparaissaient. Les barres sont la **toile de fond** : elles disent ce qui
 * travaille tout seul, c'est-à-dire précisément ce qui ne réclame rien.
 */
const gaugeFill = (event: PlacedEvent): string => {
  if (event.kind === 'note') return 'bg-dark-800/60 border border-dashed border-dark-600/60';
  switch (event.gauge) {
    case 'foudroyeur':
    case 'dragofesse':
    case 'abreuvoir':
      return 'bg-kamas/12 border border-kamas/20';
    case 'mangeoire':
      return 'bg-info/12 border border-info/20';
    default:
      return 'bg-dark-700/80 border border-dark-600/50';
  }
};

/**
 * La taille d'un losange, par genre.
 *
 * La récupération est plus grosse que le reste : c'est le seul événement qui
 * **rapporte** quelque chose, tout le reste est de l'entretien. Sur une
 * soixantaine de points dans la fenêtre, c'est ce qui permet de repérer les
 * quatre qui comptent sans lire une seule étiquette.
 */
const KIND_SIZE: Record<EventKind, string> = {
  collect: 'w-2.5 h-2.5',
  // Aussi gros que la récupération, parce que c'est le seul autre événement
  // qu'on peut vraiment rater : une jauge en retard se rattrape, une fournée
  // qu'on n'a pas de quoi charger est une fournée perdue.
  buy: 'w-2.5 h-2.5',
  mate: 'w-2 h-2',
  clone: 'w-2 h-2',
  refuel: 'w-1.5 h-1.5',
  gauge: 'w-1.5 h-1.5',
  note: 'w-1.5 h-1.5',
};

/* ------------------------------------------------------------------ ruban -- */

const HOUR = 3600;
/** Les graduations, en heures après « maintenant ». */
const TICKS = [2, 4, 6, 8, 10, 12];

const clamp = (value: number) => Math.min(100, Math.max(0, value));

/** Hauteur d'un couloir de jauge, en pixels. */
const LANE = 13;

/**
 * Largeur en dessous de laquelle on n'écrit plus dans la barre.
 *
 * Le ruban fait au moins 560 px, donc 1 % vaut 5,6 px : un libellé demande une
 * quarantaine de pixels pour dire quelque chose. En dessous, `truncate` produit
 * une bouillie de deux lettres qui se chevauchent d'une barre à l'autre — c'est
 * exactement ce que faisait la première version.
 */
const LABEL_THRESHOLD = 7;

const Ribbon = ({
  plan,
  elapsed,
  elapsedOf,
  paused,
}: {
  plan: TimelinePlan;
  /** L'avance de la piste la plus avancée : c'est elle qui cadre le ruban. */
  elapsed: number;
  /** L'avance d'une piste donnée — un enclos lancé plus tard est plus en retard. */
  elapsedOf: (trackId: string) => number;
  paused: boolean;
}) => {
  const from = elapsed - LEAD_IN_SECONDS;
  const pct = (seconds: number) => ((seconds - from) / RIBBON_SECONDS) * 100;
  /**
   * Un offset de piste, ramené sur l'échelle du ruban.
   *
   * Le ruban a **une** abscisse — sinon on ne verrait plus quel enclos travaille
   * pendant qu'un autre attend — mais chaque piste compte son temps depuis son
   * propre départ. On décale donc ses événements de son retard sur la piste de
   * tête, ce qui les remet tous sur la même horloge murale.
   */
  const shifted = (trackId: string, seconds: number) =>
    seconds + (elapsed - elapsedOf(trackId));
  const nowPct = pct(elapsed);

  /**
   * Les couloirs de chaque piste, rangés sur la piste **entière**.
   *
   * Hors du `useMemo` qui suit, parce qu'il ne dépend pas du temps qui passe :
   * un rangement recalculé sur la seule fenêtre visible ferait sauter les barres
   * d'un couloir à l'autre au fil des minutes.
   */
  const lanes = useMemo(
    () => new Map(plan.tracks.map((track) => [track.id, packLanes(track.events)])),
    [plan]
  );

  // Les événements visibles, regroupés par piste et dans l'ordre du plan : une
  // piste sans rien à faire dans la fenêtre doit rester affichée, sinon les
  // enclos changent de ligne d'une minute à l'autre et on ne suit plus.
  const rows = useMemo(() => {
    const byTrack = new Map<string, PlacedEvent[]>();
    for (const event of inRibbon(plan, elapsedOf)) {
      const list = byTrack.get(event.trackId);
      if (list) list.push(event);
      else byTrack.set(event.trackId, [event]);
    }
    // L'écurie mène le ruban : ses gestes ne dépendent d'aucun enclos et se font
    // tout de suite. La laisser en bas, sous cinq pistes de jauges, enterrait ce
    // par quoi on commence — et c'est justement ce que `plan.rs` émet en tête.
    const ordered = [...plan.tracks].sort(
      (a, b) =>
        Number(b.id === STABLE_TRACK) - Number(a.id === STABLE_TRACK)
    );
    return ordered.map((track) => {
      const trackLanes = lanes.get(track.id) ?? new Map<string, number>();
      return {
        id: track.id,
        label: track.label,
        lanes: trackLanes,
        // La hauteur suit le parallélisme réel de la piste : deux jauges de
        // front sur un enclos, une seule ligne pour l'écurie.
        laneCount: Math.max(1, ...[...trackLanes.values()].map((lane) => lane + 1)),
        events: byTrack.get(track.id) ?? [],
      };
    });
    // `elapsedOf` est recréé à chaque rendu — c'est une fermeture sur `now`, qui
    // bat chaque seconde — donc le mettre en dépendance reviendrait à ne rien
    // mémoïser. `elapsed` change au même rythme et suffit à dire quand recalculer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, elapsed, lanes]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px] relative">
        {/* Graduations et curseur, décalés de la gouttière des libellés
            (w-[4.5rem] + gap-2 = 5rem = left-20). */}
        <div className="absolute inset-y-0 left-20 right-0 pointer-events-none">
          {TICKS.map((hours) => (
            <div
              key={hours}
              className="absolute top-0 bottom-6 w-px bg-dark-700/50"
              style={{ left: `${pct(elapsed + hours * HOUR)}%` }}
            />
          ))}
          <div
            className={`absolute top-0 bottom-6 w-px ${paused ? 'bg-dark-400' : 'bg-kamas'}`}
            style={{ left: `${nowPct}%` }}
          >
            <span
              className={`absolute -top-0.5 -translate-x-1/2 w-1.5 h-1.5 rotate-45 rounded-[1px]
                ${paused ? 'bg-dark-400' : 'bg-kamas'}`}
            />
          </div>
        </div>

        <div className={`space-y-1 ${paused ? 'opacity-60 saturate-50' : ''}`}>
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <span className="w-[4.5rem] shrink-0 text-right text-[11px] text-dark-400 truncate">
                {row.label}
              </span>
              <div
                className="relative flex-1 rounded-lg bg-dark-800/40"
                style={{ height: row.laneCount * LANE + 6 }}
              >
                {row.events.map((event) => {
                  // Un geste est passé dès qu'il est derrière nous ; une barre,
                  // seulement une fois terminée — une jauge en cours n'est pas
                  // du passé, elle tourne.
                  const done = event.at + event.duration < elapsed;
                  // Décalé du retard de sa piste : le ruban a une seule abscisse,
                  // les pistes ont chacune leur départ.
                  const at = shifted(event.trackId, event.at);
                  const left = clamp(pct(at));
                  const width = clamp(pct(at + event.duration)) - left;
                  const title = [event.label, event.detail].filter(Boolean).join(' — ');

                  if (event.duration > 0) {
                    return (
                      <div
                        key={event.id}
                        title={title}
                        className={`absolute rounded-md flex items-center px-1 overflow-hidden
                          ${gaugeFill(event)} ${done ? 'opacity-35' : ''}`}
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(width, 0.4)}%`,
                          top: 3 + (row.lanes.get(event.id) ?? 0) * LANE,
                          height: LANE - 2,
                        }}
                      >
                        {width >= LABEL_THRESHOLD && (
                          <span className="text-[9px] text-dark-400 truncate leading-none">
                            {event.label}
                          </span>
                        )}
                      </div>
                    );
                  }

                  // Les gestes passent par-dessus les couloirs : ils concernent
                  // l'enclos entier, pas une jauge en particulier.
                  return (
                    <span
                      key={event.id}
                      title={title}
                      className={`absolute z-10 top-1/2 -translate-y-1/2 -translate-x-1/2
                        rotate-45 rounded-[2px] ring-2 ring-dark-900
                        ${KIND_SIZE[event.kind]} ${KIND_DOT[event.kind]}
                        ${done ? 'opacity-30' : ''}`}
                      style={{ left: `${left}%` }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* L'axe. « maintenant » n'y figure pas : c'est le curseur qui le porte,
            et le répéter en pied dédoublerait le même repère. */}
        <div className="relative h-6 ml-20">
          {TICKS.map((hours, index) => {
            // La dernière graduation tombe pile au bord droit : centrée, elle
            // déborderait du conteneur et se ferait rogner. On l'ancre à droite
            // plutôt que de la décaler, ce qui est exact au pixel près.
            const last = index === TICKS.length - 1;
            return (
            <span
              key={hours}
              className={`absolute top-1.5 text-[10px] text-dark-600 tabular-nums
                ${last ? '' : '-translate-x-1/2'}`}
              style={last ? { right: 0 } : { left: `${pct(elapsed + hours * HOUR)}%` }}
            >
              +{hours} h
            </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------- agenda -- */

/**
 * Combien de gestes on montre avant de replier.
 *
 * Douze heures de parc en contiennent une trentaine, et les dérouler tous fait
 * du panneau la page entière. Or l'agenda sert à exécuter : ce qu'on lit
 * vraiment est le haut de la pile. Le reste est à un clic, pour les fois où l'on
 * planifie sa soirée plutôt que son quart d'heure.
 */
const AGENDA_PREVIEW = 8;

const Agenda = ({
  events,
  elapsed,
  clock,
  now,
}: {
  events: PlacedEvent[];
  elapsed: number;
  clock: NonNullable<BreedingTimelineState['clock']>;
  now: number;
}) => {
  const [expanded, setExpanded] = useState(false);

  if (events.length === 0) {
    return (
      <p className="text-[11px] text-dark-500 px-1">
        Aucune intervention à faire dans les douze heures qui viennent — le parc tourne seul.
      </p>
    );
  }

  // Les tranches de deux heures, calculées d'un coup plutôt qu'accumulées dans
  // le `map` : une variable mutée pendant le rendu se lit mal et, mémoïsation
  // aidant, ne se rejoue pas forcément dans l'ordre.
  const band = (event: PlacedEvent) => Math.floor((event.at - elapsed) / (2 * HOUR));
  const shown = expanded ? events : events.slice(0, AGENDA_PREVIEW);
  const rows = shown.map((event, index) => ({
    event,
    band: band(event),
    // Une séparation toutes les deux heures : elle donne l'échelle sans qu'on
    // ait à lire chaque compte à rebours pour situer une action.
    opens: index === 0 || band(event) !== band(shown[index - 1]),
  }));

  return (
    <div className="space-y-0.5">
      {rows.map(({ event, band: eventBand, opens }) => {
        const remaining = event.at - elapsed;
        const Icon = KIND_ICON[event.kind];
        const date = wallClockAt(clock, event.at, now);
        const past = remaining < 0;

        return (
          <div key={event.id}>
            {opens && eventBand > 0 && (
              <div className="flex items-center gap-2 pt-2 pb-1">
                <span className="text-[10px] text-dark-600 tabular-nums">
                  +{eventBand * 2} h
                </span>
                <span className="flex-1 h-px bg-dark-700/40" />
              </div>
            )}

            <div
              className={`flex items-center gap-3 px-2 py-1.5 rounded-lg text-xs
                ${past ? 'opacity-45' : 'hover:bg-dark-800/40'}`}
              title={event.detail}
            >
              <span
                className={`w-20 shrink-0 text-right tabular-nums
                  ${past ? 'text-dark-500' : 'text-dark-200 font-medium'}`}
              >
                {formatCountdown(remaining)}
              </span>
              <Icon size={13} className={`shrink-0 ${KIND_TONE[event.kind]}`} />
              <span className="text-dark-200 truncate">{event.label}</span>
              {event.count !== undefined && (
                <span className="text-dark-500 tabular-nums shrink-0">×{event.count}</span>
              )}
              <span className="ml-auto shrink-0 text-[11px] text-dark-500">
                {event.trackLabel}
              </span>
              {/* En pause, aucune heure : une horloge arrêtée ne peut pas dater,
                  et un « 14 h 32 » figé serait le mensonge exact qu'on croit en
                  rouvrant lundi. */}
              <span className="w-10 shrink-0 text-right text-[11px] text-dark-600 tabular-nums">
                {date ? formatWallClock(date) : '—'}
              </span>
            </div>

            {/* La consigne s'affiche, elle ne se survole pas.
                Ailleurs le `detail` explique un geste qu'on comprend déjà par
                son libellé, et le tooltip suffit ; pour ces trois genres il
                **est** la consigne — « acheter 6 montures » n'envoie personne à
                l'HDV, « 2 Muldo Indigo femelle, 2 Muldo Doré femelle » oui.
                Même chose pour le chargement : « Charger l'enclos ×10 » ne dit
                pas quelle part de la fournée tombe ici, et c'est justement ce
                qui empêche de verser les vingt croisements dans le premier
                enclos. Et « Cloner 8 stériles » ne dit pas lesquelles — or deux
                stériles ne se clonent qu'à génération affichée égale, donc le
                choix n'est pas libre et il faut le lire. */}
            {(event.kind === 'buy' || event.kind === 'mate' || event.kind === 'clone') &&
              event.detail && (
              <p
                className={`pl-[6.5rem] pr-2 pb-1 text-[11px] leading-snug text-dark-500
                  ${past ? 'opacity-45' : ''}`}
              >
                {event.detail}
              </p>
            )}
          </div>
        );
      })}

      {events.length > AGENDA_PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 px-2 text-[11px] text-dark-500 hover:text-kamas transition-colors
            cursor-pointer"
        >
          {expanded
            ? 'Replier'
            : `Voir les ${events.length - AGENDA_PREVIEW} gestes suivants`}
        </button>
      )}
    </div>
  );
};

/* -------------------------------------------------------------- fournée ---- */

/**
 * Les quatre gestes de l'écran, et l'ordre dans lequel ils sont **rangés** —
 * qui n'est plus celui dans lequel il faut les faire.
 *
 * L'ordre de lecture reste celui de la partie : on accouple ce qui est fécond, on
 * clone ce qui ne sert plus, on charge l'enclos avec le reste, et on extrait ce
 * qui ne sert plus à rien. Mais chaque onglet est directement cliquable, parce
 * que le matin on n'a le temps que de charger les enclos — et un enclos qu'on n'a
 * pas lancé avant de partir ne tourne pas de la journée, là où un accouplement
 * qu'on n'a pas fait attend sans rien coûter.
 */
type Step = 'mate' | 'clone' | 'load' | 'extract';

const STEPS: { id: Step; label: string; icon: typeof Heart }[] = [
  { id: 'mate', label: 'Accouplement', icon: Heart },
  { id: 'clone', label: 'Clonage', icon: Dna },
  { id: 'load', label: 'Fournée', icon: Egg },
  { id: 'extract', label: 'Extraction', icon: Gem },
];

/**
 * Ce que la politique entraînée ferait de l'écurie, montures nommées.
 *
 * Une fois pour tout le parc, et non sur chaque piste : la fournée se dimensionne
 * sur les places du parc entier (`enclos × 10`), donc la répéter sous les six
 * « Charger l'enclos » ferait lire six fois le même travail — l'erreur exacte que
 * `per_enclos` évite côté Rust.
 *
 * ## Ce n'est plus le plan de recettes
 *
 * Avant, ce cadre déroulait `buildLoadout` : viser telle couleur, donc croiser
 * tels parents. Il répondait à « comment atteindre cette couleur-là ». Ce qu'on
 * lit ici répond à « que faire de cette écurie-ci », sans cible imposée — c'est
 * `policy.ts`, donc la recherche du Rust jouée sur votre écurie et vos prix.
 *
 * D'où quatre familles de gestes et non une seule. Les **accouplements** restent
 * la décision principale ; les **fécondations** sont la nouveauté, et la moins
 * intuitive — mettre une monture en enclos sans la croiser n'est pas un
 * croisement de moins, c'est un croisement de plus au tour suivant, gratuit, dès
 * que le partenaire existe. Les **clonages** et les **achats** suivent.
 *
 * Les sexes sont détaillés partout parce qu'ils ne sont pas interchangeables :
 * deux Doré mâles ne remplacent pas un mâle et une femelle, et c'est devant le
 * coffre qu'on s'en aperçoit.
 */
const Fill = ({
  fill,
  couples,
  cloneAdvice = [],
  extraction = [],
  sacrificeName = 'ambre',
  nameOf,
  individuals = [],
  colors,
  generations,
  onRecordBirths,
  onRecordClonings,
  enclosTracks = [],
  onStartTrack,
  onToggleTrack,
  onEnclosExit,
}: {
  fill: StablePlan;
  /**
   * Tous les accouplements réalisables maintenant, bouclés jusqu'au point fixe
   * par la page. Absent, l'écran retombe sur la tranche de `fill` — ce qui est
   * exactement le défaut de #165, donc c'est un repli, pas un mode.
   */
  couples?: Couple[];
  /**
   * Ce que valent les stériles de l'écurie, et laquelle apparier avec laquelle.
   *
   * À côté de l'étape « cloner » parce que c'est le même geste au même moment. Le
   * ruban dit déjà quels clonages la **politique** a planifiés ; ceci dit ce que
   * tes stériles valent et si mieux vaut les extraire. Voir `cloning.ts`.
   */
  cloneAdvice?: CloneOption[];
  /**
   * Toutes les stériles, classées pour l'extraction — y compris celles qu'aucun
   * clonage n'apparie, qui sont justement celles à vider. Voir `extraction.ts`.
   */
  extraction?: ExtractionCandidate[];
  /** Ambre, neurone ou corne, selon la famille. */
  sacrificeName?: string;
  nameOf: (colorId: string) => string;
  individuals?: Individual[];
  colors?: BreedingColor[];
  generations?: Map<string, number>;
  onRecordBirths?: (entries: BirthEntry[]) => Promise<void>;
  onRecordClonings?: (entries: { keep: string; drop: string }[]) => Promise<void>;
  /** Sortie d'enclos : niveaux relevés, tout le lot passé en fécondes. */
  onEnclosExit?: (entries: { id: string; level: number }[]) => Promise<number>;
  /** Les enclos du plan, leur état, et ce qui les bloque. */
  enclosTracks?: {
    id: string;
    label: string;
    started: boolean;
    paused: boolean;
    blocked: GaugeId | null;
  }[];
  onStartTrack?: (trackId: string) => Promise<void>;
  onToggleTrack?: (trackId: string) => Promise<void>;
}) => {
  /**
   * Quel geste on est en train de faire : accoupler, cloner, charger, extraire.
   *
   * Un seul à l'écran à la fois, parce que chaque phase se fait dans le jeu, une
   * monture à la fois, en cherchant un nom — quatre panneaux ouverts feraient
   * perdre la ligne où l'on en est.
   *
   * ## Mais l'ordre n'est plus imposé
   *
   * C'était un parcours : accoupler, puis cloner, puis charger, avec « passer → »
   * pour avancer d'un cran. L'ordre est le bon quand on a le temps de tout faire,
   * et c'est précisément ce qu'on n'a pas le matin : lancer les fournées prend
   * quelques minutes, les accouplements et les clonages en prennent beaucoup, et
   * les enclos qu'on n'a pas chargés avant de partir ne tournent pas de la
   * journée. Les fournées d'abord n'est donc pas un raccourci, c'est le bon ordre
   * ce matin-là.
   *
   * D'où quatre onglets toujours cliquables plutôt qu'un fil à dérouler. Les
   * enchaînements automatiques restent — une naissance saisie mène au clonage,
   * une sortie d'enclos ramène aux accouplements — parce qu'ils décrivent ce qui
   * vient de devenir possible, et non ce qu'il faut faire ensuite.
   */
  const [step, setStep] = useState<Step>('mate');
  const [open, setOpen] = useState<'mate' | 'clone' | 'exit' | null>(null);

  /**
   * Les montures qui sont en enclos — celles qu'on en sortira.
   *
   * Les parents d'un croisement **qui devaient leur cycle**, plus les
   * fécondations sans croisement. Une monture déjà féconde n'y est jamais entrée
   * (voir la liste de chargement), donc elle n'en sort pas non plus.
   */
  const loaded = useMemo(() => {
    /**
     * Les montures se lisent dans la liste à plat du plan, et non en refiltrant
     * les individus suivis.
     *
     * `flatten` met le vrac **et** les individus dans cette liste, et les indices
     * du plan portent sur elle. Repasser par `individuals` perdait donc tout le
     * vrac : une gen 1 achetée ou capturée n'a pas d'uuid, son identifiant est
     * fabriqué, et aucun individu suivi ne lui correspond. Elle disparaissait de
     * la liste de sortie sans un mot — chargée dans l'enclos, cycle payé, jamais
     * enregistrée comme féconde. La politique la revoyait fertile, lui
     * réservait une place déjà payée, et proposait d'acheter à côté : exactement
     * ce que la migration `breeding_bulk_feconde` était venue empêcher.
     *
     * L'enregistrement suivi reste préféré quand il existe, pour que la ligne
     * affiche le niveau et le nom à jour plutôt que l'instantané du plan.
     */
    const tracked = new Map(individuals.map((mount) => [mount.id, mount]));
    const picked = new Map<string, Individual>();

    const consider = (index: number) => {
      const planned = fill.mounts[index];
      if (planned) {
        const mount = tracked.get(planned.id) ?? planned;
        if (mount.fertile && !mount.cycled) picked.set(mount.id, mount);
        return;
      }

      /**
       * Au-delà de `mounts.length`, l'indice désigne un **achat** — c'est le
       * contrat de `readPlan`, et l'oublier laissait la fournée sortir amputée de
       * tout ce que le plan se procure : 17 montures sur 40 dans une fournée qui
       * en achetait 23.
       *
       * Rien n'enregistre un achat avant cet écran. La monture est donc bâtie
       * ici, telle qu'une gen 1 acquise : fertile, pas encore féconde, sans
       * ascendance — et son identifiant dit qu'elle reste à créer au stock.
       */
      const bought = fill.raw.purchases[index - fill.mounts.length];
      if (!bought) return;
      const [colorId, sex] = bought;
      const id = acquiredMountId(colorId, sex, index - fill.mounts.length);
      picked.set(id, {
        id,
        colorId,
        name: null,
        sex,
        level: BULK_MATE_LEVEL,
        fertile: true,
        cycled: false,
        parents: null,
      });
    };

    for (const [male, female] of fill.raw.crossings) {
      consider(male);
      consider(female);
    }
    for (const index of fill.raw.cycles) consider(index);

    return [...picked.values()];
  }, [fill, individuals]);

  /**
   * Les couleurs déjà sorties du coffre, pointées à la main.
   *
   * Douze lignes se sortent une par une, dans une écurie qui trie autrement, et
   * on s'y perd sans marque — c'est le genre de liste qu'on recommence trois
   * fois.
   *
   * Le pointage ne dure que la visite : il ne décrit pas l'écurie, seulement où
   * on en est de **ce** passage devant le coffre. L'écrire en base en ferait un
   * état à réconcilier — sorti ici, pas là, et le jour où deux onglets ne disent
   * pas la même chose il faudrait trancher pour rien. La clé porte la fournée,
   * donc un plan qui change repart d'une liste vierge au lieu de traîner les
   * coches d'avant.
   */
  const pullKey = fill.pull
    .map((pull) => `${pull.colorId}:${pull.males}:${pull.females}`)
    .join('|');
  const [pulledAt, setPulledAt] = useState<{ key: string; done: string[] }>({
    key: pullKey,
    done: [],
  });
  // Comparée plutôt que remise à zéro par un effet : une fournée qui change rend
  // le pointage caduc à l'instant même, sans un rendu de battement où les coches
  // de l'ancienne liste s'appliqueraient à la nouvelle.
  const pulled = pulledAt.key === pullKey ? pulledAt.done : [];

  const setPulled = (done: string[]) => setPulledAt({ key: pullKey, done });

  const togglePulled = (colorId: string) =>
    setPulled(
      pulled.includes(colorId) ? pulled.filter((id) => id !== colorId) : [...pulled, colorId]
    );

  /**
   * Les accouplements à saisir.
   *
   * `couples` vient de la page, qui seule tient l'entrée de la politique et peut
   * donc boucler jusqu'au point fixe — c'est ce qui empêche la liste de repousser
   * à chaque rafraîchissement (#165). Sans elle, on retombe sur la tranche que le
   * plan porte, qui est ce que faisait cet écran.
   */
  const toRecord = useMemo(() => couples ?? couplesToRecord(fill), [couples, fill]);
  const toClone = useMemo(
    () => (generations ? cloningsToRecord(fill, generations) : []),
    [fill, generations]
  );

  /**
   * Ce qu'on met en enclos : **les nommées d'abord, les anonymes ensuite**.
   *
   * Ce sont deux gestes différents devant le coffre, et les mélanger faisait
   * perdre les deux. Une monture nommée se **cherche** — le nom est le seul repère
   * que l'écurie du jeu donne, d'où le tri alphabétique, qui est celui du jeu.
   * Une anonyme ne se cherche pas : on en prend le compte annoncé dans le tas de
   * sa couleur, et ce qu'il faut alors lire est « cinq Pourpre mâles », pas cinq
   * lignes indiscernables.
   *
   * La liste regroupait tout par nom, `Anonyme` compris. Trois choses s'y
   * perdaient : le vrac de **toutes** les couleurs et des deux sexes fondait en
   * une seule entrée — `flatten` lui fabrique un identifiant qui n'est dans
   * `individuals` par construction — et `'Anonyme'` se classant avant `'G…'`,
   * ce tas passait **devant** les montures nommées, qui sont les seules qu'on ait
   * à chercher. Voir #164.
   */
  const toLoad = useMemo(() => {
    /** Les nommées, par nom : c'est sous ce nom qu'on les trouvera. */
    const named = new Map<string, number>();
    /** Les anonymes, par couleur **et par sexe** : les deux se comptent à part. */
    const anonymous = new Map<string, { colorId: string; sex: Sex; count: number }>();

    const add = (mount: Individual) => {
      // Le nom porté en jeu, et non l'identifiant : une monture de vrac n'a pas
      // de ligne, et une monture née pas encore renommée n'a pas de nom non plus.
      // Les deux se rangent avec les anonymes, ce qu'elles sont réellement.
      const name = individuals.find((entry) => entry.id === mount.id)?.name ?? mount.name;
      if (name) {
        named.set(name, (named.get(name) ?? 0) + 1);
        return;
      }
      const key = `${mount.colorId}|${mount.sex}`;
      const row = anonymous.get(key) ?? { colorId: mount.colorId, sex: mount.sex, count: 0 };
      row.count += 1;
      anonymous.set(key, row);
    };

    for (const [male, female] of fill.raw.crossings) {
      const at = (index: number) => fill.mounts[index];
      // Une féconde ne passe pas par l'enclos : son cycle est payé, elle
      // s'accouple telle quelle. La lister ferait dépenser une place pour rien
      // — et c'est bien ce que le compte dit déjà, puisque `places` ne facture
      // que les parents qui doivent leur cycle.
      for (const index of [male, female]) {
        const mount = at(index);
        if (mount && !mount.cycled) add(mount);
      }
    }
    for (const index of fill.raw.cycles) if (fill.mounts[index]) add(fill.mounts[index]);

    return {
      named: [...named].sort(([a], [b]) => a.localeCompare(b, 'fr')),
      // Par couleur puis mâles avant femelles, comme le reste de l'écran.
      anonymous: [...anonymous.values()].sort(
        (a, b) =>
          nameOf(a.colorId).localeCompare(nameOf(b.colorId), 'fr') || a.sex.localeCompare(b.sex)
      ),
    };
  }, [fill, individuals, nameOf]);
  /**
   * Le nom qu'une monture suivie porte en jeu.
   *
   * L'identifiant de base ne se cherche nulle part : l'écurie du jeu ne le
   * connaît pas. Le seul repère devant l'enclos est le nom, que `naming.ts`
   * fabrique précisément pour porter la généalogie — invisible autrement.
   */
  const nameOfMount = (mountId: string) =>
    individuals.find((mount) => mount.id === mountId)?.name ?? ANONYMOUS_NAME;

  /**
   * Les noms d'un groupe de montures, dédoublonnés.
   *
   * Une ligne charge souvent plusieurs montures d'ascendance identique, dont
   * l'une a été renommée et l'autre pas : elles se comptent, elles ne se
   * répètent pas.
   */
  const mountNames = (ids: string[]): [string, number][] => {
    const counts = new Map<string, number>();
    for (const id of ids) {
      const name = nameOfMount(id);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts];
  };

  /** Un nom à chercher en jeu — copiable, sauf quand il n'y a rien à chercher. */
  const nameChip = (name: string, count: number, key: string) =>
    name === ANONYMOUS_NAME ? (
      <span
        key={key}
        className="text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 text-dark-500"
        title="Monture non renommée : prends-en une dans le tas, elles sont interchangeables."
      >
        {name}
        {count > 1 && ` × ${count}`}
      </span>
    ) : (
      <span key={key} className="inline-flex items-center gap-1">
        <CopyableText
          value={name}
          title={`Copier « ${name} » — le nom à chercher dans l’écurie du jeu`}
        />
        {count > 1 && <span className="text-[10px] text-dark-500">× {count}</span>}
      </span>
    );

  const side = (label: string, colorId: string, ids: string[], key: string) => (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-dark-200">
      {label} {ids.length === 0 ? <em className="not-italic text-dark-400">à procurer</em> : null}
      {nameOf(colorId)}
      {mountNames(ids).map(([name, count]) => nameChip(name, count, `${key}-${name}`))}
    </span>
  );

  /**
   * Une ligne de couple. Extraite parce qu'elle sert deux fois — les immédiats et
   * la fournée — et qu'un copier-coller les aurait laissés diverger.
   */
  const couple = (line: StablePlan['couples'][number], key: string) => (
    <div key={key} className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-dark-300 font-semibold tabular-nums w-8 shrink-0 text-right">
        {line.count} ×
      </span>
      {side('♂', line.male.colorId, line.male.mountIds, `m-${key}`)}
      <span className="text-dark-600">+</span>
      {side('♀', line.female.colorId, line.female.mountIds, `f-${key}`)}
      {line.targetGeneration !== null ? (
        <span
          className="px-1.5 py-0.5 rounded-lg bg-kamas/15 text-kamas text-[10px] font-semibold"
          title={`Une couleur nomme ce rang : le croisement peut produire une génération ${line.targetGeneration}.`}
        >
          GEN. {line.targetGeneration}
        </span>
      ) : (
        /* Deux Ébène visent bien la génération 2, mais aucune recette ne s'écrit
           `[ebene, ebene]` : il n'en sort qu'un Ébène de plus, et aucun géneton.
           Le dire, parce que ça change ce qu'on fait de ses places d'enclos. */
        <span
          className="px-1.5 py-0.5 rounded-lg bg-dark-900/60 text-dark-400 text-[10px] font-semibold"
          title="Aucune couleur ne nomme le rang visé : le croisement recopie une des deux couleurs et ne rend aucun géneton."
        >
          RECOPIE
        </span>
      )}
    </div>
  );

  /** Les couples qui ne coûtent aucune place, ou ceux qui en coûtent. */
  const couplesOf = (places: 0 | 1) =>
    fill.couples.filter((line) => (places === 0 ? line.places === 0 : line.places > 0));

  /**
   * Ce qu'on met réellement en enclos : des **montures**, pas des couples.
   *
   * Le chargement ne se fait pas par paires. On ouvre l'enclos, on y glisse dix
   * montures, et qui s'accouple avec qui se décide après, à la fenêtre
   * d'accouplement — que `BreedingMatingPanel` reproduit déjà. Afficher ici la
   * liste des couples obligeait à la retraduire de tête en liste de montures, et
   * c'est à ce moment-là qu'on charge la mauvaise.
   *
   * Surtout, une **féconde n'a rien à y faire** : son cycle est payé, elle
   * s'accouple telle quelle. Elle apparaissait pourtant dans la liste, du côté
   * d'un couple dont l'autre parent, lui, devait être chargé — et la charger
   * dépense une place pour rien. C'est ce que le compte savait déjà : `places`
   * ne facture que les parents qui doivent leur cycle, si bien que vingt-trois
   * couples tenaient dans quarante places. La liste, elle, ne le disait pas.
   *
   * D'où un décompte par couleur et par sexe : c'est ce qu'on cherche dans
   * l'écurie du jeu, et les noms suivent pour désigner **lesquelles**.
   */
  const loadRows = () => {
    const rows = new Map<
      string,
      { colorId: string; sex: Sex; ids: string[]; buys: number; banked: string[] }
    >();
    const rowFor = (colorId: string, sex: Sex) => {
      const key = `${colorId}|${sex}`;
      const row = rows.get(key) ?? { colorId, sex, ids: [], buys: 0, banked: [] };
      rows.set(key, row);
      return row;
    };

    for (const line of fill.couples) {
      for (const [sex, sideOf] of [
        ['M', line.male],
        ['F', line.female],
      ] as const) {
        // Le cycle est déjà payé : elle ne passe pas par l'enclos.
        if (sideOf.cycled) continue;
        const row = rowFor(sideOf.colorId, sex);
        // Une ligne regroupe les couples de même signature, et une gen 1 achetée
        // porte la même qu'une gen 1 du coffre — même couleur, pas d'ascendance,
        // pas de cycle. Elle peut donc en mêler : ce qui n'est pas nommé est à
        // procurer, et compter `count` entier ferait un total plus grand que les
        // places engagées.
        row.ids.push(...sideOf.mountIds);
        row.buys += Math.max(0, line.count - sideOf.mountIds.length);
      }
    }

    // Les fécondations sans croisement occupent une place chacune et vont dans le
    // même enclos. Les compter ailleurs faisait dire « 38 montures » sous
    // « 40/40 places », deux vrais chiffres qui ne parlent pas de la même chose.
    for (const entry of fill.cycles) {
      for (const id of entry.mountIds) {
        const mount = individuals.find((candidate) => candidate.id === id);
        rowFor(entry.colorId, mount?.sex ?? 'M').banked.push(id);
      }
    }

    return [...rows.values()].sort(
      (a, b) => sizeOfRow(b) - sizeOfRow(a) || nameOf(a.colorId).localeCompare(nameOf(b.colorId))
    );
  };

  /** Combien de montures une ligne de chargement engage, tous régimes confondus. */
  const sizeOfRow = (row: { ids: string[]; buys: number; banked: string[] }) =>
    row.ids.length + row.buys + row.banked.length;

  /**
   * Le total du chargement, et **d'où** viennent les montures.
   *
   * Trois compteurs se contredisaient à l'écran : « 17 montures à mettre en
   * enclos » comptait ce qui sort du coffre sans les montures à procurer, « 38
   * montures » comptait les parents de croisement sans les fécondations, et
   * « 40/40 places » comptait tout. Trois chiffres vrais dont aucun ne disait ce
   * qu'il comptait — et pour l'éleveur devant son parc, il n'y a qu'une question :
   * combien de montures entrent dans l'enclos, et où je les trouve.
   */
  const loadTotals = (() => {
    const rows = loadRows();
    const owned = rows.reduce((total, row) => total + row.ids.length + row.banked.length, 0);
    const buys = rows.reduce((total, row) => total + row.buys, 0);
    return { mounts: owned + buys, owned, buys };
  })();
  const immediate = couplesOf(0).reduce((total, line) => total + line.count, 0);

  const nothing =
    fill.couples.length === 0 &&
    fill.cycles.length === 0 &&
    fill.clonings.length === 0 &&
    fill.purchases.length === 0;

  return (
    <div className="space-y-2 px-3 py-2.5 rounded-xl bg-info/8 border border-info/20">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Heart size={13} className="text-info shrink-0" />
        <span className="text-[11px] text-dark-300">
          Ce que la politique ferait de{' '}
          <strong className="text-dark-100">cette écurie</strong>
        </span>
        <span className="ml-auto text-[11px] text-dark-500 tabular-nums">
          {fill.raw.crossings.length} accouplement{fill.raw.crossings.length > 1 ? 's' : ''} ·{' '}
          {fill.places}/{fill.capacity} places
        </span>
      </div>

      {/* Ce que l'échelle a refusé. Rien n'est retiré en silence : un plan amputé
          sans le dire est ce qui rend un outil impossible à croire, et le motif
          se corrige de deux gestes différents — un couple sans cible est une
          erreur d'appariement, un couple hors plan est un désaccord de route. */}
      {fill.refused.barren + fill.refused.offPlan > 0 && (
        <p className="text-[11px] text-amber-400/80">
          {fill.refused.barren > 0 && (
            <>
              {fill.refused.barren} accouplement{fill.refused.barren > 1 ? 's' : ''} écarté
              {fill.refused.barren > 1 ? 's' : ''} — <strong>rien à gagner</strong> : la cible
              n&apos;est nommée par aucune couleur, donc le croisement recopie l&apos;ascendance
              et stérilise ses deux parents pour zéro géneton.
            </>
          )}
          {fill.refused.offPlan > 0 && (
            <>
              {fill.refused.barren > 0 ? ' ' : ''}
              {fill.refused.offPlan} écarté{fill.refused.offPlan > 1 ? 's' : ''} comme{' '}
              <strong>hors plan</strong> : la cible existe, mais elle ne sert aucun barreau de
              l&apos;échelle.
            </>
          )}
        </p>
      )}

      {/* Les quatre gestes, tous à un clic. C'était un fil à dérouler — accoupler,
          puis cloner, puis charger — et le fil se paie le matin : on n'a le temps
          que des fournées, et il fallait traverser deux étapes pour y arriver. Un
          onglet vide reste cliquable et le dit, ce qui vaut mieux que de le
          sauter automatiquement : la liste des stériles a de la valeur même quand
          la politique ne propose rien. */}
      {colors && (
        <div className="flex flex-wrap items-center gap-1.5">
          {STEPS.map(({ id, label, icon: Icon }) => {
            const count =
              id === 'mate'
                ? toRecord.length
                : id === 'clone'
                  ? toClone.length
                  : id === 'load'
                    ? loadTotals.mounts
                    : extraction.length;
            const active = step === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setStep(id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px]
                  font-medium border transition-all cursor-pointer ${
                    active
                      ? 'bg-kamas/15 text-kamas border-kamas/40'
                      : 'bg-dark-800/80 border-dark-600/50 text-dark-300 hover:border-kamas/40'
                  }`}
              >
                <Icon size={13} />
                {label}
                <span
                  className={`tabular-nums ${
                    // Un zéro se dit mat : l'onglet reste là — on veut pouvoir y
                    // aller pour vérifier — mais il n'appelle pas le regard.
                    count > 0 ? (active ? 'text-kamas' : 'text-dark-200') : 'text-dark-600'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Ce que l'étape en cours demande de faire, et le bouton qui l'ouvre. */}
      {!nothing && colors && step !== 'extract' && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl
          bg-dark-800/60 border border-dark-600/50">
          {step === 'mate' &&
            (toRecord.length > 0 ? (
              <>
                <Button size="sm" variant="primary" onClick={() => setOpen('mate')}>
                  <Heart size={13} />
                  {toRecord.length} reproduction{toRecord.length > 1 ? 's' : ''} à faire
                </Button>
                <span className="text-[11px] text-dark-500">
                  un couple à la fois, avec le nom du poulain à copier
                </span>
              </>
            ) : (
              <span className="text-[11px] text-dark-500">
                Aucun accouplement possible tout de suite — il faut d’abord une fournée
                d’enclos, ou de quoi apparier ce qui en est sorti.
              </span>
            ))}
          {step === 'clone' &&
            (toClone.length > 0 ? (
              <>
                <Button size="sm" variant="primary" onClick={() => setOpen('clone')}>
                  <Dna size={13} />
                  {toClone.length} clonage{toClone.length > 1 ? 's' : ''} à faire
                </Button>
                <span className="text-[11px] text-dark-500">
                  deux stériles, une survivante — c’est toi qui choisis laquelle
                </span>
              </>
            ) : (
              <span className="text-[11px] text-dark-500">
                Aucun clonage à faire — deux stériles ne s’apparient qu’à génération
                affichée égale. Ce qui reste dépareillé est dans « Extraction ».
              </span>
            ))}
          {step === 'load' && (
            <>
              <span className="text-[11px] font-semibold text-dark-200">
                {loadTotals.mounts} montures à mettre en enclos
              </span>
              {/* Le total ne se lisait que sur les noms, donc il ignorait les
                  montures à procurer — « 17 » sous une fournée de quarante
                  places. La liste alphabétique, elle, reste ce qu'elle est : les
                  noms qu'on cherche **dans le coffre**, et rien d'autre ne s'y
                  cherche. */}
              <span className="text-[11px] text-dark-500">
                {toLoad.named.reduce((total, [, count]) => total + count, 0) +
                  toLoad.anonymous.reduce((total, { count }) => total + count, 0)}{' '}
                à chercher dans le coffre, les nommées par ordre alphabétique
                {loadTotals.buys > 0 && ` · ${loadTotals.buys} à procurer`}
              </span>
              {/* La sortie, qui ferme la boucle : sans elle le chargement ne
                  laissait aucune trace, et l'éleveur recochait quarante cases
                  « Féconde » à la main dans Mes stocks — quand il y pensait. */}
              {onEnclosExit && loaded.length > 0 && (
                <Button size="sm" variant="secondary" onClick={() => setOpen('exit')}>
                  <LogOut size={13} />
                  Les sortir de l’enclos
                </Button>
              )}
            </>
          )}
          {/* Un bouton par enclos, et pas un seul pour le parc : on en remplit
              un, on le lance, on passe au suivant. Le temps de chercher les
              montures dans le coffre, le premier a une heure d'avance sur le
              dernier — et c'est cette avance qui décide de l'ordre dans lequel
              on ira les récupérer. */}
          {onStartTrack && enclosTracks.length > 0 && (
            <span className="w-full flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-dark-400">chargé :</span>
              {enclosTracks.map(({ id, label, started, paused, blocked }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => (started ? onToggleTrack?.(id) : onStartTrack(id))}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border
                    transition-all cursor-pointer ${
                      !started
                        ? 'bg-dark-800/80 text-dark-300 border-dark-600/50 hover:border-kamas/50'
                        : paused
                          ? 'bg-dark-900/60 text-dark-400 border-dark-600/50 hover:border-kamas/50'
                          : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:border-emerald-400/60'
                    }`}
                  title={
                    !started
                      ? `Lancer le compteur de ${label} — il vient d’être chargé.`
                      : paused
                        ? `${label} est arrêté. Le relancer.`
                        : blocked
                          ? `${label} attend ${GAUGE_LABELS[blocked]}, qui ne tourne pas sans toi — l’arrêter avant de partir.`
                          : `${label} tourne. Il n’attend qu’une stat, il ira au bout tout seul.`
                  }
                >
                  {label}
                  {started && (paused ? ' ⏸' : blocked ? ' ⚠' : ' ✓')}
                </button>
              ))}
            </span>
          )}
          {/* Les liens « ← revenir » et « passer → » ont disparu : les onglets
              au-dessus vont partout, dans les deux sens, et en un clic. C'est le
              même besoin que #167 — une étape dépassée devait pouvoir se rouvrir
              — mais réglé par la navigation plutôt que par un chemin. */}
        </div>
      )}

      {/* La liste de chargement, quand on y est. Les nommées d'abord — des noms à
          chercher, triés comme l'écurie du jeu les trie — puis les anonymes, qui
          ne se cherchent pas : elles se comptent dans le tas de leur couleur. */}
      {/* Ce que valent les stériles, à l'étape où on les clone. */}
      {step === 'clone' && (
        <BreedingCloneAdvice
          clonings={cloneAdvice}
          nameOf={nameOf}
          individuals={individuals}
        />
      )}

      {/* L'extraction, qui n'attend pas que la politique ait quelque chose à
          proposer : une écurie sans monture fertile est justement celle qui a le
          plus de stériles à vider. */}
      {step === 'extract' && (
        <BreedingExtraction
          candidates={extraction}
          nameOf={nameOf}
          individuals={individuals}
          resourceName={sacrificeName}
        />
      )}

      {step === 'load' && (toLoad.named.length > 0 || toLoad.anonymous.length > 0) && (
        <div className="flex flex-col gap-1.5 px-3 py-2 rounded-xl
          bg-emerald-500/5 border border-emerald-500/20">
          {toLoad.named.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {toLoad.named.map(([name, count]) => (
                <span key={name} className="inline-flex items-center gap-1">
                  <CopyableText value={name} title={`Copier « ${name} »`} />
                  {count > 1 && <span className="text-[10px] text-dark-500">× {count}</span>}
                </span>
              ))}
            </div>
          )}
          {toLoad.anonymous.length > 0 && (
            <div
              className={`flex flex-wrap gap-x-3 gap-y-1 ${
                // Le trait ne sépare que s'il y a deux blocs à séparer.
                toLoad.named.length > 0 ? 'pt-1.5 border-t border-emerald-500/15' : ''
              }`}
            >
              {toLoad.anonymous.map(({ colorId, sex, count }) => (
                <span
                  key={`${colorId}|${sex}`}
                  className="text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 text-dark-400"
                  // Le nom du tas où aller les prendre : elles n'en ont pas d'autre.
                  title={`${count} ${nameOf(colorId)} ${sex === 'M' ? 'mâle' : 'femelle'} sans nom`}
                >
                  <span className="text-dark-200">{count}</span> {nameOf(colorId)}{' '}
                  {sex === 'M' ? 'mâle' : 'femelle'}
                  {count > 1 ? 's' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {colors && onRecordBirths && (
        <BreedingBirthDialog
          isOpen={open === 'mate'}
          onClose={() => setOpen(null)}
          couples={toRecord}
          individuals={individuals}
          colors={colors}
          nameOf={nameOf}
          onRecord={async (entries) => {
            await onRecordBirths(entries);
            setStep('clone');
          }}
        />
      )}
      {colors && onEnclosExit && (
        <BreedingEnclosExitDialog
          isOpen={open === 'exit'}
          onClose={() => setOpen(null)}
          mounts={loaded}
          colors={colors}
          nameOf={nameOf}
          onConfirm={async (entries) => {
            const written = await onEnclosExit(entries);
            // Une fournée qui sort de l'enclos en ressort **féconde** : c'est
            // exactement le moment où de nouveaux accouplements deviennent
            // possibles. Rester sur « charger » — l'étape qui vient de se vider —
            // était le second verrou de #167 : plus rien n'y était actionnable, et
            // la seule façon d'en sortir était de recharger la page.
            if (written > 0) setStep('mate');
            return written;
          }}
        />
      )}
      {colors && (
        <BreedingCloneDialog
          isOpen={open === 'clone'}
          onClose={() => setOpen(null)}
          clonings={toClone}
          individuals={individuals}
          colors={colors}
          nameOf={nameOf}
          onRecord={async (entries) => {
            await onRecordClonings?.(entries);
            setStep('load');
          }}
        />
      )}

      {/* Le récapitulatif de la fournée ne suit pas l'onglet « Extraction » : il
          décrit ce que la politique fait des **fertiles**, et l'extraction ne
          parle que des stériles. Les deux à l'écran ensemble donneraient deux
          listes de montures qui ne se recoupent jamais. */}
      {step === 'extract' ? null : nothing ? (
        /* Une fournée vide se dit, plutôt que de laisser un cadre vide qu'on
           prendrait pour un défaut d'affichage. C'est le cas quand l'écurie n'a
           aucune monture fertile, ou quand aucun prix n'est saisi — la politique
           ne voit alors rien qui vaille quoi que ce soit. */
        <p className="text-[11px] text-dark-500">
          La politique ne propose rien sur cette écurie : soit elle n’a plus de monture fertile,
          soit les prix ne sont pas saisis et tout lui paraît sans valeur.
        </p>
      ) : (
        <>
          {/* Les couples, et non seulement les couleurs. L'appariement **est** la
              consigne : quel mâle avec quelle femelle, et laquelle nommément dès
              qu'elle est suivie — deux montures de même couleur n'ont pas la
              même ascendance, et c'est l'ascendance qui décide de ce que le
              croisement vise. */}
          {couplesOf(0).length > 0 && (
            <div className="space-y-0.5">
              {/* Ce qui ne demande rien : les deux parents sont déjà féconds, donc
                  l'accouplement est un clic. En tête parce que c'est ce qu'on fait
                  en ouvrant le jeu, avant même de penser à l'enclos ou à l'hôtel de
                  vente — le ruban range la piste « Écurie » en premier pour la même
                  raison. */}
              <div className="flex items-center gap-2 pt-0.5">
                <span className="text-[11px] font-semibold text-emerald-300">
                  D’abord, sans enclos
                </span>
                <span className="text-[10px] text-dark-500">
                  {immediate} accouplement{immediate > 1 ? 's' : ''} d’un clic, avec ce que tu as
                </span>
              </div>
              {couplesOf(0).map((line, index) => couple(line, `now-${index}`))}
            </div>
          )}

          {couplesOf(1).length > 0 && (
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 pt-1 border-t border-info/15">
                <span className="text-[11px] font-semibold text-dark-300">
                  Puis la fournée à charger
                </span>
                <span className="text-[10px] text-dark-500 tabular-nums">
                  {loadTotals.mounts} monture{loadTotals.mounts > 1 ? 's' : ''} ·{' '}
                  {fill.places}/{fill.capacity} places d’enclos
                </span>
                {/* La décomposition, parce que les deux moitiés ne se cherchent
                    pas au même endroit : l’une est dans le coffre, l’autre à
                    l’hôtel de vente ou au filet. */}
                <span className="text-[10px] text-dark-500">
                  {loadTotals.owned} du coffre
                  {loadTotals.buys > 0 && ` · ${loadTotals.buys} à procurer`}
                </span>
                <span
                  className="text-[10px] text-dark-600"
                  title="Les fécondes n'y sont pas : leur cycle est payé, elles s'accouplent sans repasser par l'enclos. Qui s'accouple avec qui se décide après, à la fenêtre d'accouplement. Si le compte des montures est en deçà des places, la différence est en bas : les fécondations sans croisement, qui occupent une place chacune."
                >
                  fécondes exclues
                </span>
              </div>
              {loadRows().map((row) => (
                <div
                  key={`${row.colorId}-${row.sex}`}
                  className="flex flex-wrap items-center gap-2 text-xs"
                >
                  <span className="text-dark-300 font-semibold tabular-nums w-8 shrink-0 text-right">
                    {sizeOfRow(row)} ×
                  </span>
                  <span
                    className={row.sex === 'M' ? 'text-info' : 'text-loss-light'}
                    title={row.sex === 'M' ? 'Mâle' : 'Femelle'}
                  >
                    {row.sex === 'M' ? '♂' : '♀'}
                  </span>
                  <span className="text-dark-200">{nameOf(row.colorId)}</span>
                  {row.buys > 0 && (
                    <em className="not-italic text-dark-400">
                      dont {row.buys} à procurer — achat ou capture
                    </em>
                  )}
                  {row.banked.length > 0 && (
                    <em
                      className="not-italic text-dark-400"
                      title="En enclos sans croiser : elle en sort féconde et reste en écurie."
                    >
                      dont {row.banked.length} à féconder sans croiser
                    </em>
                  )}
                  {mountNames([...row.ids, ...row.banked]).map(([name, count]) =>
                    nameChip(name, count, `load-${row.colorId}-${row.sex}-${name}`)
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Les fécondations. Le geste le moins intuitif du lot, d'où la
              formulation longue : on met la monture en enclos et on ne la croise
              pas, ce qui n'a l'air d'un gâchis que tant qu'on oublie que la
              fécondité ne se perd qu'à la naissance. */}
          {fill.cycles.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 border-t border-info/15 text-xs">
              <span
                className="text-[11px] text-dark-400"
                title="En enclos sans croiser : elles en sortent fécondes et restent en écurie. C'est un croisement gratuit au tour suivant, dès que le partenaire existe."
              >
                À féconder sans croiser
              </span>
              {fill.cycles.map((entry) => (
                <span
                  key={entry.colorId}
                  className="inline-flex flex-wrap items-center gap-1.5 text-dark-200"
                >
                  {nameOf(entry.colorId)}
                  <span className="text-dark-100 tabular-nums font-semibold">
                    ×{entry.mountIds.length}
                  </span>
                  {mountNames(entry.mountIds).map(([name, count]) =>
                    nameChip(name, count, `c-${entry.colorId}-${name}`)
                  )}
                </span>
              ))}
            </div>
          )}

          {fill.clonings.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 border-t border-info/15 text-xs">
              <span
                className="text-[11px] text-dark-400"
                title="Deux stériles ne se clonent qu'à génération affichée égale : le choix n'est pas libre."
              >
                À cloner
              </span>
              {/* Les montures, et non « une paire ». Un clonage se fait dans le
                  jeu en désignant deux stériles précises : « gén. 3, 1 paire »
                  oblige à retrouver soi-même lesquelles, parmi toutes celles de
                  ce rang, alors que le plan les a déjà choisies. Les noms
                  suivent l'ordre des paires — deux d'affilée sont les deux
                  côtés d'un même clonage. */}
              {fill.clonings.map((entry) => (
                <span
                  key={entry.generation}
                  className="inline-flex flex-wrap items-center gap-1.5 text-dark-200"
                >
                  gén. {entry.generation}
                  <span className="text-dark-100 tabular-nums font-semibold">
                    {entry.mountIds.length / 2} paire{entry.mountIds.length > 2 ? 's' : ''}
                  </span>
                  {mountNames(entry.mountIds).map(([name, count]) =>
                    nameChip(name, count, `k-${entry.generation}-${name}`)
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Les achats n'ont plus de liste à eux. Chaque monture à acheter est
              déjà nommée « à acheter » dans la fournée, à la ligne où elle sert,
              et c'est la seule forme utile : ce qu'on veut savoir devant l'hôtel
              de vente, c'est pour quel croisement on achète, pas un total qui
              oblige à revenir en arrière pour retrouver lequel. Le total reste
              dans `fill.purchases` pour qui en a besoin — voir le budget. */}

          {/* Le récapitulatif par couleur, qui se lit devant le coffre : on y va
              une fois, pas une fois par couple. Chaque ligne se coche à mesure
              qu'on la sort — voir `pulled`. */}
          {fill.pull.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 border-t border-info/15">
              <span className="text-[11px] text-dark-400">
                À sortir de l&apos;écurie
                <span className="text-dark-600 tabular-nums">
                  {' '}
                  {pulled.length}/{fill.pull.length}
                </span>
              </span>
              {fill.pull.map((pull) => {
                const out = pulled.includes(pull.colorId);
                return (
                  <button
                    key={pull.colorId}
                    type="button"
                    onClick={() => togglePulled(pull.colorId)}
                    title={
                      out
                        ? 'Sortie du coffre. Clique pour la remettre dans la liste.'
                        : 'Clique quand tu l’as sortie du coffre.'
                    }
                    className={`text-xs cursor-pointer transition-colors ${
                      out ? 'text-dark-600 line-through' : 'text-dark-300 hover:text-dark-100'
                    }`}
                  >
                    {out && <Check size={11} className="inline -mt-0.5 mr-0.5 text-gain" />}
                    {nameOf(pull.colorId)}{' '}
                    <span
                      className={`tabular-nums font-semibold ${out ? '' : 'text-dark-100'}`}
                    >
                      {pull.males > 0 && `${pull.males}♂`}
                      {pull.males > 0 && pull.females > 0 && ' '}
                      {pull.females > 0 && `${pull.females}♀`}
                    </span>
                    {pull.exhausts && (
                      <span
                        className={`text-[10px] ${out ? 'text-dark-600' : 'text-amber-400/70'}`}
                        title="La fournée vide cette couleur : il n'en restera aucune fertile."
                      >
                        {' '}
                        vidée
                      </span>
                    )}
                  </button>
                );
              })}
              {pulled.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPulled([])}
                  className="text-[10px] text-dark-500 hover:text-dark-300 cursor-pointer
                    transition-colors"
                >
                  tout décocher
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

/* ------------------------------------------------------------ chargement --- */

/**
 * Le chargement d'un plan, tant que le modèle ne le pousse pas lui-même.
 *
 * Trois entrées, et elles ne se remplacent pas : le plan **embarqué** du
 * champion pour le cas courant, un fichier pour celui qu'on vient de
 * régénérer, un collage pour l'ordonnancement qu'on bricole. Toutes passent par
 * `parsePlan`, donc une erreur de format se dit ici plutôt que de produire un
 * ruban vide.
 */
const PlanLoader = ({
  onLoad,
  fromModel,
  compact = false,
  actions,
}: {
  onLoad: (plan: TimelinePlan) => void;
  /**
   * Le plan du champion pour le parc courant, ou `null` s'il ne passe plus le
   * contrat — ou n'est pas encore arrivé, puisqu'il se charge à la demande.
   */
  fromModel?: ModelPlan | null;
  compact?: boolean;
  /**
   * Ce qui accompagne le déclencheur sur sa ligne.
   *
   * Passé en contenu plutôt que posé à côté dans la page : le panneau déplié
   * doit occuper toute la largeur, ce qu'il ne peut pas faire s'il est enfermé
   * dans une colonne de la barre d'actions — le collage de JSON s'y retrouvait
   * dans un champ de trois centimètres.
   */
  actions?: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const accept = (raw: string) => {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      setProblem("Ce n'est pas du JSON valide.");
      return;
    }

    const result = parsePlan(parsedJson);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    setProblem(null);
    setText('');
    setOpen(false);
    onLoad(result.plan);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen((value) => !value)}>
          <Upload size={13} />
          {open ? 'Fermer' : 'Importer un plan'}
        </Button>
        {/* Le plan du modèle passe devant l'exemple : c'est la réponse, l'autre
            n'était que la maquette qui a permis de juger l'écran avant qu'elle
            existe. L'exemple reste, en second, parce qu'il tient les durées de
            `schedule.rs` en bande haute et sert donc de repère quand le plan du
            modèle surprend. */}
        {!compact && (
          <>
            {fromModel && (
              <Button size="sm" onClick={() => onLoad(fromModel.plan)}>
                <CalendarClock size={13} />
                Charger le plan du modèle — {fromModel.enclos} enclos
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => onLoad(samplePlan())}>
              Charger l’exemple
            </Button>
          </>
        )}
        {actions}
      </div>

      {open && (
        <div className="space-y-2 p-3 rounded-xl bg-dark-800/40 border border-dark-700/50">
          {/* Le champ natif est masqué et piloté par son étiquette : le libellé
              de son bouton vient de la locale du navigateur, pas de la page, et
              affichait « Choose File » au milieu d'un écran français. */}
          <label
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-700
              text-dark-200 text-[11px] cursor-pointer hover:bg-dark-600 transition-colors"
          >
            <Upload size={12} />
            Choisir un fichier
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) accept(await file.text());
                // Réinitialisé pour que recharger le **même** fichier après une
                // correction déclenche bien un nouvel événement.
                if (fileInput.current) fileInput.current.value = '';
              }}
              className="hidden"
            />
          </label>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder='{ "version": 1, "tracks": [ … ] }'
            rows={4}
            className="w-full px-3 py-2 rounded-lg bg-dark-900/60 border border-dark-600/50
              text-dark-200 text-[11px] font-mono transition-all hover:border-dark-500
              focus:border-kamas/50 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={text.trim() === ''} onClick={() => accept(text)}>
              Charger
            </Button>
            <span className="text-[10px] text-dark-600">
              Contrat dans <code>lib/dofus/breeding/timeline.ts</code>.
            </span>
          </div>
          {problem && (
            <p className="flex items-start gap-1.5 text-[11px] text-loss">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {problem}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------- le panneau - */

const BreedingTimeline = ({
  timeline,
  enclosCount,
  fill,
  couples,
  cloneAdvice,
  extraction,
  sacrificeName,
  nameOf,
  individuals,
  colors,
  generations,
  onRecordBirths,
  onRecordClonings,
  onEnclosExit,
}: Props) => {
  const { plan, clock, now, loading, error, load, pause, resume, restart, clear } = timeline;

  /**
   * Le plan du modèle pour ce parc-là, chargé à la demande.
   *
   * Les douze tailles pèsent 748 Ko à elles toutes : les importer d'un bloc
   * ferait payer à chaque visite onze plans que personne ne lira. Un import
   * dynamique n'apporte que celui du parc courant, au prix d'un état — le
   * bouton apparaît un instant après le reste, ce qui est sans conséquence sur
   * un écran qu'on vient consulter.
   */
  const [fromModel, setFromModel] = useState<ModelPlan | null>(null);

  /**
   * Le rappel sonore, une minute avant qu'une jauge change.
   *
   * Éteint par défaut, et pas seulement par politesse : aucun navigateur ne laisse
   * partir un son avant un geste de l'utilisateur, donc un réglage « allumé » au
   * chargement serait un mensonge — le premier rappel ne sonnerait pas.
   */
  const [alerting, setAlerting] = useState(false);
  /**
   * Le dernier changement annoncé, pour ne pas sonner à chaque battement
   * d'horloge. Un instant du plan, en secondes — donc stable d'un rendu à l'autre,
   * là où une date le serait moins.
   */
  const rung = useRef<number | null>(null);

  useEffect(() => {
    let current = true;
    modelPlan(enclosCount).then((loaded) => {
      if (current) setFromModel(loaded);
    });
    return () => {
      // Changer d'enclos pendant le chargement doit laisser gagner la dernière
      // demande, pas la plus lente.
      current = false;
    };
  }, [enclosCount]);

  /**
   * Les bascules de jauge du plan courant, calculées une fois.
   *
   * Elles ne bougent qu'avec le plan, alors que l'horloge bat chaque seconde :
   * les recalculer à chaque tic ferait parcourir toutes les pistes soixante fois
   * par minute pour un résultat identique.
   */
  const changes = useMemo(() => (plan ? gaugeChanges(plan) : []), [plan]);

  useEffect(() => {
    if (!alerting || !clock || now === null || isPaused(clock)) return;
    const elapsed = elapsedSeconds(clock, now);
    // Le prochain changement à venir, et la fenêtre d'une minute avant lui. La
    // borne basse évite de sonner pour un changement qu'on a déjà dépassé quand
    // l'onglet revient au premier plan après une longue absence.
    const next = changes.find((at) => at > elapsed);
    if (next === undefined) return;
    const remaining = next - elapsed;
    if (remaining > 60 || remaining < 0) return;
    if (rung.current === next) return;
    rung.current = next;
    chime();
  }, [alerting, changes, clock, now]);

  // `now` reste nul jusqu'au montage — voir `useBreedingTimeline` sur l'écart
  // d'hydratation qu'un `Date.now()` initial produirait.
  if (loading || now === null) {
    return (
      <div className="glass rounded-2xl px-5 py-4 space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-7 w-full" count={3} />
      </div>
    );
  }

  if (!plan || !clock) {
    return (
      <div className="glass rounded-2xl px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarClock size={15} className="text-kamas" />
          <span className="text-sm font-semibold text-dark-200">Les 12 prochaines heures</span>
          <span className="text-xs text-dark-500">
            quand recharger, quand récupérer — et le bouton pour tout arrêter
          </span>
        </div>
        <p className="text-[11px] text-dark-500">
          {fromModel ? (
            <>
              Aucun plan chargé. Celui du modèle est joué sur{' '}
              <strong>
                {fromModel.enclos} enclos
                {fromModel.enclos !== enclosCount && ` — le plus proche de tes ${enclosCount}`}
              </strong>
              , tient {((fromModel.plan.horizon ?? planHorizon(fromModel.plan)) / 3600).toFixed(0)}{' '}
              h, et la même politique vaut{' '}
              {(MODEL_PLAN_SOURCE.sealedMedian / 1e6).toFixed(0)} M de kamas médians à{' '}
              {MODEL_PLAN_SOURCE.sealedEnclos} enclos sur les graines scellées, contre 72 M pour
              l’heuristique gloutonne.
            </>
          ) : (
            <>
              Aucun plan chargé, et celui du modèle ne passe plus le contrat — il a été émis
              avant un changement de format. Le régénérer&nbsp;: <code>plan.exe</code>, puis{' '}
              <code>scripts/check-plan.mjs</code>.
            </>
          )}
        </p>
        {error && (
          <p className="flex items-start gap-1.5 text-[11px] text-loss">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        <PlanLoader onLoad={load} fromModel={fromModel} />
      </div>
    );
  }

  const paused = isPaused(clock);
  const elapsed = elapsedSeconds(clock, now);
  /**
   * Le temps écoulé **pour une piste**, qui peut avoir son propre départ.
   *
   * Un enclos se lance quand il finit d'être chargé, donc le premier a souvent une
   * heure d'avance sur le dernier. Tout ce qui se lit sur le ruban, dans l'agenda
   * ou dans le rappel sonore doit passer par ici — sinon chaque enclos serait
   * affiché avec l'avance d'un autre.
   */
  const elapsedOf = (trackId: string) => elapsedFor(clock, trackId, now);
  /**
   * L'avance de la piste la plus avancée : c'est elle qui cadre le ruban.
   *
   * Prendre l'horloge du plan ferait sortir du cadre les enclos lancés plus tôt,
   * qui sont pourtant ceux qu'on va récupérer en premier.
   */
  /**
   * Les enclos du plan, et ceux que l'éleveur a déclarés chargés.
   *
   * Tant qu'aucun ne l'est, la fournée **n'a pas commencé** : le plan est affiché,
   * rien n'est en jeu. Le ruban le disait pourtant en marche, parce que son
   * horloge partait à l'affichage.
   */
  const loadable = plan.tracks.filter((track) => needsLoading(track.id));
  const loadedTracks = loadable.filter((track) => clock.tracks?.[track.id] !== undefined);
  const running = loadable.length === 0 || loadedTracks.length > 0;

  /**
   * L'avance de la piste la plus avancée : c'est elle qui cadre le ruban.
   *
   * Sur un plan à enclos, elle se lit sur les enclos **chargés** et non sur
   * l'horloge du plan — sans quoi un parc à moitié rempli ferait courir le cadre
   * sur des enclos vides.
   */
  const leading = running
    ? Math.max(
        loadable.length === 0 ? elapsed : 0,
        ...plan.tracks.map((track) => elapsedOf(track.id))
      )
    : 0;
  const horizon = planHorizon(plan);
  const upcoming = agenda(plan, elapsedOf);
  const next = nextAction(plan, elapsedOf);
  const nextDate = next ? wallClockAt(clock, next.at, now) : null;
  const NextIcon = next ? KIND_ICON[next.kind] : CalendarClock;
  // Épuisée se lit sur la piste la plus avancée, pas sur l'horloge du plan : une
  // fournée jamais chargée n'est pas finie, elle n'a pas commencé.
  const exhausted = running && leading >= horizon;

  return (
    <div className="glass rounded-2xl px-5 py-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock size={15} className="text-kamas" />
        <span className="text-sm font-semibold text-dark-200">Les 12 prochaines heures</span>
        {plan.label && <span className="text-xs text-dark-500 truncate">{plan.label}</span>}

        <div className="ml-auto flex items-center gap-2">
          {/* « Démarrée il y a 3 h » sur une fournée que personne n'a chargée
              était le mensonge le plus coûteux du ruban : tout ce qui suit —
              agenda, rappel, heure de récupération — en découlait. */}
          <span
            className={`text-[11px] tabular-nums ${running ? 'text-dark-500' : 'text-amber-400/80'}`}
            title={
              running
                ? undefined
                : 'Le compte à rebours part quand tu déclares un enclos chargé, pas quand le plan s’affiche.'
            }
          >
            {!running
              ? 'pas encore chargée'
              : paused
                ? 'en pause'
                : `démarrée il y a ${formatCountdown(leading)}`}
          </span>
          {/* Le rappel sonore. L'activation **est** le geste que le navigateur
              exige avant tout son : on réveille le contexte audio là, pas au
              premier rappel, sinon celui-là serait muet. */}
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              if (alerting) {
                setAlerting(false);
                return;
              }
              const ready = await unlock();
              setAlerting(ready);
              // Sonner une fois à l'activation : c'est le seul moyen de savoir que
              // le son passe, et à quel volume, avant de compter dessus.
              if (ready) chime();
            }}
            title={
              alerting
                ? 'Rappel sonore actif : deux notes une minute avant chaque changement de jauge.'
                : 'Sonner une minute avant chaque changement de jauge.'
            }
          >
            {alerting ? <Bell size={13} /> : <BellOff size={13} />}
            {alerting ? 'Rappel actif' : 'Rappel'}
          </Button>

          {/* Le seul bouton qui compte, donc le seul en teinte pleine. */}
          <Button size="sm" variant={paused ? 'primary' : 'secondary'} onClick={paused ? resume : pause}>
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? 'Reprendre' : 'Mettre en pause'}
          </Button>
        </div>
      </div>

      {/* Ce que la pause fait, dit en toutes lettres : c'est la question qu'on
          se pose en la déclenchant un vendredi soir. */}
      {paused && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 rounded-xl
          bg-dark-800/60 border border-dark-600/50 text-[11px]">
          <Pause size={12} className="text-dark-300 shrink-0" />
          <span className="text-dark-200">
            Timeline arrêtée depuis{' '}
            <strong className="text-dark-100">
              {formatCountdown(pausedForSeconds(clock, now))}
            </strong>
            .
          </span>
          <span className="text-dark-500">
            Rien ne court : à la reprise, tout ce qui restait sera décalé d’autant. Les jauges
            se figent sans se vider, donc le parc t’attend là où tu l’as laissé.
          </span>
        </div>
      )}

      {/* Le prochain geste, sorti du lot. C'est la seule ligne qu'on vient lire
          quand on ouvre l'écran entre deux allers-retours en jeu. */}
      {next && !paused && (
        <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-xl bg-kamas/10">
          <NextIcon size={16} className={KIND_TONE[next.kind]} />
          <span className="text-sm text-dark-100 font-medium">{next.label}</span>
          <span className="text-xs text-dark-400">{next.trackLabel}</span>
          <span className="ml-auto text-sm text-kamas font-semibold tabular-nums">
            {next.at < elapsed ? 'maintenant' : `dans ${formatCountdown(next.at - elapsed)}`}
          </span>
          {nextDate && (
            <span className="text-[11px] text-dark-500 tabular-nums">
              {formatWallClock(nextDate)}
            </span>
          )}
        </div>
      )}

      <Ribbon plan={plan} elapsed={leading} elapsedOf={elapsedOf} paused={paused} />

      {/* Entre le ruban et l'agenda : le ruban dit quand l'enclos se recharge,
          l'agenda égrène les gestes, et c'est entre les deux qu'on se demande ce
          qu'on met dedans. Absent quand aucune couleur n'a de plan — il n'y a
          alors rien à charger, et l'annoncer serait inventer une consigne. */}
      {fill && (
        <Fill
          fill={fill}
          couples={couples}
          cloneAdvice={cloneAdvice}
          extraction={extraction}
          sacrificeName={sacrificeName}
          nameOf={nameOf}
          individuals={individuals}
          colors={colors}
          generations={generations}
          onRecordBirths={onRecordBirths}
          onRecordClonings={onRecordClonings}
          onEnclosExit={onEnclosExit}
          enclosTracks={plan.tracks
            .filter((track) => track.id.startsWith('enclos'))
            .map((track) => ({
              id: track.id,
              label: track.label,
              started: clock.tracks?.[track.id] !== undefined,
              paused: isTrackPaused(clock, track.id),
              // La jauge qui la bloque, s'il y en a une : c'est la question qu'on
              // se pose à l'heure du coucher.
              blocked: blockedOn(plan, track.id, elapsedOf(track.id)),
            }))}
          onStartTrack={timeline.startTrack}
          onToggleTrack={timeline.toggleTrack}
        />
      )}

      <Agenda events={upcoming} elapsed={elapsed} clock={clock} now={now} />

      {/* Un plan épuisé se dit, plutôt que de s'afficher comme un ruban vide
          qu'on prendrait pour « rien à faire ». */}
      {exhausted && (
        <p className="text-[11px] text-amber-400/80">
          Le plan ne porte plus au-delà d’ici — il couvrait {formatCountdown(horizon)}. Relance-le
          ou charges-en un nouveau.
        </p>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-loss">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="pt-3 border-t border-dark-700/40">
        <PlanLoader
          onLoad={load}
          fromModel={fromModel}
          compact
          actions={
            <span className="ml-auto flex items-center gap-3">
              <button
                type="button"
                onClick={restart}
                className="flex items-center gap-1.5 text-[11px] text-dark-500 hover:text-dark-300
                  transition-colors cursor-pointer"
                title="Repartir du début du même plan, pauses remises à zéro."
              >
                <RotateCcw size={12} />
                Relancer
              </button>
              <button
                type="button"
                onClick={clear}
                className="flex items-center gap-1.5 text-[11px] text-dark-500 hover:text-loss
                  transition-colors cursor-pointer"
              >
                <Trash2 size={12} />
                Effacer
              </button>
            </span>
          }
        />
      </div>
    </div>
  );
};

export default BreedingTimeline;
