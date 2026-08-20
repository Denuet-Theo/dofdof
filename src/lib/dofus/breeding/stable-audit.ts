import { auditClones, type CloneClaim, type CloneTally } from './clone-audit';
import { dictatedNameFor, type NamedColor } from './naming';
import { mountStatus, type BulkStock, type Individual, type Stable } from './stable';

/**
 * Ce que l'écurie peut dire de fausse **toute seule**, sans regarder le jeu.
 *
 * ## Pourquoi ça existe séparément du recensement
 *
 * Il y a deux façons de trouver un écart entre l'app et la partie, et elles ne
 * se remplacent pas.
 *
 * La première est le **recensement** : poser les deux écrans côte à côte et
 * comparer les facettes, total, état, sexe, génération, couleur. C'est
 * `BreedingStockFilters`, bâti exprès aux intitulés et dans l'ordre du jeu, et
 * c'est la seule façon de trouver ce que l'app croit vrai sans raison de se
 * méfier — une stérile recyclée en jeu, une féconde qui n'a jamais vu d'enclos,
 * un niveau faux. Elle demande le jeu ouvert.
 *
 * La seconde est ce module : les lignes que l'écurie contredit **par sa propre
 * logique**. Une anonyme stérile, un nom qui ne décrit plus sa monture, une
 * fertile là où rien ne peut en produire une. Elles ne demandent rien à
 * personne, elles sont fausses en soi, et elles se trouvaient jusqu'ici
 * dispersées : une bannière ici, un petit bouton ambre au fil de deux cents
 * lignes là, et rien du tout pour la troisième.
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
 */

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
   * Une gen 1 fertile sans ascendance, alors que le vrac tient déjà sa couleur.
   *
   * Le compteur de vrac ne porte **que** des fertiles sans ascendance : c'est sa
   * définition. Une monture suivie de même couleur et de même sexe, fertile et
   * sans ascendance, est donc probablement la même, comptée deux fois — et c'est
   * la porte par laquelle les cinquante-sept fantômes sont entrés.
   *
   * « Probablement » est retenu, pas concédé : l'ajout manuel accepte une
   * monture sans ascendance, et deux montures distinctes peuvent parfaitement
   * exister. C'est pour ça que ça va dans `claims` et non dans `defects` — le
   * compte du jeu tranche, l'app ne le fait pas à sa place.
   */
  | { kind: 'double-counted'; mount: Individual; bulk: number }
  /** Une ligne qui prétend être un clone — voir `clone-audit.ts`. */
  | { kind: 'clone-claim'; mount: Individual; claim: CloneClaim };

export type StableAudit = {
  /** Faux quoi qu'en dise la partie. Se corrige sans ouvrir le jeu. */
  defects: AuditFinding[];
  /** Vérifiable, et vérifié par le jeu seul. */
  claims: AuditFinding[];
  /** Le compte des clones par niveau, à confronter aux FILTRES du jeu. */
  tally: CloneTally[];
};

/** Ce que le vrac tient de cette couleur, du sexe demandé. */
const bulkOf = (stock: BulkStock | undefined, mount: Individual): number => {
  if (!stock) return 0;
  return mount.sex === 'M' ? stock.males : stock.females;
};

/**
 * Le relevé complet de l'écurie, dans l'ordre où on veut le lire.
 *
 * Les défauts d'abord, parce qu'ils se règlent sans rien ouvrir ; les
 * affirmations ensuite, parce qu'elles demandent le jeu sous les yeux et que
 * c'est un autre geste, dans un autre moment.
 */
export const auditStable = (stable: Stable, colors: readonly NamedColor[]): StableAudit => {
  const defects: AuditFinding[] = [];
  const claims: AuditFinding[] = [];

  for (const mount of stable.individuals) {
    const status = mountStatus(mount);

    if (mount.name === null && status === 'sterile') {
      defects.push({ kind: 'anonymous-sterile', mount });
      // Une seule classe par monture : un reste anonyme n'a pas de nom à
      // rectifier, et l'annoncer deux fois ferait compter deux problèmes là où
      // il y en a un — le seul chiffre que l'éleveur compare au jeu.
      continue;
    }

    const expected = dictatedNameFor(mount, colors);
    if (expected !== null && expected !== mount.name) {
      defects.push({ kind: 'stale-name', mount, expected });
      continue;
    }

    if (mount.name === null && mount.parents === null && status === 'fertile') {
      const bulk = bulkOf(stable.bulk.get(mount.colorId), mount);
      if (bulk > 0) claims.push({ kind: 'double-counted', mount, bulk });
    }
  }

  // Le clonage garde son module : son raisonnement — pourquoi une fertile
  // au-dessus du niveau 1 est un clone, et ce que la liste ne peut structurellement
  // pas voir — ne tient pas en une clause de boucle.
  const clones = auditClones(stable.individuals);
  /*
   * Une monture déjà en défaut ne devient pas une affirmation.
   *
   * Les deux se croisent pour de bon : un clone dont le nom a divergé est les
   * deux à la fois. Mais l'affirmation se vérifie **en cherchant ce nom dans
   * l'écurie du jeu**, et un nom faux ne trouve rien — la vérification ne peut
   * donc pas se faire avant la correction. La montrer quand même la ferait
   * conclure « le jeu ne la montre pas », c'est-à-dire tirer d'un nom cassé la
   * preuve d'un clonage inventé.
   *
   * D'où l'ordre : on répare ce qui est faux, et le relevé rouvert propose
   * ensuite ce qui reste à confronter.
   */
  const flawed = new Set(defects.map((finding) => finding.mount.id));
  for (const claim of clones.claims) {
    if (flawed.has(claim.clone.id)) continue;
    claims.push({ kind: 'clone-claim', mount: claim.clone, claim });
  }

  return { defects, claims, tally: clones.tally };
};
