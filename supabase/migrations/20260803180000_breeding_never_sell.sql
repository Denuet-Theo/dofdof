-- Option « ne jamais vendre les montures ».
--
-- Le marché des certificats de monture est peu liquide : un prix saisi à
-- l'hôtel de vente ne veut pas dire qu'un acheteur se présentera. Classer les
-- couleurs sur une revente qui n'aura pas lieu donne un palmarès flatteur mais
-- faux — la marge affichée serait celle d'une vente hypothétique.
--
-- Quand l'option est active, la seule sortie retenue est l'**extraction**, qui
-- ne dépend d'aucun acheteur : la monture est détruite contre une ressource par
-- génération, revendable celle-là. Les génétons, eux, tombent de toute façon à
-- l'accouplement et restent comptés dans les deux cas.
alter table public.user_breeding_settings
  add column if not exists never_sell_mounts boolean not null default false;

comment on column public.user_breeding_settings.never_sell_mounts is
  'Ignorer la revente des montures et ne valoriser que l''extraction et les génétons.';
