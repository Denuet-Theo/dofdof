-- Palier de remplissage des jauges d'enclos, imposé plutôt que déduit.
--
-- Les plafonds des carburants (40 000 / 70 000 / 90 000, et l'Élixir sans
-- plafond) tombent exactement sur les paliers de transfert : tenir une jauge
-- haute transfère jusqu'à quatre fois plus vite, mais les carburants hauts se
-- paient plus cher au point.
--
-- Par défaut (`null`) l'arbitrage se fait tout seul via `kamas_per_hour`. Mais
-- ce réglage-là suppose qu'une heure de jeu se convertit en kamas, ce qui n'est
-- pas vrai pour tout le monde : on peut vouloir aller vite parce qu'on a peu de
-- sessions, ou lentement parce qu'on laisse tourner. D'où la possibilité de
-- fixer le palier directement.
alter table public.user_breeding_settings
  add column if not exists gauge_cap integer
    check (gauge_cap is null or gauge_cap in (40000, 70000, 90000, 100000));

comment on column public.user_breeding_settings.gauge_cap is
  'Plafond de remplissage imposé (40000/70000/90000/100000), ou null pour laisser l''arbitrage temps/kamas décider.';
