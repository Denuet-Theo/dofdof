import { identityKey } from './cloning';
import { mountStatus, type Individual, type MountStatus } from './stable';

/**
 * Retrouver un clonage saisi de travers.
 *
 * Un clonage est le seul geste de l'élevage qui **détruit** ce qu'il consomme :
 * `recordClonings` insère le clone, puis supprime les deux stériles. Une
 * naissance s'annule — `undoBirth` existe, le poulain part et les parents
 * reviennent. Un clonage, non : les deux originales ne sont plus là, et avec
 * elles l'ascendance de celle qui n'a pas été retenue. C'est irréversible en jeu
 * et ça l'est ici, ce qui rend la saisie fautive coûteuse d'une façon qu'aucun
 * autre écran ne partage.
 *
 * Et cette saisie est exactement celle qui se trompe le plus facilement : elle
 * consigne un **tirage du jeu**. L'éleveur ne choisit pas la survivante, il la
 * lit sur un autre écran et la recopie ici. Trois faux pas, tous vus :
 *
 * 1. cliquer « c'est celle-ci qui est sortie » sur une paire que le jeu n'avait
 *    plus, au lieu de « Passer » — l'app perd deux stériles et gagne un clone
 *    que la partie ne contient pas ;
 * 2. cliquer la mauvaise des deux cartes — le compte reste juste **partout**, et
 *    seule l'ascendance du clone est fausse ;
 * 3. cloner en jeu sans l'enregistrer — fenêtre refermée, écriture refusée, ou
 *    clonage fait directement dans la partie.
 *
 * ## Ce que ce module peut, et ce qu'il ne peut pas
 *
 * Il ne peut pas dire lesquels sont faux. **Rien dans la base ne distingue un
 * clonage réussi d'un clonage inventé** : les deux donnent la même ligne. Le
 * seul arbitre est la partie, et l'outil ne la voit pas.
 *
 * Ce qu'il peut, c'est réduire la vérification à une poignée de recherches. Il
 * rassemble les lignes qui **prétendent** être des clones et, pour chacune, dit
 * exactement ce que la partie doit montrer sous ce nom. L'éleveur tape le nom
 * dans l'écurie du jeu, compare trois nombres, et tranche. Cinq recherches au
 * lieu d'un recensement de deux cents montures — c'est toute la différence entre
 * une vérification qui se fait et une qui ne se fait pas.
 *
 * ## Comment on reconnaît un clone : le niveau
 *
 * `recordClonings` insère le clone **fertile, non fécond, au niveau de la
 * stérile qu'il remplace** — typiquement 48, puisqu'une stérile a vécu. Or, la
 * mangeoire réglée au niveau 1, rien d'autre ne produit une fertile au-dessus du
 * niveau 1 : un poulain naît niveau 1 fertile, rien ne monte en enclos, et une
 * monture qui sort d'enclos en ressort **féconde** (`recordEnclosExit` pose
 * `cycled`). C'est l'invariante du recensement du 16/08 — 63 fertiles, 63
 * montures au niveau 1, les deux ensembles identiques — retournée : ce qui
 * dépasse est un clone.
 *
 * Deux réserves, et elles sont dites à l'écran plutôt que tues :
 *
 * - L'invariante dépend du réglage de la mangeoire. Voir la compétence
 *   `ecurie-en-jeu`, qui demande de le revérifier avant de s'y fier.
 * - Une fertile de niveau 48 peut aussi avoir été **saisie à la main** — ajout
 *   manuel, import, niveau corrigé dans « Mes stocks ». Elle apparaît donc ici.
 *   Ce n'est pas un défaut de la liste : une fertile de niveau 48 qui n'est pas
 *   un clone est soit une monture achetée, soit un niveau faux, et les deux
 *   valent le même coup d'œil que celui qu'on est venu donner.
 *
 * On ne prétend donc pas « voici les clones » mais « voici ce qui en a la
 * forme ». C'est une différence que l'écran porte dans ses mots, parce que la
 * confondre ferait corriger des montures parfaitement saines.
 *
 * ## Ce qui échappe à la liste, et se rattrape par un compte
 *
 * Un clonage **jamais enregistré** (cas 3) ne laisse aucune ligne : l'app tient
 * encore ses deux stériles, il n'y a rien à lister. Il ne se voit que par un
 * total — la partie montre plus de fertiles au-dessus du niveau 1 que l'app n'en
 * tient. D'où `tally`, qui donne le nombre par niveau : un filtre FERTILITÉ =
 * fertile croisé avec NIVEAUX = 48–48 dans le jeu rend le même chiffre, ou
 * révèle l'oubli. Un seul nombre à comparer, et il couvre le cas que la liste ne
 * peut pas voir.
 *
 * Un clone déjà **accouplé** échappe aussi, définitivement : il est redevenu
 * stérile, donc indiscernable des autres. La vérification a une fenêtre, et
 * c'est la fournée en cours.
 */

/** Le niveau d'une monture que rien n'a fait monter — voir l'en-tête. */
export const FRESH_LEVEL = 1;

/** Ce que l'écurie tient sous une identité, ventilé par état. */
export type HeldCounts = Record<MountStatus, number>;

/**
 * Une ligne qui prétend être un clone, et ce que la partie doit montrer d'elle.
 *
 * « Prétend » est le mot exact : voir l'en-tête. La ligne n'est pas une accusation,
 * c'est une **affirmation vérifiable** — et c'est l'éleveur qui la vérifie.
 */
export type CloneClaim = {
  /** La ligne fertile au-dessus du niveau 1. */
  clone: Individual;
  /**
   * Ce que l'écurie tient sous la **même identité**, clone compris.
   *
   * C'est le chiffre à confronter au jeu, parce que c'est le seul que le jeu
   * sache rendre : la recherche par nom de l'écurie ramène toutes les montures
   * du même nom, et le nom encode couleur, sexe et ascendance (`naming.ts`).
   * Une recherche, trois nombres, et les trois faux pas se distinguent.
   */
  held: HeldCounts;
  /**
   * Les stériles de la même identité, celles que le clonage aurait dû consommer.
   *
   * Deux ou plus, et l'effacement des originales a peut-être échoué —
   * `recordClonings` insère puis supprime, et la suppression peut être refusée
   * seule ; elle le dit dans la bannière, mais une bannière se rate. Ce n'est
   * **pas** une preuve : l'éleveur peut avoir tenu six stériles identiques et
   * n'en avoir cloné que deux. C'est un ordre de lecture, pas un verdict, et
   * c'est pour ça que ça remonte en tête plutôt que de déclencher un correctif.
   */
  survivors: Individual[];
};

/** Le contrôle qui trouve l'oubli : un nombre par niveau, à lire dans les FILTRES. */
export type CloneTally = { level: number; count: number };

export type CloneAudit = {
  claims: CloneClaim[];
  tally: CloneTally[];
};

/**
 * Vrai pour une monture qui a la forme d'un clone : fertile, au-dessus du
 * niveau 1.
 *
 * `mountStatus` et non `fertile` nu : une **féconde** porte aussi `fertile`, et
 * elle est légitimement au niveau 48 — c'est même l'état ordinaire d'une monture
 * qui a fait son cycle d'enclos. Les confondre remplirait la liste de toute
 * l'écurie prête à s'accoupler, ce qui est le contraire du service rendu.
 */
export const looksCloned = (mount: Individual): boolean =>
  mountStatus(mount) === 'fertile' && mount.level > FRESH_LEVEL;

const emptyCounts = (): HeldCounts => ({ fertile: 0, feconde: 0, sterile: 0 });

/**
 * Les clonages à vérifier, du plus récent au plus ancien.
 *
 * ## Pourquoi le plus récent d'abord
 *
 * Parce que c'est la question posée. On n'ouvre pas cet écran pour auditer une
 * écurie, on l'ouvre en sortant d'une séance de clonage où quelque chose a
 * cloché. Les lignes de ce soir sont celles qu'on cherche ; celles de la semaine
 * dernière ont déjà servi ou déjà été vues.
 *
 * `createdAt` peut manquer — une monture posée dans l'état local avant sa
 * relecture n'en a pas encore. Elle passe en tête plutôt qu'en queue : ce qui
 * vient d'être écrit dans cette session **est** le plus récent, et l'enterrer
 * sous un mois d'historique cacherait précisément la ligne qu'on vient de faire.
 */
export const auditClones = (individuals: Individual[]): CloneAudit => {
  const byIdentity = new Map<string, Individual[]>();
  for (const mount of individuals) {
    const key = identityKey(mount);
    byIdentity.set(key, [...(byIdentity.get(key) ?? []), mount]);
  }

  const claims = individuals
    .filter(looksCloned)
    .map((clone) => {
      const kin = byIdentity.get(identityKey(clone)) ?? [clone];
      const held = emptyCounts();
      for (const mount of kin) held[mountStatus(mount)] += 1;
      return {
        clone,
        held,
        survivors: kin.filter((mount) => mountStatus(mount) === 'sterile'),
      };
    })
    .sort((a, b) => {
      const when = (mount: Individual) => mount.createdAt ?? '';
      // Décroissant sur la date, puis sur le niveau, puis sur le nom : les deux
      // replis servent quand les dates sont absentes ou égales — un lot de
      // clonages saisi d'affilée porte souvent la même seconde — et un ordre qui
      // change entre deux rendus ferait perdre sa ligne à qui coche.
      const recency = when(b.clone).localeCompare(when(a.clone));
      if (recency !== 0) return recency;
      if (b.clone.level !== a.clone.level) return b.clone.level - a.clone.level;
      return (a.clone.name ?? '').localeCompare(b.clone.name ?? '');
    });

  const perLevel = new Map<number, number>();
  for (const claim of claims) {
    perLevel.set(claim.clone.level, (perLevel.get(claim.clone.level) ?? 0) + 1);
  }

  return {
    claims,
    tally: [...perLevel]
      .map(([level, count]) => ({ level, count }))
      .sort((a, b) => a.level - b.level),
  };
};
