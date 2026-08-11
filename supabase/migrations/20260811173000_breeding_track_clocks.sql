-- Une horloge **complète** par piste : départ, pause, cumul.
--
-- `track_starts` ne portait que le départ, sur l'idée qu'on ne quitte pas le jeu
-- enclos par enclos. C'est faux, et la raison est mécanique plutôt que
-- préférentielle.
--
-- Le Baffeur et le Caresseur portent la **sérénité**, qui ouvre et ferme les
-- fenêtres des autres jauges — une jauge hors de sa fenêtre s'arrête net au lieu
-- de ralentir. La Mangeoire, elle, occupe une des deux places de l'enclos. Un
-- enclos qui attend l'une de ces trois-là ne progressera plus sans l'éleveur :
-- laisser son compteur courir la nuit lui ferait rater son cycle.
--
-- L'Abreuvoir, le Foudroyeur et la Dragofesse sont des stats : elles vont au bout
-- toutes seules. Un enclos qui n'attend qu'elles peut tourner pendant qu'on dort.
--
-- D'où une pause par piste, et non une pour le parc : à l'heure du coucher, on
-- coupe les enclos bloqués et on laisse finir les autres.
alter table public.breeding_timeline
  add column if not exists track_clocks jsonb not null default '{}'::jsonb;

-- Ce que `track_starts` portait déjà, repris tel quel : un départ sans pause.
update public.breeding_timeline
   set track_clocks = (
         select coalesce(
           jsonb_object_agg(key, jsonb_build_object(
             'started_at', value,
             'paused_at', null,
             'paused_seconds', 0
           )),
           '{}'::jsonb
         )
         from jsonb_each_text(track_starts)
       )
 where track_starts <> '{}'::jsonb and track_clocks = '{}'::jsonb;

alter table public.breeding_timeline drop column if exists track_starts;

comment on column public.breeding_timeline.track_clocks is
  'L''horloge propre de chaque piste, indexée par identifiant :
   `{"enclos-1": {"started_at": …, "paused_at": null, "paused_seconds": 0}}`.
   Absente, la piste suit celle du plan. La pause est **par piste** parce qu''un
   enclos bloqué sur la sérénité ou la Mangeoire ne progresse plus sans
   l''éleveur, là où un enclos qui n''attend qu''une stat va au bout tout seul.';
