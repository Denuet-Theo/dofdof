-- Le plan suivi retient **ce qu'on cherche**, et pas seulement ce qu'on a choisi.
--
-- Le classement ne savait répondre qu'à « quelle couleur rapporte le plus par
-- heure d'enclos ». C'est la bonne question pour vivre de l'élevage, et la
-- mauvaise pour monter en génération : une gen 10 mobilise le parc des dizaines
-- de fois plus longtemps pour une seule monture, donc elle perd toujours à ce
-- jeu-là. Un éleveur qui vise le haut de l'arbre ne voyait jamais sa route
-- arriver en tête, alors que c'est exactement celle qu'il cherchait.
--
-- L'objectif est donc une donnée du projet, au même titre que la couleur : deux
-- éleveurs devant le même arbre et les mêmes prix n'ont pas la même bonne
-- réponse, et rien dans les prix ne permet de deviner laquelle.
--
-- `color` reste le défaut, qui est le comportement d'avant : le classement
-- complet, à l'éleveur de choisir.

alter table public.breeding_projects
  add column if not exists objective text not null default 'color'
    check (objective in ('profit', 'gen10_fast', 'gen10_profit', 'color'));

comment on column public.breeding_projects.objective is
  'Ce que le plan cherche : profit = meilleure marge horaire toutes générations confondues, gen10_fast = génération maximale au plus vite, gen10_profit = génération maximale au moins cher, color = couleur choisie à la main.';
