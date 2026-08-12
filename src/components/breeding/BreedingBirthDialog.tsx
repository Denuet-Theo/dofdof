'use client';

import { useMemo, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import CopyableText from '@/components/ui/CopyableText';
import BreedingMatingPanel, { TO_BUY } from '@/components/breeding/BreedingMatingPanel';
import {
  matingOutcomes,
  mateSignature,
  pairOutlook,
  BULK_MATE_LEVEL,
  type Mate,
  type MatingOutcome,
} from '@/lib/dofus/breeding/pairing';
import {
  ANONYMOUS_NAME,
  carriedGeneration,
  colorCoder,
  mountName,
} from '@/lib/dofus/breeding/naming';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
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
 * La **disposition** vient ensuite : mâle à gauche, femelle à droite, œuf au
 * milieu, « Génération cible » puis « Autres » en dessous. C'est celle du jeu, et
 * elle se lit côte à côte avec lui — voir `BreedingMatingPanel`, qui la porte.
 * Ce module ne fait plus que découper la fournée en croisements et tenir le
 * compte de ce qui a été saisi.
 *
 * ## Le nom, qui est la vraie raison d'être de cet écran
 *
 * Une fois né, le poulain doit être **renommé dans le jeu** — c'est la seule
 * façon de le retrouver ensuite dans une écurie où tout s'appelle « Anonyme ».
 * Le nom dépend de ce qui est né, donc il ne peut pas être dicté avant. Il
 * s'affiche sur chaque issue, avant le clic ; après le clic il repasse en bas du
 * panneau, avec de quoi le copier d'un geste.
 */

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Les couples de la fournée en cours, ceux dont on vient saisir le résultat. */
  couples: Couple[];
  /** Les montures suivies, pour retrouver niveau, nom et ascendance derrière un couple. */
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

  const generationOf = (colorId: string) => generations.get(colorId) ?? 1;

  /** La vignette d'une couleur, tirée du certificat que `trees.json` lui rattache. */
  const icons = useMemo(
    () => new Map(colors.map((color) => [color.id, colorIconUrl(color)])),
    [colors]
  );
  const iconOf = (colorId: string) => icons.get(colorId) ?? null;

  /** Le codeur de la famille — c'est lui qui décide des deux lettres d'une couleur. */
  const code = useMemo(() => colorCoder(colors), [colors]);
  const codeOf = (colorId: string) => code(nameOf(colorId));

  /**
   * La monture derrière un côté de couple.
   *
   * Le vrac n'a ni niveau ni ascendance enregistrés : on lui prête le niveau 1,
   * comme partout ailleurs. Les probabilités affichées sont donc un plancher
   * quand un parent vient du vrac — le taux monte avec le niveau réel, il ne
   * descend jamais. Ce qui est né, lui, ne dépend pas de cette hypothèse.
   */
  const byId = useMemo(
    () => new Map(individuals.map((mount) => [mount.id, mount])),
    [individuals]
  );

  const mateOf = useMemo(() => {
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
  }, [byId]);

  /**
   * Les couples regroupés par croisement **identique** : mêmes couleurs, mêmes
   * ascendances, et du même côté.
   *
   * Dix couples formés sur la même recette ont exactement les mêmes issues et le
   * même nom à donner. En afficher dix panneaux identiques ferait dix fois le
   * même travail de lecture ; on en affiche un, et on clique dix fois dedans.
   *
   * Les deux **orientations** se rangeaient ensemble, du temps où l'écran
   * n'affichait qu'une ligne « Ébène × Orchidée » : les issues n'en dépendent
   * pas — `matingOutcomes` est symétrique d'un bout à l'autre, puisqu'une paire
   * de teintes se lit triée — et le nom non plus, depuis qu'il range ses deux
   * codes. Elles se séparent de nouveau, et pour une raison qui n'existait pas
   * alors : le panneau **désigne un mâle à gauche et une femelle à droite**.
   * Fondre « ♂ Ébène × ♀ Orchidée » et son miroir dans un seul panneau
   * obligerait à choisir un côté pour les deux, donc à en désigner un faux — et
   * c'est précisément ce que cet écran est là pour éviter devant l'enclos.
   */
  const groups = useMemo(() => {
    const byKind = new Map<
      string,
      {
        indices: number[];
        male: Mate;
        female: Mate;
        maleNames: string[];
        femaleNames: string[];
        outcomes: MatingOutcome[];
        targetGeneration: number | null;
        genetons: number;
        successRate: number;
      }
    >();

    /**
     * Le nom porté **en jeu** par un côté de couple, « Anonyme » par défaut.
     *
     * Sauf quand le plan propose de l'acheter : elle n'est alors dans aucun
     * coffre, et l'annoncer « Anonyme » envoyait l'éleveur chercher une monture
     * qu'il n'a pas. Voir `Pairing.bought`.
     */
    const gameNameOf = (side: Pairing) =>
      side.bought && !side.mountId
        ? TO_BUY
        : ((side.mountId ? byId.get(side.mountId)?.name : null) ?? ANONYMOUS_NAME);

    couples.forEach((couple, index) => {
      const male = mateOf(couple.male);
      const female = mateOf(couple.female);
      const key = `${mateSignature(male)}//${mateSignature(female)}`;
      const group = byKind.get(key);

      if (group) {
        group.indices.push(index);
        // Un même croisement peut charger des montures nommées différemment —
        // l'une renommée, l'autre pas. Toutes se cherchent dans l'écurie, donc
        // toutes s'affichent.
        for (const [names, side] of [
          [group.maleNames, couple.male],
          [group.femaleNames, couple.female],
        ] as const) {
          const name = gameNameOf(side);
          if (!names.includes(name)) names.push(name);
        }
        return;
      }

      const outlook = pairOutlook(male, female, colors, generations);
      byKind.set(key, {
        indices: [index],
        male,
        female,
        maleNames: [gameNameOf(couple.male)],
        femaleNames: [gameNameOf(couple.female)],
        outcomes: matingOutcomes(male, female, colors, generations),
        targetGeneration: outlook?.targetGeneration ?? null,
        genetons: outlook?.genetons ?? 0,
        successRate: outlook?.successRate ?? 0,
      });
    });

    return [...byKind.values()];
  }, [couples, mateOf, byId, colors, generations]);

  /** Le nom à inscrire en jeu si telle couleur, de tel sexe, naît de tel couple. */
  const nameFor = (male: Mate, female: Mate, bornColorId: string, sex: Sex) =>
    mountName({
      carriedGeneration: carriedGeneration(generationOf(bornColorId), [
        generationOf(male.colorId),
        generationOf(female.colorId),
      ]),
      colorName: nameOf(bornColorId),
      sex,
      parentNames: [nameOf(male.colorId), nameOf(female.colorId)],
      code,
    });

  const recordedFor = (indices: number[]) =>
    recorded.filter((entry) => indices.includes(entry.coupleIndex));

  const add = (group: (typeof groups)[number], colorId: string, sex: Sex) => {
    const done = recordedFor(group.indices).length;
    // Un accouplement, une naissance : au-delà du nombre de couples du groupe,
    // il n'y a plus rien à saisir. Les boutons se désactivent, ceci est la ceinture.
    if (done >= group.indices.length) return;
    setRecorded((current) => [
      ...current,
      {
        coupleIndex: group.indices[done],
        colorId,
        sex,
        mountName: nameFor(group.male, group.female, colorId, sex),
      },
    ]);
  };

  /** Défait la dernière naissance saisie sur ce croisement, et elle seule. */
  const undoLast = (group: (typeof groups)[number]) => {
    setRecorded((current) => {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        if (group.indices.includes(current[index].coupleIndex)) {
          return current.filter((_, position) => position !== index);
        }
      }
      return current;
    });
  };

  const total = couples.length;
  const done = recorded.length;

  /** Ce qu'il faudra renommer en jeu, une ligne par nom et non par monture. */
  const namesToWrite = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of recorded)
      counts.set(entry.mountName, (counts.get(entry.mountName) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [recorded]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Ce qui est né" size="xl">
      <div className="space-y-5">
        <p className="text-[11px] text-dark-500">
          Un accouplement rend <strong>toujours</strong> un bébé : les pourcentages portent sur
          sa couleur, pas sur sa venue au monde. Clique la couleur obtenue et son sexe, une
          fois par accouplement. Le nom qui apparaît est celui à recopier{' '}
          <strong>dans le jeu</strong>
          {' — sans lui, cette monture redevient une « Anonyme » parmi d’autres.'}
        </p>

        {groups.map((group, groupIndex) => (
          <BreedingMatingPanel
            key={groupIndex}
            male={group.male}
            female={group.female}
            maleNames={group.maleNames}
            femaleNames={group.femaleNames}
            outcomes={group.outcomes}
            targetGeneration={group.targetGeneration}
            genetons={group.genetons}
            successRate={group.successRate}
            total={group.indices.length}
            nameOf={nameOf}
            generationOf={generationOf}
            iconOf={iconOf}
            codeOf={codeOf}
            nameFor={(colorId, sex) => nameFor(group.male, group.female, colorId, sex)}
            births={recordedFor(group.indices).map((entry) => ({
              colorId: entry.colorId,
              sex: entry.sex,
              name: entry.mountName,
            }))}
            onPick={(colorId, sex) => add(group, colorId, sex)}
            onUndoLast={() => undoLast(group)}
          />
        ))}

        {/* Le récapitulatif, quand la fournée porte plusieurs croisements : c'est
            la liste qu'on garde sous les yeux pendant qu'on renomme, et elle
            compte les doublons au lieu de les répéter. */}
        {namesToWrite.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-dark-700/40">
            <p className="text-[11px] text-dark-400">À renommer dans le jeu :</p>
            <div className="flex flex-wrap gap-1.5">
              {namesToWrite.map(([name, count]) => (
                <span key={name} className="flex items-center gap-1.5">
                  <CopyableText value={name} />
                  {count > 1 && <span className="text-[10px] text-dark-500">× {count}</span>}
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
            <span className="flex items-center gap-1 text-[11px] text-gain">
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
