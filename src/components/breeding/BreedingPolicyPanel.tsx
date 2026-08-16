'use client';

import { useMemo, useRef, useState } from 'react';
import { Dna, Egg, Gem, Heart, Lock, LockOpen, LogOut, Check } from 'lucide-react';
import Button from '@/components/ui/Button';
import CopyableText from '@/components/ui/CopyableText';
import BreedingBirthDialog from '@/components/breeding/BreedingBirthDialog';
import BreedingCloneDialog from '@/components/breeding/BreedingCloneDialog';
import BreedingCloneAdvice from '@/components/breeding/BreedingCloneAdvice';
import BreedingEnclosExitDialog from '@/components/breeding/BreedingEnclosExitDialog';
import BreedingExtraction from '@/components/breeding/BreedingExtraction';
import { cloningsToRecord, couplesToRecord, type StablePlan } from '@/lib/dofus/breeding/policy';
import {
  nextPenIndex,
  pennedUnits,
  type BatchPen,
  type BatchUnit,
} from '@/lib/dofus/breeding/batch';
import { ENCLOS_SLOTS } from '@/lib/dofus/breeding/enclos';
import { formatCountdown } from '@/lib/dofus/breeding/timeline';
import { acquiredMountId } from '@/lib/dofus/breeding/search';
import { BULK_MATE_LEVEL } from '@/lib/dofus/breeding/pairing';
import type { BreedingColor } from '@/lib/dofus/breeding/costs';
import type { CloneOption } from '@/lib/dofus/breeding/cloning';
import type { ExtractionCandidate } from '@/lib/dofus/breeding/extraction';
import { MINUTE_MS, useWallClock } from '@/lib/hooks/useWallClock';
import type { Couple, Individual } from '@/lib/dofus/breeding/stable';
import type {
  BirthEntry,
  BirthRecord,
  CloningResult,
  RecordBirthsResult,
} from '@/lib/hooks/useBreeding';
import type { BreedingBatchState } from '@/lib/hooks/useBreedingBatch';

/**
 * Ce que la politique fait de l'écurie : quatre gestes, **un seul à l'écran**.
 *
 * ## Pourquoi les onglets sont étanches
 *
 * Ils ne l'étaient pas. L'onglet ne changeait que l'en-tête et son bouton ;
 * en dessous, le même bloc déroulait toujours tout — la fournée découpée en
 * enclos, les fécondations, les clonages, la liste à sortir du coffre. Choisir
 * « Accouplement » affichait donc cinq enclos à charger, et l'écran donnait
 * quatre consignes simultanées pour un joueur qui n'a qu'une fenêtre de jeu
 * ouverte devant lui.
 *
 * Chaque geste se fait dans le jeu, une monture à la fois, en cherchant un nom.
 * Un onglet montre **ce geste-là** et rien d'autre.
 *
 * ## Pourquoi la fournée se charge enclos par enclos, avec un verrou
 *
 * C'est le défaut que plusieurs joueurs ont remonté dans les mêmes termes : on
 * charge les enclos le matin, on revient le soir pour les sortir, « et ce ne
 * sont plus les mêmes ». Ce n'était pas une impression. La fournée était
 * recalculée à chaque rendu depuis l'écurie du moment ; entre le chargement et
 * la sortie, l'écurie bouge — naissances saisies, achats, clonages — donc la
 * politique reproposait une autre fournée et la fenêtre de sortie offrait des
 * montures qui n'avaient jamais vu l'enclos.
 *
 * Le verrou écrit ce que le jeu, lui, sait déjà : cet enclos-ci contient ces
 * dix montures-là depuis telle heure. Voir `batch.ts`. Une fois posé, plus rien
 * ne le recalcule.
 *
 * D'où un enclos à la fois : c'est le geste réel — on ouvre un enclos, on y met
 * dix montures, on le referme, on passe au suivant. La liste complète des cinq
 * enclos obligeait à retrouver soi-même où l'on en était au milieu.
 */

type Step = 'mate' | 'clone' | 'load' | 'extract';

const STEPS: { id: Step; label: string; icon: typeof Heart }[] = [
  { id: 'mate', label: 'Accouplement', icon: Heart },
  { id: 'clone', label: 'Clonage', icon: Dna },
  { id: 'load', label: 'Fournée', icon: Egg },
  { id: 'extract', label: 'Extraction', icon: Gem },
];

type Props = {
  /** Ce que la politique ferait de l'écurie, ou `null` si elle ne peut pas répondre. */
  fill: StablePlan | null;
  /** La fournée réellement en enclos, et les gestes qui la font avancer. */
  batch: BreedingBatchState;
  /** Tous les accouplements réalisables maintenant, bouclés par la page (#165). */
  couples?: Couple[];
  /** Ce que valent les stériles de l'écurie, à l'onglet « Clonage ». */
  cloneAdvice?: CloneOption[];
  /** Toutes les stériles, appariables ou non, à l'onglet « Extraction ». */
  extraction?: ExtractionCandidate[];
  /** Ambre, neurone ou corne : ce que l'extraction rend dans cette famille. */
  sacrificeName?: string;
  nameOf: (colorId: string) => string;
  individuals?: Individual[];
  colors?: BreedingColor[];
  generations?: Map<string, number>;
  onRecordBirths?: (entries: BirthEntry[]) => Promise<RecordBirthsResult>;
  onUndoBirth?: (record: BirthRecord) => Promise<boolean>;
  onRecordClonings?: (entries: { keep: string; drop: string }[]) => Promise<CloningResult>;
  /** Sortie d'enclos : niveaux relevés, lot passé en fécondes. */
  onEnclosExit?: (entries: { id: string; level: number }[]) => Promise<number>;
};

/**
 * Une unité d'enclos rendue lisible comme une monture.
 *
 * La fenêtre de sortie parle en `Individual` — c'est ce que `recordEnclosExit`
 * attend, identifiants fabriqués compris. L'instantané en porte exactement les
 * champs utiles : le reste (ascendance, fertilité) n'entre pas dans une sortie
 * d'enclos.
 */
const asIndividual = (unit: BatchUnit): Individual => ({
  id: unit.id,
  colorId: unit.colorId,
  name: unit.name,
  sex: unit.sex,
  level: unit.level,
  fertile: true,
  cycled: false,
  parents: null,
});

const BreedingPolicyPanel = ({
  fill,
  batch,
  couples,
  cloneAdvice = [],
  extraction = [],
  sacrificeName = 'ambre',
  nameOf,
  individuals = [],
  colors,
  generations,
  onRecordBirths,
  onUndoBirth,
  onRecordClonings,
  onEnclosExit,
}: Props) => {
  const [step, setStep] = useState<Step>('mate');
  /** La fenêtre ouverte : saisie de naissances, de clonages, ou sortie d'un enclos. */
  const [open, setOpen] = useState<'mate' | 'clone' | { exit: number } | null>(null);
  /**
   * Une naissance au moins a été écrite depuis l'ouverture de la fenêtre.
   *
   * Une `ref` et non un `state` : personne ne l'affiche, elle ne décide que de
   * l'onglet à ouvrir à la fermeture.
   */
  const birthsWritten = useRef(false);

  /**
   * L'heure, pour dater les enclos verrouillés.
   *
   * `null` tant que le composant n'est pas monté : le serveur n'a pas d'heure à
   * laquelle l'éleveur regarde, et un `Date.now()` initial produirait un écart
   * d'hydratation sur chaque « chargé il y a … ». Voir `useWallClock`.
   */
  const now = useWallClock(MINUTE_MS);

  const toRecord = useMemo(
    () => couples ?? (fill ? couplesToRecord(fill) : []),
    [couples, fill]
  );
  const toClone = useMemo(
    () => (fill && generations ? cloningsToRecord(fill, generations) : []),
    [fill, generations]
  );

  /**
   * La fournée que la politique **propose**, découpée en enclos de dix places.
   *
   * ## Un enclos ne marie personne
   *
   * On pourrait croire qu'il faut y ranger les deux parents d'un croisement
   * ensemble. Non : l'enclos paie le **cycle de fécondité**, et l'appariement se
   * décide après, à la fenêtre d'accouplement. Deux montures qui s'accoupleront
   * peuvent avoir été fécondées dans deux enclos différents, à deux jours
   * d'écart. Le découpage est donc libre — on aligne les montures et on coupe
   * tous les dix.
   *
   * ## L'ordre, lui, n'est pas libre
   *
   * Les nommées passent devant, triées par nom : ce sont les seules qu'on ait à
   * **chercher** dans l'écurie du jeu, et les grouper évite d'ouvrir la
   * recherche dix fois pour dix enclos. Les anonymes suivent, prises au tas.
   *
   * Ce n'est qu'une proposition : dès qu'un enclos est verrouillé, c'est
   * l'instantané qui fait foi et cette liste n'est plus lue. Voir `batch.ts`.
   */
  const proposed = useMemo((): BatchPen[] => {
    if (!fill) return [];
    const byId = new Map(individuals.map((mount) => [mount.id, mount]));
    const units: BatchUnit[] = [];

    for (const line of fill.couples) {
      for (let index = 0; index < line.count; index += 1) {
        for (const [sex, sideOf] of [
          ['M', line.male],
          ['F', line.female],
        ] as const) {
          // Le cycle est déjà payé : elle ne passe pas par l'enclos.
          if (sideOf.cycled) continue;
          // Une ligne mêle le coffre et l'achat : les identifiants d'abord, et ce
          // qui dépasse est à procurer. Une monture procurée n'existe nulle part
          // encore — `acquiredMountId` lui fabrique l'identité que la sortie
          // d'enclos saura relire pour l'inscrire à l'écurie.
          const id = sideOf.mountIds[index];
          const mount = id ? byId.get(id) : undefined;
          units.push({
            id: id ?? acquiredMountId(sideOf.colorId, sex, units.length),
            colorId: sideOf.colorId,
            sex,
            name: mount?.name ?? null,
            level: mount?.level ?? BULK_MATE_LEVEL,
            banked: false,
            toBuy: id === undefined,
          });
        }
      }
    }

    // Les fécondations sans croisement occupent une place chacune, dans les mêmes
    // enclos que le reste : les compter ailleurs faisait dire « 38 montures » sous
    // « 40/40 places ».
    for (const entry of fill.cycles) {
      for (const id of entry.mountIds) {
        const mount = byId.get(id);
        units.push({
          id,
          colorId: entry.colorId,
          sex: mount?.sex ?? 'M',
          name: mount?.name ?? null,
          level: mount?.level ?? BULK_MATE_LEVEL,
          banked: true,
          toBuy: false,
        });
      }
    }

    units.sort(
      (a, b) =>
        Number(!a.name) - Number(!b.name) ||
        (a.name ?? '').localeCompare(b.name ?? '') ||
        nameOf(a.colorId).localeCompare(nameOf(b.colorId)) ||
        a.sex.localeCompare(b.sex)
    );

    /**
     * Une monture, une place — même si le plan la nommait deux fois.
     *
     * La politique ne devrait jamais engager la même monture dans deux
     * croisements, mais cette liste-là **crée des montures** : la sortie
     * d'enclos inscrit à l'écurie tout identifiant compté qu'elle ne connaît
     * pas. Un doublon y deviendrait une monture fantôme, née d'une ligne
     * dupliquée à l'affichage. Les identifiants fabriqués pour les achats sont
     * uniques par construction, donc seul un vrai doublon tombe ici.
     */
    const once = [...new Map(units.map((unit) => [unit.id, unit])).values()];

    const pens: BatchPen[] = [];
    for (let index = 0; index < once.length; index += ENCLOS_SLOTS) {
      pens.push({ units: once.slice(index, index + ENCLOS_SLOTS), lockedAt: null });
    }
    return pens;
  }, [fill, individuals, nameOf]);

  /**
   * Ce que l'écran montre : l'instantané dès qu'il existe, la proposition sinon.
   *
   * Le premier verrou fige la fournée entière — enclos à venir compris — donc
   * `proposed` n'est plus lu de toute la fournée. C'est le cœur du correctif :
   * ne figer que l'enclos verrouillé laisserait les suivants changer sous les
   * doigts, soit le même défaut décalé d'un enclos.
   */
  const pens = batch.pens.length > 0 ? batch.pens : proposed;
  const current = nextPenIndex(pens);
  const locked = pens
    .map((pen, index) => ({ pen, index }))
    .filter((entry) => entry.pen.lockedAt !== null);

  const loadTotal = pens.reduce((total, pen) => total + pen.units.length, 0);
  /**
   * Les montures **physiquement en enclos**, celles que la page a retirées de
   * l'entrée de la politique. Comptées sur l'instantané en base et non sur
   * `pens`, qui vaut la proposition tant qu'aucun verrou n'a été posé.
   */
  const penned = pennedUnits(batch.pens).length;

  /** Les nommées d'un enclos : une ligne par nom, comptée si elle se répète. */
  const namedGroups = (units: BatchUnit[]) => {
    const groups = new Map<string, { unit: BatchUnit; count: number }>();
    for (const unit of units.filter((entry) => entry.name)) {
      const key = `${unit.name}|${unit.colorId}|${unit.sex}|${unit.banked}`;
      const group = groups.get(key) ?? { unit, count: 0 };
      group.count += 1;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) =>
      (a.unit.name ?? '').localeCompare(b.unit.name ?? '')
    );
  };

  /**
   * Les anonymes d'un enclos, regroupées — et elles seules.
   *
   * Deux anonymes de même couleur et de même sexe sont interchangeables : rien
   * ne permet de les distinguer en jeu, donc les lister séparément demanderait
   * de choisir entre deux choses identiques.
   */
  const anonymousGroups = (units: BatchUnit[]) => {
    const groups = new Map<string, { unit: BatchUnit; count: number }>();
    for (const unit of units.filter((entry) => !entry.name)) {
      const key = `${unit.colorId}|${unit.sex}|${unit.toBuy}|${unit.banked}`;
      const group = groups.get(key) ?? { unit, count: 0 };
      group.count += 1;
      groups.set(key, group);
    }
    return [...groups.values()].sort(
      (a, b) =>
        b.count - a.count || nameOf(a.unit.colorId).localeCompare(nameOf(b.unit.colorId))
    );
  };

  /** « il y a 3 h » sur un enclos verrouillé, une fois l'heure connue. */
  const since = (at: string | null) => {
    if (at === null || now === null) return null;
    const seconds = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
    return formatCountdown(seconds);
  };

  const nothing =
    !fill ||
    (fill.couples.length === 0 &&
      fill.cycles.length === 0 &&
      fill.clonings.length === 0 &&
      fill.purchases.length === 0);

  /** L'enclos dont on est en train de sortir les montures. */
  const exiting = typeof open === 'object' && open !== null ? pens[open.exit] : undefined;

  return (
    <div
      data-testid="policy-panel"
      className="glass rounded-2xl px-5 py-4 space-y-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Heart size={15} className="text-kamas shrink-0" />
        <span className="text-sm font-semibold text-dark-200">Ce que fait la politique</span>
        <span className="text-xs text-dark-500">un geste à la fois, dans l&apos;ordre du jeu</span>
        {fill && (
          <span
            data-testid="policy-summary"
            className="ml-auto text-[11px] text-dark-500 tabular-nums"
          >
            {fill.raw.crossings.length} accouplement{fill.raw.crossings.length > 1 ? 's' : ''} ·{' '}
            {fill.places}/{fill.capacity} places
          </span>
        )}
      </div>

      {/* Ce que la politique **ne voit pas**, dit en toutes lettres.
          Les montures verrouillées sont retirées de tous les arbitrages — le jeu
          ne les laisse ni s'accoupler ni se faire cloner tant que leur cycle
          tourne — mais « Mes stocks » continue de les compter, à juste titre :
          elles sont toujours à vous. Sans cette ligne, les deux décomptes se
          contredisent en silence, et un écran qui se contredit sans le dire est
          exactement ce qu'on vient de corriger ailleurs. */}
      {penned > 0 && (
        <p data-testid="penned-notice" className="text-[11px] text-dark-500">
          <strong className="text-dark-300 tabular-nums">{penned}</strong>
          {penned > 1 ? ' montures en enclos, mises' : ' monture en enclos, mise'} de côté : le
          jeu ne {penned > 1 ? 'les' : 'la'} laissera ni s&apos;accoupler, ni se faire cloner, ni
          se faire sacrifier tant que le cycle tourne.{' '}
          {penned > 1 ? 'Elles reviennent' : 'Elle revient'} à la sortie d&apos;enclos.
        </p>
      )}

      {/* Les quatre gestes. Un onglet vide reste cliquable et le dit : la liste
          des stériles a de la valeur même quand la politique ne propose rien. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {STEPS.map(({ id, label, icon: Icon }) => {
          const count =
            id === 'mate'
              ? toRecord.length
              : id === 'clone'
                ? toClone.length
                : id === 'load'
                  ? loadTotal
                  : extraction.length;
          const active = step === id;
          return (
            <button
              key={id}
              type="button"
              data-testid={`step-${id}`}
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

      {/* Ce que l'échelle a refusé. Rien n'est retiré en silence : un plan amputé
          sans le dire est ce qui rend un outil impossible à croire. Ça vaut pour
          les trois onglets qui produisent des croisements, donc ça reste au-dessus. */}
      {fill && fill.refused.barren + fill.refused.offPlan > 0 && (
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

      {/* ------------------------------------------------------ accouplement -- */}
      {step === 'mate' && (
        <div data-testid="pane-mate" className="space-y-2">
          {toRecord.length > 0 ? (
            <>
              <Button size="md" variant="primary" onClick={() => setOpen('mate')}>
                <Heart size={14} />
                {toRecord.length} reproduction{toRecord.length > 1 ? 's' : ''} à faire
              </Button>
              <p className="text-[11px] text-dark-500">
                Un croisement à la fois, avec ses issues et le nom du poulain à recopier dans le
                jeu. Chaque clic enregistre aussitôt.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-dark-500">
              Aucun accouplement possible tout de suite — il faut d&apos;abord une fournée
              d&apos;enclos, ou de quoi apparier ce qui en est sorti.
            </p>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- clonage -- */}
      {step === 'clone' && (
        <div data-testid="pane-clone" className="space-y-2">
          {toClone.length > 0 ? (
            <>
              <Button size="md" variant="primary" onClick={() => setOpen('clone')}>
                <Dna size={14} />
                {toClone.length} clonage{toClone.length > 1 ? 's' : ''} à faire
              </Button>
              <p className="text-[11px] text-dark-500">
                Deux stériles, une survivante — c&apos;est toi qui choisis laquelle.
              </p>
            </>
          ) : cloneAdvice.length > 0 ? (
            /* Les deux listes ne répondent pas à la même question : `toClone` est
               ce que la **politique** planifie, `cloneAdvice` ce que l'écurie
               **permet**. La seconde reste actionnable quand la première est vide. */
            <p className="text-[11px] text-dark-500">
              La politique n&apos;en planifie aucun. Les appariements ci-dessous sont ceux que
              tes stériles permettent — à faire dans le jeu, sans rien à saisir ici.
            </p>
          ) : (
            <p className="text-[11px] text-dark-500">
              Aucun clonage possible — deux stériles ne s&apos;apparient qu&apos;à génération
              affichée égale. Ce qui reste dépareillé est dans « Extraction ».
            </p>
          )}

          <BreedingCloneAdvice
            clonings={cloneAdvice}
            nameOf={nameOf}
            individuals={individuals}
          />
        </div>
      )}

      {/* ----------------------------------------------------------- fournée -- */}
      {step === 'load' && (
        <div data-testid="pane-load" className="space-y-3">
          {pens.length === 0 ? (
            <p className="text-[11px] text-dark-500">
              Rien à mettre en enclos : la politique n&apos;a aucun croisement à préparer, ou
              toutes les montures qu&apos;elle vise ont déjà payé leur cycle.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xs font-semibold text-dark-200">
                  {pens.length} enclos · {loadTotal} monture{loadTotal > 1 ? 's' : ''}
                </span>
                <span className="text-[11px] text-dark-500 tabular-nums">
                  {locked.length}/{pens.length} verrouillé{locked.length > 1 ? 's' : ''}
                </span>
                <span
                  className="text-[10px] text-dark-600"
                  title="Les fécondes n'y sont pas : leur cycle est payé, elles s'accouplent sans repasser par l'enclos. Qui s'accouple avec qui se décide après, à la fenêtre d'accouplement."
                >
                  fécondes exclues
                </span>
                {batch.pens.length > 0 && (
                  <button
                    type="button"
                    onClick={batch.discard}
                    className="ml-auto text-[10px] text-dark-500 hover:text-loss transition-colors
                      cursor-pointer"
                    title="Oublier cette fournée sans rien écrire sur les montures. À faire si elle ne correspond plus à ce que tu as réellement en enclos."
                  >
                    abandonner cette fournée
                  </button>
                )}
              </div>

              {/* Les enclos déjà refermés, en une ligne chacun. Ils n'ont plus
                  rien à charger — seulement à être sortis, quand ils auront
                  tourné. Le contenu reste consultable, mais replié : ce qui
                  compte ici est « depuis quand », pas « lesquelles ». */}
              {locked.map(({ pen, index }) => (
                <div
                  key={index}
                  data-testid="locked-pen"
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 rounded-xl
                    bg-emerald-500/8 border border-emerald-500/25"
                >
                  <Lock size={14} className="text-emerald-400 shrink-0" />
                  <span className="text-xs font-semibold text-dark-100">Enclos {index + 1}</span>
                  <span className="text-[11px] text-dark-400 tabular-nums">
                    {pen.units.length} monture{pen.units.length > 1 ? 's' : ''}
                  </span>
                  {since(pen.lockedAt) && (
                    <span className="text-[11px] text-dark-500 tabular-nums">
                      chargé il y a {since(pen.lockedAt)}
                    </span>
                  )}
                  {onEnclosExit && (
                    <Button
                      size="sm"
                      variant="secondary"
                      data-testid="exit-pen"
                      className="ml-auto"
                      onClick={() => setOpen({ exit: index })}
                    >
                      <LogOut size={13} />
                      Les sortir de l&apos;enclos
                    </Button>
                  )}
                </div>
              ))}

              {/* L'enclos en cours, en grand. Un seul : devant le jeu on ouvre un
                  enclos, on y met dix montures, on le referme. Afficher les cinq
                  obligeait à retrouver soi-même où l'on en était. */}
              {current !== null ? (
                <div
                  data-testid="current-pen"
                  className="rounded-2xl border border-kamas/30 bg-kamas/5 px-4 py-3 space-y-2"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold text-dark-100">
                      Enclos {current + 1}
                    </span>
                    <span className="text-[11px] text-dark-500 tabular-nums">
                      {pens[current].units.length}/{ENCLOS_SLOTS} places
                    </span>
                    <span className="text-[11px] text-dark-500">
                      à remplir maintenant, puis à verrouiller
                    </span>
                  </div>

                  {namedGroups(pens[current].units).length > 0 && (
                    <div className="space-y-0.5">
                      <p className="text-[10px] uppercase tracking-wider text-dark-500">
                        Nommées — à chercher par leur nom
                      </p>
                      {namedGroups(pens[current].units).map(({ unit, count }) => (
                        <div
                          key={`${unit.name}-${unit.sex}-${unit.banked}`}
                          data-testid="load-named"
                          className="flex flex-wrap items-center gap-2 text-xs"
                        >
                          <span
                            className={unit.sex === 'M' ? 'text-info' : 'text-loss-light'}
                            title={unit.sex === 'M' ? 'Mâle' : 'Femelle'}
                          >
                            {unit.sex === 'M' ? '♂' : '♀'}
                          </span>
                          <span className="text-dark-200">{nameOf(unit.colorId)}</span>
                          <CopyableText
                            value={unit.name!}
                            title={`Copier « ${unit.name} » — le nom à chercher dans l’écurie du jeu`}
                          />
                          {count > 1 && (
                            <span className="text-[10px] text-dark-500">× {count}</span>
                          )}
                          {unit.banked && (
                            <em
                              className="not-italic text-[10px] text-dark-400"
                              title="En enclos sans croiser : elle en sort féconde et reste en écurie."
                            >
                              à féconder sans croiser
                            </em>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {anonymousGroups(pens[current].units).length > 0 && (
                    <div className="space-y-0.5">
                      <p className="text-[10px] uppercase tracking-wider text-dark-500">
                        Anonymes — à prendre au tas
                      </p>
                      {anonymousGroups(pens[current].units).map(({ unit, count }) => (
                        <div
                          key={`${unit.colorId}-${unit.sex}-${unit.toBuy}-${unit.banked}`}
                          data-testid="load-anonymous"
                          className="flex flex-wrap items-center gap-2 text-xs"
                        >
                          <span className="text-dark-300 font-semibold tabular-nums w-6 shrink-0 text-right">
                            {count} ×
                          </span>
                          <span
                            className={unit.sex === 'M' ? 'text-info' : 'text-loss-light'}
                            title={unit.sex === 'M' ? 'Mâle' : 'Femelle'}
                          >
                            {unit.sex === 'M' ? '♂' : '♀'}
                          </span>
                          <span className="text-dark-200">{nameOf(unit.colorId)}</span>
                          {unit.toBuy && (
                            <em className="not-italic text-[10px] text-amber-400/80">
                              à procurer — achat ou capture
                            </em>
                          )}
                          {unit.banked && (
                            <em
                              className="not-italic text-[10px] text-dark-400"
                              title="En enclos sans croiser : elle en sort féconde et reste en écurie."
                            >
                              à féconder sans croiser
                            </em>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Le verrou. Gros, parce que c'est le seul geste de cet écran
                      qui écrive quelque chose d'irréversible pour la journée :
                      après lui, cet enclos-là ne bougera plus, quoi que la
                      politique repense de l'écurie entre-temps. */}
                  <button
                    type="button"
                    data-testid="lock-pen"
                    onClick={() => batch.lock(proposed)}
                    className="w-full mt-1 flex items-center justify-center gap-2 px-4 py-3
                      rounded-xl bg-kamas/20 border border-kamas/50 text-kamas text-sm
                      font-bold uppercase tracking-wider transition-all cursor-pointer
                      hover:bg-kamas/30 hover:border-kamas/70"
                    title="Cet enclos est rempli et refermé. Son contenu est figé : c'est lui qu'on retrouvera à la sortie, même dans douze heures."
                  >
                    <Lock size={16} />
                    Lock — enclos {current + 1} chargé
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-xl
                  bg-dark-800/60 border border-dark-600/50">
                  <Check size={14} className="text-gain shrink-0" />
                  <span className="text-xs text-dark-200">
                    Tous les enclos sont chargés. Reviens les sortir quand le cycle aura tourné.
                  </span>
                  <button
                    type="button"
                    onClick={batch.unlock}
                    className="ml-auto inline-flex items-center gap-1 text-[10px] text-dark-500
                      hover:text-dark-300 transition-colors cursor-pointer"
                    title="Rouvrir le dernier enclos verrouillé — un clic de trop, rien de plus."
                  >
                    <LockOpen size={11} />
                    rouvrir le dernier
                  </button>
                </div>
              )}

              {/* Le récapitulatif par couleur, qui se lit devant le coffre : on y
                  va une fois, pas une fois par enclos. Il décrit la fournée
                  entière — c'est justement ce qu'on veut avant d'ouvrir le
                  premier enclos. */}
              {fill && fill.pull.length > 0 && batch.pens.length === 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2
                  border-t border-dark-700/40">
                  <span className="text-[11px] text-dark-400">
                    À sortir de l&apos;écurie, pour toute la fournée
                  </span>
                  {fill.pull.map((pull) => (
                    <span key={pull.colorId} className="text-xs text-dark-300">
                      {nameOf(pull.colorId)}{' '}
                      <span className="tabular-nums font-semibold text-dark-100">
                        {pull.males > 0 && `${pull.males}♂`}
                        {pull.males > 0 && pull.females > 0 && ' '}
                        {pull.females > 0 && `${pull.females}♀`}
                      </span>
                      {pull.exhausts && (
                        <span
                          className="text-[10px] text-amber-400/70"
                          title="La fournée vide cette couleur : il n'en restera aucune fertile."
                        >
                          {' '}
                          vidée
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* -------------------------------------------------------- extraction -- */}
      {step === 'extract' && (
        <div data-testid="pane-extract">
          <BreedingExtraction
            candidates={extraction}
            nameOf={nameOf}
            individuals={individuals}
            resourceName={sacrificeName}
          />
        </div>
      )}

      {/* Une écurie sur laquelle la politique n'a rien à dire se dit, plutôt que
          de laisser trois onglets vides qu'on prendrait pour un défaut
          d'affichage. L'extraction s'en passe : une écurie sans fertile est
          justement celle qui a le plus de stériles à vider. */}
      {nothing && step !== 'extract' && (
        <p className="text-[11px] text-dark-500">
          La politique ne propose rien sur cette écurie : soit elle n&apos;a plus de monture
          fertile, soit les prix ne sont pas saisis et tout lui paraît sans valeur.
        </p>
      )}

      {colors && onRecordBirths && (
        <BreedingBirthDialog
          isOpen={open === 'mate'}
          couples={toRecord}
          individuals={individuals}
          colors={colors}
          nameOf={nameOf}
          onRecord={async (entries) => {
            const result = await onRecordBirths(entries);
            if (result.ok && result.born.length > 0) birthsWritten.current = true;
            return result;
          }}
          onUndo={async (record) => (onUndoBirth ? onUndoBirth(record) : false)}
          onClose={() => {
            setOpen(null);
            if (birthsWritten.current) setStep('clone');
            birthsWritten.current = false;
          }}
        />
      )}

      {colors && (
        <BreedingCloneDialog
          isOpen={open === 'clone'}
          clonings={toClone}
          individuals={individuals}
          colors={colors}
          nameOf={nameOf}
          onRecord={async (entries) =>
            (await onRecordClonings?.(entries)) ?? { ok: true as const }
          }
          onClose={() => {
            setOpen(null);
            setStep('load');
          }}
        />
      )}

      {colors && onEnclosExit && (
        <BreedingEnclosExitDialog
          isOpen={exiting !== undefined}
          onClose={() => setOpen(null)}
          mounts={(exiting?.units ?? []).map(asIndividual)}
          colors={colors}
          nameOf={nameOf}
          onConfirm={async (entries) => {
            const written = await onEnclosExit(entries);
            // L'enclos ne quitte la fournée que si la sortie a été écrite : sinon
            // il resterait à l'écran comme verrouillé — ce qui est la vérité —
            // et l'éleveur pourrait recommencer. Un enclos retiré sur une
            // écriture perdue serait, lui, définitivement introuvable.
            if (written > 0 && typeof open === 'object' && open !== null) {
              await batch.release(open.exit);
            }
            // Le cycle vient d'être payé : c'est exactement le moment où de
            // nouveaux accouplements deviennent possibles.
            if (written > 0) setStep('mate');
            return written;
          }}
          onRelease={async () => {
            if (typeof open === 'object' && open !== null) await batch.release(open.exit);
          }}
        />
      )}
    </div>
  );
};

export default BreedingPolicyPanel;
