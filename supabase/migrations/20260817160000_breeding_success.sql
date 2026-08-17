-- Le succès de collection : chaque couleur de la famille, née au moins une fois.
--
-- Le jeu décerne un succès à qui a fait **naître** chaque couleur au moins une
-- fois. Sur le muldo cela fait 120 couleurs, dont **105 de génération paire** —
-- les composées. C'est donc essentiellement une affaire de générations paires, et
-- ça a une conséquence directe sur le levier le moins cher : les 10 gen 2 sont
-- exactement les 10 paires des 5 gen 1, si bien qu'échanger un partenaire gen 1
-- contre un autre change la gen 2 qui sort sans consommer une monture de plus.

-- ## Ce qui compte, et ce qui ne compte pas
--
-- « Faire naître », donc une naissance **enregistrée**. Pas ce que l'écurie porte :
-- l'éleveur achète aussi des montures qui ont une généalogie, si bien que
-- « parents renseignés » ne prouve rien. Cette table ne se remplit donc que par
-- `recordBirths`, à la saisie de « Ce qui est né », et par rien d'autre — ni
-- déduction depuis l'écurie, ni saisie manuelle.
--
-- Conséquence assumée : le compteur part de 0 et ne reflète pas ce qui a été
-- élevé avant aujourd'hui. Rien de faux n'y entre, ce qui est le compromis
-- retenu.
--
-- Pas de date de naissance ni de compte : le succès demande « au moins une
-- fois », donc l'existence de la ligne est toute l'information. Un `first_at`
-- serait joli et ne répondrait à aucune question qu'on se pose.

create table if not exists public.user_breeding_hatched (
  user_id uuid not null references auth.users(id) default auth.uid(),
  family text not null check (family in ('dragodinde', 'muldo', 'volkorne')),
  color_id text not null,
  primary key (user_id, family, color_id)
);

alter table public.user_breeding_hatched enable row level security;

drop policy if exists "Collection propre" on public.user_breeding_hatched;
create policy "Collection propre" on public.user_breeding_hatched
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ## Ce que la politique en fait : rien, pour l'instant
--
-- L'écran affiche la collection et laisse la politique tranquille. Les trois
-- modes que l'éleveur a demandés — ignoré, priorisé sans surcoût, priorisé —
-- arrivent avec la branche qui les fait agir, et leur colonne avec eux.
--
-- Pas avant, et c'est délibéré : un réglage qui n'a aucun effet est exactement ce
-- que #181 et #216 ont passé deux PR à retirer de cet écran. `check:settings`
-- l'interdit maintenant par construction — un champ n'entre dans
-- `BreedingSettings` qu'accompagné du contrôle qui l'écrit.
