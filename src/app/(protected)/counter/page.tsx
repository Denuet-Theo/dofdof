'use client';

import { Tally5, TriangleAlert } from 'lucide-react';
import CounterCell from '@/components/counters/CounterCell';
import Skeleton from '@/components/ui/Skeleton';
import { COUNTER_SLOTS } from '@/lib/dofus/counters';
import { useCounters } from '@/lib/hooks/useCounters';

/**
 * La grille de compteurs.
 *
 * Ce que le jeu ne compte pas : les Peaux de Bouftou ramassées depuis ce matin,
 * les Chafers tués pour la quête, les bestioles d'une famille entière. Douze
 * cases, une cible par case, un clic par unité — et rien d'autre, parce que
 * tout ce qui s'ajoute ici se paie en allers-retours avec la fenêtre du jeu.
 */
const CounterPage = () => {
  const { cells, loading, loadError, place, bump, remove } = useCounters();

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Tally5 size={24} className="text-kamas" />
          <h1 className="text-2xl font-bold text-dark-100">Compteur</h1>
        </div>
        <p className="text-dark-500 text-sm">
          Douze cases à remplir d&apos;items, d&apos;ennemis ou de familles. Un clic sur
          l&apos;icône ajoute un ; 🔙 en retire un ; ❌ vide la case.
        </p>
      </div>

      {loadError ? (
        // La grille n'est pas affichée du tout : douze cases vides seraient douze
        // invitations à écraser les compteurs que la base porte encore.
        <div className="glass rounded-2xl p-6 flex items-start gap-3">
          <TriangleAlert size={20} className="text-loss flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-dark-100">Compteurs non relus</p>
            <p className="text-xs text-dark-500 mt-1">
              {loadError} — recharge la page plutôt que de repartir d&apos;une grille vide,
              qui écraserait ce qui est enregistré.
            </p>
          </div>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <Skeleton count={COUNTER_SLOTS} className="h-[172px]" />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 stagger-children">
          {cells.map((cell, slot) => (
            <CounterCell
              key={slot}
              slot={slot}
              cell={cell}
              onPick={(target) => place(slot, target)}
              onBump={(delta) => bump(slot, delta)}
              onRemove={() => remove(slot)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default CounterPage;
