'use client';

import { useMemo, useState } from 'react';
import { Check, LogOut } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import ColorChip, { GenBadge } from '@/components/breeding/ColorChip';
import { colorIconUrl, type BreedingColor } from '@/lib/dofus/breeding/costs';
import { ANONYMOUS_NAME, colorCoder } from '@/lib/dofus/breeding/naming';
import { parseCountedMountId } from '@/lib/dofus/breeding/search';
import type { Individual, Sex } from '@/lib/dofus/breeding/stable';

/**
 * La sortie d'enclos : ce que le parcours n'écrivait nulle part.
 *
 * Le ruban savait dire quoi charger, quand ce serait fini, et quoi saisir
 * ensuite. Entre les deux, **rien n'était enregistré** : une fournée de quarante
 * places laissait quarante cases à recocher une par une dans « Mes stocks », et
 * tant qu'elles ne l'étaient pas, la politique voyait des fertiles là où
 * l'éleveur tenait des fécondes — elle leur réservait des places d'enclos déjà
 * payées et proposait d'acheter à côté.
 *
 * Cet écran ferme la boucle, et il pose la seule question que le jeu ne nous dira
 * pas.
 *
 * ## Pourquoi il demande les niveaux
 *
 * Une monture ne ressort pas de l'enclos comme elle y est entrée : elle a monté.
 * Et le niveau n'est pas une décoration — il décide du **taux de réussite** d'un
 * croisement, donc de ce que la politique proposera au tour suivant. Le relever
 * ailleurs voudrait dire le relever plus tard, c'est-à-dire jamais : la seule
 * fois où l'éleveur a les quarante fiches sous les yeux, c'est en les sortant.
 *
 * D'où un champ par monture, prérempli avec le niveau connu — corriger deux
 * lignes sur quarante est supportable, ressaisir quarante lignes ne l'est pas —
 * et un raccourci pour poser le même niveau à tout le lot, parce qu'une fournée
 * chargée ensemble en ressort le plus souvent à la même hauteur.
 */

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Les montures qui étaient en enclos, dans l'ordre où on les y a mises. */
  mounts: Individual[];
  colors: BreedingColor[];
  nameOf: (colorId: string) => string;
  /** Écrit les niveaux et passe tout le lot en fécondes. Rend le compte écrit. */
  onConfirm: (entries: { id: string; level: number }[]) => Promise<number>;
};

const BreedingEnclosExitDialog = ({
  isOpen,
  onClose,
  mounts,
  colors,
  nameOf,
  onConfirm,
}: Props) => {
  /**
   * Le brouillon de saisie, rattaché au lot qu'il décrit.
   *
   * Comparé plutôt que remis à zéro par un effet : la liste change quand une
   * fournée sort, et un effet laisserait un rendu de battement où les niveaux de
   * l'ancien lot s'afficheraient sur le nouveau. Les niveaux connus servent de
   * valeurs de départ — c'est ce qui rend la saisie supportable à quarante
   * lignes, puisque la plupart n'auront pas bougé.
   */
  const signature = mounts.map((mount) => `${mount.id}:${mount.level}`).join('|');
  const [draft, setDraft] = useState<{
    key: string;
    levels: Record<string, number>;
    done: number | null;
  }>({ key: signature, levels: {}, done: null });
  const [running, setRunning] = useState(false);

  const current = draft.key === signature ? draft : { key: signature, levels: {}, done: null };
  const levels = current.levels;
  const done = current.done;

  const byId = useMemo(() => new Map(colors.map((color) => [color.id, color])), [colors]);
  const code = useMemo(() => colorCoder(colors), [colors]);

  const levelOf = (mount: Individual) => levels[mount.id] ?? mount.level;
  const setLevel = (id: string, value: number) =>
    setDraft({
      key: signature,
      done: null,
      levels: { ...levels, [id]: Math.max(1, Math.min(200, value || 1)) },
    });

  /** Le même niveau pour tout le lot — le cas courant, en un geste. */
  const setAll = (value: number) =>
    setDraft({
      key: signature,
      done: null,
      levels: Object.fromEntries(mounts.map((mount) => [mount.id, value])),
    });

  const climbed = mounts.filter((mount) => levelOf(mount) !== mount.level).length;

  /**
   * Le lot rangé pour être lu : **les nommées d'abord, les sans-nom ensuite**.
   *
   * L'ordre était celui du chargement, donc nommées et anonymes alternaient, et
   * une fournée de cinquante places posait quarante lignes « Anonyme » identiques
   * entre lesquelles il n'y avait rien à distinguer — ni couleur lisible en un
   * coup d'œil, ni sexe, ni moyen de savoir si on en avait déjà traité une. Voir
   * #164.
   *
   * Les sans-nom se **groupent**, et c'est ce qui rend l'écran tenable : elles
   * n'ont pas d'identité à saisir, seulement un effectif. La clé porte le niveau
   * en plus de la couleur et du sexe, pour que le groupe reste exactement ce qui
   * est interchangeable — les comptées sortent toutes de `BULK_MATE_LEVEL` et se
   * réunissent d'elles-mêmes, une monture née pas encore renommée garde le sien
   * et donc sa ligne.
   *
   * Le champ de niveau du groupe écrit sur **toutes** ses montures : c'est ce qui
   * garde `missing` juste, puisqu'il se lit monture par monture.
   */
  const rows = useMemo(() => {
    const named = mounts.filter((mount) => mount.name);
    const unnamed = new Map<string, { mounts: Individual[]; colorId: string; sex: Sex }>();
    for (const mount of mounts) {
      if (mount.name) continue;
      const key = `${mount.colorId}|${mount.sex}|${mount.level}`;
      const group = unnamed.get(key) ?? { mounts: [], colorId: mount.colorId, sex: mount.sex };
      group.mounts.push(mount);
      unnamed.set(key, group);
    }
    return {
      named: [...named].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'fr')),
      unnamed: [...unnamed.values()].sort(
        (a, b) =>
          nameOf(a.colorId).localeCompare(nameOf(b.colorId), 'fr') || a.sex.localeCompare(b.sex)
      ),
    };
  }, [mounts, nameOf]);

  /** Pose un niveau sur tout un groupe d'un coup : il n'y a rien à y distinguer. */
  const setGroupLevel = (group: Individual[], value: number) =>
    setDraft({
      key: signature,
      done: null,
      levels: {
        ...levels,
        ...Object.fromEntries(
          group.map((mount) => [mount.id, Math.max(1, Math.min(200, value || 1))])
        ),
      },
    });

  /**
   * Les montures dont le niveau n'est **pas** connu, et que la sortie ne doit pas
   * enregistrer sans qu'on l'ait saisi.
   *
   * Une monture comptée — vrac ou procurée — vaut `BULK_MATE_LEVEL`, soit 1. Sa
   * ligne s'affiche donc préremplie à 1, et le bouton partirait sur ce 1 au
   * premier clic : quarante montures inscrites niveau 1, des taux de réussite
   * effondrés, et une fournée suivante calculée là-dessus. C'est le mode d'échec
   * le plus probable de cet écran, parce qu'il ne ressemble pas à une erreur — il
   * ressemble à un clic.
   *
   * Les suivies, elles, portent un niveau réel : il fait un point de départ
   * honnête, et rien ne les bloque.
   */
  const missing = mounts.filter(
    (mount) => parseCountedMountId(mount.id) !== null && levels[mount.id] === undefined
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sortir les montures de l'enclos" size="xl">
      <div className="space-y-4">
        <p className="text-[11px] text-dark-500">
          Elles en sortent <strong className="text-profit">fécondes</strong> : leur cycle est
          payé, elles s&apos;accoupleront sans repasser par l&apos;enclos. Le niveau, lui, a
          monté pendant le cycle et rien d&apos;autre ne le dira — c&apos;est lui qui décide du
          taux de réussite des croisements à venir.
        </p>

        {mounts.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-dark-400">Même niveau pour tout le lot</span>
            <input
              type="number"
              min={1}
              max={200}
              placeholder="ex. 61"
              onChange={(event) => {
                const value = Number(event.target.value);
                if (value >= 1 && value <= 200) setAll(value);
              }}
              className="w-24 px-3 py-1.5 rounded-xl bg-dark-800/80 border border-dark-600/50
                text-dark-100 text-sm text-right transition-all hover:border-dark-500
                focus:border-kamas/50"
            />
            <span className="text-[10px] text-dark-600">
              puis corrige les exceptions ligne par ligne
            </span>
          </div>
        )}

        <div className="space-y-1 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
          {rows.named.map((mount) => {
            const color = byId.get(mount.colorId);
            return (
              <div
                key={mount.id}
                className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl bg-dark-800/40"
              >
                <ColorChip
                  name={nameOf(mount.colorId)}
                  code={code(nameOf(mount.colorId))}
                  icon={color ? colorIconUrl(color) : null}
                  size="sm"
                />
                <span className="text-xs text-dark-200 truncate max-w-[9rem]">
                  {nameOf(mount.colorId)}
                </span>
                <GenBadge generation={color?.generation ?? 1} />
                <span className={mount.sex === 'M' ? 'text-info' : 'text-loss-light'}>
                  {mount.sex === 'M' ? '♂' : '♀'}
                </span>
                <code className="text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 text-kamas">
                  {mount.name}
                </code>
                {/* Toute monture qui sort d'ici prend son niveau, vrac et
                    procurées comprises. Sans lui elles vaudraient
                    `BULK_MATE_LEVEL`, soit 1 — et c'est le niveau qui décide du
                    taux de réussite des croisements suivants, donc les prêter à 1
                    reviendrait à saboter tout ce qu'on vient de sortir. La sortie
                    les inscrit une par une pour cette raison. */}
                <label className="ml-auto flex items-center gap-1 text-[10px] text-dark-500">
                  niv
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={String(levelOf(mount))}
                    onChange={(event) => setLevel(mount.id, Number(event.target.value))}
                    className="w-16 px-1.5 py-0.5 rounded-lg bg-dark-800/80 border
                      border-dark-600/50 text-dark-100 text-[11px] text-right transition-all
                      hover:border-dark-500 focus:border-kamas/50"
                  />
                </label>
                {levelOf(mount) !== mount.level && (
                  <span className="text-[10px] text-dark-600 tabular-nums">
                    était {mount.level}
                  </span>
                )}
              </div>
            );
          })}

          {rows.unnamed.map((group) => {
            const color = byId.get(group.colorId);
            const head = group.mounts[0];
            return (
              <div
                key={`${group.colorId}|${group.sex}|${head.level}`}
                className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl
                  bg-dark-800/40 border border-dark-700/40"
              >
                <ColorChip
                  name={nameOf(group.colorId)}
                  code={code(nameOf(group.colorId))}
                  icon={color ? colorIconUrl(color) : null}
                  size="sm"
                />
                {/* L'effectif tient la place du nom : c'est la seule chose qui
                    distingue cette ligne, et c'est ce qu'on va compter dans le
                    tas. */}
                <span className="text-xs text-dark-100 tabular-nums font-semibold">
                  {group.mounts.length}
                </span>
                <span className="text-xs text-dark-200 truncate max-w-[9rem]">
                  {nameOf(group.colorId)}
                </span>
                <GenBadge generation={color?.generation ?? 1} />
                <span className={group.sex === 'M' ? 'text-info' : 'text-loss-light'}>
                  {group.sex === 'M' ? '♂' : '♀'}
                </span>
                <code className="text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 text-dark-500">
                  {ANONYMOUS_NAME}
                </code>
                {/* Un seul champ pour le groupe : elles n'ont rien qui les
                    distingue, donc rien à saisir séparément. Il écrit sur chacune,
                    ce qui garde `missing` juste. */}
                <label className="ml-auto flex items-center gap-1 text-[10px] text-dark-500">
                  niv
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={String(levelOf(head))}
                    onChange={(event) => setGroupLevel(group.mounts, Number(event.target.value))}
                    className="w-16 px-1.5 py-0.5 rounded-lg bg-dark-800/80 border
                      border-dark-600/50 text-dark-100 text-[11px] text-right transition-all
                      hover:border-dark-500 focus:border-kamas/50"
                  />
                </label>
                {levelOf(head) !== head.level && (
                  <span className="text-[10px] text-dark-600 tabular-nums">était {head.level}</span>
                )}
              </div>
            );
          })}
        </div>

        {done !== null && (
          <p className="flex items-center gap-1.5 text-[11px] text-profit">
            <Check size={12} /> {done} monture{done > 1 ? 's' : ''} sortie{done > 1 ? 's' : ''},
            féconde{done > 1 ? 's' : ''}.
          </p>
        )}

        {/* Collée en bas : quarante lignes de niveaux passent l'écran, et un
            bouton hors champ fait croire que la sortie est enregistrée. */}
        <div
          className="sticky bottom-0 -mx-1 px-1 py-3 flex flex-wrap items-center gap-3
            bg-dark-900/95 backdrop-blur-sm border-t border-dark-700/60"
        >
          <Button
            size="sm"
            disabled={running || mounts.length === 0 || missing.length > 0}
            onClick={async () => {
              setRunning(true);
              const written = await onConfirm(
                mounts.map((mount) => ({ id: mount.id, level: levelOf(mount) }))
              );
              setRunning(false);
              setDraft({ key: signature, levels, done: written });
              onClose();
            }}
          >
            <LogOut size={13} />
            {running
              ? 'Enregistrement…'
              : `Sortir ${mounts.length} monture${mounts.length > 1 ? 's' : ''}`}
          </Button>
          {missing.length > 0 && (
            <span className="text-[11px] text-loss-light">
              {missing.length} monture{missing.length > 1 ? 's' : ''} sans niveau — pose le niveau
              du lot ci-dessus, sinon {missing.length > 1 ? 'elles entreraient' : 'elle entrerait'} à
              l&apos;écurie au niveau 1 et les croisements suivants seraient calculés dessus
            </span>
          )}
          {missing.length === 0 && climbed > 0 && (
            <span className="text-[11px] text-dark-500">
              {climbed} niveau{climbed > 1 ? 'x' : ''} corrigé{climbed > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default BreedingEnclosExitDialog;
