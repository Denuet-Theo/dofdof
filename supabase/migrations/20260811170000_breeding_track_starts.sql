-- Une horloge par enclos, et non une pour tout le parc.
--
-- Le parc ne se charge pas d'un bloc : on remplit un enclos, on le lance, on
-- passe au suivant. Une horloge unique obligeait à faire partir les cinq
-- ensemble, ce qui n'arrive jamais — le temps de nommer les poulains et de
-- chercher les montures dans le coffre, le premier enclos a une heure d'avance
-- sur le dernier.
--
-- Une colonne JSON et non une table : ce sont au plus une douzaine de dates,
-- toutes réécrites ensemble quand le plan change, et jamais interrogées
-- séparément. Une table imposerait une jointure pour lire ce que la ligne porte
-- déjà.
--
-- Une piste absente de la carte retombe sur `started_at`, ce qui est le
-- comportement d'avant : un plan chargé et jamais lancé enclos par enclos se lit
-- exactement comme aujourd'hui.
alter table public.breeding_timeline
  add column if not exists track_starts jsonb not null default '{}'::jsonb;

comment on column public.breeding_timeline.track_starts is
  'Le départ propre à chaque piste, en ISO 8601, indexé par identifiant de
   piste — `{"enclos-1": "2026-08-11T13:42:00Z"}`. Absente, la piste suit
   `started_at`. La **pause** reste globale : on ne quitte pas le jeu enclos par
   enclos.';
