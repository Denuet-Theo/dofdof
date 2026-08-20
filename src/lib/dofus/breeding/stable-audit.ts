import { identityKey } from './cloning';
import { dictatedNameFor, type NamedColor } from './naming';
import {
  FRESH_LEVEL,
  mountStatus,
  type BulkStock,
  type Individual,
  type MountStatus,
  type Stable,
} from './stable';

/**
 * Ce que l'écurie peut dire de fausse **toute seule**, sans regarder le jeu.
 *
 * ## Pourquoi ça existe séparément du recensement
 *
 * Il y a deux façons de trouver un écart entre l'app et la partie, et elles ne
 * se remplacent pas.
 *
 * La première est le **recensement** : poser les deux écrans côte à côte et
 * comparer les facettes — total, état, sexe, génération, couleur. C'est
 * `BreedingStockFilters`, bâti exprès aux intitulés et dans l'ordre du jeu, et
 * c'est la seule façon de trouver ce que l'app croit vrai sans raison de se
 * méfier : une stérile recyclée en jeu, une féconde qui n'a jamais vu d'enclos,
 * un clonage fait et jamais saisi. Elle demande le jeu ouvert.
 *
 * La seconde est ce module : les lignes que l'écurie contredit **par sa propre
 * logique**. Elles ne demandent rien à personne, elles sont fausses en soi, et
 * elles se trouvaient jusqu'ici dispersées — une bannière ici, un petit bouton
 * ambre au fil de deux cents lignes là, et rien du tout pour la troisième.
 *
 * Dispersé, un signal ne se compte pas. Or c'est un **compte** que l'éleveur
 * cherche quand il sort d'une séance de saisie en se demandant ce qu'il a raté.
 *
 * ## Deux tas, et la frontière compte plus que les cases
 *
 * `defects` : l'app a raison sans avoir à demander. Ces lignes se corrigent
 * séance tenante.
 *
 * `claims` : l'app affirme quelque chose de vérifiable, et c'est le **jeu** qui
 * tranche. Rien n'y est faux tant que la partie n'a pas parlé.
 *
 * Mélanger les deux est précisément ce qu'il ne faut pas faire. Une liste où
 * l'avéré et le douteux se ressemblent s'ignore en bloc au troisième faux
 * positif, et c'est le sort qu'ont connu tous les avertissements qui ont fini
 * par être retirés de cet écran.
 *
 * ## Ce que ce module a cessé de pouvoir faire, et il faut le dire
 *
 * Il a d'abord porté une règle « voici tes clones, va les vérifier en jeu »,
 * bâtie sur l'idée qu'un clone **garde le niveau de la stérile consommée**.
 * C'est faux : le jeu rend une monture **neuve**, au niveau 1. Vérifié par
 * l'éleveur.
 *
 * La conséquence est nette et vaut d'être écrite plutôt que découverte deux fois :
 * un clone est désormais **indiscernable d'un poulain** — fertile, niveau 1,
 * même façon de nommer, aucune colonne pour l'en distinguer. Un clonage saisi de
 * travers ne se retrouve donc plus après coup par aucune règle locale. Ce qui
 * reste est le total du recensement, qu'un clonage fait baisser de un (deux
 * stériles consommées, une monture rendue), et un journal des clonages qui
 * n'existe pas.
 *
 * Ce que la règle attrape aujourd'hui n'est donc pas « les clones » mais son
 * exact complément : les lignes **impossibles**, dont l'essentiel a été écrit par
 * le défaut lui-même. Voir `impossible-level`.
 */

/** Ce que l'écurie tient sous une identité, ventilé par état. */
export type HeldCounts = Record<MountStatus, number>;

/**
 * Une monture prise en défaut, et par quelle règle.
 *
 * Union discriminée plutôt qu'un `kind` et un sac d'options : chaque classe
 * porte ce qu'il faut pour la trancher et **rien d'autre**, si bien qu'un écran
 * qui l'affiche ne peut pas oublier une donnée ni en inventer une.
 */
export type AuditFinding =
  /**
   * Une anonyme stérile : un état que le jeu ne rend pas.
   *
   * Sans nom il n'y a pas d'ascendance, donc rien à extraire et rien que le
   * clonage sache désigner dans l'écurie du jeu. Ce n'est pas une monture qu'on
   * aurait oublié de nommer, c'est un reste — et l'écurie en a porté
   * cinquante-sept d'un coup, 255 annoncées contre 198 au recensement du 16/08.
   */
  | { kind: 'anonymous-sterile'; mount: Individual }
  /**
   * Le nom porté en jeu ne décrit plus la monture.
   *
   * Le nom encode couleur, sexe et ascendance. S'il diverge, l'un des deux a
   * bougé sans l'autre — un sexe corrigé dans « Mes stocks » sans renommer en
   * jeu, une ligne importée dont le nom contredit ce qui était tapé à côté.
   *
   * Le coût n'est pas cosmétique : le nom est la **seule** chose qui se lise
   * depuis la liste de l'écurie du jeu, donc une monture dont le nom ment est
   * introuvable là où on la cherche.
   */
  | { kind: 'stale-name'; mount: Individual; expected: string }
  /**
   * Une **fertile au-dessus du niveau 1**, ce que rien ne devrait produire.
   *
   * Trois portes mènent à l'état fertile, et les trois donnent le niveau 1 : un
   * poulain naît là, un clone y revient — le jeu rend une monture neuve — et
   * rien ne monte tant qu'une monture est fertile, puisque ce qui sort d'un
   * enclos en sort **féconde**. Le recensement du 16/08 l'a mesuré sans le
   * chercher : 63 fertiles, 63 montures au niveau 1, les deux ensembles
   * identiques.
   *
   * ## D'où viennent celles qu'on trouve
   *
   * Presque toutes de `recordClonings`, qui recopiait le niveau de la stérile
   * consommée sur le clone. C'est donc une règle qui trouve surtout les dégâts
   * d'un défaut corrigé depuis — et c'est exactement ce qu'on lui demande, parce
   * que ces lignes-là sont toujours en base et faussent toujours le calcul.
   *
   * Le niveau n'est pas décoratif : `targetGenerationRate` vaut
   * `0,3 + 0,0015 × (niveauA + niveauB)`. Deux montures ainsi surévaluées
   * s'annoncent à 44,4 % là où le jeu en donne 30,3 %.
   *
   * ## La seule exception, et pourquoi elle ne fait pas de cette règle un doute
   *
   * Une monture **achetée déjà montée** est fertile au-dessus du niveau 1 sans
   * que rien ne soit faux. C'est réel, et c'est rare : l'écran offre donc de
   * l'écarter d'un clic plutôt que de reléguer toute la règle dans les
   * incertitudes, où elle se serait fait ignorer avec le reste.
   *
   * `held` et `survivors` accompagnent la ligne parce que le rattrapage ne
   * s'arrête pas toujours au niveau : si le clonage lui-même a été saisi de
   * travers, c'est ce que la partie montre sous ce nom qui le dira.
   */
  | {
      kind: 'impossible-level';
      mount: Individual;
      /** Ce que l'écurie tient sous la même identité, la ligne comprise. */
      held: HeldCounts;
      /** Les stériles de la même identité — celles qu'un clonage aurait mangées. */
      survivors: Individual[];
    }
  /**
   * Une fertile sans ascendance, alors que le vrac tient déjà sa couleur.
   *
   * Le compteur de vrac ne porte **que** des fertiles sans ascendance : c'est sa
   * définition. Une monture suivie de même couleur et de même sexe est donc
   * peut-être la même, comptée deux fois — et c'est la porte par laquelle les
   * cinquante-sept fantômes sont entrés.
   *
   * « Peut-être » est retenu, pas concédé : l'ajout manuel accepte une monture
   * sans ascendance, et deux montures distinctes peuvent parfaitement exister.
   * C'est pour ça que ça va dans `claims` et non dans `defects` — le compte du
   * jeu tranche, l'app ne le fait pas à sa place.
   */
  | { kind: 'double-counted'; mount: Individual; bulk: number };

export type StableAudit = {
  /** Faux quoi que dise la partie. Se corrige sans ouvrir le jeu. */
  defects: AuditFinding[];
  /** Vérifiable, et vérifié par le jeu seul. */
  claims: AuditFinding[];
};

/** Ce que le vrac tient de cette couleur, du sexe demandé. */
const bulkOf = (stock: BulkStock | undefined, mount: Individual): number => {
  if (!stock) return 0;
  return mount.sex === 'M' ? stock.males : stock.females;
};

const emptyCounts = (): HeldCounts => ({ fertile: 0, feconde: 0, sterile: 0 });

/**
 * Le relevé complet de l'écurie, dans l'ordre où on veut le lire.
 *
 * Les défauts d'abord, parce qu'ils se règlent sans rien ouvrir ; les
 * affirmations ensuite, parce qu'elles demandent le jeu sous les yeux et que
 * c'est un autre geste, dans un autre moment.
 *
 * **Une classe par monture.** Une ligne qui cumule deux défauts n'est pas deux
 * problèmes, et la compter deux fois fausserait le seul chiffre que l'éleveur
 * regarde. L'ordre des tests est donc l'ordre de réparation : ce qui n'a pas
 * d'identité à sauver d'abord, puis l'identité, puis le reste.
 */
export const auditStable = (stable: Stable, colors: readonly NamedColor[]): StableAudit => {
  const defects: AuditFinding[] = [];
  const claims: AuditFinding[] = [];

  const byIdentity = new Map<string, Individual[]>();
  for (const mount of stable.individuals) {
    const key = identityKey(mount);
    byIdentity.set(key, [...(byIdentity.get(key) ?? []), mount]);
  }

  for (const mount of stable.individuals) {
    const status = mountStatus(mount);

    if (mount.name === null && status === 'sterile') {
      defects.push({ kind: 'anonymous-sterile', mount });
      continue;
    }

    const expected = dictatedNameFor(mount, colors);
    if (expected !== null && expected !== mount.name) {
      defects.push({ kind: 'stale-name', mount, expected });
      continue;
    }

    if (status === 'fertile' && mount.level > FRESH_LEVEL) {
      const kin = byIdentity.get(identityKey(mount)) ?? [mount];
      const held = emptyCounts();
      for (const other of kin) held[mountStatus(other)] += 1;
      defects.push({
        kind: 'impossible-level',
        mount,
        held,
        survivors: kin.filter((other) => mountStatus(other) === 'sterile'),
      });
      continue;
    }

    if (mount.name === null && mount.parents === null && status === 'fertile') {
      const bulk = bulkOf(stable.bulk.get(mount.colorId), mount);
      if (bulk > 0) claims.push({ kind: 'double-counted', mount, bulk });
    }
  }

  /*
   * Les défauts, du plus récemment écrit au plus ancien.
   *
   * On n'ouvre pas ce relevé pour auditer une écurie, on l'ouvre en sortant
   * d'une séance de saisie où quelque chose a cloché. Les lignes de ce soir sont
   * celles qu'on cherche ; celles du mois dernier ont déjà été vues ou ont déjà
   * servi.
   *
   * `createdAt` peut manquer — une monture posée dans l'état local avant sa
   * relecture n'en a pas encore. Elle passe en tête plutôt qu'en queue : ce qui
   * vient d'être écrit **est** le plus récent, et l'enterrer sous un mois
   * d'historique cacherait précisément la ligne qu'on vient de faire.
   */
  const byRecency = (a: AuditFinding, b: AuditFinding) =>
    (b.mount.createdAt ?? '').localeCompare(a.mount.createdAt ?? '') ||
    (a.mount.name ?? '').localeCompare(b.mount.name ?? '');

  return { defects: defects.sort(byRecency), claims: claims.sort(byRecency) };
};
