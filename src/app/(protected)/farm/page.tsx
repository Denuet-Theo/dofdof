'use client';

import { useState, useEffect, useMemo, useCallback, useTransition } from 'react';
import { Swords, AlertTriangle, RefreshCw, MapPin, X } from 'lucide-react';
import FarmFilters, { DEFAULT_FILTERS, type FarmFilterState } from '@/components/farm/FarmFilters';
import MonsterCard from '@/components/farm/MonsterCard';
import ZoneCard from '@/components/farm/ZoneCard';
import { useFarmFilters } from '@/lib/hooks/useFarmFilters';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import type { DofusDBResponse, FarmTarget, FarmZone } from '@/lib/supabase/types';

/** Le classement se lit d'un coup d'œil : au-delà, on affine les filtres. */
const PAGE_SIZE = 50;
/** Une zone tient sur une ligne courte, et il y en a 562 : on en montre plus. */
const ZONE_PAGE_SIZE = 80;

type Area = { id: number; name_fr: string };

/**
 * Par ennemi ou par zone.
 *
 * Les deux répondent à des questions différentes et pas au même moment : la zone
 * dit **où se poser**, l'ennemi dit **quoi taper une fois sur place**. D'où le
 * chaînage — cliquer une zone bascule en mode ennemi, filtré sur elle.
 */
type Mode = 'monsters' | 'zones';

/** La zone sur laquelle on vient de zoomer depuis le classement par zone. */
type Focus = { id: number; name: string };

/**
 * Répercute sur le classement affiché un prix qu'on vient d'enregistrer.
 *
 * Le calcul est fait ici plutôt que redemandé au serveur, et l'ordre est laissé
 * tel quel à dessein : le prix se saisit depuis une carte dépliée, et reclasser
 * à chaque enregistrement ferait fuir cette carte sous le curseur au beau
 * milieu de la saisie des drops suivants. Même raisonnement que la grille de
 * suggestions du tableau de bord, qui grise la carte saisie sans la déplacer.
 *
 * L'écart appliqué est exact malgré les dix drops affichés au maximum :
 * l'espérance d'un drop vaut taux × prix, donc changer un prix ne déplace le
 * total du monstre que du drop concerné — lequel est forcément sous les yeux,
 * puisque c'est là qu'on l'a saisi.
 *
 * Reste ce que l'écran ne peut pas savoir : un monstre dont ce drop tombe
 * au-delà du dixième garde un total sous-évalué, et le rang de tout le monde
 * date de la dernière requête. D'où le bouton de reclassement.
 */
const applyPrice = (targets: FarmTarget[], itemId: number, price: number): FarmTarget[] =>
  targets.map((target) => {
    if (!target.top_drops.some((drop) => drop.objectId === itemId)) return target;

    let delta = 0;
    const top_drops = target.top_drops.map((drop) => {
      // Un même objet peut figurer deux fois, sous deux jeux de conditions :
      // la clé des drops est (monstre, objet, critères). Les deux lignes
      // bougent, et chacune compte dans l'écart.
      if (drop.objectId !== itemId) return drop;
      delta += ((Number(drop.percent) || 0) / 100) * (price - (Number(drop.price) || 0));
      return { ...drop, price };
    });

    return {
      ...target,
      top_drops,
      kamas_per_fight: (Number(target.kamas_per_fight) || 0) + delta,
    };
  });

/**
 * Traduit l'état des filtres en paramètres d'URL.
 *
 * N'envoie que ce qui s'écarte de `DEFAULT_FILTERS` : les valeurs par défaut
 * vivent dans la signature SQL de `farm_targets`, et les réenvoyer à chaque
 * requête ferait exister deux sources de vérité qui divergeraient au premier
 * changement de défaut côté base.
 */
const buildParams = (
  filters: FarmFilterState,
  mode: Mode,
  focus: Focus | null
): URLSearchParams => {
  const params = new URLSearchParams({
    limit: String(mode === 'zones' ? ZONE_PAGE_SIZE : PAGE_SIZE),
  });

  // Le zoom sur une zone n'entre pas dans `FarmFilterState` à dessein : cet état
  // est persisté par compte, et une sous-zone choisie d'un clic n'a pas à
  // survivre à la session. `p_subarea_ids` et `p_area_id` se cumulent en OR côté
  // SQL, donc les deux peuvent coexister sans se contredire.
  if (focus !== null) params.set('subareaIds', String(focus.id));

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
  const { filters, setFilters, restored, restoredAdvanced } = useFarmFilters();
  // `null` tant que le bouton n'a pas servi : le panneau suit alors ce qu'on a
  // restauré, pour que des réglages avancés hérités de la dernière visite ne
  // filtrent pas le classement depuis un tiroir fermé.
  const [advancedToggled, setAdvancedToggled] = useState<boolean | null>(null);
  const advancedOpen = advancedToggled ?? restoredAdvanced;
  const [mode, setMode] = useState<Mode>('monsters');
  const [focus, setFocus] = useState<Focus | null>(null);
  const [targets, setTargets] = useState<FarmTarget[] | null>(null);
  const [zones, setZones] = useState<FarmZone[] | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  // Des prix ont été saisis depuis la dernière requête : les totaux affichés
  // sont à jour, mais l'ordre et les monstres écartés par les filtres, non.
  const [priced, setPriced] = useState(false);
  // Compteur de reclassement. Passe dans les dépendances de l'effet de
  // chargement, ce qui relance la même requête sans passer par les filtres.
  const [reload, setReload] = useState(0);

  const handlePriceSaved = useCallback((itemId: number, price: number) => {
    setTargets((current) => (current === null ? current : applyPrice(current, itemId, price)));
    setPriced(true);
  }, []);

  /**
   * Zoomer sur une zone : on passe aux monstres, filtrés sur elle.
   *
   * Le classement par zone dit où aller ; il ne dit pas quoi taper. C'est le
   * geste qui enchaîne les deux, et il évite d'avoir à retrouver la sous-zone
   * dans un menu de 562 entrées — lequel n'existe d'ailleurs pas.
   */
  const handleDrillDown = useCallback((zone: FarmZone) => {
    setFocus({ id: zone.subarea_id, name: zone.subarea_name });
    setMode('monsters');
  }, []);

  const handleMode = useCallback((next: Mode) => {
    setMode(next);
    // Le zoom appartient au mode monstre. Le garder en repassant aux zones
    // afficherait un classement d'une seule zone, celle qu'on vient de quitter.
    if (next === 'zones') setFocus(null);
  }, []);

  useEffect(() => {
    // Le sélecteur de zone ne dépend d'aucun filtre : une seule fois au montage.
    fetch('/api/dofusdb/areas')
      .then((response) => (response.ok ? response.json() : { data: [] }))
      .then((body: DofusDBResponse<Area>) => setAreas(body.data ?? []))
      .catch(() => setAreas([]));
  }, []);

  const query = useMemo(() => buildParams(filters, mode, focus).toString(), [filters, mode, focus]);

  // Le classement du mode courant, et sa taille de page. Les deux listes sont
  // gardées séparément — repasser d'un mode à l'autre ne doit pas rejeter ce
  // qu'on avait déjà chargé — mais l'affichage n'en lit qu'une à la fois.
  const rows: (FarmTarget | FarmZone)[] | null = mode === 'zones' ? zones : targets;
  const pageSize = mode === 'zones' ? ZONE_PAGE_SIZE : PAGE_SIZE;

  useEffect(() => {
    // Attendre les filtres du compte : les lancer sur les défauts afficherait
    // d'abord un classement que personne n'a demandé.
    if (!restored) return;

    const controller = new AbortController();
    const zoning = mode === 'zones';
    const endpoint = zoning ? '/api/dofusdb/farm/zones' : '/api/dofusdb/farm';
    const failure = zoning
      ? 'Erreur lors du calcul des zones de farm'
      : 'Erreur lors du calcul des cibles de farm';

    startLoading(async () => {
      try {
        const response = await fetch(`${endpoint}?${query}`, { signal: controller.signal });
        const body = await response.json();

        if (!response.ok) {
          // Le 503 du miroir vide porte un message actionnable : le relayer tel
          // quel vaut mieux qu'un « erreur » générique qui enverrait chercher
          // un bug de filtre là où il manque une synchronisation.
          setError(body?.error ?? failure);
          if (zoning) setZones([]);
          else setTargets([]);
          return;
        }

        setError(null);
        if (zoning) {
          setZones((body as DofusDBResponse<FarmZone>).data ?? []);
        } else {
          setTargets((body as DofusDBResponse<FarmTarget>).data ?? []);
        }
        setPriced(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('[farm] fetch failed:', err);
        setError(`Erreur réseau — ${failure.toLowerCase()}`);
        if (zoning) setZones([]);
        else setTargets([]);
      }
    });

    return () => controller.abort();
  }, [query, restored, reload, mode]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dark-100">Cibles de farm</h1>
        <p className="text-sm text-dark-400 mt-1">
          {mode === 'zones'
            ? 'Sous-zones classées par kamas espérés pour un combat quelconque, moyennés sur tous leurs monstres.'
            : 'Monstres classés par kamas espérés par combat, en croisant les taux de drop et les prix de l’hôtel de vente.'}
        </p>
      </div>

      {/* Par où on cherche. Deux boutons plutôt qu'un menu : il n'y a que deux
          réponses, et elles se comparent d'un aller-retour. */}
      <div
        className="inline-flex rounded-xl border border-dark-700/50 bg-dark-800/30 p-1"
        role="group"
        aria-label="Grouper le classement"
      >
        {(
          [
            ['monsters', 'Par ennemi', Swords],
            ['zones', 'Par zone', MapPin],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => handleMode(value)}
            aria-pressed={mode === value}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
              mode === value
                ? 'bg-kamas/10 text-kamas'
                : 'text-dark-400 hover:text-dark-200'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Le zoom venu d'un clic sur une zone. Affiché parce qu'il restreint le
          classement sans apparaître dans le panneau de filtres — un filtre
          invisible est un piège, celui-ci se voit et se retire. */}
      {focus !== null ? (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-kamas/30
            bg-kamas/5 text-xs text-kamas"
        >
          <MapPin size={13} />
          <span className="flex-1 truncate">Monstres de {focus.name}</span>
          <button
            type="button"
            onClick={() => setFocus(null)}
            className="flex items-center gap-1 hover:text-dark-100 transition-colors cursor-pointer"
          >
            <X size={13} />
            Retirer
          </button>
        </div>
      ) : null}

      <FarmFilters
        filters={filters}
        onChange={setFilters}
        areas={areas}
        open={advancedOpen}
        onToggle={() => setAdvancedToggled(!advancedOpen)}
      />

      {/* `!restored` couvre le temps de relire les filtres du compte, avant que
          la moindre requête de classement soit partie. `rows` est le classement
          du mode courant : c'est lui qui décide du squelette et du vide. */}
      {!restored || (loading && rows === null) ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" count={6} />
        </div>
      ) : error ? (
        <EmptyState icon={AlertTriangle} title="Classement indisponible" description={error} />
      ) : rows !== null && rows.length === 0 ? (
        <EmptyState
          icon={mode === 'zones' ? MapPin : Swords}
          title={
            mode === 'zones'
              ? 'Aucune zone ne passe ces filtres'
              : 'Aucun monstre ne passe ces filtres'
          }
          description="Élargis la fourchette de niveau, ou retire le filtre de zone ou de résistance."
        />
      ) : (
        <div className={`space-y-3 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          {/* Le classement ne se réordonne pas tout seul après une saisie : la
              carte qu'on est en train de remplir s'en irait sous le curseur.
              C'est donc un geste, proposé seulement quand il a lieu d'être. */}
          {priced ? (
            <button
              type="button"
              onClick={() => setReload((count) => count + 1)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl
                border border-kamas/30 bg-kamas/5 text-xs text-kamas
                hover:bg-kamas/10 transition-colors cursor-pointer"
            >
              <RefreshCw size={13} />
              Des prix ont changé — reclasser les monstres
            </button>
          ) : null}

          {mode === 'zones'
            ? (zones ?? []).map((zone) => (
                <ZoneCard key={zone.subarea_id} zone={zone} onDrillDown={handleDrillDown} />
              ))
            : (targets ?? []).map((target) => (
                <MonsterCard
                  key={target.monster_id}
                  target={target}
                  onPriceSaved={handlePriceSaved}
                />
              ))}

          {rows !== null && rows.length === pageSize ? (
            <p className="text-xs text-dark-500 text-center pt-2">
              {mode === 'zones'
                ? `Les ${pageSize} meilleures zones sont affichées.`
                : `Les ${pageSize} meilleures cibles sont affichées.`}{' '}
              Affine les filtres pour voir plus loin dans le classement.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default FarmPage;
