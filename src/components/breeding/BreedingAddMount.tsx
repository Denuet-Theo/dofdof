'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Search } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import CopyableText from '@/components/ui/CopyableText';
import ColorChip, { GenBadge } from '@/components/breeding/ColorChip';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
import {
  ANONYMOUS_NAME,
  carriedGeneration,
  colorCoder,
  mountName,
} from '@/lib/dofus/breeding/naming';
import { MOUNT_STATUS_LABEL, type MountStatus, type Sex } from '@/lib/dofus/breeding/stable';
import type { AddResult } from '@/lib/hooks/useBreeding';

/**
 * Ajouter une monture à l'écurie, dans l'ordre où on la lit en jeu.
 *
 * La saisie se faisait sur la liste des 120 couleurs : un `+♂` par couleur pour
 * les hautes générations, deux compteurs pour les basses. Ça marche pour
 * corriger un chiffre, pas pour **charger une écurie** — et c'est pourtant le
 * geste réel : on arrive avec cent trente montures dans le jeu et rien dans
 * l'outil. Sur cette liste-là, chaque monture demandait de retrouver sa couleur
 * parmi 120, puis d'ouvrir sa ligne pour le niveau, puis de deviner son
 * ascendance, qu'aucun champ ne permettait de saisir.
 *
 * D'où un assistant, dans l'ordre de la fiche du jeu :
 *
 * 1. **la génération** — elle ramène 120 couleurs à cinq ou cinquante ;
 * 2. **la couleur et le sexe** — les deux se lisent d'un coup d'œil sur la
 *    vignette et le glyphe ;
 * 3. **le niveau et l'état** — fertile, féconde ou stérile ;
 * 4. **les parents** — les deux couleurs de l'ascendance, ou rien si la monture
 *    a été achetée ou capturée.
 *
 * ## Pourquoi le nom vient en dernier, et pourquoi il verrouille
 *
 * Le nom se **calcule** sur tout ce qui précède (voir `naming.ts`) : la
 * génération portée, la couleur, le sexe et les deux parents. Il ne peut donc
 * pas être demandé, seulement dicté — et il doit être recopié **dans le jeu**,
 * sans quoi la monture qu'on vient d'enregistrer reste une « Anonyme » parmi
 * cent trente autres et son ascendance ne sert plus à rien.
 *
 * C'est pour ça que le bouton d'enregistrement attend la copie. Ce n'est pas une
 * cérémonie : une monture saisie sans son nom est une monture qu'on ne
 * retrouvera pas, et personne ne repasse derrière.
 */

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Les couleurs de la famille — elles portent générations, icônes et noms. */
  colors: BreedingColor[];
  onAdd: (mount: {
    colorId: string;
    sex: Sex;
    level: number;
    status: MountStatus;
    parents: [string, string] | null;
  }) => Promise<AddResult>;
};

type Step = 'generation' | 'color' | 'traits' | 'parents' | 'name';

const SEX_GLYPH: Record<Sex, string> = { M: '♂', F: '♀' };
const SEX_LABEL: Record<Sex, string> = { M: 'Mâle', F: 'Femelle' };

/** Ce que chaque état interdit, dit une fois pour toutes au moment du choix. */
const STATUS_HINT: Record<MountStatus, string> = {
  fertile: 'disponible, mais son cycle de jauges reste à faire avant de l’accoupler',
  feconde: 'prête : son cycle est fait, elle s’accouple telle quelle',
  sterile: 'épuisée : il ne lui reste que le clonage et l’extraction',
};

const STEP_LABEL: Record<Step, string> = {
  generation: 'Génération',
  color: 'Couleur et sexe',
  traits: 'Niveau et état',
  parents: 'Parents',
  name: 'Nom',
};

const STEPS: Step[] = ['generation', 'color', 'traits', 'parents', 'name'];

const BreedingAddMount = ({ isOpen, onClose, colors, onAdd }: Props) => {
  const [step, setStep] = useState<Step>('generation');
  const [generation, setGeneration] = useState<number | null>(null);
  const [colorId, setColorId] = useState<string | null>(null);
  const [sex, setSex] = useState<Sex | null>(null);
  const [level, setLevel] = useState(1);
  const [status, setStatus] = useState<MountStatus>('fertile');
  const [parents, setParents] = useState<[string | null, string | null]>([null, null]);
  /** Achetée ou capturée : elle n'a pas d'ascendance, et ce n'est pas un oubli. */
  const [noParents, setNoParents] = useState(false);
  const [slot, setSlot] = useState<0 | 1>(0);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Ce que la base a refusé, dit à l'écran plutôt qu'en console. */
  const [problem, setProblem] = useState<string | null>(null);
  /** Ce qui a été ajouté sans fermer la fenêtre — le compteur d'une session de saisie. */
  const [added, setAdded] = useState<{ name: string; colorName: string; sex: Sex }[]>([]);

  const byId = useMemo(() => new Map(colors.map((color) => [color.id, color])), [colors]);
  const code = useMemo(() => colorCoder(colors), [colors]);
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const generationOf = (id: string) => byId.get(id)?.generation ?? 1;
  const iconOf = (id: string) => {
    const color = byId.get(id);
    return color ? colorIconUrl(color) : null;
  };
  const codeOf = (id: string) => code(nameOf(id));

  /** Les générations que la famille porte réellement, avec leur nombre de couleurs. */
  const generations = useMemo(() => {
    const counts = new Map<number, number>();
    for (const color of colors) counts.set(color.generation, (counts.get(color.generation) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a - b);
  }, [colors]);

  /**
   * Les couleurs proposées à l'étape courante.
   *
   * La génération ne filtre que la monture elle-même : ses **parents** peuvent
   * être de n'importe quelle génération, et c'est même tout l'intérêt du
   * raccourci d'ascendance — une gen 2 née de deux gen 3 en est l'exemple.
   */
  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return colors
      .filter((color) => (step === 'color' ? color.generation === generation : true))
      .filter((color) => !needle || color.name.toLowerCase().includes(needle))
      .sort((a, b) => a.generation - b.generation || a.name.localeCompare(b.name));
  }, [colors, step, generation, query]);

  const parentPair: [string, string] | null =
    !noParents && parents[0] && parents[1] ? [parents[0], parents[1]] : null;

  /**
   * Le nom que cette monture doit porter en jeu.
   *
   * « Anonyme » sans ascendance, et c'est exact plutôt qu'ignorant : une monture
   * achetée ne fera jamais viser plus haut que sa couleur, donc elle n'a rien à
   * annoncer depuis la liste de l'écurie.
   */
  const computedName =
    colorId && sex
      ? mountName({
          carriedGeneration: carriedGeneration(
            generationOf(colorId),
            parentPair ? [generationOf(parentPair[0]), generationOf(parentPair[1])] : null
          ),
          colorName: nameOf(colorId),
          sex,
          parentNames: parentPair ? [nameOf(parentPair[0]), nameOf(parentPair[1])] : null,
          code,
        })
      : ANONYMOUS_NAME;

  /** Une « Anonyme » n'a rien à recopier : il n'y a pas de copie à attendre. */
  const needsCopy = computedName !== ANONYMOUS_NAME;

  const reachable = (target: Step): boolean => {
    if (target === 'generation') return true;
    if (target === 'color') return generation !== null;
    if (target === 'traits') return colorId !== null && sex !== null;
    return colorId !== null && sex !== null;
  };

  /**
   * Avancer d'une étape, sans relire l'état qu'on vient d'écrire.
   *
   * Le fil d'étapes se garde par `reachable`, mais les transitions internes ne
   * peuvent pas s'y fier : `setGeneration(3)` puis `go('color')` dans le même
   * gestionnaire lit encore `generation === null`, et l'assistant restait
   * bloqué sur sa première étape. La garde vaut pour le fil, pas pour le
   * chemin qui vient tout juste de la satisfaire.
   */
  const jump = (target: Step) => {
    setQuery('');
    setStep(target);
  };

  const go = (target: Step) => {
    if (!reachable(target)) return;
    jump(target);
  };

  /** Repart pour une monture, en gardant ce qui se répète dans une fratrie. */
  const nextMount = () => {
    setColorId(null);
    setSex(null);
    setLevel(1);
    setStatus('fertile');
    setCopied(false);
    setQuery('');
    setStep('color');
  };

  const close = () => {
    setAdded([]);
    setGeneration(null);
    setParents([null, null]);
    setNoParents(false);
    setSlot(0);
    nextMount();
    // `nextMount` repart à l'étape « couleur », qui n'a plus de sens une fois la
    // génération oubliée : la prochaine ouverture recommence du début.
    setStep('generation');
    onClose();
  };

  const save = async () => {
    if (!colorId || !sex) return;
    setSaving(true);
    setProblem(null);
    const result = await onAdd({ colorId, sex, level, status, parents: parentPair });
    setSaving(false);
    if (!result.ok) {
      // Le bouton restait sans effet et l'assistant sur son étape : on pouvait
      // recommencer cent trente fois sans jamais rien enregistrer, et sans que
      // rien à l'écran le dise. C'est arrivé.
      setProblem(result.message);
      return;
    }
    setAdded((current) => [
      ...current,
      { name: computedName, colorName: nameOf(colorId), sex },
    ]);
    nextMount();
  };

  /** La grille de couleurs, partagée par l'étape « couleur » et l'étape « parents ». */
  const colorGrid = (onPick: (id: string) => void, selected: string | null) => (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filtrer par nom"
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
            text-dark-100 text-xs placeholder:text-dark-500 transition-all hover:border-dark-500
            focus:border-kamas/50"
        />
      </div>
      <div
        className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-72 overflow-y-auto pr-1
          custom-scrollbar"
      >
        {listed.map((color) => (
          <button
            key={color.id}
            type="button"
            onClick={() => onPick(color.id)}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-xl border transition-all
              cursor-pointer text-left ${
                selected === color.id
                  ? 'bg-kamas/15 border-kamas/40'
                  : 'bg-dark-800/60 border-dark-700/50 hover:border-dark-500'
              }`}
          >
            <ColorChip
              name={color.name}
              code={code(color.name)}
              icon={colorIconUrl(color)}
              size="sm"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] text-dark-200 truncate">{color.name}</span>
              <span className="block text-[10px] text-dark-500">gen {color.generation}</span>
            </span>
          </button>
        ))}
        {listed.length === 0 && (
          <p className="col-span-full text-xs text-dark-500 text-center py-6">
            Aucune couleur ne correspond.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={close} title="Ajouter une monture" size="lg">
      <div className="space-y-4">
        {/* Le fil d'étapes, cliquable en arrière : on corrige un sexe sans
            recommencer la couleur, et on voit d'un coup où l'on en est. */}
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          {STEPS.map((entry, index) => (
            <span key={entry} className="flex items-center gap-1">
              {index > 0 && <span className="text-dark-700">›</span>}
              <button
                type="button"
                disabled={!reachable(entry)}
                onClick={() => go(entry)}
                className={`px-2 py-1 rounded-lg transition-all ${
                  step === entry
                    ? 'bg-kamas/15 text-kamas'
                    : reachable(entry)
                      ? 'text-dark-400 hover:text-dark-200 cursor-pointer'
                      : 'text-dark-700'
                }`}
              >
                {STEP_LABEL[entry]}
              </button>
            </span>
          ))}
        </div>

        {/* Le résumé de ce qui est déjà choisi : sans lui, l'étape « parents »
            ne dit plus de quelle monture on parle. */}
        {colorId && sex && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-dark-800/40">
            <ColorChip
              name={nameOf(colorId)}
              code={codeOf(colorId)}
              icon={iconOf(colorId)}
              size="md"
            />
            <span className="text-sm text-dark-100">{nameOf(colorId)}</span>
            <span className={sex === 'M' ? 'text-info' : 'text-loss-light'}>{SEX_GLYPH[sex]}</span>
            <GenBadge generation={generationOf(colorId)} />
            <span className="text-[11px] text-dark-500">niv. {level}</span>
            <span className="text-[11px] text-dark-500">{MOUNT_STATUS_LABEL[status]}</span>
          </div>
        )}

        {step === 'generation' && (
          <div className="space-y-2">
            <p className="text-[11px] text-dark-500">
              La génération est ce que le jeu affiche sur la fiche. Elle ramène les{' '}
              {colors.length}
              {' couleurs de la famille à celles qu’on cherche.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {generations.map(([value, count]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setGeneration(value);
                    setColorId(null);
                    jump('color');
                  }}
                  className={`px-3 py-2 rounded-xl border text-xs transition-all cursor-pointer ${
                    generation === value
                      ? 'bg-kamas/15 border-kamas/40 text-kamas'
                      : 'bg-dark-800/80 border-dark-600/50 text-dark-300 hover:border-kamas/40'
                  }`}
                >
                  Gen {value}
                  <span className="block text-[10px] text-dark-500">{count} couleurs</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'color' && (
          <div className="space-y-3">
            {colorGrid((id) => {
              setColorId(id);
              // Le sexe se choisit dans la foulée : il est sur la même fiche du
              // jeu, et attendre une étape de plus pour deux boutons n'ajoute
              // qu'un clic.
              if (sex) jump('traits');
            }, colorId)}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-dark-400">Sexe</span>
              {(['M', 'F'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setSex(value);
                    if (colorId) jump('traits');
                  }}
                  className={`px-3 py-1.5 rounded-xl border text-xs transition-all cursor-pointer ${
                    sex === value
                      ? 'bg-kamas/15 border-kamas/40 text-kamas'
                      : 'bg-dark-800/80 border-dark-600/50 text-dark-300 hover:border-kamas/40'
                  }`}
                >
                  {SEX_GLYPH[value]} {SEX_LABEL[value]}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'traits' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-dark-400 mb-1 block">Niveau</label>
              <input
                type="number"
                min={1}
                max={200}
                autoFocus
                value={String(level)}
                onChange={(event) =>
                  setLevel(Math.max(1, Math.min(200, Number(event.target.value) || 1)))
                }
                className="w-24 px-3 py-2 rounded-xl bg-dark-800/80 border border-dark-600/50
                  text-dark-100 text-sm text-right transition-all hover:border-dark-500
                  focus:border-kamas/50"
              />
              <p className="text-[10px] text-dark-600 mt-1">
                Le niveau des deux parents décide du taux de réussite d&apos;un accouplement :
                c&apos;est le levier le moins cher de toute la fournée.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs text-dark-400 block">État</span>
              <div className="flex flex-wrap gap-2">
                {(['fertile', 'feconde', 'sterile'] as const).map((value) => {
                  /* Sans ascendance, il n'y a pas de nom — et une anonyme
                     stérile ne peut rien : le jeu n'extrait pas les gen 1, et le
                     clonage ne prend pas ce qu'on ne sait pas désigner devant
                     son écurie. Même règle qu'à l'import et qu'à « Mes stocks »,
                     parce que ce sont trois portes sur la même table. */
                  const impossible = value === 'sterile' && !parentPair;

                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={impossible}
                      onClick={() => !impossible && setStatus(value)}
                      title={
                        impossible
                          ? 'Une monture sans ascendance ne peut pas être stérile : c’est une gen 1, que le jeu n’extrait pas et que le clonage ne sait pas désigner. Donne-lui ses deux parents, ou choisis un autre état.'
                          : STATUS_HINT[value]
                      }
                      className={`px-3 py-1.5 rounded-xl border text-xs transition-all ${
                        impossible ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
                      } ${
                        status === value
                          ? 'bg-kamas/15 border-kamas/40 text-kamas'
                          : 'bg-dark-800/80 border-dark-600/50 text-dark-300 hover:border-kamas/40'
                      }`}
                    >
                      {MOUNT_STATUS_LABEL[value]}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-dark-600">{STATUS_HINT[status]}</p>
            </div>

            <Button size="sm" onClick={() => go('parents')}>
              Continuer
            </Button>
          </div>
        )}

        {step === 'parents' && (
          <div className="space-y-3">
            <p className="text-[11px] text-dark-500">
              Les deux couleurs dont elle est née. C&apos;est elles qui décident de ce que ses
              propres accouplements viseront — une gen 2 née de deux gen 3 vise la gen 4, et
              rien d&apos;autre ne le dit.
            </p>

            <label className="flex items-center gap-2 text-xs text-dark-400 cursor-pointer w-fit">
              <input
                type="checkbox"
                checked={noParents}
                onChange={(event) => setNoParents(event.target.checked)}
                className="accent-kamas cursor-pointer"
              />
              Achetée ou capturée — sans ascendance
            </label>

            {!noParents && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {([0, 1] as const).map((index) => {
                    const picked = parents[index];
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setSlot(index)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border
                          transition-all cursor-pointer text-left ${
                            slot === index
                              ? 'bg-kamas/10 border-kamas/40'
                              : 'bg-dark-800/60 border-dark-700/50 hover:border-dark-500'
                          }`}
                      >
                        {picked ? (
                          <>
                            <ColorChip
                              name={nameOf(picked)}
                              code={codeOf(picked)}
                              icon={iconOf(picked)}
                              size="sm"
                            />
                            <span className="min-w-0">
                              <span className="block text-[11px] text-dark-200 truncate">
                                {nameOf(picked)}
                              </span>
                              <span className="block text-[10px] text-dark-500">
                                gen {generationOf(picked)}
                              </span>
                            </span>
                          </>
                        ) : (
                          <span className="text-[11px] text-dark-500">
                            Parent {index + 1} — à choisir
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {colorGrid((id) => {
                  const next: [string | null, string | null] = [...parents];
                  next[slot] = id;
                  setParents(next);
                  // On passe à l'autre emplacement tant qu'il est vide : deux
                  // parents, deux clics, sans avoir à viser la case entre les
                  // deux.
                  setSlot(next[slot === 0 ? 1 : 0] === null ? (slot === 0 ? 1 : 0) : slot);
                }, parents[slot])}
              </>
            )}

            <Button size="sm" disabled={!noParents && !parentPair} onClick={() => go('name')}>
              {noParents || parentPair ? 'Voir le nom' : 'Choisis les deux parents'}
            </Button>
          </div>
        )}

        {step === 'name' && (
          <div className="space-y-3">
            {needsCopy ? (
              <>
                <p className="text-[11px] text-dark-500">
                  Le nom à donner <strong>dans le jeu</strong>
                  {' à cette monture. Sans lui, elle redevient une « Anonyme » parmi les autres'}
                  {' et son ascendance ne se retrouve plus depuis la liste de l’écurie.'}
                </p>
                <div className="flex items-center gap-3">
                  <CopyableText
                    value={computedName}
                    className="px-3 py-2"
                    onCopy={() => setCopied(true)}
                  />
                  {copied && (
                    <span className="flex items-center gap-1 text-[11px] text-gain">
                      <Check size={12} /> copié — colle-le dans le jeu
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="text-[11px] text-dark-500">
                Sans ascendance, cette monture reste « Anonyme » dans le jeu — et c&apos;est
                exact : elle ne fera jamais viser plus haut que sa couleur, donc elle n&apos;a
                rien à annoncer.
              </p>
            )}

            {/* Ce que la base a refusé. Le message brut de PostgREST, parce
                qu'une colonne absente, une contrainte violée et une session
                expirée demandent trois gestes différents — et que le résumer en
                « échec » rendrait l'écran aussi muet qu'avant. */}
            {problem && (
              <p className="flex items-start gap-1.5 px-3 py-2 rounded-xl bg-loss/10 text-[11px] text-loss">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>
                  <strong>Rien n’a été enregistré.</strong> {problem}
                </span>
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" disabled={saving || (needsCopy && !copied)} onClick={save}>
                {saving ? 'Enregistrement…' : 'Ajouter à l’écurie'}
              </Button>
              {needsCopy && !copied && (
                <span className="text-[10px] text-dark-600">
                  Copie le nom d&apos;abord : une monture enregistrée sans son nom ne se
                  retrouve pas en jeu.
                </span>
              )}
              <button
                type="button"
                onClick={() => go('parents')}
                className="flex items-center gap-1 text-[11px] text-dark-500 hover:text-dark-300
                  transition-colors cursor-pointer"
              >
                <ArrowLeft size={11} /> corriger
              </button>
            </div>
          </div>
        )}

        {/* Ce qui vient d'être ajouté sans fermer la fenêtre. La génération et
            les parents sont conservés d'une monture à l'autre : une fratrie se
            saisit alors en deux clics par tête. */}
        {added.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-dark-700/40">
            <p className="text-[11px] text-dark-400">
              {added.length} monture{added.length > 1 ? 's' : ''} ajoutée
              {added.length > 1 ? 's' : ''} — la génération et les parents sont gardés pour la
              suivante
            </p>
            <div className="flex flex-wrap gap-1.5">
              {added.map((entry, index) => (
                <span
                  key={index}
                  className="text-[10px] text-dark-300 bg-dark-800/60 px-2 py-1 rounded-lg"
                >
                  {SEX_GLYPH[entry.sex]} {entry.colorName}
                  {entry.name !== ANONYMOUS_NAME && (
                    <code className="text-dark-500"> · {entry.name}</code>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default BreedingAddMount;
