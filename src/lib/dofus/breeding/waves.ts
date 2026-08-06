import type { BreedingPlan } from './costs';
import { maxPairings, splitBySex, type BulkStock } from './stable';

/**
 * Le plan en fournées d'enclos, et non plus en liste de croisements.
 *
 * Une liste de croisements répond à « combien », jamais à « qu'est-ce que je
 * lance maintenant ». Or ces deux questions n'ont pas la même réponse dès que
 * l'écurie est courte sur un parent : vingt-cinq accouplements Doré + Amande
 * avec dix-huit Amande fertiles ne se lancent pas d'un bloc, ils se lancent en
 * deux vagues séparées par un clonage.
 *
 * Une **vague** est un tour de cycles de fécondité mené de front sur tout le
 * parc : toutes les montures qu'on y met progressent ensemble, et rien ne peut
 * en sortir avant la fin. Sa capacité est le nombre de places du parc — dix par
 * enclos — et deux d'entre elles partent à chaque accouplement, un parent
 * chacune.
 *
 * Deux contraintes la dimensionnent, et c'est la plus serrée qui décide :
 *
 * 1. **Les places.** Cinquante places portent au plus vingt-cinq accouplements.
 * 2. **Les parents fertiles disponibles à cet instant**, sexes compris. C'est
 *    celle qu'une liste de croisements ignore, et c'est presque toujours elle
 *    qui mord. Un accouplement demande un mâle et une femelle : dix mâles d'une
 *    couleur et aucune femelle ne font aucun couple, là où compter les montures
 *    sans distinguer les sexes en annonçait cinq.
 *
 * Entre deux vagues, les parents ressortis stériles se clonent — deux stériles
 * de même rang donnent un fertile, gratuitement et sans égard aux jauges. Le
 * clone repart les jauges vides, donc il refait un cycle complet : c'est bien
 * ce qui rend la vague suivante *séquentielle* et non parallèle. Le coût, lui,
 * ne bouge pas — il se compte par usage de parent, que l'usage soit servi par
 * une monture fraîche ou par un clone.
 *
 * Les places qu'une vague laisse libres sont du carburant déjà payé : la jauge
 * se vide au niveau de l'enclos, pas de la monture. Les occuper ne coûte que
 * les parents qu'on y met, d'où le remplissage par la couleur la mieux classée
 * après la cible.
 */

/** Ce qu'un groupe de places produit dans une vague. */
export type WaveLoad = {
  colorId: string;
  /** Accouplements que ce groupe permet. */
  crossings: number;
  /** Places occupées : deux par accouplement. */
  mounts: number;
};

export type Wave = {
  /** Rang de la vague, à partir de 1. */
  index: number;
  /** Ce que la vague avance sur le plan suivi. */
  target: WaveLoad;
  /**
   * Ce qui occupe les places restantes, ou `null` si la vague est pleine ou
   * qu'aucune autre couleur ne mérite d'y passer.
   */
  filler: WaveLoad | null;
  /** Places du parc. */
  capacity: number;
  /** Places réellement occupées, remplissage compris. */
  used: number;
  /**
   * Clonages à faire une fois la vague finie, pour réarmer les parents de la
   * suivante. Gratuits, mais sans eux la vague suivante manque de montures.
   */
  clonings: { colorId: string; count: number }[];
};

export type WavePlanOptions = {
  /**
   * Ce que l'éleveur possède réellement, par couleur **et par sexe**, et non le
   * minimum que le plan achète. Vient de `stableBySex`.
   */
  stock: Map<string, BulkStock>;
  /** Places du parc : dix par enclos. */
  capacity: number;
  recycleSteriles: boolean;
  /** La couleur qui occupe les places libres, si le classement en désigne une. */
  filler: string | null;
};

/**
 * Garde-fou contre une écurie qui ne permet aucun accouplement.
 *
 * Sans lui, une cible dont les parents manquent tourne indéfiniment sur une
 * vague de zéro accouplement. On préfère rendre une liste tronquée, que
 * l'appelant sait lire, plutôt que de bloquer le rendu.
 */
const MAX_WAVES = 200;

/**
 * Le plan découpé en vagues, dans l'ordre où elles se lancent.
 *
 * Les étapes arrivent déjà triées parents avant enfants, et cet ordre est aussi
 * l'ordre du temps : on ne peut pas accoupler une génération avant que la
 * précédente soit née. Les vagues d'une étape s'enchaînent donc derrière celles
 * de l'étape qui la précède.
 *
 * Une étape dont les parents manquent complètement interrompt le découpage : la
 * liste rendue s'arrête là, ce qui se voit, plutôt que d'annoncer un programme
 * que rien ne permet de lancer.
 */
export const planWaves = (
  plan: BreedingPlan,
  { stock, capacity, recycleSteriles, filler }: WavePlanOptions
): Wave[] => {
  if (capacity < 2) return [];

  /**
   * Montures fertiles disponibles par couleur, au fil du temps.
   *
   * Part du stock **réel** et non du `owned` du plan : celui-ci est plafonné au
   * minimum d'exemplaires à se procurer, alors qu'ici c'est le nombre de
   * montures réellement en main qui décide de la taille de la première vague.
   * Les achats s'y ajoutent, puisqu'on les fait avant de commencer.
   */
  const available = new Map([...stock].map(([id, counts]) => [id, { ...counts }]));

  /**
   * Ajoute des montures dont le sexe n'est pas encore connu — achats, clones et
   * naissances. Réparties à moitié-moitié : c'est l'espérance, et rien dans le
   * jeu ne permet de choisir. Voir `splitBySex`.
   */
  const addUnsexed = (colorId: string, count: number) => {
    if (count <= 0) return;
    const current = available.get(colorId) ?? { males: 0, females: 0 };
    const { males, females } = splitBySex(count);
    available.set(colorId, {
      males: current.males + males,
      females: current.females + females,
    });
  };

  /** Retire `count` montures d'une couleur, en entamant le sexe le mieux fourni. */
  const consume = (colorId: string, males: number, females: number) => {
    const current = available.get(colorId) ?? { males: 0, females: 0 };
    available.set(colorId, {
      males: current.males - males,
      females: current.females - females,
    });
  };

  for (const purchase of plan.purchases) {
    addUnsexed(purchase.colorId, purchase.count);
  }

  const waves: Wave[] = [];
  const perWave = Math.floor(capacity / 2);

  for (const step of plan.steps) {
    let remaining = step.attempts;
    /**
     * Parents ressortis stériles, **par sexe**, en attente d'être clonés.
     *
     * Le sexe était perdu ici, et c'est ce qui faisait manquer le levier : un
     * clone conserve le genre de l'original, donc appairer deux stériles du même
     * sexe donne un clone de ce sexe, à coup sûr. Voir plus bas.
     */
    const sterile = new Map<string, BulkStock>();
    const addSterile = (colorId: string, males: number, females: number) => {
      const current = sterile.get(colorId) ?? { males: 0, females: 0 };
      sterile.set(colorId, { males: current.males + males, females: current.females + females });
    };

    while (remaining > 0 && waves.length < MAX_WAVES) {
      const [first, second] = step.recipe;
      const sameColor = first === second;
      const firstFree = available.get(first) ?? { males: 0, females: 0 };
      const secondFree = available.get(second) ?? { males: 0, females: 0 };

      // Un accouplement demande un mâle et une femelle. Sur une recette à deux
      // couleurs, les deux orientations — mâle de l'une avec femelle de l'autre,
      // et l'inverse — ne se disputent aucune monture ; sur une recette à
      // couleur unique, c'est le sexe le moins représenté qui plafonne.
      const byParents = maxPairings(firstFree, secondFree, sameColor);
      const crossings = Math.min(remaining, byParents, perWave);

      // Plus aucun parent mobilisable : le programme s'arrête là plutôt que de
      // tourner à vide.
      if (crossings <= 0) return waves;

      if (sameColor) {
        consume(first, crossings, crossings);
        addSterile(first, crossings, crossings);
      } else {
        // On sert d'abord l'orientation la plus disponible, puis l'autre pour le
        // reste. Les deux puisant dans des sexes distincts, l'ordre ne change
        // pas le total — seulement quel sexe reste en fin de vague.
        const firstOrientation = Math.min(
          Math.min(firstFree.males, secondFree.females),
          crossings
        );
        const secondOrientation = crossings - firstOrientation;

        consume(first, firstOrientation, secondOrientation);
        consume(second, secondOrientation, firstOrientation);
        // Les stériles sortent sexés : ce sont exactement les montures qu'on
        // vient de consommer, et c'est leur sexe qui décidera de celui des
        // clones qu'on en tirera.
        addSterile(first, firstOrientation, secondOrientation);
        addSterile(second, secondOrientation, firstOrientation);
      }

      const used = crossings * 2;
      const spare = capacity - used;
      const fillerCrossings = filler ? Math.floor(spare / 2) : 0;

      // Les clonages se font une fois la vague sortie : ce sont eux qui
      // réarment la suivante, et c'est pour cela qu'elle ne peut pas démarrer
      // avant. On ne clone que ce qui reste à produire — cloner après le dernier
      // accouplement ne servirait personne.
      const clonings: Wave['clonings'] = [];
      if (recycleSteriles && remaining - crossings > 0) {
        for (const parent of new Set(step.recipe)) {
          const idle = sterile.get(parent) ?? { males: 0, females: 0 };

          // Le clone conserve le **genre** de l'original — l'écran du jeu le dit
          // — et c'est l'une des deux appairées qui est clonée. Appairer deux
          // stériles du même sexe rend donc un clone de ce sexe, à coup sûr.
          //
          // Le sexe ne se subit plus, il se choisit. C'est le remède direct au
          // déséquilibre qui a motivé le suivi par sexe : huit mâles et deux
          // femelles ne faisaient que deux couples, et les clones tirés à
          // moitié-moitié ne corrigeaient rien. En n'appairant que des
          // identiques, on reconstitue exactement le sexe qui manque.
          const clonesM = Math.floor(idle.males / 2);
          const clonesF = Math.floor(idle.females / 2);
          const clones = clonesM + clonesF;
          if (clones <= 0) continue;

          sterile.set(parent, {
            males: idle.males - clonesM * 2,
            females: idle.females - clonesF * 2,
          });

          const current = available.get(parent) ?? { males: 0, females: 0 };
          available.set(parent, {
            males: current.males + clonesM,
            females: current.females + clonesF,
          });

          clonings.push({ colorId: parent, count: clones });
        }
      }

      waves.push({
        index: waves.length + 1,
        target: { colorId: step.colorId, crossings, mounts: used },
        filler:
          filler && fillerCrossings > 0
            ? { colorId: filler, crossings: fillerCrossings, mounts: fillerCrossings * 2 }
            : null,
        capacity,
        used: used + fillerCrossings * 2,
        clonings,
      });

      remaining -= crossings;
    }

    // Les bébés de l'étape rejoignent le vivier : les générations suivantes s'en
    // servent comme parents. Sexes inconnus tant qu'ils ne sont pas nés.
    addUnsexed(step.colorId, step.count);
  }

  return waves;
};

/**
 * Vagues nécessaires par couleur produite, pour corriger le délai.
 *
 * `planDuration` suppose que tous les parents d'une étape se préparent de front,
 * ce qui n'est vrai que si l'écurie les porte tous en même temps. Ce compte dit
 * combien de tours de cycles l'étape demande réellement.
 */
export const wavesByStep = (waves: Wave[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const wave of waves) {
    counts.set(wave.target.colorId, (counts.get(wave.target.colorId) ?? 0) + 1);
  }
  return counts;
};
