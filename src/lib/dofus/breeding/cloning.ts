import { carriedGeneration } from './naming';
import { mateSignature, type Mate } from './pairing';
import { isSterile, type Individual, type Sex, type Stable } from './stable';

/**
 * Quelles deux stériles appairer pour cloner — et laquelle on espère récupérer.
 *
 * L'écran du jeu pose les règles : deux montures de **même génération affichée**
 * entrent, les deux sont détruites, **l'une des deux au hasard** ressort. Elle
 * conserve la couleur, le genre, le nom et la généalogie de l'originale ; seules
 * les jauges repartent à zéro.
 *
 * Trois conséquences, et c'est la troisième qui décide.
 *
 * ## 1. Une stérile ne vaut rien jusqu'à ce qu'on la clone
 *
 * Elle ne s'accouple plus. Il ne lui reste que l'extraction — sa génération en
 * ressource — ou de servir d'entrée à un clonage. Le clonage n'est donc pas un
 * arbitrage entre deux emplois d'une monture précieuse : c'est le seul moyen de
 * lui rendre une valeur.
 *
 * **Sauf au sommet, et c'est la seule exception.** Une gen 10 stérile se **vend**
 * à son prix d'HDV, qui est le plus haut de l'arbre ; la refondre en échange
 * d'une fécondité détruit la monture la plus chère qu'on possède pour une chance
 * sur deux d'en refaire une. Le marché s'inverse donc exactement au plafond, et
 * `cloneOptions` n'y propose plus rien.
 *
 * Ce n'est pas un raisonnement, c'est une mesure : jouée sans cette exception, la
 * boucle du sommet — voir `aimsAtSummit` — **perd 8,38 M** sur 200 graines,
 * parce que le cloneur refond exactement ce qu'elle vient de produire. Avec, elle
 * en gagne 43,18 et remporte les 200. Les deux règles ne valent rien séparément.
 *
 * ## 2. Ce qui fait la valeur d'une monture, c'est son ascendance
 *
 * Depuis #59, une gen 1 dont un parent est gen 9 vise la gen 10 — comme une
 * gen 9, qui coûte cent fois plus cher. On valorise donc une monture par
 * **ce qu'il faudrait payer pour la remplacer dans son rôle** : le prix de la
 * couleur la moins chère de la génération que son ascendance porte. Pas par sa
 * propre couleur, qui ne dit rien de ce qu'elle permet.
 *
 * ## 3. Ce qui compte n'est pas qui va avec qui, mais qui reste dépareillée
 *
 * L'intuition dit qu'il ne faut jamais dépenser une porteuse pour en sauver une
 * autre. **C'est faux en espérance**, et il vaut mieux le dire : une paire rend
 * la moitié de la somme des deux valeurs, donc la somme sur tout un parc apparié
 * vaut la moitié de la somme des montures appariées — quel que soit l'appariement.
 * Appairer deux porteuses ou les appairer chacune à une banale donne exactement
 * le même total, la seconde option laissant les deux banales s'appairer entre
 * elles.
 *
 * Ce qui change le total, c'est **qui ne trouve pas de partenaire**. Avec deux
 * porteuses et une seule banale, appairer la meilleure porteuse à la banale
 * laisse l'autre porteuse sur le carreau — et une stérile dépareillée ne vaut
 * plus que son extraction. Il faut alors appairer les deux porteuses.
 *
 * D'où l'appariement retenu : on **écarte la moins précieuse** quand l'effectif
 * est impair, puis on apparie la plus haute avec la plus basse, la deuxième plus
 * haute avec la deuxième plus basse, et ainsi de suite. Rien de précieux n'est
 * jamais laissé de côté, et les porteuses partent de préférence avec une banale
 * — ce qui ne change pas le total mais **décorrèle les tirages** : deux porteuses
 * distinctes appairées ensemble ne peuvent jamais survivre toutes les deux,
 * appairées séparément elles ont une chance sur quatre.
 *
 * ## L'exception : quand il n'y a pas de tirage du tout
 *
 * Tout ce qui précède raisonne sur une pièce qu'on lance. Deux stériles de même
 * couleur **et de même ascendance** n'en lancent aucune : le clone est le même
 * des deux côtés. Les apparier rend donc la même espérance avec **zéro
 * variance**, et la décorrélation ci-dessus ne s'y applique pas — on n'a jamais
 * voulu deux exemplaires de la même monture, on en voulait une, certaine.
 *
 * Or « la plus haute avec la plus basse » ne les rapproche jamais : à valeur
 * égale elles se rangent côte à côte, donc du même côté du tri. Sur l'écurie
 * réelle du 14/08, **douze propositions, toutes à pile ou face**, pendant que six
 * clonages à ascendance certaine dormaient dans la même écurie. C'était #163.
 * Elles passent donc en premier, et le reste garde la règle ci-dessus.
 *
 * ## Le sexe, qui est gratuit et qu'on oublie
 *
 * Le clone garde le genre de celle qui est clonée. Appairer deux stériles du
 * **même sexe** rend donc ce sexe certain, sans rien changer aux chances sur
 * l'ascendance. C'est strictement meilleur, et c'est le remède direct au
 * déséquilibre qui bloque les fournées : huit mâles et deux femelles ne font que
 * deux couples.
 */

/** Une monture stérile, réduite à ce que l'arbitrage a besoin d'en savoir. */
export type SterileMount = Mate & {
  /** La génération affichée, celle que le jeu compare pour autoriser le clonage. */
  generation: number;
  /** La génération que son ascendance porte : ce qu'elle permet réellement. */
  carried: number;
  /** Ce qu'il faudrait payer pour la remplacer dans son rôle. */
  value: number;
};

export type CloneContext = {
  generations: Map<string, number>;
  /** Ce qu'une couleur coûte à se procurer. */
  costOf: (colorId: string) => number;
  /**
   * La couleur la moins chère d'une génération donnée — le prix de remplacement
   * du **rôle**, puisque n'importe quelle monture de cette génération le tient.
   */
  cheapestAt: (generation: number) => number;
  /** Ce que l'extraction rend par unité, pour chiffrer ce qu'on renonce à sacrifier. */
  sacrificeUnitValue: number;
};

/** Les stériles suivies individuellement, valorisées par ce qu'elles permettent. */
export const sterileMounts = (stable: Stable, context: CloneContext): SterileMount[] =>
  stable.individuals
    .filter((mount: Individual) => isSterile(mount))
    .map((mount) => {
      const generation = context.generations.get(mount.colorId) ?? 1;
      const carried = carriedGeneration(
        generation,
        mount.parents
          ? [
              context.generations.get(mount.parents[0]) ?? 1,
              context.generations.get(mount.parents[1]) ?? 1,
            ]
          : null
      );
      return {
        id: mount.id,
        colorId: mount.colorId,
        sex: mount.sex,
        level: mount.level,
        parents: mount.parents,
        generation,
        carried,
        value: context.cheapestAt(carried),
      };
    });

/** Un appairage de clonage proposé, et ce qu'on en attend. */
export type CloneOption = {
  /** Celle qu'on espère récupérer : la plus précieuse des deux. */
  keep: SterileMount;
  partner: SterileMount;
  /**
   * Chance de récupérer `keep` : **1** quand les deux portent la même
   * ascendance — le tirage ne change alors rien — et **0,5** sinon.
   */
  keepChance: number;
  /** Valeur espérée du clone obtenu. */
  expectedValue: number;
  /** Ce qu'on renonce à extraire en détruisant les deux. */
  sacrificed: number;
  /** Gain net de l'opération. Négatif : mieux vaut extraire. */
  gain: number;
  /** `true` quand les deux sont du même sexe, donc le sexe du clone est certain. */
  certainSex: boolean;
  /** Le sexe obtenu, ou `null` s'il dépend du tirage. */
  sex: Sex | null;
};

/**
 * Ce que rend l'extraction d'une monture : une ressource par génération, et
 * rien du tout en génération 1 — elles ne s'extraient pas.
 */
const sacrificeValue = (mount: SterileMount, { sacrificeUnitValue }: CloneContext) =>
  mount.generation > 1 ? mount.generation * sacrificeUnitValue : 0;

/**
 * Un clonage chiffré : ce qu'il rend en espérance, contre ce qu'il renonce à
 * extraire.
 *
 * `keepChance` vaut **1** quand les deux portent la même ascendance — le tirage
 * ne change alors rien, l'une comme l'autre rend le même clone — et 0,5 sinon.
 */
const optionFor = (
  keep: SterileMount,
  partner: SterileMount,
  context: CloneContext
): CloneOption => {
  const keepChance = mateSignature(keep) === mateSignature(partner) ? 1 : 0.5;
  const expectedValue = keepChance * keep.value + (1 - keepChance) * partner.value;
  const sacrificed = sacrificeValue(keep, context) + sacrificeValue(partner, context);
  const certainSex = keep.sex === partner.sex;

  return {
    keep,
    partner,
    keepChance,
    expectedValue,
    sacrificed,
    gain: expectedValue - sacrificed,
    certainSex,
    sex: certainSex ? keep.sex : null,
  };
};

/**
 * Les clonages à faire, du plus rentable au moins.
 *
 * Glouton par génération, puisque le jeu n'apparie qu'à génération affichée
 * égale. Dans chaque génération, les **jumelles** partent ensemble d'abord — le
 * clone y est certain, voir l'en-tête — puis la plus précieuse du reste part avec
 * la moins précieuse, en préférant une partenaire du même sexe pour rendre le
 * sexe du clone certain.
 *
 * Les appairages à gain négatif sont rendus quand même, en queue : ils disent
 * qu'il vaut mieux extraire, et c'est une décision autant qu'une autre.
 */
export const cloneOptions = (
  stable: Stable,
  context: CloneContext,
  limit = 10
): CloneOption[] => {
  // Le plafond de la famille, lu sur les générations connues. C'est la borne
  // au-delà de laquelle un clonage cesse d'être une bonne affaire.
  const top = Math.max(0, ...context.generations.values());

  const byGeneration = new Map<number, SterileMount[]>();
  for (const mount of sterileMounts(stable, context)) {
    // Le sommet ne se refond pas — voir l'en-tête.
    if (mount.generation >= top) continue;
    const group = byGeneration.get(mount.generation) ?? [];
    group.push(mount);
    byGeneration.set(mount.generation, group);
  }

  const options: CloneOption[] = [];

  for (const group of byGeneration.values()) {
    const sorted = [...group].sort((a, b) => b.value - a.value || a.id!.localeCompare(b.id!));

    /**
     * D'abord les **jumelles** : deux stériles dont le clone est le même, quel
     * que soit le côté de la pièce.
     *
     * « La plus haute avec la plus basse » ne les rapproche jamais, puisqu'elles
     * ont exactement la même valeur et se rangent donc côte à côte du même côté
     * du tri. Sur l'écurie réelle du 14/08 ça donnait **douze propositions,
     * toutes à pile ou face**, pendant que six clonages à ascendance certaine
     * dormaient dans la même écurie. C'est le défaut de #163.
     *
     * Les apparier ne change **rien à l'espérance** — l'argument du §3 tient, un
     * parc apparié vaut la moitié de la somme quel que soit l'appariement — mais
     * il retire la variance là où elle n'achète rien. Deux jumelles appariées
     * séparément se perdent toutes les deux une fois sur quatre ; ensemble, il en
     * ressort une à coup sûr.
     *
     * Et la décorrélation du §3 ne s'y oppose pas : elle vaut pour deux porteuses
     * **distinctes**, qu'on voudrait garder toutes les deux. De deux jumelles on
     * n'en a jamais voulu deux — le jeu ne conserve que la couleur, le sexe, le
     * nom et la généalogie, et elles les partagent toutes. On en voulait une,
     * certaine.
     *
     * Deux passes, et l'ordre dit ce qui prime. Le même sexe d'abord, parce qu'il
     * rend le clone certain sur les deux tableaux à la fois. Puis l'ascendance
     * seule : un sexe tiré à pile ou face se rachète à l'hôtel de vente, une
     * ascendance perdue ne se rachète pas.
     */
    const taken = new Set<SterileMount>();
    const pairTwins = (keyOf: (mount: SterileMount) => string) => {
      const twins = new Map<string, SterileMount[]>();
      for (const mount of sorted) {
        if (taken.has(mount)) continue;
        const key = keyOf(mount);
        twins.set(key, [...(twins.get(key) ?? []), mount]);
      }
      for (const sisters of twins.values()) {
        for (let i = 0; i + 1 < sisters.length; i += 2) {
          options.push(optionFor(sisters[i], sisters[i + 1], context));
          taken.add(sisters[i]);
          taken.add(sisters[i + 1]);
        }
      }
    };
    pairTwins((mount) => `${mateSignature(mount)}|${mount.sex}`);
    pairTwins((mount) => mateSignature(mount));

    // Ce qui n'a pas trouvé sa jumelle garde la règle d'origine.
    const pool = sorted.filter((mount) => !taken.has(mount));

    // Effectif impair : c'est la moins précieuse qui reste sur le carreau, et
    // c'est le seul choix qui coûte quelque chose. Laisser une porteuse
    // dépareillée la réduirait à son extraction.
    if (pool.length % 2 === 1) pool.pop();

    while (pool.length >= 2) {
      const keep = pool.shift()!;

      // La plus basse restante, et à valeur égale celle du même sexe : le sexe
      // certain ne coûte rien et débloque les fournées.
      let index = pool.length - 1;
      for (let i = pool.length - 1; i >= 0; i -= 1) {
        if (pool[i].value > pool[index].value) break;
        if (pool[i].sex === keep.sex) {
          index = i;
          break;
        }
      }
      const partner = pool.splice(index, 1)[0];
      options.push(optionFor(keep, partner, context));
    }
  }

  return options.sort((a, b) => b.gain - a.gain).slice(0, limit);
};
