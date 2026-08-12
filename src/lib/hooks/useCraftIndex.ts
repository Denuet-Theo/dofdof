'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { craftableIngredientIds, fetchRecipeTree } from '@/lib/dofus/craft-index';
import { indexRecipes, type RecipeIndex } from '@/lib/utils/recipes';
import type { DofusDBRecipe } from '@/lib/supabase/types';

/**
 * Les recettes des ingrédients d'un lot tenu en état, pour que « craft ou achat »
 * ait une réponse (#123).
 *
 * Enveloppe `fetchIngredientRecipes` : la descente et son cadrage vivent là-bas,
 * partagés avec les écrans qui calculent dans un bloc async et n'ont pas de lot
 * en état à observer. Ce qui est propre au hook, c'est de ne pas redemander deux
 * fois la même chose entre deux rendus.
 */
export const useCraftIndex = (recipes: DofusDBRecipe[] | null) => {
  const [known, setKnown] = useState<DofusDBRecipe[]>([]);
  const [loading, setLoading] = useState(false);

  // Ce qu'on a déjà demandé. Un ref et non un état : ce registre ne doit jamais
  // déclencher de rendu, il ne fait que borner le travail.
  const asked = useRef<Set<number>>(new Set());

  // La clé de relance. Une chaîne d'ids et non le tableau lui-même : deux lots
  // de recettes distincts portant les mêmes ingrédients ne doivent pas relancer
  // la descente, et un nouveau tableau à chaque rendu la relancerait sans fin.
  const roots = useMemo(
    () => (recipes === null ? '' : craftableIngredientIds(recipes).join(',')),
    [recipes]
  );

  useEffect(() => {
    if (roots === '') return;
    let cancelled = false;

    const descend = async () => {
      const pending = roots
        .split(',')
        .map(Number)
        .filter((id) => !asked.current.has(id));
      if (pending.length === 0) return;

      setLoading(true);
      try {
        // `pending` porte déjà les ingrédients : on attaque l'arbre à leur
        // niveau, sans repasser par un lot de recettes.
        const found = await fetchRecipeTree(pending, { asked: asked.current });
        if (cancelled || found.length === 0) return;

        setKnown((current) => {
          // Dédupliqué sur `resultId` : le miroir garantit une recette par item,
          // mais deux tours peuvent tomber sur le même.
          const merged = new Map(current.map((r) => [r.resultId, r]));
          found.forEach((r) => merged.set(r.resultId, r));
          return Array.from(merged.values());
        });
      } catch (error) {
        // Un index incomplet fait retomber les coûts sur les prix d'achat, soit
        // le comportement d'avant #123. Le dire vaut mieux que laisser croire à
        // un arbre complet.
        console.error('[craft] recettes d’ingrédients non chargées:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void descend();
    return () => {
      cancelled = true;
    };
  }, [roots]);

  const index: RecipeIndex = useMemo(() => indexRecipes(known), [known]);

  return { index, indexing: loading };
};
