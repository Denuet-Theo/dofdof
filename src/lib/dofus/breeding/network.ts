/**
 * Le réseau du champion, évalué dans le navigateur.
 *
 * ## Pourquoi l'écran doit le faire tourner
 *
 * Jusqu'ici la politique ne vivait qu'en Rust, et l'écran lisait un **plan émis** —
 * `model-plans/*.json`. Ça marche pour ce qui est invariant : la forme de
 * l'ordonnancement, les points par jauge. Ça ne marche pas pour ce qui dépend des
 * prix, et presque tout en dépend — quelle gen 10 viser, à quel niveau monter,
 * quand extraire de l'ambre, quoi acheter.
 *
 * Or les prix changent tous les jours, et ce sont **ceux de l'éleveur** : les
 * siens, ceux de ses coéquipiers. Un plan émis est donc daté du marché qui l'a
 * produit, et périme avant d'être lu. La seule sortie est que l'app applique la
 * politique elle-même, à son écurie et à ses cours.
 *
 * ## Ce que le Rust garde, et ce que l'écran reprend
 *
 * Le Rust garde ce qui ne dépend pas d'un cours : la loi d'appariement — que le
 * test de parité verrouille au milliardième — et les **poids** appris. L'écran
 * reprend tout ce qui se price.
 *
 * Ce module est la première pièce : la passe avant. Elle est courte parce que le
 * réseau l'est — le champion du tapis tient en trois nœuds cachés et 78 liens.
 *
 * ## La topologie ne se rejoue pas, elle se recalcule
 *
 * `neat.rs` trie les nœuds par l'algorithme de Kahn avant d'évaluer. On refait le
 * tri ici plutôt que de transporter l'ordre dans l'artefact, et c'est sans risque :
 * sur un graphe acyclique, **tout** ordre topologique donne les mêmes valeurs. Le
 * génome garantit l'absence de cycle ; on ne s'y fie pas pour autant, et un nœud
 * qu'on n'arrive pas à ordonner est simplement ignoré, comme côté Rust.
 */

/** Un lien du génome, tel que `champion.json` le porte. */
export type Connection = {
  from: number;
  to: number;
  weight: number;
  enabled: boolean;
};

/**
 * Le champion, tel que `breeding-neat` l'écrit.
 *
 * `features` est l'arité que le réseau attend, et l'artefact la porte lui-même —
 * ce qui permet de refuser un génome émis avant un changement d'encodage plutôt
 * que de lui donner un vecteur qu'il ne sait pas lire.
 */
export type Champion = {
  features: number;
  hidden: number[];
  connections: Connection[];
  strategies?: unknown[];
};

/**
 * Le réseau compilé : un ordre d'évaluation et les arcs entrants de chaque rang.
 */
export type Network = {
  /** L'arité attendue. Un vecteur d'une autre taille est une erreur, pas un défaut. */
  inputs: number;
  order: number[];
  /** Pour chaque rang de `order`, les `(rang source, poids)` qui l'alimentent. */
  incoming: [number, number][][];
  outputSlot: number;
};

/**
 * La numérotation, qui est le contrat avec `neat.rs` :
 * `0..inputs-1` les entrées, `inputs` le biais constant, `inputs + 1` la sortie,
 * au-delà les cachés.
 */
const biasOf = (inputs: number) => inputs;
const outputOf = (inputs: number) => inputs + 1;

export const compile = (champion: Champion): Network => {
  const inputs = champion.features;
  const output = outputOf(inputs);
  const nodes = [...Array.from({ length: output + 1 }, (_, node) => node), ...champion.hidden];
  const live = champion.connections.filter((connection) => connection.enabled);

  // Kahn. Un nœud dont le compte d'arcs entrants ne retombe jamais à zéro reste
  // hors de l'ordre, et sera ignoré à l'évaluation — même tolérance qu'en Rust.
  const remaining = new Map<number, number>(nodes.map((node) => [node, 0]));
  for (const connection of live) {
    remaining.set(connection.to, (remaining.get(connection.to) ?? 0) + 1);
  }
  const ready = nodes.filter((node) => (remaining.get(node) ?? 0) === 0);
  const order: number[] = [];
  while (ready.length > 0) {
    const node = ready.pop() as number;
    order.push(node);
    for (const connection of live) {
      if (connection.from !== node) continue;
      const count = (remaining.get(connection.to) ?? 0) - 1;
      remaining.set(connection.to, count);
      if (count === 0) ready.push(connection.to);
    }
  }

  const slotOf = new Map<number, number>(order.map((node, slot) => [node, slot]));
  const incoming: [number, number][][] = order.map(() => []);
  for (const connection of live) {
    const from = slotOf.get(connection.from);
    const to = slotOf.get(connection.to);
    if (from === undefined || to === undefined) continue;
    incoming[to].push([from, connection.weight]);
  }

  return { inputs, order, incoming, outputSlot: slotOf.get(output) ?? 0 };
};

/**
 * Ce que le réseau dit d'une écurie.
 *
 * `tanh` sur les cachés, **identité** sur la sortie : une valeur d'écurie n'a pas
 * à tenir dans `[-1, 1]`, et l'écraser y détruirait l'ordre entre deux écuries
 * toutes deux excellentes — ce qui est précisément ce que la recherche compare.
 */
export const evaluate = (network: Network, features: number[]): number => {
  if (features.length !== network.inputs) {
    throw new RangeError(
      `Ce réseau attend ${network.inputs} entrées, on lui en donne ${features.length}. ` +
        `L'artefact a été émis avant un changement d'encodage.`
    );
  }

  const bias = biasOf(network.inputs);
  const output = outputOf(network.inputs);
  const values = new Array<number>(network.order.length).fill(0);

  for (let slot = 0; slot < network.order.length; slot += 1) {
    const node = network.order[slot];
    if (node < network.inputs) {
      values[slot] = features[node];
      continue;
    }
    if (node === bias) {
      values[slot] = 1;
      continue;
    }
    let sum = 0;
    for (const [from, weight] of network.incoming[slot]) sum += values[from] * weight;
    values[slot] = node === output ? sum : Math.tanh(sum);
  }

  return values[network.outputSlot];
};

/** Vrai quand la sortie reçoit quelque chose. Un réseau muet note tout pareil. */
export const isConnected = (network: Network): boolean =>
  network.incoming[network.outputSlot].length > 0;
