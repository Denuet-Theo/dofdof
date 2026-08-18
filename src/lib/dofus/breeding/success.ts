import { isProjected } from './cloning';
import { composedColorOf, mateGroups, pairOutlook, type Mate } from './pairing';
import type { BreedingColor } from './costs';
import type { Stable } from './stable';

/**
 * Le succès de collection : chaque couleur de la famille, née au moins une fois.
 *
 * ## Ce qui compte comme « fait naître »
 *
 * Une naissance **enregistrée**, et rien d'autre. Pas ce que l'écurie porte :
 * l'éleveur achète aussi des montures qui ont une généalogie, si bien que
 * « parents renseignés » ne prouve rien. La collection se remplit donc à la saisie
 * de « Ce qui est né » — voir `recordBirths` — et par aucun autre chemin, ni
 * déduction depuis l'écurie, ni case à cocher.
 *
 * Conséquence assumée : le compteur part de zéro et ignore ce qui a été élevé
 * avant que la table existe. Rien de faux n'y entre, ce qui est le compromis
 * retenu.
 *
 * ## Pourquoi c'est hors plan, et pourquoi la stratégie est bloquée
 *
 * L'échelle ne planifie que ce qui sert la montée, et c'est peu : **30 couleurs
 * sur 120** en muldo, 18 sur 66 en dragodinde, 28 sur 120 en volkorne. Les 90
 * autres ne sont sur aucune route — dont les **50 gen 10**, puisqu'on n'en
 * couronne qu'une. Le succès demande donc, par définition, de produire ce que le
 * plan ne demande pas.
 *
 * Il n'existe aucun chemin gratuit vers lui, et deux mesures du dépôt disent
 * pourquoi :
 *
 * - `loadout.ts` mesure qu'un croisement **n'est jamais gratuit, même sur une
 *   place inoccupée** : il stérilise ses deux parents définitivement, et remplir
 *   les places libres de croisements a coûté quatre fournées et 3,5 % de kamas.
 *   Ce qui est gratuit sur une place libre, c'est la fécondation, et
 *   `fillSparePlaces` y met déjà celle-là — bornée depuis à ce qui prépare un
 *   croisement admissible, une par groupe, faute de quoi elle bouchait les
 *   places avec des montures que rien ne pouvait marier. Voir `pairedBanking`.
 * - `check-recipes.mjs` verrouille le jeu de gen 2 retenu comme **union disjointe
 *   de cliques**, parce qu'un raté de `A × B` rend une gen 1 portant `[A, B]` et
 *   que la réemployer hors clique dédouble la cible : **27 % de la masse utile**
 *   s'en va. Détourner un croisement vers une couleur manquante casse donc cette
 *   propriété.
 *
 * Chiffrer ces deux coûts est une branche à part, et le choix de stratégie reste
 * **bloqué** jusque-là. Un réglage sans effet est exactement ce que #181 et #216
 * ont passé deux PR à retirer de cet écran ; `check:settings` l'interdit
 * désormais par construction, puisqu'un champ n'entre dans `BreedingSettings`
 * qu'accompagné du contrôle qui l'écrit.
 *
 * Ce module ne fait donc que tenir la collection à jour.
 */

/** Où en est la collection d'une famille. */
export const collectionProgress = (colors: BreedingColor[], hatched: ReadonlySet<string>) => {
  const done = colors.filter((color) => hatched.has(color.id)).length;
  return { done, total: colors.length, missing: colors.length - done };
};

/**
 * Ce qu'il reste à faire naître, la génération la plus basse d'abord.
 *
 * L'ordre est celui de l'effort : une gen 2 manquante se complète en un croisement
 * de gen 1, une gen 10 demande toute une route. À génération égale, l'ordre
 * alphabétique, stable d'un rendu à l'autre.
 */
export const missingColors = (
  colors: BreedingColor[],
  hatched: ReadonlySet<string>
): BreedingColor[] =>
  colors
    .filter((color) => !hatched.has(color.id))
    .sort((a, b) => a.generation - b.generation || a.name.localeCompare(b.name, 'fr'));

/** Ce que la politique fait du succès. `ignore` est le défaut. */
export type SuccessMode = 'ignore' | 'free' | 'priority';

export const SUCCESS_MODES: SuccessMode[] = ['ignore', 'free', 'priority'];

/** Le catalogue et la collection, tels que l'écran les tient. */
export type SuccessContext = {
  colors: BreedingColor[];
  generations: Map<string, number>;
  /** Les couleurs déjà nées au moins une fois. */
  hatched: ReadonlySet<string>;
};

/** Un croisement du plan, détourné vers une couleur jamais obtenue. */
export type Redirection = {
  /** La couleur que le pas du plan visait. */
  from: string;
  /** Celle qu'on vise à la place, jamais obtenue et de même génération. */
  to: string;
  /** Le partenaire remplacé, puis son remplaçant. */
  swap: readonly [string, string];
  /** Le remplaçant manque à l'écurie : il faudra l'acheter. */
  buy: boolean;
};

/** Les couleurs fertiles que l'écurie porte, vrac compris. */
const heldColors = (stable: Stable): Set<string> => {
  const held = new Set<string>();
  for (const [colorId, stock] of stable.bulk) {
    if (stock.males + stock.females > 0) held.add(colorId);
  }
  for (const mount of stable.individuals) if (mount.fertile) held.add(mount.colorId);
  return held;
};

/**
 * Vers quoi un pas du plan peut être détourné, sans changer de rang.
 *
 * On tient un côté de la recette et on cherche un remplaçant de l'autre tel que
 * la paire nomme une couleur **de la même génération**, jamais obtenue. La
 * génération préservée est ce qui rend l'échange défendable : le croisement occupe
 * les mêmes places, consomme autant de montures, et atteint le même rang de
 * l'échelle. Seule la couleur change.
 *
 * `null` quand rien ne convient, ce qui est le cas le plus fréquent — la plupart
 * des pas n'ont pas de voisin manquant à leur génération.
 *
 * ## L'ordre des candidats
 *
 * Ce qui est **déjà en écurie** d'abord : l'échange est alors sans dépense.
 * Ensuite ce qui s'achète, et le moins cher d'abord — la génération sert de proxy
 * de prix, ce qui est grossier mais suffit à préférer une gen 1 à une gen 5. Le
 * mode `free` accepte l'achat, sur décision de l'éleveur : une gen 1 coûte 4 à
 * 6 000 kamas, ce qui est petit sans être nul.
 */
export const redirectionFor = (
  step: { colorId: string; recipe: readonly [string, string] },
  stable: Stable,
  context: SuccessContext
): Redirection | null => {
  const rung = context.generations.get(step.colorId);
  if (rung === undefined) return null;

  const names = composedColorOf(context.colors);
  const held = heldColors(stable);

  const candidates: Redirection[] = [];
  for (const [side, other] of [
    [step.recipe[0], step.recipe[1]],
    [step.recipe[1], step.recipe[0]],
  ] as const) {
    for (const color of context.colors) {
      if (color.id === side) continue;
      const named = names(other, color.id);
      // Même rang, jamais obtenue : les deux conditions font tout le contrat.
      if (!named || context.generations.get(named) !== rung) continue;
      if (context.hatched.has(named) || named === step.colorId) continue;
      candidates.push({
        from: step.colorId,
        to: named,
        swap: [side, color.id],
        buy: !held.has(color.id),
      });
    }
  }

  if (candidates.length === 0) return null;
  return candidates.sort(
    (a, b) =>
      Number(a.buy) - Number(b.buy) ||
      (context.generations.get(a.swap[1]) ?? 0) - (context.generations.get(b.swap[1]) ?? 0) ||
      a.to.localeCompare(b.to)
  )[0];
};

/** Un croisement monté pour la collection, et rien d'autre. */
export type CollectionCrossing = {
  male: Mate;
  female: Mate;
  /** Les couleurs jamais obtenues que ce croisement peut rendre. */
  wanted: string[];
  /** Probabilité cumulée d'en rendre une. Sert à classer, pas à parier. */
  chance: number;
};

/**
 * Les croisements que l'écurie permet et qui rendraient une couleur manquante.
 *
 * Le levier de `priority`, et il **coûte** : chaque croisement stérilise ses deux
 * parents définitivement, y compris ceux que l'échelle réclamait. C'est le
 * sacrifice que le mode assume, pas un effet de bord.
 *
 * Classés par probabilité de rendre une couleur manquante, la plus haute devant :
 * viser une gen 10 à 3 % collectionne moins vite qu'une gen 6 à 45 %, et
 * l'éleveur qui ouvre ce mode veut avancer, pas parier.
 *
 * On travaille sur les **ascendances distinctes** et non sur les montures : deux
 * gen 1 achetées visent la même chose, et les proposer deux fois ne ferait
 * qu'allonger la liste.
 */
export const collectionCrossings = (
  stable: Stable,
  context: SuccessContext,
  limit = 8
): CollectionCrossing[] => {
  const partners = [...mateGroups(stable).values()].map(({ sample }) => sample);
  const found: CollectionCrossing[] = [];
  const seen = new Map<string, number>();

  for (let index = 0; index < partners.length; index += 1) {
    for (let other = index + 1; other < partners.length; other += 1) {
      const [a, b] = [partners[index], partners[other]];
      if (a.sex === b.sex) continue;
      const [male, female] = a.sex === 'M' ? [a, b] : [b, a];

      const outlook = pairOutlook(male, female, context.colors, context.generations);
      if (!outlook || outlook.targetColors.length === 0) continue;

      const total = outlook.targetColors.reduce((sum, color) => sum + color.weight, 0);
      let chance = 0;
      const wanted: string[] = [];
      for (const target of outlook.targetColors) {
        if (context.hatched.has(target.colorId)) continue;
        wanted.push(target.colorId);
        chance += outlook.successRate * (total > 0 ? target.weight / total : 0);
      }
      if (wanted.length === 0) continue;

      /**
       * Une **couleur à collectionner** ne se propose qu'une fois.
       *
       * Et non une paire d'ascendances : l'écurie du 17/08 porte sept Amande de
       * sept ascendances différentes, si bien que « Amande × Doré-Amande » désigne
       * sept couples distincts pour le modèle et une seule ligne pour l'œil. Le
       * dédoublonnage sur les ascendances laissait donc la même proposition
       * apparaître six fois d'affilée.
       *
       * Ce que l'éleveur décide, c'est quelle couleur manquante il va chercher —
       * pas avec quelle Amande. On garde donc une ligne par ensemble de couleurs
       * manquantes, celle dont la chance est la plus haute, et l'écran nomme les
       * deux montures pour qu'on sache laquelle prendre.
       */
      const key = [...wanted].sort().join('+');
      const previous = seen.get(key);
      if (previous !== undefined && found[previous].chance >= chance) continue;
      if (previous !== undefined) {
        found[previous] = { male, female, wanted, chance };
        continue;
      }
      seen.set(key, found.length);
      found.push({ male, female, wanted, chance });
    }
  }

  return found.sort((a, b) => b.chance - a.chance || b.wanted.length - a.wanted.length).slice(0, limit);
};

/* ------------------------------------------------ la passe sur la fournée -- */

/**
 * Ce que la politique fait du succès, appliqué **après** la recherche.
 *
 * ## Pourquoi après, et pas dedans
 *
 * `search.ts` est portée en Rust et comparée au milliardième par
 * `check-search.mjs` ; le champion a été entraîné sur cette physique-là. Faire
 * entrer la collection dans la montée demanderait de porter la passe, de
 * régénérer les six références et de ré-entraîner. Rien de tout ça n'est justifié
 * par un succès de collection.
 *
 * Le dépôt a déjà le précédent : `fillSparePlaces` est « fermée dans le modèle,
 * qui doit rester comparable au Rust, et ouverte ici, où l'on charge un vrai
 * enclos ». Cette passe suit exactement la même règle, un cran plus loin : elle
 * ne touche que le `StablePlan` rendu, donc la recherche et sa parité sont
 * intactes.
 *
 * ## Ce qu'elle fait, et ce qu'elle refuse de faire
 *
 * **`free`** détourne un croisement déjà prévu : elle remplace un parent par un
 * autre de **même génération** pour viser une couleur jamais obtenue. Le rang
 * atteint ne change pas, le nombre de croisements ne change pas, les places ne
 * changent pas — sauf si le remplaçant doit s'acheter, et alors elle facture la
 * place du cycle et l'achat.
 *
 * Elle ne détourne que si un remplaçant est **réellement disponible** : une
 * monture fertile de la bonne couleur et du bon sexe que ce plan n'a pas déjà
 * engagée, ou une gen 1 à acheter. Sans quoi elle laisse la ligne intacte —
 * proposer un croisement dont un parent n'existe pas serait pire que ne rien
 * proposer.
 *
 * **`priority`** ajoute en plus des croisements dédiés dans les places qui
 * restent. Chacun stérilise deux montures définitivement, y compris celles que
 * l'échelle réclamait, et c'est le sacrifice que le mode assume.
 *
 * ## Ce qu'elle coûte, mesuré
 *
 * Voir l'en-tête du module : détourner casse la propriété de clique que
 * `check-recipes.mjs` verrouille, et un croisement dédié n'est jamais gratuit même
 * sur une place libre. Les deux modes sont donc chiffrés avant d'être proposés, et
 * `ignore` reste le défaut.
 */
export type SuccessPass = {
  /** Les lignes détournées : ce qu'elles visaient, ce qu'elles visent. */
  redirected: Redirection[];
  /** Les croisements montés pour la collection seule. */
  added: CollectionCrossing[];
  /** Gen 1 achetées pour compléter un détournement. */
  bought: string[];
};

/** Ce qu'une ligne de fournée porte, réduit à ce que la passe manipule. */
type PlanLine = {
  male: { colorId: string; mountIds: string[]; cycled: boolean };
  female: { colorId: string; mountIds: string[]; cycled: boolean };
  count: number;
  targetGeneration: number | null;
  targetColorId: string | null;
  places: number;
};

/** Le peu d'une fournée que la passe lit et réécrit. */
export type SuccessPlan = {
  couples: PlanLine[];
  purchases: { colorId: string; males: number; females: number }[];
  places: number;
  capacity: number;
};

/**
 * Les montures qu'une fournée engage déjà, pour ne pas les réserver deux fois.
 *
 * Un détournement qui prendrait une monture déjà croisée ailleurs dans la même
 * fournée proposerait deux accouplements sur une bête qui n'en fera qu'un — et le
 * second échouerait devant l'enclos, sans que l'écran l'ait dit.
 */
const engagedBy = (plan: SuccessPlan): Set<string> => {
  const used = new Set<string>();
  for (const line of plan.couples) {
    for (const id of [...line.male.mountIds, ...line.female.mountIds]) used.add(id);
  }
  return used;
};

export const applySuccess = (
  plan: SuccessPlan,
  stable: Stable,
  context: SuccessContext,
  mode: SuccessMode
): SuccessPass => {
  const pass: SuccessPass = { redirected: [], added: [], bought: [] };
  if (mode === 'ignore') return pass;

  const engaged = engagedBy(plan);
  const collected = new Set(context.hatched);

  for (const line of plan.couples) {
    if (line.targetColorId === null) continue;

    const redirection = redirectionFor(
      { colorId: line.targetColorId, recipe: [line.male.colorId, line.female.colorId] },
      stable,
      { ...context, hatched: collected }
    );
    if (!redirection) continue;

    const [out, into] = redirection.swap;
    // Le côté à remplacer, et son sexe : c'est lui qui décide quelle monture
    // peut prendre la place.
    const side = line.male.colorId === out ? line.male : line.female.colorId === out ? line.female : null;
    if (!side) continue;
    const sex = side === line.male ? 'M' : 'F';

    /**
     * Jamais une monture **projetée**.
     *
     * `couplesToRecordAll` planifie sur `afterClonings(...)` depuis #223 — l'écurie
     * telle qu'elle sera une fois les clonages faits — et filtre ensuite les
     * couples qui portent un clone à venir, faute de ligne en base. Un
     * détournement qui prendrait un de ces clones verrait donc son couple **écarté
     * de la saisie de naissance**, alors que le panneau de la fournée, qui
     * planifie sur l'écurie réelle, en montrerait un autre. Les deux écrans
     * diraient deux choses de la même bête, ce que mettre la passe dans
     * `stablePlan` visait précisément à éviter.
     *
     * On ne détourne donc que vers une monture qui a une ligne.
     */
    const replacement = stable.individuals.find(
      (mount) =>
        mount.colorId === into &&
        mount.fertile &&
        mount.sex === sex &&
        !engaged.has(mount.id) &&
        !isProjected(mount.id)
    );

    /**
     * Le vrac compte, et c'est là que vivent les remplaçants.
     *
     * Le levier porte sur les partenaires **gen 1**, et une gen 1 est
     * interchangeable : elle n'a pas d'identité, donc elle est dans `bulk` et pas
     * dans `individuals`. Ne chercher que parmi les montures nommées laissait donc
     * la passe inerte sur exactement le cas qu'elle vise — mesuré : zéro
     * détournement sur l'écurie de `check-success.mjs`, dont les cinq gen 1 sont
     * toutes du vrac.
     *
     * On préfère une féconde : elle ne coûte aucune place, ce qui est la seule
     * façon de détourner sans rien dépenser du tout.
     */
    const stock = stable.bulk.get(into);
    const bulkFree = stock
      ? (sex === 'M' ? stock.males : stock.females) > 0
      : false;
    const bulkCycled = stock
      ? (sex === 'M' ? (stock.cycledMales ?? 0) : (stock.cycledFemales ?? 0)) > 0
      : false;

    if (replacement) {
      side.colorId = into;
      side.mountIds = [replacement.id];
      // Une monture non cyclée doit passer par l'enclos : la place se facture, et
      // si la fournée est pleine on renonce plutôt que de la faire déborder.
      const needsPlace = !replacement.cycled && side.cycled;
      if (needsPlace && plan.places + 1 > plan.capacity) continue;
      if (needsPlace) {
        side.cycled = false;
        line.places += 1;
        plan.places += 1;
      }
      engaged.add(replacement.id);
    } else if (bulkFree) {
      // Une monture du vrac n'a pas d'identifiant : la ligne la désigne par sa
      // couleur, comme le fait déjà la fournée pour tout le vrac.
      const needsPlace = !bulkCycled && side.cycled;
      if (needsPlace && plan.places + 1 > plan.capacity) continue;
      side.colorId = into;
      side.mountIds = [];
      if (needsPlace) {
        side.cycled = false;
        line.places += 1;
        plan.places += 1;
      }
    } else if (redirection.buy && (context.generations.get(into) ?? 99) === 1) {
      // Une gen 1 s'achète, et l'éleveur l'a accepté. Elle arrive fertile et non
      // féconde, donc elle coûte une place de cycle en plus.
      if (plan.places + 1 > plan.capacity) continue;
      side.colorId = into;
      side.mountIds = [];
      side.cycled = false;
      line.places += 1;
      plan.places += 1;
      const existing = plan.purchases.find((entry) => entry.colorId === into);
      if (existing) existing[sex === 'M' ? 'males' : 'females'] += 1;
      else
        plan.purchases.push({
          colorId: into,
          males: sex === 'M' ? 1 : 0,
          females: sex === 'F' ? 1 : 0,
        });
      pass.bought.push(into);
    } else {
      continue;
    }

    line.targetColorId = redirection.to;
    pass.redirected.push(redirection);
    // Une couleur détournée compte comme visée : la ligne suivante ne doit pas
    // détourner un second croisement vers la même.
    collected.add(redirection.to);
  }

  if (mode === 'priority') {
    for (const crossing of collectionCrossings(stable, { ...context, hatched: collected }, 16)) {
      // Deux places par croisement, et on s'arrête à la capacité : une fournée
      // qui débordait rendait l'enclos infaisable sans que rien ne le dise.
      if (plan.places + 2 > plan.capacity) break;
      const ids = [crossing.male.id, crossing.female.id].filter(
        (id): id is string => id !== null
      );
      // Même raison que pour un détournement : un clone à venir n'a pas de ligne
      // en base, donc #223 écarte son couple de la saisie de naissance et les deux
      // écrans divergeraient.
      if (ids.some((id) => isProjected(id))) continue;
      if (ids.some((id) => engaged.has(id))) continue;
      for (const id of ids) engaged.add(id);

      plan.couples.push({
        male: { colorId: crossing.male.colorId, mountIds: crossing.male.id ? [crossing.male.id] : [], cycled: false },
        female: { colorId: crossing.female.colorId, mountIds: crossing.female.id ? [crossing.female.id] : [], cycled: false },
        count: 1,
        targetGeneration: context.generations.get(crossing.wanted[0]) ?? null,
        targetColorId: crossing.wanted[0],
        places: 2,
      });
      plan.places += 2;
      pass.added.push(crossing);
      for (const wanted of crossing.wanted) collected.add(wanted);
    }
  }

  return pass;
};
