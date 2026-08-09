-- « Féconde » veut dire prête, pas occupée.
--
-- La migration 20260809190000 a introduit `pregnant` sur une lecture fausse du
-- jeu : elle prenait « féconde » pour « en gestation », donc pour une monture
-- indisponible qui attendrait un poulain. C'est l'inverse.
--
-- Le dépôt le disait déjà, dans `enclos.ts` : « Points à transférer pour amener
-- une monture **de fertile à féconde** ». Le cycle de fécondité — sérénité
-- alignée, les stats montées à l'extrême — sert précisément à rendre une monture
-- féconde. Et il n'y a pas de gestation du tout : un mâle fécond, une femelle
-- féconde, un clic, les deux parents passent stériles et le poulain est là.
--
-- La chaîne réelle est donc :
--
--   fertile --(cycle de jauges)--> féconde --(accouplement)--> stérile
--
-- Une féconde qui n'est pas accouplée le reste ; elle ne retombe pas fertile.
--
-- ## Ce que la lecture fausse cassait
--
-- `statusFlags('feconde')` posait `fertile = false`, et tout le calcul lit
-- `fertile` comme « puis-je la charger dans une fournée ». Les montures les
-- **plus** prêtes du parc — celles dont le cycle est déjà payé — disparaissaient
-- donc de toutes les fournées, de tous les plans et de la fournée à charger. Sur
-- un éleveur qui en tient cinquante et une, c'est tout son parc utile qui
-- s'évapore.
--
-- ## Ce que la colonne dit maintenant
--
-- `fertile` garde son sens et son nom : **la monture peut encore s'accoupler**.
-- Elle est donc vraie pour une fertile comme pour une féconde, et c'est ce qui
-- rend tous les lecteurs existants corrects sans les toucher.
--
-- `cycled` porte la seule différence entre les deux : le cycle de fécondité est
-- déjà payé. C'est une information économique — une féconde ne recoûte pas un
-- cycle — plus qu'une information de disponibilité.

alter table public.user_breeding_individuals
  add column if not exists cycled boolean not null default false;

comment on column public.user_breeding_individuals.cycled is
  'Le cycle de fécondité est déjà fait : la monture est « féconde » au sens du jeu, donc prête à s''accoupler sans repasser par les jauges. Va avec fertile = true — une stérile ne peut pas être cyclée, la contrainte ci-dessous le garantit.';

-- Reprise des données écrites sous la lecture fausse. Une ligne `pregnant` était
-- une féconde, c'est-à-dire une monture **disponible** dont le cycle est fait :
-- elle redevient donc fertile, et cyclée.
update public.user_breeding_individuals
   set cycled = true,
       fertile = true
 where pregnant;

alter table public.user_breeding_individuals
  drop constraint if exists user_breeding_individuals_state_check;

alter table public.user_breeding_individuals
  drop column if exists pregnant;

-- Trois états valides sur quatre combinaisons, et ce n'est plus la même
-- quatrième : « stérile et cyclée » n'a pas de sens, puisque l'accouplement qui
-- stérilise consomme justement le cycle.
alter table public.user_breeding_individuals
  add constraint user_breeding_individuals_state_check
  check (fertile or not cycled);
