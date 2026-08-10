/**
 * Le générateur pseudo-aléatoire du modèle.
 *
 * Extrait de `simulate.ts`, où il vivait, parce qu'il a maintenant deux
 * utilisateurs et que le deuxième en fait un **contrat** : `search.ts` rejoue la
 * montée de colline du Rust, et une montée de colline n'est reproductible que si
 * les deux côtés tirent la même suite.
 *
 * C'est bien le cas : `breeding_sim::economy::Rng` est le même Mulberry32 sur
 * `u32`, opération pour opération. Les tirages sont donc identiques au bit, ce qui
 * permet à `check-search.mjs` de comparer des **plans entiers** plutôt que des
 * nombres à une tolérance près.
 */

/**
 * Mulberry32 : court, sans dépendance, de qualité largement suffisante pour tirer
 * des naissances — et assez simple pour qu'un portage en soit vérifiable à l'œil.
 */
export const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
