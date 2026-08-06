'use client';

import { useMemo, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import {
  matingOutcomes,
  mateSignature,
  BULK_MATE_LEVEL,
  type Mate,
  type MatingOutcome,
} from '@/lib/dofus/breeding/pairing';
import { carriedGeneration, mountName } from '@/lib/dofus/breeding/naming';
import type { BreedingColor } from '@/lib/dofus/breeding/costs';
import type { Couple, Individual, Pairing, Sex } from '@/lib/dofus/breeding/stable';
import type { BirthEntry } from '@/lib/hooks/useBreeding';

/**
 * La fenêtre d'accouplement du jeu, mais pour **saisir** au lieu de lire.
 *
 * La saisie se faisait sur une liste déroulante par couple : dix accouplements
 * demandaient dix ouvertures de liste à 120 couleurs, dix recherches à la
 * lettre, dix clics sur le sexe. Or ce qu'un accouplement peut rendre n'est pas
 * une couleur parmi 120 — c'est **quatre ou cinq**, celles de la génération
 * visée et celles de l'ascendance, et on les connaît à l'avance. Le jeu les
 * affiche d'ailleurs avant l'accouplement ; il n'y avait qu'à les reproduire.
 *
 * D'où deux clics par naissance, sur une liste courte, à côté de la probabilité
 * qui dit à quoi s'attendre. Voir `matingOutcomes`, qui reproduit cette liste au
 * centième sur le relevé #59.
 *
 * ## Le nom, qui est la vraie raison d'être de cet écran
 *
 * Une fois né, le poulain doit être **renommé dans le jeu** — c'est la seule
 * façon de le retrouver ensuite dans une écurie où tout s'appelle « Anonyme ».
 * Le nom dépend de ce qui est né, donc il ne peut pas être dicté avant. Il
 * s'affiche sur chaque issue, avant le clic : on lit la couleur obtenue, on voit
 * le nom à recopier, on clique.
 */

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Les couples de la fournée en cours, ceux dont on vient saisir le résultat. */
  couples: Couple[];
  /** Les montures suivies, pour retrouver niveau et ascendance derrière un couple. */
  individuals: Individual[];
  colors: BreedingColor[];
  nameOf: (colorId: string) => string;
  onRecord: (entries: BirthEntry[]) => Promise<void>;
};

/** Un accouplement et son résultat, tel qu'on le construit au fil des clics. */
type Recorded = { coupleIndex: number; colorId: string; sex: Sex; mountName: string };

const BreedingBirthDialog = ({
  isOpen,
  onClose,
  couples,
  individuals,
  colors,
  nameOf,
  onRecord,
}: Props) => {
  const [recorded, setRecorded] = useState<Recorded[]>([]);
  const [saving, setSaving] = useState(false);

  const generations = useMemo(
    () => new Map(colors.map((color) => [color.id, color.generation])),
    [colors]
  );

  /**
   * La monture derrière un côté de couple.
   *
   * Le vrac n'a ni niveau ni ascendance enregistrés : on lui prête le niveau 1,
   * comme partout ailleurs. Les probabilités affichées sont donc un plancher
   * quand un parent vient du vrac — le taux monte avec le niveau réel, il ne
   * descend jamais. Ce qui est né, lui, ne dépend pas de cette hypothèse.
   */
  const mateOf = useMemo(() => {
    const byId = new Map(individuals.map((mount) => [mount.id, mount]));
    return (side: Pairing): Mate => {
      const mount = side.mountId ? byId.get(side.mountId) : undefined;
      return mount
        ? {
            id: mount.id,
            colorId: mount.colorId,
            sex: mount.sex,
            level: mount.level,
            parents: mount.parents,
          }
        : { id: null, colorId: side.colorId, sex: side.sex, level: BULK_MATE_LEVEL, parents: null };
    };
  }, [individuals]);

  /**
   * Les couples regroupés par accouplement **identique** : mêmes couleurs, mêmes
   * ascendances des deux côtés.
   *
   * Dix couples formés sur la même recette ont exactement les mêmes issues et le
   * même nom à donner. En afficher dix arbres identiques ferait dix fois le même
   * travail de lecture ; on en affiche un, et on clique dix fois dedans.
   *
   * Les deux **orientations** se rangent ensemble : « ♂ Ébène × ♀ Orchidée » et
   * « ♂ Orchidée × ♀ Ébène » sont des montures différentes mais le même
   * croisement. Les issues n'en dépendent pas — la masse d'échec se partage
   * moitié-moitié entre les deux lignées, sans égard au sexe — et le nom non
   * plus, depuis qu'il range ses deux codes. Les séparer doublait l'écran pour
   * afficher deux fois la même chose.
   */
  const groups = useMemo(() => {
    const byKind = new Map<
      string,
      { indices: number[]; male: Mate; female: Mate; outcomes: MatingOutcome[] }
    >();

    couples.forEach((couple, index) => {
      const male = mateOf(couple.male);
      const female = mateOf(couple.female);
      const key = [mateSignature(male), mateSignature(female)].sort().join('//');
      const group = byKind.get(key);
      if (group) {
        group.indices.push(index);
        return;
      }
      byKind.set(key, {
        indices: [index],
        male,
        female,
        outcomes: matingOutcomes(male, female, colors, generations),
      });
    });

    return [...byKind.values()];
  }, [couples, mateOf, colors, generations]);

  /** Le nom à inscrire en jeu si telle couleur naît de tel couple. */
  const nameFor = (male: Mate, female: Mate, bornColorId: string) =>
    mountName(
      carriedGeneration(generations.get(bornColorId) ?? 1, [
        generations.get(male.colorId) ?? 1,
        generations.get(female.colorId) ?? 1,
      ]),
      [nameOf(male.colorId), nameOf(female.colorId)]
    );

  const recordedFor = (indices: number[]) =>
    recorded.filter((entry) => indices.includes(entry.coupleIndex));

  const add = (group: (typeof groups)[number], colorId: string, sex: Sex) => {
    const done = recordedFor(group.indices).length;
    // Un accouplement, une naissance : au-delà du nombre de couples du groupe,
    // il n'y a plus rien à saisir. Le bouton se désactive, ceci est la ceinture.
    if (done >= group.indices.length) return;
    setRecorded((current) => [
      ...current,
      {
        coupleIndex: group.indices[done],
        colorId,
        sex,
        mountName: nameFor(group.male, group.female, colorId),
      },
    ]);
  };

  const total = couples.length;
  const done = recorded.length;

  /** Ce qu'il faudra renommer en jeu, une ligne par nom et non par monture. */
  const namesToWrite = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of recorded) counts.set(entry.mountName, (counts.get(entry.mountName) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [recorded]);

  /**
   * Un côté de couple, sans le sexe : un groupe réunit les deux orientations,
   * et y afficher « ♂ » ferait croire que seuls les mâles de cette couleur sont
   * concernés. Quelle monture charger se lit dans la liste de la fournée, qui
   * est faite pour ça ; ici on identifie le croisement.
   */
  const label = (mate: Mate) => nameOf(mate.colorId);

  /**
   * L'ascendance d'un côté, en infobulle.
   *
   * Elle remplace l'identifiant de monture qui figurait ici : un groupe réunit
   * toutes les montures de **même** ascendance, donc désigner l'une d'elles par
   * son identifiant laissait croire que les autres n'étaient pas concernées.
   * L'ascendance, elle, est ce qui définit le groupe — et c'est aussi ce qui
   * décide des issues affichées en dessous.
   */
  const ancestryOf = (mate: Mate) =>
    mate.parents
      ? `Née de ${nameOf(mate.parents[0])} et ${nameOf(mate.parents[1])}`
      : 'Sans ascendance connue : achetée, capturée, ou pas encore suivie.';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Ce qui est né" size="lg">
      <div className="space-y-5">
        <p className="text-[11px] text-dark-500">
          Un accouplement rend <strong>toujours</strong> un bébé : les pourcentages portent sur
          sa couleur, pas sur sa venue au monde. Clique la couleur obtenue et son sexe, une
          fois par accouplement. Le nom à droite est celui à recopier{' '}
          <strong>dans le jeu</strong>
          {' — sans lui, cette monture redevient une « Anonyme » parmi d’autres.'}
        </p>

        {groups.map((group, groupIndex) => {
          const saisis = recordedFor(group.indices).length;
          const complete = saisis >= group.indices.length;

          return (
            <div key={groupIndex} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-dark-200" title={ancestryOf(group.male)}>
                  {label(group.male)}
                </span>
                <span className="text-dark-600">×</span>
                <span className="text-xs text-dark-200" title={ancestryOf(group.female)}>
                  {label(group.female)}
                </span>
                <span
                  className={`text-[10px] tabular-nums ${complete ? 'text-profit' : 'text-dark-500'}`}
                >
                  {saisis}/{group.indices.length} saisis
                </span>
              </div>

              {group.outcomes.length === 0 && (
                <p className="text-[11px] text-amber-400/80 pl-2">
                  Issues inconnues : une couleur de l&apos;ascendance manque au catalogue.
                </p>
              )}

              <div className="space-y-1">
                {group.outcomes.map((outcome) => (
                  <div
                    key={outcome.colorId}
                    className={`flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl text-xs
                      ${outcome.kind === 'target' ? 'bg-kamas/10' : 'bg-dark-800/40'}`}
                  >
                    <span className="text-dark-200 flex-1 truncate">
                      {nameOf(outcome.colorId)}
                    </span>
                    {outcome.kind === 'target' && (
                      <span className="text-[10px] text-kamas font-semibold">
                        GEN. {generations.get(outcome.colorId)}
                      </span>
                    )}
                    <span className="text-[10px] text-dark-500 tabular-nums w-12 text-right">
                      {(outcome.probability * 100).toFixed(1)} %
                    </span>
                    <code
                      className="text-[10px] text-dark-400 bg-dark-900/60 px-1.5 py-0.5 rounded-md"
                      title="Le nom à donner en jeu à ce poulain."
                    >
                      {nameFor(group.male, group.female, outcome.colorId)}
                    </code>
                    {(['M', 'F'] as const).map((sex) => (
                      <button
                        key={sex}
                        type="button"
                        disabled={complete}
                        onClick={() => add(group, outcome.colorId, sex)}
                        title={`Un ${sex === 'M' ? 'mâle' : 'femelle'} ${nameOf(outcome.colorId)} est né`}
                        className="px-2 py-1 rounded-lg text-[11px] border transition-all
                          bg-dark-800/80 border-dark-600/50 text-dark-300 hover:border-kamas/50
                          hover:text-kamas cursor-pointer disabled:opacity-30
                          disabled:cursor-not-allowed disabled:hover:border-dark-600/50"
                      >
                        {sex === 'M' ? '♂' : '♀'}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {namesToWrite.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-dark-700/40">
            <p className="text-[11px] text-dark-400">À renommer dans le jeu :</p>
            <div className="flex flex-wrap gap-1.5">
              {namesToWrite.map(([name, count]) => (
                <span
                  key={name}
                  className="text-[11px] text-dark-200 bg-dark-800/60 px-2 py-1 rounded-lg"
                >
                  <code>{name}</code>
                  {count > 1 && <span className="text-dark-500"> × {count}</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={saving || done === 0}
            onClick={async () => {
              setSaving(true);
              await onRecord(
                recorded.map((entry) => ({
                  male: couples[entry.coupleIndex].male,
                  female: couples[entry.coupleIndex].female,
                  colorId: entry.colorId,
                  sex: entry.sex,
                }))
              );
              setRecorded([]);
              setSaving(false);
              onClose();
            }}
          >
            {saving ? 'Enregistrement…' : `Enregistrer ${done} naissance${done > 1 ? 's' : ''}`}
          </Button>

          {done > 0 && (
            <button
              type="button"
              onClick={() => setRecorded([])}
              className="flex items-center gap-1 text-[11px] text-dark-500 hover:text-dark-300
                transition-colors cursor-pointer"
            >
              <RotateCcw size={11} /> tout effacer
            </button>
          )}

          {done === total ? (
            <span className="flex items-center gap-1 text-[11px] text-profit">
              <Check size={12} /> la fournée est complète
            </span>
          ) : (
            <span className="text-[10px] text-dark-600">
              {total - done} accouplement{total - done > 1 ? 's' : ''} sans résultat saisi — on
              peut enregistrer quand même et finir plus tard.
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default BreedingBirthDialog;
