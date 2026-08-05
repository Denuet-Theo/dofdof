-- Trois objectifs au lieu de quatre, et le nouveau vise l'équilibre.
--
-- `gen10_fast` disparaît : il ne tenait pas sa promesse. L'objectif n'atteignait
-- jamais `optimalParentLevel`, qui minimise toujours le coût attendu, si bien
-- que « au plus vite » ne faisait que re-trier des couleurs sur une durée
-- calculée pour un tout autre critère. Deux objectifs rendaient la même route,
-- au même délai, à un niveau de parent près.
--
-- `color` disparaît aussi : le classement reste à l'écran sous « rentabilité
-- maximale », qui n'écarte aucune génération, et chaque ligne se suit d'un clic.
-- Un mode dédié n'apportait qu'un tri manuel concurrent de celui de l'objectif.
--
-- `gen10_balanced` les remplace, et répond à un besoin qu'aucun des deux ne
-- couvrait : **monter en génération sans avoir à alterner**. Sans lui, on
-- enchaîne des sessions de rentabilité pour financer des sessions de montée,
-- ce qui n'est pas un plan mais deux. L'objectif retient donc la route vers la
-- génération maximale dont les recettes couvrent le mieux les dépenses — au
-- solde, et non au coût, qui sont deux classements différents dès que les
-- sorties diffèrent d'une couleur à l'autre.

alter table public.breeding_projects
  drop constraint if exists breeding_projects_objective_check;

-- Les projets existants sont reportés sur l'objectif le plus proche de leur
-- intention : viser la génération maximale devient l'équilibre, choisir une
-- couleur à la main devient le classement par rentabilité, qui la montre encore.
update public.breeding_projects set objective = 'gen10_balanced' where objective = 'gen10_fast';
update public.breeding_projects set objective = 'profit' where objective = 'color';

alter table public.breeding_projects
  alter column objective set default 'profit';

alter table public.breeding_projects
  add constraint breeding_projects_objective_check
  check (objective in ('profit', 'gen10_balanced', 'gen10_profit'));

comment on column public.breeding_projects.objective is
  'Ce que le plan cherche : profit = meilleure marge horaire toutes générations confondues, gen10_balanced = génération maximale dont les recettes couvrent le mieux les dépenses, gen10_profit = génération maximale au moins cher.';
