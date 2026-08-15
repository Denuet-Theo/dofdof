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

  /**
   * Les clonages où il y a réellement quelque chose à trancher.
   *
   * Un clonage entre **deux anonymes** n'en est pas un : elles ont la même
   * couleur, la même génération, aucune ascendance et aucun nom. Rien ne les
   * distingue à l'écran parce que rien ne les distingue en jeu, et « laquelle
   * gardes-tu » n'a alors pas de réponse — les deux mènent au même clone. Les
   * faire défiler une par une, c'est vingt écrans qui demandent de choisir
   * entre une chose et elle-même.
   *
   * Elles ne disparaissent pas pour autant : elles se font en jeu comme les
   * autres, et deux stériles y partent bien pour une fertile. Elles se comptent
   * donc en tête, dans une ligne qui dit combien il y en a, et se tranchent
   * toutes seules — le premier des deux identifiants, puisque le choix est vide.
   */
  const undecidable = (entry: CloningToRecord) =>
    !byId.get(entry.first)?.name && !byId.get(entry.second)?.name;

  const anonymous = useMemo(
    () => clonings.filter(undecidable),
    // `byId` suffit : `undecidable` n'en dépend que par lui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clonings, byId]
  );
  const decisions = useMemo(
    () => clonings.filter((entry) => !undecidable(entry)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clonings, byId]
  );

  const at = decisions.findIndex((_, index) => !kept.has(index));
  const current = at >= 0 ? decisions[at] : null;
  const done = kept.size;

  /**
   * Une des deux stériles, telle qu'on la choisit.
   *
   * L'ascendance est affichée parce que c'est ce qui décide de leurs cibles : même
   * génération — le clonage l'exige — mais pas les mêmes possibilités ensuite.
   *
   * Le **sexe** est affiché parce que c'est ce qui permet de les retrouver. Deux
   * gen 1 anonymes de même couleur et sans ascendance donnaient deux cartes
   * rigoureusement identiques : même vignette, même « Doré », même « sans
   * ascendance connue », même « Anonyme ». L'écran demandait alors de choisir
   * entre deux choses indiscernables, et le choix ne pouvait pas se reporter en
   * jeu — où le sexe est justement le seul tri disponible sur un tas d'Anonymes.
   *
   * Tous les autres écrans d'élevage le portent déjà — l'écurie, l'extraction,
   * la sortie d'enclos, la fenêtre d'accouplement. Celui-ci était le seul à
   * l'oublier, et c'est celui où deux montures se ressemblent le plus.
   */
  const card = (mountId: string, side: 'left' | 'right') => {
    const mount = byId.get(mountId);
    if (!mount) return null;
    const icon = iconOf(mount.colorId);
    const parents = mount.parents
      ? `${nameOf(mount.parents[0])} × ${nameOf(mount.parents[1])}`
      : 'sans ascendance connue';

    return (
      // Une carte **et** un bouton, et non une carte qui **est** un bouton.
      //
      // Toute la carte était cliquable, ce qui rendait son texte inatteignable :
      // sélectionner le nom pour le copier revenait à trancher le clonage. Or
      // c'est ce nom-là qu'on va chercher dans l'écurie du jeu — la carte
      // existe pour lui autant que pour le choix.
      //
      // D'où la séparation : le contenu se lit et se sélectionne, et le geste a
      // son bouton, nommé. Ça règle aussi un défaut de structure — `CopyableText`
      // est un bouton, et un bouton dans un bouton n'est pas du HTML valide,
      // donc le nom ne pouvait pas devenir copiable tant que la carte en était un.
      <div
        data-testid="clone-card"
        className="flex-1 flex flex-col items-center gap-2 px-4 py-4 rounded-2xl border
          bg-dark-800/60 border-dark-600/50 transition-all hover:border-dark-500"
      >
        {icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" className="w-12 h-12 object-contain" />
        )}
        <span className="flex items-center gap-1.5 text-sm font-semibold text-dark-100">
          <span
            data-testid="clone-sex"
            className={mount.sex === 'M' ? 'text-info' : 'text-loss-light'}
            title={mount.sex === 'M' ? 'Mâle' : 'Femelle'}
          >
            {mount.sex === 'M' ? '♂' : '♀'}
          </span>
          {nameOf(mount.colorId)}
        </span>
        <span className={`text-[11px] text-dark-400 ${side === 'left' ? 'text-left' : 'text-right'}`}>
          {parents}
        </span>
        {mount.name ? (
          <CopyableText
            value={mount.name}
            title={`Copier « ${mount.name} » — le nom à chercher dans l’écurie du jeu`}
          />
        ) : (
          <span
            className="text-[11px] text-dark-500"
            title="Monture non renommée : prends-en une de ce sexe dans le tas, elles sont interchangeables."
          >
            {ANONYMOUS_NAME}
          </span>
        )}
        <Button
          size="sm"
          variant="secondary"
          className="mt-1 w-full"
          onClick={() =>
            setKept((current) => new Map(current).set(at, side === 'left' ? 'first' : 'second'))
          }
          title="Le clone prend sa place, son nom et son ascendance. L’autre stérile disparaît."
        >
          Garder celle-ci
        </Button>
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        decisions.length === 0
          ? `Clonages — ${clonings.length} à faire`
          : `Clonage ${Math.min(done + 1, decisions.length)} / ${decisions.length}`
      }
    >
      <div className="space-y-4">
        {/* Les clonages sans arbitrage, comptés en tête plutôt que déroulés un
            par un. Ils restent à faire **en jeu** : c'est tout ce que cette
            ligne a à dire, et c'est pour ça qu'elle existe. */}
        {anonymous.length > 0 && (
          <p
            data-testid="clone-anonymous-note"
            className="flex items-start gap-2 px-3 py-2 rounded-xl bg-dark-800/60
              border border-dark-600/50 text-[11px] text-dark-300"
          >
            <Dna size={13} className="text-dark-500 mt-0.5 shrink-0" />
            <span>
              <strong className="text-dark-100">
                {anonymous.length} clonage{anonymous.length > 1 ? 's' : ''} entre anonymes
              </strong>{' '}
              — rien à départager : elles ont la même couleur, la même génération et aucune
              ascendance, donc les deux mènent au même clone. Prends-en deux au hasard dans le
              tas. <strong className="text-dark-100">Ne les oublie pas</strong> : elles comptent
              dans la fournée et sont enregistrées avec les autres.
            </span>
          </p>
        )}

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
              {decisions.length === 0
                ? 'Aucun clonage ne demande d’arbitrage sur cette fournée.'
                : `Les ${decisions.length} clonages à départager sont tranchés. Les noms à chercher dans l’écurie du jeu :`}
            </p>
            {/* Le sexe accompagne chaque nom, et il n'est pas décoratif sur les
                anonymes : c'est le seul tri dont on dispose devant un tas
                d'« Anonyme » de même couleur. Une liste de six « Anonyme » nus
                ne dit pas lesquelles aller chercher. */}
            <div className="flex flex-wrap gap-2">
              {[...kept].map(([index, choice]) => {
                const entry = decisions[index];
                const id = choice === 'first' ? entry.first : entry.second;
                const mount = byId.get(id);
                const name = mount?.name ?? ANONYMOUS_NAME;

                return (
                  <span key={`${id}-${index}`} className="flex items-center gap-1.5">
                    {mount && (
                      <span
                        className={`text-[11px] ${
                          mount.sex === 'M' ? 'text-info' : 'text-loss-light'
                        }`}
                        title={mount.sex === 'M' ? 'Mâle' : 'Femelle'}
                      >
                        {mount.sex === 'M' ? '♂' : '♀'}
                      </span>
                    )}
                    {name === ANONYMOUS_NAME ? (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 text-dark-500"
                        title="Monture non renommée : prends-en une de ce sexe dans le tas, elles sont interchangeables."
                      >
                        {name}
                      </span>
                    ) : (
                      <CopyableText value={name} title={`Copier « ${name} »`} />
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Collée en bas, pour la même raison qu'à la saisie des naissances : un
            bouton qui sort de l'écran fait croire que le geste est fait. Voir
            `BreedingBirthDialog`, où ça a coûté une soirée de saisie. */}
        <div
          className="sticky bottom-0 -mx-1 px-1 py-3 flex items-center gap-2
            bg-dark-900/95 backdrop-blur-sm border-t border-dark-700/60"
        >
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
            {done} / {decisions.length}
          </span>
          <Button
            size="sm"
            variant={current ? 'secondary' : 'primary'}
            className="ml-auto"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onRecord([
                ...[...kept].map(([index, choice]) => {
                  const entry = decisions[index];
                  return choice === 'first'
                    ? { keep: entry.first, drop: entry.second }
                    : { keep: entry.second, drop: entry.first };
                }),
                // Les clonages entre anonymes n'ont pas été tranchés parce qu'il
                // n'y avait rien à trancher. Ils sont faits en jeu comme les
                // autres, donc ils s'enregistrent comme les autres — sur le
                // premier des deux, arbitrairement, puisque les deux mènent au
                // même clone. Les omettre laisserait l'écurie avec des stériles
                // que le jeu n'a plus.
                ...anonymous.map((entry) => ({ keep: entry.first, drop: entry.second })),
              ]);
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
