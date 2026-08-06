'use client';

import { useMemo, useState } from 'react';
import { Layers, TriangleAlert } from 'lucide-react';
import Button from '@/components/ui/Button';
import BreedingBirthDialog from '@/components/breeding/BreedingBirthDialog';
import { ANONYMOUS_NAME } from '@/lib/dofus/breeding/naming';
import type { BreedingColor } from '@/lib/dofus/breeding/costs';
import type { Batch } from '@/lib/dofus/breeding/batches';
import type { Individual, Pairing, Sex } from '@/lib/dofus/breeding/stable';
import type { BirthEntry } from '@/lib/hooks/useBreeding';

/**
 * Les montures à charger dans l'enclos — en **lots**, pas en couples.
 *
 * Le plan dit combien d'accouplements ; devant l'enclos la question est « je
 * mets lesquelles ». Elle se répondait couple par couple, dix lignes
 * « ♂ Doré × ♀ Ébène » pour dix accouplements. Or l'enclos ne se charge pas par
 * couples : on y dépose vingt montures, et le jeu apparie. Ce qu'il faut lire
 * est donc **ce qu'on sort de l'écurie** — « ♂ Doré Anonyme × 10 » — et non un
 * appariement que personne ne compose à la main.
 *
 * Les lots se distinguent par couleur, sexe **et nom**. Le nom n'est pas un
 * ornement : depuis #59, deux montures de même couleur ne se valent pas selon
 * leur ascendance, et le nom est la seule chose qui les sépare dans l'écurie du
 * jeu. Confondre « ♂ Doré Anonyme » et « ♂ Doré G9 AMB-DOR » dans un même lot
 * ferait charger la mauvaise — celle qui ne porte pas le raccourci.
 *
 * La saisie des naissances, elle, passe par une popin : voir
 * `BreedingBirthDialog`.
 */

type Props = {
  batches: Batch[];
  nameOf: (colorId: string) => string;
  /** Les montures suivies, pour nommer les lots et retrouver les ascendances. */
  individuals: Individual[];
  /** Les couleurs de la famille, pour calculer les issues d'un accouplement. */
  colors: BreedingColor[];
  onRecord: (entries: BirthEntry[]) => Promise<void>;
};

/** Un lot à sortir de l'écurie : même couleur, même sexe, même nom. */
type Load = {
  colorId: string;
  sex: Sex;
  /** Le nom porté en jeu, « Anonyme » compris — c'est ce qu'on lit sur place. */
  name: string;
  count: number;
  /** Les identifiants courts, quand les montures sont suivies une par une. */
  ids: string[];
};

const BreedingBatches = ({ batches, nameOf, individuals, colors, onRecord }: Props) => {
  const [dialogOpen, setDialogOpen] = useState(false);

  const nameById = useMemo(
    () => new Map(individuals.map((mount) => [mount.id, mount.name ?? ANONYMOUS_NAME])),
    [individuals]
  );

  /**
   * Les montures d'une fournée regroupées en lots.
   *
   * On compte les **côtés** de couple et non les couples : une même monture ne
   * peut servir qu'une fois, donc chaque côté est une monture distincte à sortir
   * de l'écurie.
   */
  const loadsOf = (couples: Batch['couples']): Load[] => {
    const byKind = new Map<string, Load>();

    const take = (side: Pairing, sex: Sex) => {
      const name = side.mountId ? (nameById.get(side.mountId) ?? ANONYMOUS_NAME) : ANONYMOUS_NAME;
      const key = `${side.colorId}|${sex}|${name}`;
      const load = byKind.get(key);
      if (load) {
        load.count += 1;
        if (side.mountId) load.ids.push(side.mountId.slice(0, 6));
        return;
      }
      byKind.set(key, {
        colorId: side.colorId,
        sex,
        name,
        count: 1,
        ids: side.mountId ? [side.mountId.slice(0, 6)] : [],
      });
    };

    for (const couple of couples) {
      take(couple.male, 'M');
      take(couple.female, 'F');
    }

    return [...byKind.values()].sort(
      (a, b) =>
        // Les mâles devant, puis les gros lots : c'est l'ordre dans lequel on
        // vide l'écurie.
        a.sex.localeCompare(b.sex) || b.count - a.count || a.colorId.localeCompare(b.colorId)
    );
  };

  if (batches.length === 0) {
    return (
      <p className="text-[11px] text-dark-500">
        Aucune fournée possible : il manque des parents fertiles pour la première étape du
        plan. Complète l&apos;écurie dans « Mes stocks ».
      </p>
    );
  }

  const first = batches[0];

  return (
    <div className="space-y-5">
      {batches.map((batch) => (
        <div key={batch.index} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Layers size={14} className="text-kamas" />
            <span className="text-xs font-semibold text-dark-200">Fournée {batch.index}</span>
            <span className="text-[11px] text-dark-500">
              {batch.couples.length} accouplement{batch.couples.length > 1 ? 's' : ''} ·{' '}
              {batch.used}/{batch.capacity} places
            </span>
            {batch.provisional && (
              <span className="flex items-center gap-1 text-[10px] text-amber-400/80">
                <TriangleAlert size={11} />
                provisoire — suppose les naissances de la fournée {batch.index - 1}
              </span>
            )}
          </div>

          {batch.clonings.length > 0 && (
            <p className="text-[11px] text-dark-500 pl-5">
              À cloner avant :{' '}
              {batch.clonings
                .map((cloning) => `${cloning.count} × ${nameOf(cloning.colorId)}`)
                .join(', ')}
            </p>
          )}

          <div className="space-y-1 pl-5">
            {loadsOf(batch.couples).map((load) => (
              <div
                key={`${batch.index}-${load.colorId}-${load.sex}-${load.name}`}
                className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl
                  bg-dark-800/40 text-xs"
              >
                <span className="text-dark-400 w-4 shrink-0">
                  {load.sex === 'M' ? '♂' : '♀'}
                </span>
                <span className="text-dark-200">{nameOf(load.colorId)}</span>
                <code
                  className={`text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 ${
                    load.name === ANONYMOUS_NAME ? 'text-dark-500' : 'text-kamas'
                  }`}
                  title={
                    load.name === ANONYMOUS_NAME
                      ? 'Montures non renommées : interchangeables, prends-en dans le tas.'
                      : 'Cherche ce nom dans l’écurie du jeu — ces montures-là ne sont pas interchangeables.'
                  }
                >
                  {load.name}
                </code>
                <span className="text-dark-300 font-semibold tabular-nums">× {load.count}</span>
                {load.ids.length > 0 && (
                  <span
                    className="text-[10px] text-dark-600 truncate"
                    title={`Identifiants : ${load.ids.join(', ')}`}
                  >
                    {load.ids.slice(0, 4).join(' · ')}
                    {load.ids.length > 4 && ` +${load.ids.length - 4}`}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3 pl-5">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          Saisir les naissances
        </Button>
        <span className="text-[10px] text-dark-600">
          Les deux parents passent stériles, les bébés entrent en écurie — avec le nom à leur
          donner en jeu.
        </span>
      </div>

      <BreedingBirthDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        couples={first.couples}
        individuals={individuals}
        colors={colors}
        nameOf={nameOf}
        onRecord={onRecord}
      />
    </div>
  );
};

export default BreedingBatches;
