'use client';

import { useMemo, useState } from 'react';
import { Check, Dna, RotateCcw } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import CopyableText from '@/components/ui/CopyableText';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
import { ANONYMOUS_NAME } from '@/lib/dofus/breeding/naming';
import type { Individual } from '@/lib/dofus/breeding/stable';
import type { CloningToRecord } from '@/lib/dofus/breeding/policy';

/**
 * Le clonage, un par un — le pendant de `BreedingBirthDialog`.
 *
 * ## Pourquoi il faut choisir
 *
 * Deux stériles entrent, **une** monture sort. Le jeu ne dit pas laquelle : c'est
 * l'éleveur qui décide de quelle monture le clone prend la place, et ce choix n'est
 * pas neutre — les deux ont la même génération affichée, sans quoi le clonage
 * serait refusé, mais pas la même **ascendance**. Or c'est l'ascendance qui décide
 * de ce que la monture pourra viser ensuite.
 *
 * D'où deux cartes côte à côte plutôt qu'une confirmation : on montre ce que chacune
 * porte, et le clic dit laquelle survit.
 *
 * ## Le nom, encore
 *
 * Comme pour une naissance, la seule chose qui se lise dans l'écurie du jeu est le
 * **nom**. Le clone hérite de celui qu'on a choisi, donc on le donne à copier au
 * moment du clic — c'est ce qu'on ira chercher devant le coffre, et c'est la raison
 * d'être de cet écran autant que la saisie elle-même.
 *
 * ## Ce qu'il enregistre
 *
 * Les deux stériles disparaissent, une fertile prend la place de celle qu'on a
 * gardée — même couleur, même ascendance, même nom, mais sa reproduction retrouvée.
 * Pas « une des deux redevient fertile » : un clonage consomme bien **deux**
 * montures pour en rendre une, et laisser la seconde traîner fausserait le compte.
 *
 * Une stérile est toujours une monture suivie — le vrac ne porte que des fertiles,
 * par construction du type — donc il n'y a jamais rien à deviner.
 */

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Les clonages de la fournée, chacun avec ses deux stériles. */
  clonings: CloningToRecord[];
  /** Les montures suivies, pour retrouver nom et ascendance derrière un identifiant. */
  individuals: Individual[];
  colors: BreedingColor[];
  nameOf: (colorId: string) => string;
  /** Enregistre les clonages tranchés : deux stériles partent, une fertile entre. */
  onRecord: (entries: { keep: string; drop: string }[]) => Promise<void>;
};

const BreedingCloneDialog = ({
  isOpen,
  onClose,
  clonings,
  individuals,
  colors,
  nameOf,
  onRecord,
}: Props) => {
  const [saving, setSaving] = useState(false);
  /** Les clonages tranchés : l'indice, et **quelle** des deux on garde. */
  const [kept, setKept] = useState<Map<number, 'first' | 'second'>>(new Map());

  const byId = useMemo(
    () => new Map(individuals.map((mount) => [mount.id, mount])),
    [individuals]
  );
  const iconOf = useMemo(() => {
    const icons = new Map(colors.map((color) => [color.id, colorIconUrl(color)]));
    return (colorId: string) => icons.get(colorId) ?? null;
  }, [colors]);

  const at = clonings.findIndex((_, index) => !kept.has(index));
  const current = at >= 0 ? clonings[at] : null;
  const done = kept.size;

  /**
   * Une des deux stériles, telle qu'on la choisit.
   *
   * L'ascendance est affichée parce que c'est la seule chose qui les sépare : même
   * génération — le clonage l'exige — mais pas les mêmes cibles ensuite.
   */
  const card = (mountId: string, side: 'left' | 'right') => {
    const mount = byId.get(mountId);
    if (!mount) return null;
    const icon = iconOf(mount.colorId);
    const parents = mount.parents
      ? `${nameOf(mount.parents[0])} × ${nameOf(mount.parents[1])}`
      : 'sans ascendance connue';

    return (
      <button
        type="button"
        onClick={() => setKept((current) => new Map(current).set(at, side === 'left' ? 'first' : 'second'))}
        className={`flex-1 flex flex-col items-center gap-2 px-4 py-4 rounded-2xl border
          transition-all cursor-pointer bg-dark-800/60 border-dark-600/50
          hover:border-kamas/50 hover:bg-dark-800 ${side === 'left' ? 'text-left' : 'text-right'}`}
        title={`Garder cette monture : le clone prend sa place, son nom et son ascendance.`}
      >
        {icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" className="w-12 h-12 object-contain" />
        )}
        <span className="text-sm font-semibold text-dark-100">{nameOf(mount.colorId)}</span>
        <span className="text-[11px] text-dark-400">{parents}</span>
        <span className="text-[11px] text-dark-300">
          {mount.name ?? <em className="not-italic text-dark-500">{ANONYMOUS_NAME}</em>}
        </span>
      </button>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Clonage ${Math.min(done + 1, clonings.length)} / ${clonings.length}`}
    >
      <div className="space-y-4">
        {current ? (
          <>
            <p className="text-[11px] text-dark-400">
              Deux stériles entrent, une monture sort.{' '}
              <strong className="text-dark-200">Laquelle gardes-tu ?</strong> Elles ont la
              même génération — le jeu l’exige — mais pas la même ascendance, et c’est
              l’ascendance qui décide de ce que le clone pourra viser.
            </p>

            <div className="flex items-stretch gap-3">
              {card(current.first, 'left')}
              <div className="flex flex-col items-center justify-center gap-1 px-2">
                <Dna size={18} className="text-kamas" />
                <span className="text-[10px] text-dark-500 tabular-nums">
                  gén. {current.generation}
                </span>
              </div>
              {card(current.second, 'right')}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] text-dark-300">
              Les {clonings.length} clonages sont tranchés. Les noms à chercher dans
              l’écurie du jeu :
            </p>
            <div className="flex flex-wrap gap-2">
              {[...kept].map(([index, choice]) => {
                const entry = clonings[index];
                const id = choice === 'first' ? entry.first : entry.second;
                return byId.get(id)?.name ?? ANONYMOUS_NAME;
              }).map((name, index) =>
                name === ANONYMOUS_NAME ? (
                  <span
                    key={`${name}-${index}`}
                    className="text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 text-dark-500"
                    title="Monture non renommée : prends-en une dans le tas, elles sont interchangeables."
                  >
                    {name}
                  </span>
                ) : (
                  <CopyableText
                    key={`${name}-${index}`}
                    value={name}
                    title={`Copier « ${name} »`}
                  />
                )
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          {done > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setKept((current) => {
                  const next = new Map(current);
                  next.delete(Math.max(...[...next.keys()]));
                  return next;
                })
              }
            >
              <RotateCcw size={13} />
              Revenir
            </Button>
          )}
          <span className="text-[11px] text-dark-500 tabular-nums">
            {done} / {clonings.length}
          </span>
          <Button
            size="sm"
            variant={current ? 'secondary' : 'primary'}
            className="ml-auto"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onRecord(
                [...kept].map(([index, choice]) => {
                  const entry = clonings[index];
                  return choice === 'first'
                    ? { keep: entry.first, drop: entry.second }
                    : { keep: entry.second, drop: entry.first };
                })
              );
              setSaving(false);
              onClose();
            }}
          >
            <Check size={13} />
            {current ? 'Terminer plus tard' : 'C’est fait'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default BreedingCloneDialog;
