'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { reportWriteFailure } from '@/lib/errors/write-failures';
import {
  EMPTY_STATE,
  activePreset,
  parseAvailability,
  today,
  type AvailabilityPreset,
  type AvailabilityState,
} from '@/lib/dofus/breeding/availability';

/**
 * Les préréglages de disponibilité du joueur, et celui du jour.
 *
 * Même forme que `useFarmFilters` — restauration, écriture différée, purge au
 * démontage — parce que c'est le même besoin : un réglage personnel qu'on ne veut
 * ni resaisir à chaque visite, ni écrire à chaque frappe.
 *
 * La différence est le **choix du jour**, qui porte sa date. Un choix d'hier ne
 * s'applique pas aujourd'hui : le préréglage se pose le matin, et rejouer celui de
 * la veille ferait planifier un lundi de travail sur une journée de repos.
 */
const SAVE_DELAY_MS = 600;

export const useAvailability = () => {
  const [state, setState] = useState<AvailabilityState>(EMPTY_STATE);
  const [restored, setRestored] = useState(false);

  const saved = useRef<string | null>(null);
  const pending = useRef<AvailabilityState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const load = async () => {
      const { data, error } = await supabase
        .from('user_breeding_availability')
        .select('availability')
        .maybeSingle();

      if (cancelled) return;

      // Un échec de lecture ne bloque pas l'écran : on repart des exemples, et la
      // première modification recréera la ligne.
      if (error) {
        console.error('[élevage] disponibilités non relues:', error);
      } else if (data) {
        setState(parseAvailability(data.availability));
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

    const payload = JSON.stringify(state);

    // Premier passage après la restauration : cet état sort de la base.
    if (saved.current === null) {
      saved.current = payload;
      return;
    }
    if (saved.current === payload) return;

    pending.current = state;

    const timeout = setTimeout(async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from('user_breeding_availability')
        .upsert({ availability: state, updated_at: new Date().toISOString() });

      if (error) {
        reportWriteFailure('tes disponibilités d’élevage', error);
      } else {
        saved.current = payload;
        pending.current = null;
      }
    }, SAVE_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [state, restored]);

  // Déclaré après l'effet de saisie pour que son `clearTimeout` passe en premier
  // au démontage : on écrit alors ce que le délai n'a pas eu le temps d'écrire.
  useEffect(
    () => () => {
      const last = pending.current;
      if (last === null) return;

      pending.current = null;
      void createClient()
        .from('user_breeding_availability')
        .upsert({ availability: last, updated_at: new Date().toISOString() })
        .then(({ error }) => {
          if (error) reportWriteFailure('tes disponibilités d’élevage, en quittant l’écran', error);
        });
    },
    []
  );

  /** Poser le préréglage du jour. */
  const choose = useCallback((presetId: string) => {
    setState((current) => ({ ...current, chosen: { presetId, date: today() } }));
  }, []);

  const savePreset = useCallback((preset: AvailabilityPreset) => {
    setState((current) => ({
      ...current,
      presets: current.presets.some((entry) => entry.id === preset.id)
        ? current.presets.map((entry) => (entry.id === preset.id ? preset : entry))
        : [...current.presets, preset],
    }));
  }, []);

  const removePreset = useCallback((presetId: string) => {
    setState((current) => ({
      presets: current.presets.filter((entry) => entry.id !== presetId),
      // Retirer le préréglage du jour retire le choix : planifier sur un
      // préréglage supprimé n'aurait aucun sens.
      chosen: current.chosen?.presetId === presetId ? null : current.chosen,
    }));
  }, []);

  return {
    state,
    restored,
    active: activePreset(state),
    choose,
    savePreset,
    removePreset,
  };
};
