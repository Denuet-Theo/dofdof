import type { BreedingPlan } from './costs';

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
 * 2. **Les parents fertiles disponibles à cet instant.** C'est celle qu'une
 *    liste de croisements ignore, et c'est presque toujours elle qui mord.
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
  /** Ce que l'éleveur possède réellement, et non le minimum que le plan achète. */
  stock: Map<string, number>;
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
  const available = new Map(stock);
  for (const purchase of plan.purchases) {
    available.set(purchase.colorId, (available.get(purchase.colorId) ?? 0) + purchase.count);
  }

  const waves: Wave[] = [];
  const perWave = Math.floor(capacity / 2);

  for (const step of plan.steps) {
    let remaining = step.attempts;
    /** Parents ressortis stériles, en attente d'être clonés. */
    const sterile = new Map<string, number>();

    while (remaining > 0 && waves.length < MAX_WAVES) {
      const [first, second] = step.recipe;
      const firstFree = available.get(first) ?? 0;
      const secondFree = available.get(second) ?? 0;

      // Une recette qui appaire deux fois la même couleur consomme deux
      // exemplaires par accouplement, pas un de chaque.
      const byParents =
        first === second ? Math.floor(firstFree / 2) : Math.min(firstFree, secondFree);
      const crossings = Math.min(remaining, byParents, perWave);

      // Plus aucun parent mobilisable : le programme s'arrête là plutôt que de
      // tourner à vide.
      if (crossings <= 0) return waves;

      for (const parent of step.recipe) {
        available.set(parent, (available.get(parent) ?? 0) - crossings);
        sterile.set(parent, (sterile.get(parent) ?? 0) + crossings);
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
          const idle = sterile.get(parent) ?? 0;
          const clones = Math.floor(idle / 2);
          if (clones <= 0) continue;
          sterile.set(parent, idle - clones * 2);
          available.set(parent, (available.get(parent) ?? 0) + clones);
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
    // servent comme parents.
    available.set(step.colorId, (available.get(step.colorId) ?? 0) + step.count);
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
