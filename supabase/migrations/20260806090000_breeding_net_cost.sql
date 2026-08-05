-- Pouvoir capturer sans imputer le prix des filets.
--
-- Le coût d'une monture capturée se compose du filet consommé et du combat.
-- Le filet est chiffré à son prix de craft, amputé de ce que le recraft
-- récupère — environ 80 %, donc un cinquième du prix par capture.
--
-- C'est juste pour qui achète ses matériaux à l'hôtel de vente. Ça ne l'est pas
-- pour qui les récolte : le craft ne sort alors aucun kama de la poche, et lui
-- imputer un prix d'hôtel revient à facturer une dépense qui n'a pas eu lieu.
-- Le coût de capture est le plancher de toute la première génération, donc
-- l'erreur remonte dans chaque route.
--
-- À `false`, il ne reste que le temps de combat. Deux effets, et le second
-- compte autant que le premier : les filets sans prix connu redeviennent
-- éligibles, et le choix bascule sur le plus gros filet disponible — un filet
-- vaut un combat quel que soit son palier.
--
-- Défaut à `true`, qui est le comportement d'avant.

alter table public.user_breeding_settings
  add column if not exists count_net_cost boolean not null default true;

comment on column public.user_breeding_settings.count_net_cost is
  'Imputer le prix de craft des filets au coût d''une capture. À false, seul le temps de combat est compté — le régime de qui récolte ses propres matériaux.';
