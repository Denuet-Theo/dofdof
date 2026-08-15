'use client';

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
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
import type { BirthEntry, BirthRecord, RecordBirthsResult } from '@/lib/hooks/useBreeding';

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
 *
 * ## Un clic, une écriture — et plus de brouillon
 *
 * Les saisies s'empilaient dans un `useState` et ne partaient en base qu'au
 * bouton « Enregistrer N naissances ». Deux façons de tout perdre, et les deux
 * se sont produites :
 *
 * * la fenêtre se refermait — le brouillon survivait en mémoire, mais un
 *   rechargement de page l'emportait ;
 * * l'enregistrement échouait — la fenêtre se refermait quand même en annonçant
 *   le succès, et le brouillon était effacé. Le 15 août 2026, 22 naissances.
 *
 * Chaque clic écrit donc maintenant sa naissance immédiatement. Ce que le
 * panneau affiche comme « né » est ce que la base contient, jamais autre chose :
 * un clic refusé ne s'affiche pas, et son erreur reste à l'écran. Il n'y a plus
 * de bouton d'enregistrement, parce qu'il n'y a plus rien à enregistrer.
 *
 * Le prix à payer, assumé : « annuler le dernier » doit défaire une écriture
 * réelle — voir `undoBirth`, qui supprime le poulain et rend aux deux parents
 * l'état exact qu'ils avaient avant le clic.
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
  onRecord: (entries: BirthEntry[]) => Promise<RecordBirthsResult>;
  /** Défait une naissance déjà écrite — voir `undoBirth` dans `useBreeding`. */
  onUndo: (record: BirthRecord) => Promise<boolean>;
};

/**
 * Un accouplement et son résultat — **déjà en base**.
 *
 * `record` est ce que la base a rendu : c'est lui qui permet de défaire. Sa
 * présence est aussi ce qui distingue cette liste d'un brouillon — on n'y entre
 * qu'après une écriture réussie.
 */
type Recorded = {
  coupleIndex: number;
  colorId: string;
  sex: Sex;
  mountName: string;
  record: BirthRecord;
};

const BreedingBirthDialog = ({
  isOpen,
  onClose,
  couples,
  individuals,
  colors,
  nameOf,
  onRecord,
  onUndo,
}: Props) => {
  const [recorded, setRecorded] = useState<Recorded[]>([]);

  /**
   * La fournée **figée à l'ouverture**, et pourquoi elle doit l'être.
   *
   * `couples` vient de `policyCouples`, qui se recalcule dès que l'écurie
   * change. Or chaque clic écrit désormais une naissance et stérilise ses deux
   * parents : l'écurie change donc à **chaque** saisie, la politique repropose
   * une autre fournée, et la liste se réordonne sous les doigts.
   *
   * Les naissances déjà saisies se repèrent par leur indice dans cette liste.
   * Un réordonnancement les rattache donc à d'autres couples : le panneau
   * « Indigo × Indigo-Pourpre » affichait un poulain nommé `G1 IN M DO-IN`,
   * venu d'un croisement Doré × Indigo saisi juste avant, et se croyait complet
   * — donc plus aucun sexe cliquable dessus. Pire, un clic suivant aurait lu
   * `couples[coupleIndex]` dans la **nouvelle** liste et stérilisé deux montures
   * qui n'étaient pas celles du panneau.
   *
   * D'où l'instantané : la fenêtre montre la fournée telle qu'elle était quand
   * on l'a ouverte, et la saisie porte du début à la fin sur ces couples-là.
   * C'est aussi le bon modèle mental — « voici les 17 accouplements, saisis
   * leurs 17 résultats » — et la liste se rafraîchit à la réouverture.
   *
   * Le motif d'état dérivé des props est celui que React documente et que
   * `ItemPriceInput` utilise déjà : on compare, on corrige pendant le rendu.
   */
  const [batch, setBatch] = useState<Couple[] | null>(null);
  if (isOpen && batch === null) setBatch(couples);
  if (!isOpen && batch !== null) {
    setBatch(null);
    // Rien à conserver : tout est en base, et la fournée suivante n'a aucune
    // raison de porter les naissances de celle-ci.
    setRecorded([]);
  }
  const session = batch ?? couples;

  /**
   * Le croisement dont l'écriture est en vol, s'il y en a une.
   *
   * Un seul à la fois, et c'est voulu : deux clics rapides sur le même panneau
   * écriraient deux naissances pour un seul accouplement restant, et l'écurie
   * n'a aucun moyen de deviner laquelle est en trop.
   */
  const [pending, setPending] = useState<number | null>(null);
  /** Le dernier refus de la base, affiché sur le panneau qui l'a reçu. */
  const [refused, setRefused] = useState<{ groupIndex: number; message: string } | null>(null);

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

    session.forEach((couple, index) => {
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
  }, [session, mateOf, byId, colors, generations]);

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

  /**
   * Un clic : la naissance part en base, et n'apparaît à l'écran que si elle y
   * est arrivée.
   *
   * L'ordre compte. On n'ajoute **rien** à `recorded` avant le retour de la
   * base : poser la ligne d'abord pour la retirer en cas d'échec ferait
   * clignoter une naissance qui n'a jamais eu lieu, et c'est le clignotement
   * qu'on croit avoir vu passer.
   */
  const add = async (
    group: (typeof groups)[number],
    groupIndex: number,
    colorId: string,
    sex: Sex
  ) => {
    // Une écriture à la fois : deux clics rapides écriraient deux naissances
    // pour un seul accouplement restant, et rien ne dirait ensuite laquelle est
    // en trop.
    if (pending !== null) return;
    const done = recordedFor(group.indices).length;
    /**
     * Un accouplement, une naissance : au-delà du nombre de couples du groupe,
     * il n'y a plus rien à saisir. Les boutons se désactivent déjà, ceci est la
     * ceinture.
     *
     * Elle a servi, et en silence : quand la fournée se réordonnait sous les
     * doigts, un panneau pouvait se croire complet à tort et ce `return`
     * avalait le clic — rien d'écrit, rien d'affiché, et l'éleveur croyait sa
     * naissance enregistrée. C'est arrivé le 15/08 sur la deuxième d'une série
     * de deux. Un geste sans effet se dit maintenant, comme un refus de la base.
     */
    if (done >= group.indices.length) {
      setRefused({
        groupIndex,
        message:
          'les accouplements de ce croisement ont déjà tous leur résultat — rien n’a été ' +
          'enregistré. Referme et rouvre la fenêtre pour repartir de la fournée à jour.',
      });
      return;
    }
    const coupleIndex = group.indices[done];

    setPending(groupIndex);
    setRefused(null);
    const result = await onRecord([
      {
        male: session[coupleIndex].male,
        female: session[coupleIndex].female,
        colorId,
        sex,
      },
    ]);
    setPending(null);

    if (!result.ok) {
      setRefused({ groupIndex, message: result.message });
      return;
    }
    const record = result.born[0];
    if (!record) {
      setRefused({
        groupIndex,
        message: 'La base n’a rendu aucune ligne pour cette naissance. Elle n’est pas enregistrée.',
      });
      return;
    }

    setRecorded((current) => [
      ...current,
      {
        coupleIndex,
        colorId,
        sex,
        mountName: nameFor(group.male, group.female, colorId, sex),
        record,
      },
    ]);
  };

  /**
   * Défait la dernière naissance de ce croisement — pour de vrai.
   *
   * Ce n'est plus le retrait d'une ligne de brouillon : le poulain est en base,
   * donc il faut l'en sortir et rendre aux deux parents l'état qu'ils avaient
   * avant le clic. Voir `undoBirth`.
   */
  const undoLast = async (group: (typeof groups)[number], groupIndex: number) => {
    if (pending !== null) return;
    const mine = recordedFor(group.indices);
    const last = mine[mine.length - 1];
    if (!last) return;

    setPending(groupIndex);
    setRefused(null);
    const undone = await onUndo(last.record);
    setPending(null);

    if (!undone) {
      setRefused({
        groupIndex,
        message: `« ${last.mountName} » n’a pas pu être retirée : elle est toujours en écurie.`,
      });
      return;
    }
    setRecorded((current) => current.filter((entry) => entry !== last));
  };

  const total = session.length;
  const done = recorded.length;

  /** Ce qu'il faudra renommer en jeu, une ligne par nom et non par monture. */
  const namesToWrite = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of recorded)
      counts.set(entry.mountName, (counts.get(entry.mountName) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [recorded]);

  return (
    <Modal
      // Plus de confirmation à la fermeture : il n'y a plus rien à perdre. Tout
      // ce que la fenêtre affiche est déjà en base, et ce qui n'y est pas n'est
      // pas affiché.
      isOpen={isOpen}
      onClose={onClose}
      title="Ce qui est né"
      size="xl"
    >
      <div className="space-y-5">
        <p className="text-[11px] text-dark-500">
          Un accouplement rend <strong>toujours</strong> un bébé : les pourcentages portent sur
          sa couleur, pas sur sa venue au monde. Clique la couleur obtenue et son sexe, une
          fois par accouplement. Le nom qui apparaît est celui à recopier{' '}
          <strong>dans le jeu</strong>
          {' — sans lui, cette monture redevient une « Anonyme » parmi d’autres.'}
        </p>

        <p className="text-[11px] text-gain">
          Chaque clic enregistre aussitôt : il n&apos;y a rien à valider, et rien ne se perd en
          fermant. Ce qui s&apos;affiche en « né » est dans l&apos;écurie.
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
            onPick={(colorId, sex) => add(group, groupIndex, colorId, sex)}
            onUndoLast={() => undoLast(group, groupIndex)}
            busy={pending === groupIndex}
            /* Le refus s'affiche sur le panneau qui l'a reçu, en plus de la
               bannière : celle-ci dit qu'il y a un problème, celui-là dit sur
               quel croisement recliquer. */
            refusal={refused?.groupIndex === groupIndex ? refused.message : null}
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

        {/* La barre ne porte plus de bouton d'enregistrement — il n'y a plus rien
            à enregistrer — mais elle reste collée en bas : sur quatorze couples la
            fenêtre fait plusieurs écrans, et l'avancement est ce qu'on veut voir
            sans remonter. */}
        <div
          className="sticky bottom-0 -mx-1 px-1 py-3 flex flex-wrap items-center gap-3
            bg-dark-900/95 backdrop-blur-sm border-t border-dark-700/60"
        >
          <span className="text-[11px] text-dark-300 tabular-nums">
            {done}/{total} enregistrée{done > 1 ? 's' : ''}
          </span>

          {done === total ? (
            <span className="flex items-center gap-1 text-[11px] text-gain">
              <Check size={12} /> la fournée est complète
            </span>
          ) : (
            <span className="text-[10px] text-dark-600">
              {total - done} accouplement{total - done > 1 ? 's' : ''} sans résultat saisi — on
              peut fermer et finir plus tard, rien ne se perd.
            </span>
          )}

          <Button size="sm" variant="secondary" className="ml-auto" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default BreedingBirthDialog;
