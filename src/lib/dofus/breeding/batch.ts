import type { Sex } from '@/lib/dofus/breeding/stable';

/**
 * La fournée en cours : ce qui est **dans les enclos**, et non ce que la
 * politique proposerait maintenant.
 *
 * ## Le défaut que ce module existe pour fermer
 *
 * L'écran affichait une fournée recalculée à chaque rendu. Charger un enclos
 * n'écrivait rien : le lendemain, l'écurie ayant bougé, la politique reproposait
 * une autre fournée, et « Les sortir de l'enclos » offrait à sortir des montures
 * qui n'y étaient jamais entrées. Plusieurs joueurs l'ont remonté dans les mêmes
 * termes — « ce ne sont plus les mêmes ».
 *
 * Un enclos est un objet du jeu. Une fois refermé, son contenu ne dépend plus de
 * rien : ni des prix, ni de l'écurie, ni d'un avis de la politique. On en prend
 * donc une **copie** au moment où l'éleveur déclare l'avoir rempli.
 *
 * ## Pourquoi la fournée entière est figée au premier verrou
 *
 * Ne figer que l'enclos verrouillé laisserait les suivants se recalculer, donc
 * changer entre deux chargements — le même défaut décalé d'un enclos. Le premier
 * verrou fige la liste complète ; les enclos à venir sont lus dans l'instantané,
 * pas recalculés.
 *
 * ## Pourquoi la validation est ici et pas en SQL
 *
 * `pens` est du `jsonb` libre, comme le plan de la timeline. Une ligne écrite par
 * une version antérieure de l'écran doit donner une fournée vide plutôt qu'un
 * rendu cassé, et c'est ce que `parsePens` garantit : tout ce qui ne se relit pas
 * est écarté, silencieusement mais complètement — une unité à moitié comprise
 * ferait sortir une monture inconnue de l'enclos.
 */

/**
 * Une monture dans un enclos, telle qu'on l'y a mise.
 *
 * L'identifiant est celui de `search.ts` : un uuid pour une suivie,
 * `couleur#M3` pour du vrac, `couleur+F0` pour une monture à procurer. La sortie
 * d'enclos sait relire les trois — c'est exactement pourquoi on garde
 * l'identifiant plutôt qu'une désignation reconstruite.
 *
 * Le reste est de l'affichage figé : le nom qu'elle portait, son niveau d'entrée.
 * Recalculés à la sortie, ils suivraient l'écurie du moment, ce qui est
 * précisément ce qu'on refuse ici.
 */
export type BatchUnit = {
  id: string;
  colorId: string;
  sex: Sex;
  /** Le nom porté en jeu, ou `null` pour une anonyme et une monture à procurer. */
  name: string | null;
  /** Le niveau connu à l'entrée. La sortie propose de le corriger. */
  level: number;
  /** En enclos sans croiser : elle en ressort féconde, sans poulain. */
  banked: boolean;
  /** Pas au coffre à l'entrée : achetée ou capturée pour cette fournée. */
  toBuy: boolean;
};

/** Un enclos : dix places, et l'instant où il a été refermé. */
export type BatchPen = {
  units: BatchUnit[];
  /** ISO, ou `null` tant que l'enclos n'est pas verrouillé. */
  lockedAt: string | null;
};

const isSex = (value: unknown): value is Sex => value === 'M' || value === 'F';

/** Une unité relue, ou `null` si elle ne porte pas de quoi désigner une monture. */
const parseUnit = (raw: unknown): BatchUnit | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const unit = raw as Record<string, unknown>;
  if (typeof unit.id !== 'string' || unit.id === '') return null;
  if (typeof unit.colorId !== 'string' || unit.colorId === '') return null;
  if (!isSex(unit.sex)) return null;

  return {
    id: unit.id,
    colorId: unit.colorId,
    sex: unit.sex,
    name: typeof unit.name === 'string' && unit.name !== '' ? unit.name : null,
    // Un niveau absent vaut 1, comme partout où une monture comptée n'en a pas.
    // La sortie le redemandera : elle refuse d'écrire un niveau qu'on n'a pas
    // saisi sur une comptée, précisément pour ça.
    level: typeof unit.level === 'number' && Number.isFinite(unit.level)
      ? Math.max(1, Math.min(200, Math.round(unit.level)))
      : 1,
    banked: unit.banked === true,
    toBuy: unit.toBuy === true,
  };
};

/**
 * Relit la colonne `pens`.
 *
 * Un enclos dont **aucune** unité ne se relit disparaît : il ne désigne plus rien
 * qu'on puisse sortir, et le garder afficherait un enclos vide qu'aucun geste ne
 * ferme. Un enclos partiellement relu, lui, reste — les montures comprises sont
 * réellement en enclos, et refuser de les sortir serait pire que d'en oublier
 * une.
 */
export const parsePens = (raw: unknown): BatchPen[] => {
  if (!Array.isArray(raw)) return [];

  const pens: BatchPen[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const pen = entry as Record<string, unknown>;
    if (!Array.isArray(pen.units)) continue;

    const units = pen.units.map(parseUnit).filter((unit): unit is BatchUnit => unit !== null);
    if (units.length === 0) continue;

    pens.push({
      units,
      lockedAt: typeof pen.lockedAt === 'string' && pen.lockedAt !== '' ? pen.lockedAt : null,
    });
  }
  return pens;
};

/** Les enclos refermés — ceux qui tournent, et les seuls qu'on puisse sortir. */
export const lockedPens = (pens: BatchPen[]): BatchPen[] =>
  pens.filter((pen) => pen.lockedAt !== null);

/**
 * L'index du prochain enclos à charger, ou `null` si tout est verrouillé.
 *
 * Le premier non verrouillé et non le premier tout court : on charge dans
 * l'ordre, et l'écran n'en montre qu'un à la fois pour cette raison — devant le
 * jeu, on remplit un enclos, on le referme, on passe au suivant.
 */
export const nextPenIndex = (pens: BatchPen[]): number | null => {
  const at = pens.findIndex((pen) => pen.lockedAt === null);
  return at === -1 ? null : at;
};

/** Toutes les montures d'un lot d'enclos, dédoublonnées par identifiant. */
export const unitsOf = (pens: BatchPen[]): BatchUnit[] => {
  const byId = new Map<string, BatchUnit>();
  for (const pen of pens) for (const unit of pen.units) byId.set(unit.id, unit);
  return [...byId.values()];
};
