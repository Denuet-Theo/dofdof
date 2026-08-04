'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  DEFAULT_FILTERS,
  countAdvanced,
  type FarmFilterState,
} from '@/components/farm/FarmFilters';
import { ELEMENTS, type Element } from '@/lib/supabase/types';

/**
 * Délai avant écriture. Un niveau se saisit chiffre par chiffre et chaque frappe
 * change l'état : sans ce répit, taper « 150 » ferait trois allers-retours.
 */
const SAVE_DELAY_MS = 800;

/**
 * Recolle un jsonb enregistré sur `DEFAULT_FILTERS`.
 *
 * La valeur relue n'est pas de confiance : elle a été écrite par une version
 * antérieure de l'écran, qui pouvait connaître d'autres filtres. On repart donc
 * des défauts et on ne reprend une valeur que si son type correspond — ce qui
 * absorbe aussi bien un réglage disparu (le défaut prend le relais) qu'un
 * réglage ajouté depuis (jamais enregistré, donc absent).
 *
 * Le parcours se fait sur les clés de `DEFAULT_FILTERS` plutôt que sur une liste
 * dupliquée ici : ajouter un filtre ne demande rien de plus.
 */
const parseFilters = (raw: unknown): FarmFilterState => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_FILTERS;

  const stored = raw as Record<string, unknown>;
  const next: Record<string, unknown> = { ...DEFAULT_FILTERS };

  for (const [key, fallback] of Object.entries(DEFAULT_FILTERS)) {
    const value = stored[key];

    if (Array.isArray(fallback)) {
      // `elements` est le seul tableau, et le seul champ dont le contenu compte
      // au-delà du type : un élément inconnu ferait taire le filtre de
      // résistance côté SQL au lieu de le signaler (cf. la route farm).
      next[key] = Array.isArray(value)
        ? value.filter((item): item is Element => (ELEMENTS as readonly unknown[]).includes(item))
        : fallback;
    } else if (typeof value === typeof fallback) {
      next[key] = value;
    }
  }

  return next as FarmFilterState;
};

/**
 * L'état des filtres de farm, restauré depuis le compte et réenregistré à
 * chaque changement.
 *
 * `restored` est ce qui empêche l'écran de travailler pour rien : tant que la
 * ligne n'est pas lue, `filters` n'est qu'un défaut provisoire, et lancer le
 * classement dessus afficherait d'abord un résultat que personne n'a demandé.
 */
export const useFarmFilters = () => {
  const [filters, setFilters] = useState<FarmFilterState>(DEFAULT_FILTERS);
  const [restored, setRestored] = useState(false);

  // Y avait-il des réglages avancés dans ce qu'on a relu ? Figé au moment de la
  // restauration, et pas recalculé sur `filters` : l'écran s'en sert pour
  // déplier le panneau, et le suivre en direct le replierait sous les doigts de
  // celui qui vient d'y remettre un réglage à son défaut.
  const [restoredAdvanced, setRestoredAdvanced] = useState(false);

  // Dernier état connu de la base, sérialisé. Sert à ne pas réécrire ce qui
  // vient d'être lu, et à ignorer les changements qui reviennent au même.
  const saved = useRef<string | null>(null);

  // Ce qui est en attente d'écriture, s'il y a lieu. Le délai de saisie ouvre
  // une fenêtre pendant laquelle quitter la page perdrait précisément le
  // réglage qu'on vient de poser : c'est ce que le démontage rattrape.
  const pending = useRef<FarmFilterState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const load = async () => {
      const { data, error } = await supabase
        .from('user_farm_filters')
        .select('filters')
        .maybeSingle();

      if (cancelled) return;

      // Un échec de lecture n'a pas à bloquer la page : on farme avec les
      // défauts, et la première modification recréera la ligne.
      if (error) {
        console.error('[farm] filtres non relus:', error);
      } else if (data) {
        const next = parseFilters(data.filters);
        setFilters(next);
        setRestoredAdvanced(countAdvanced(next) > 0);
      }

      setRestored(true);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!restored) return;

    const payload = JSON.stringify(filters);

    // Premier passage après la restauration : cet état sort de la base, le
    // réécrire ne ferait qu'une requête pour rien.
    if (saved.current === null) {
      saved.current = payload;
      return;
    }
    if (saved.current === payload) return;

    pending.current = filters;

    const timeout = setTimeout(async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from('user_farm_filters')
        .upsert({ filters, updated_at: new Date().toISOString() });

      // On ne marque enregistré qu'en cas de succès : sinon le prochain
      // changement repartira du dernier état réellement écrit.
      if (error) {
        console.error('[farm] filtres non enregistrés:', error);
      } else {
        saved.current = payload;
        pending.current = null;
      }
    }, SAVE_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [filters, restored]);

  // Déclaré après l'effet de saisie pour que son `clearTimeout` passe en
  // premier au démontage : on écrit alors ce que le délai n'a pas eu le temps
  // d'écrire, sans risquer de le faire deux fois.
  useEffect(
    () => () => {
      const last = pending.current;
      if (last === null) return;

      pending.current = null;
      void createClient()
        .from('user_farm_filters')
        .upsert({ filters: last, updated_at: new Date().toISOString() })
        .then(({ error }) => {
          if (error) console.error('[farm] filtres non enregistrés au départ:', error);
        });
    },
    []
  );

  return { filters, setFilters, restored, restoredAdvanced };
};
