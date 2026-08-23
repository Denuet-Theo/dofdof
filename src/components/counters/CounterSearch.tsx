'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import ItemCard from '@/components/ui/ItemCard';
import { KIND_GROUP, type CounterSearchResult, type CounterTarget } from '@/lib/dofus/counters';
import type { CounterKind } from '@/lib/supabase/types';

/**
 * Le moteur de recherche d'une case vide.
 *
 * Une case libre n'affiche pas un bouton « ajouter » qui ouvrirait une fenêtre :
 * elle affiche directement le champ. Poser un compteur est un geste qu'on fait
 * le jeu ouvert à côté, entre deux combats, et chaque écran intermédiaire est un
 * aller-retour de plus entre les deux fenêtres.
 *
 * Les trois catégories sont montrées ensemble parce que le mot tapé ne dit pas
 * laquelle on vise : « Bouftou » est un ennemi, une famille, et le début de six
 * items. Choisir la catégorie d'abord obligerait à la connaître avant de
 * chercher.
 */

/** Le temps de frappe entre deux requêtes. Même valeur que la barre de /items. */
const DEBOUNCE_MS = 300;

interface CounterSearchProps {
  onPick: (target: CounterTarget) => void;
}

const ORDER: CounterKind[] = ['item', 'monster', 'race'];

/**
 * La réponse **et le terme qui l'a produite**.
 *
 * Les deux voyagent ensemble pour que l'affichage se déduise de la comparaison
 * avec le champ, au lieu d'être effacé à la main à chaque frappe : une réponse
 * qui ne répond plus à ce qui est tapé disparaît d'elle-même, et il n'y a aucun
 * instant où la liste montre les résultats du mot précédent.
 */
type Answer = { term: string; data: CounterSearchResult | null; error: string | null };

const groupsOf = (result: CounterSearchResult | null) => {
  if (!result) return [];
  const byKind: Record<CounterKind, CounterTarget[]> = {
    item: result.items,
    monster: result.monsters,
    race: result.races,
  };
  return ORDER.map((kind) => ({ kind, targets: byKind[kind] })).filter(
    (group) => group.targets.length > 0
  );
};

const CounterSearch = ({ onPick }: CounterSearchProps) => {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) return;

    // `live` en plus de l'abandon : une requête abandonnée traverse quand même
    // le `catch`, et laisser passer son `setLoading(false)` ferait clignoter le
    // chargement à chaque frappe.
    let live = true;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/dofusdb/counter-targets?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const body = await response.json();
        if (!live) return;

        // Le corps porte le message du serveur — « miroir vide, lancer
        // npm run db:sync » n'appelle pas le même geste qu'une panne de requête,
        // et lui seul sait lequel c'est.
        setAnswer(
          response.ok
            ? { term, data: body as CounterSearchResult, error: null }
            : {
                term,
                data: null,
                error: (body as { error?: string }).error ?? 'Recherche indisponible',
              }
        );
      } catch {
        if (live) setAnswer({ term, data: null, error: 'Recherche indisponible' });
      } finally {
        if (live) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [term]);

  const fresh = answer?.term === term ? answer : null;
  const groups = groupsOf(fresh?.data ?? null);
  const error = fresh?.error ?? null;
  const first = groups[0]?.targets[0];
  const showPanel = open && term.length >= 2;

  const pick = (target: CounterTarget) => {
    setQuery('');
    setOpen(false);
    onPick(target);
  };

  return (
    <div
      // Pas de `h-full` : la liste est ancrée au `bottom` de ce conteneur, et
      // l'étirer à la case entière ouvrait la liste dix rangs plus bas, sous un
      // vide.
      className="relative"
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        // Le panneau vit dans le même conteneur que le champ : sans ce test, le
        // clic sur un résultat fermerait la liste avant que le clic n'arrive.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500">
          {loading ? (
            <Loader2 size={14} className="animate-spin text-kamas" />
          ) : (
            <Search size={14} />
          )}
        </div>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('');
              setOpen(false);
            }
            // Entrée pose le premier résultat : sur un nom complet, c'est le bon
            // dans l'immense majorité des cas, et ça évite de lâcher le clavier.
            if (event.key === 'Enter' && first) pick(first);
          }}
          placeholder="Item, ennemi, famille…"
          data-testid="counter-search"
          className="w-full pl-9 pr-3 py-2 rounded-xl
            bg-dark-800/80 border border-dark-600/50
            text-dark-100 text-sm placeholder:text-dark-500
            transition-all duration-200
            hover:border-dark-500 focus:border-kamas/50 focus:bg-dark-800"
        />
      </div>

      {term.length > 0 && term.length < 2 && (
        <p className="mt-2 text-[11px] text-dark-500">Min. 2 caractères</p>
      )}

      {showPanel && (
        <div
          // Fond opaque et non `glass` : la liste flotte au-dessus d'autres
          // cases, et à 85 % d'opacité leurs libellés traversaient les lignes de
          // résultats — illisible là précisément où il faut lire un nom.
          className="absolute left-0 right-0 top-full mt-2 z-30 max-h-80 overflow-y-auto
            bg-dark-900 rounded-xl border border-dark-600/60 shadow-xl shadow-dark-950/60"
        >
          {error && <p className="px-3 py-3 text-xs text-loss">{error}</p>}

          {!error && fresh && groups.length === 0 && (
            <p className="px-3 py-3 text-xs text-dark-500">Aucun résultat</p>
          )}

          {groups.map((group) => (
            <div key={group.kind}>
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-dark-500">
                {KIND_GROUP[group.kind]}
              </p>
              {group.targets.map((target) => (
                <button
                  key={`${target.kind}-${target.id}`}
                  type="button"
                  data-testid="counter-result"
                  data-kind={target.kind}
                  data-name={target.name}
                  onClick={() => pick(target)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left
                    hover:bg-dark-800/60 transition-colors cursor-pointer"
                >
                  <ItemCard.Icon src={target.img} alt={target.name} size="sm" scaleOnHover={false} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-dark-100 truncate">
                      {target.name}
                    </span>
                    {target.hint && (
                      <span className="block text-[10px] text-dark-500 truncate">{target.hint}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))}

          {/* Le miroir des familles est arrivé après le reste du catalogue : sans
              ce mot, une base migrée mais pas resynchronisée dirait simplement
              « aucun résultat », ce qui se lit « cette famille n'existe pas ». */}
          {fresh?.data?.racesUnavailable && (
            <p className="px-3 py-2 text-[10px] text-dark-500 border-t border-dark-700/40">
              Familles indisponibles : lancer <code>npm run db:sync</code>.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default CounterSearch;
