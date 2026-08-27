/**
 * La **fournée**, et les identifiants des montures qu'elle nomme.
 *
 * ## Pourquoi ce fichier existe
 *
 * Ces déclarations vivaient dans `search.ts`, aux côtés du grimpeur qui cherchait
 * la fournée. Elles n'ont rien à voir avec lui : l'échelle produit le même
 * `UnitPlan`, `readPlan` le relit sans savoir qui l'a produit, et la sortie
 * d'enclos lit les mêmes identifiants. Six fichiers importaient donc `search.ts`
 * pour des types que le champion ne concerne pas.
 *
 * Séparées parce que **le champion quitte le TypeScript** : l'échelle joue, et la
 * recherche reste côté Rust comme étalon de comparaison. Ce qui est commun aux
 * deux devait sortir d'abord, sinon supprimer le grimpeur emportait l'échelle
 * avec lui.
 */

import { BULK_MATE_LEVEL } from './pairing';
import { cycledOf, type Individual, type Sex, type Stable } from './stable';

/**
 * Ce qu'on met dans une unité qui se libère.
 *
 * Les indices sont **virtuels** : les achats sont ajoutés d'abord, si bien qu'une
 * monture achetée porte l'indice `mounts.length + j` et peut servir de parent dans
 * le même chargement.
 */
export type UnitPlan = {
  purchases: [string, Sex][];
  clonings: [number, number][];
  crossings: [number, number][];
  /** Une Optimakina par croisement, en regard de `crossings`. */
  optimakina: boolean[];
  /**
   * Ce croisement vient-il de la **moisson** ? En regard de `crossings`.
   *
   * La moisson compose **hors plan** par construction : c'est tout son objet,
   * tirer des génétons de ce que l'échelle ne réclame pas. Or le filet
   * d'affichage de `readPlan` refuse le hors plan, également par construction.
   * Les deux se sont donc annulés en silence : la moisson dépensait ses places,
   * l'écran jetait ses croisements, et la composition se croyait pleine — cinq
   * places sur cinquante que rien n'occupait en jeu.
   *
   * Ce drapeau dit à l'affichage lesquels lui sont **délibérément** hors plan,
   * pour qu'il les rende au lieu de les compter comme une divergence. Le filet
   * garde tout son sens sur les autres, qui sont ceux qu'il surveille.
   *
   * **Pas de jumeau côté Rust, et c'est voulu** : le banc joue le plan tel quel,
   * il n'a pas de filet d'affichage à informer. Le champ ne voyage donc pas dans
   * la référence de parité, qui compare croisements, achats, clonages et
   * sacrifices — voir `check-ladder-policy.mjs`.
   */
  harvested: boolean[];
  /** Créditées **avant** les dépenses, pour qu'un chargement se finance. */
  sacrifices: number[];
  /**
   * Montures mises en enclos **sans être croisées** : elles en sortent fécondes et
   * restent en écurie.
   *
   * C'est la fécondité mise en banque, et elle ne se périme pas — une monture citée
   * ici occupe une place mais ne consomme pas sa reproduction.
   */
  cycles: number[];
};

export const emptyPlan = (): UnitPlan => ({
  purchases: [],
  clonings: [],
  crossings: [],
  optimakina: [],
  harvested: [],
  sacrifices: [],
  cycles: [],
});

/**
 * L'écurie de l'app, mise à plat.
 *
 * Le Rust ne connaît que des montures ; le vrac est une commodité de saisie propre
 * à l'écran. Une monture de vrac est **fertile, non féconde, sans ascendance** —
 * c'est ce que « achetée ou capturée » veut dire.
 *
 * L'ordre est le contrat : les indices que le plan rend s'y rapportent, vrac
 * d'abord puis individus.
 */
/**
 * L'identité d'une monture de vrac.
 *
 * Le vrac n'a pas d'identité en base — il se compte, il ne se nomme pas. Mais un
 * plan rend des **indices** dans la liste à plat, et l'écran doit pouvoir
 * remonter de l'indice à la monture pour dire ce qu'on en fait. D'où un
 * identifiant fabriqué, qui porte de quoi retrouver la ligne de stock : sa
 * couleur et son sexe.
 *
 * Il est reconnaissable, et c'est le point : `#` ne peut pas apparaître dans un
 * uuid, donc `parseCountedMountId` sépare sans ambiguïté une monture de vrac d'une
 * monture suivie. Une sortie d'enclos s'écrit dans deux tables différentes selon
 * le cas, et l'avoir deviné au petit bonheur est précisément ce qui a fait
 * disparaître le vrac de la liste de sortie.
 */
export const bulkMountId = (colorId: string, sex: Sex, index: number) =>
  `${colorId}#${sex}${index}`;

/**
 * Une monture que le plan se **procure** : achetée à l'hôtel de vente ou capturée.
 *
 * Elle n'existe nulle part encore — ni ligne suivie, ni stock. Les indices d'un
 * `UnitPlan` au-delà de `mounts.length` la désignent (voir `readPlan`), et rien ne
 * l'enregistre avant que l'éleveur ne la déclare. La sortie d'enclos est donc le
 * premier moment où l'app peut apprendre qu'elle existe : il faut l'y **créer**,
 * et non seulement créditer un compteur. D'où un espace de noms distinct du vrac
 * en stock — `+` plutôt que `#`, deux caractères qu'un identifiant de couleur ne
 * porte jamais.
 */
export const acquiredMountId = (colorId: string, sex: Sex, index: number) =>
  `${colorId}+${sex}${index}`;

/**
 * Lit un identifiant de monture **comptée** — vrac en stock ou à procurer.
 *
 * `null` pour une monture suivie (un uuid). `acquired` dit laquelle des deux :
 * une monture à procurer doit être ajoutée au stock en sortant de l'enclos, une
 * monture déjà en stock seulement passée féconde. Un seul lecteur pour les deux,
 * parce que tout ce qui les distingue de l'écurie suivie leur est commun : pas de
 * ligne à soi, pas de niveau propre, une quantité par couleur et par sexe.
 */
export const parseCountedMountId = (
  id: string
): { colorId: string; sex: Sex; acquired: boolean } | null => {
  const cut = Math.max(id.lastIndexOf('#'), id.lastIndexOf('+'));
  if (cut <= 0) return null;
  const sex = id[cut + 1];
  if (sex !== 'M' && sex !== 'F') return null;
  if (!/^\d+$/.test(id.slice(cut + 2))) return null;
  return { colorId: id.slice(0, cut), sex, acquired: id[cut] === '+' };
};

export const flatten = (stable: Stable): Individual[] => {
  const out: Individual[] = [];
  for (const [colorId, counts] of stable.bulk) {
    const cycled = cycledOf(counts);
    // Les fécondes d'abord dans chaque sexe : elles sont interchangeables entre
    // elles, donc l'ordre n'a pas de sens en soi — mais il en a un pour la
    // lecture, `materialise` piochant les fécondations par le début.
    const push = (sex: Sex, count: number, banked: number) => {
      for (let index = 0; index < count; index += 1) {
        out.push({
          id: bulkMountId(colorId, sex, index),
          colorId,
          name: null,
          sex,
          level: BULK_MATE_LEVEL,
          fertile: true,
          cycled: index < banked,
          parents: null,
        });
      }
    };
    push('M', counts.males, cycled.males);
    push('F', counts.females, cycled.females);
  }
  out.push(...stable.individuals);
  return out;
};

/**
 * Le réglage d'une fournée : à quel niveau monter le lot, et à partir de quelle
 * génération visée acheter une Optimakina.
 *
 * Deux nombres, et ils venaient du **génome du champion** — `strategies[0]`,
 * `level: 47`. L'écran conseillait pendant ce temps un niveau calculé sur les
 * prix de l'éleveur, et le plan en employait un autre sans le dire. Le champion
 * étant retiré du TypeScript, le niveau vient désormais de l'appelant, donc du
 * conseil affiché.
 */
export type BatchStrategy = {
  /** Zéro veut dire « celui de l'économie », comme côté Rust. */
  level: number;
  /**
   * Génération visée à partir de laquelle une Optimakina est achetée. `11` =
   * jamais, l'arbre s'arrêtant à 10 — et c'est le cas ici : l'échelle ne pose
   * aucune Optimakina dans sa fournée (`optimakina: []`). Le conseil, lui, vit à
   * part, au-dessus du bouton d'accouplement. Voir `worthwhileOptimakina`.
   */
  optimakinaFrom: number;
};

/**
 * Le niveau retenu faute d'un conseil.
 *
 * `47` était celui du génome, et le garder évite de déplacer toutes les fournées
 * de référence en même temps qu'on retire le champion. Ce n'est **pas** une
 * recommandation : mesuré sur l'écurie de l'éleveur, l'optimum est bien plus
 * haut, borné par ce qu'un remplissage de Mangeoire paie. Voir `tunedLevel`.
 */
export const DEFAULT_BATCH_LEVEL = 47;
