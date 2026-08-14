'use client';

import CopyableText from '@/components/ui/CopyableText';
import { ANONYMOUS_NAME } from '@/lib/dofus/breeding/naming';
import type { Individual } from '@/lib/dofus/breeding/stable';

/**
 * Le nom en jeu d'une monture, tel qu'on le cherche devant l'écurie.
 *
 * Extrait de `BreedingNextMove`, qui était le seul à savoir l'afficher — et qui
 * portait deux conseils dont on avait besoin ailleurs. Le nom est **le seul
 * repère** que l'écurie du jeu donne : depuis #59 deux montures de même couleur
 * ne se valent pas selon leur ascendance, et rien d'autre ne les sépare à
 * l'écran.
 *
 * Une non renommée n'est pas nommée « Anonyme » par erreur : c'est bien ce
 * qu'elle porte, et on peut en prendre n'importe laquelle dans le tas. Elle ne
 * mérite donc pas un nom à copier, seulement une puce mate.
 */
export const mountNameOf = (individuals: Individual[]) => {
  const names = new Map(individuals.map((mount) => [mount.id, mount.name ?? ANONYMOUS_NAME]));
  return (mountId: string) => names.get(mountId) ?? ANONYMOUS_NAME;
};

const BreedingMountName = ({ name }: { name: string }) =>
  name === ANONYMOUS_NAME ? (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-md bg-dark-900/60 text-dark-500"
      title="Monture non renommée : prends-en une dans le tas, elles sont interchangeables."
    >
      {name}
    </span>
  ) : (
    <CopyableText value={name} title={`Copier « ${name} » — le nom à chercher dans l’écurie du jeu`} />
  );

export default BreedingMountName;
