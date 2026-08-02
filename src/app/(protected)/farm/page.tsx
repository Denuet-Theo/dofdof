'use client';

import { useState, useEffect, useMemo, useTransition } from 'react';
import { Swords, AlertTriangle } from 'lucide-react';
import FarmFilters, { DEFAULT_FILTERS, type FarmFilterState } from '@/components/farm/FarmFilters';
import MonsterCard from '@/components/farm/MonsterCard';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import type { DofusDBResponse, FarmTarget } from '@/lib/supabase/types';

/** Le classement se lit d'un coup d'œil : au-delà, on affine les filtres. */
const PAGE_SIZE = 50;

type Area = { id: number; name_fr: string };

/**
 * Traduit l'état des filtres en paramètres d'URL.
 *
 * N'envoie que ce qui s'écarte de `DEFAULT_FILTERS` : les valeurs par défaut
 * vivent dans la signature SQL de `farm_targets`, et les réenvoyer à chaque
 * requête ferait exister deux sources de vérité qui divergeraient au premier
 * changement de défaut côté base.
 */
const buildParams = (filters: FarmFilterState): URLSearchParams => {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });

  const numbers: [keyof FarmFilterState, string][] = [
    ['minLevel', 'minLevel'],
    ['maxLevel', 'maxLevel'],
    ['areaId', 'areaId'],
    ['prospecting', 'prospecting'],
    ['minPercent', 'minPercent'],
    ['maxResistance', 'maxResistance'],
  ];

  for (const [key, param] of numbers) {
    const value = filters[key];
    if (typeof value === 'string' && value !== '' && value !== DEFAULT_FILTERS[key]) {
      params.set(param, value);
    }
  }

  const flags: [keyof FarmFilterState, string][] = [
    ['excludeBoss', 'excludeBoss'],
    ['excludeMiniBoss', 'excludeMiniBoss'],
    ['excludeQuest', 'excludeQuest'],
    ['excludeHidden', 'excludeHidden'],
    ['pricedOnly', 'pricedOnly'],
    ['craftedOnly', 'craftedOnly'],
    ['excludeQuestDrops', 'excludeQuestDrops'],
    ['unconditionalOnly', 'unconditionalOnly'],
  ];

  for (const [key, param] of flags) {
    if (filters[key] !== DEFAULT_FILTERS[key]) params.set(param, filters[key] ? '1' : '0');
  }

  // Le seuil de résistance n'a de sens qu'avec des éléments : la fonction SQL
  // ignore l'un sans l'autre, autant ne pas l'envoyer à moitié.
  if (filters.elements.length > 0) {
    params.set('elements', filters.elements.join(','));
  } else {
    params.delete('maxResistance');
  }

  return params;
};

const FarmPage = () => {
  const [filters, setFilters] = useState<FarmFilterState>(DEFAULT_FILTERS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [targets, setTargets] = useState<FarmTarget[] | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    // Le sélecteur de zone ne dépend d'aucun filtre : une seule fois au montage.
    fetch('/api/dofusdb/areas')
      .then((response) => (response.ok ? response.json() : { data: [] }))
      .then((body: DofusDBResponse<Area>) => setAreas(body.data ?? []))
      .catch(() => setAreas([]));
  }, []);

  const query = useMemo(() => buildParams(filters).toString(), [filters]);

  useEffect(() => {
    const controller = new AbortController();

    startLoading(async () => {
      try {
        const response = await fetch(`/api/dofusdb/farm?${query}`, { signal: controller.signal });
        const body = await response.json();

        if (!response.ok) {
          // Le 503 du miroir vide porte un message actionnable : le relayer tel
          // quel vaut mieux qu'un « erreur » générique qui enverrait chercher
          // un bug de filtre là où il manque une synchronisation.
          setError(body?.error ?? 'Erreur lors du calcul des cibles de farm');
          setTargets([]);
          return;
        }

        setError(null);
        setTargets((body as DofusDBResponse<FarmTarget>).data ?? []);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('[farm] fetch failed:', err);
        setError('Erreur réseau lors du calcul des cibles de farm');
        setTargets([]);
      }
    });

    return () => controller.abort();
  }, [query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark-100">Cibles de farm</h1>
        <p className="text-sm text-dark-400 mt-1">
          Monstres classés par kamas espérés par combat, en croisant les taux de drop et les
          prix de l&apos;hôtel de vente.
        </p>
      </div>

      <FarmFilters
        filters={filters}
        onChange={setFilters}
        areas={areas}
        open={advancedOpen}
        onToggle={() => setAdvancedOpen((open) => !open)}
      />

      {loading && targets === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" count={6} />
        </div>
      ) : error ? (
        <EmptyState icon={AlertTriangle} title="Classement indisponible" description={error} />
      ) : targets && targets.length === 0 ? (
        <EmptyState
          icon={Swords}
          title="Aucun monstre ne passe ces filtres"
          description="Élargis la fourchette de niveau, ou retire le filtre de zone ou de résistance."
        />
      ) : (
        <div className={`space-y-3 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          {(targets ?? []).map((target) => (
            <MonsterCard key={target.monster_id} target={target} />
          ))}

          {targets && targets.length === PAGE_SIZE ? (
            <p className="text-xs text-dark-500 text-center pt-2">
              Les {PAGE_SIZE} meilleures cibles sont affichées. Affine les filtres pour voir
              plus loin dans le classement.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default FarmPage;
