-- La timeline d'exécution : le plan du modèle, et où l'on en est dedans.
--
-- Le reste de l'élevage est **sans horloge**. Le classement, le plan, la fournée
-- répondent tous à « quoi faire », jamais à « quand » — et c'est cohérent, parce
-- que ces réponses ne dépendent pas de l'heure qu'il est.
--
-- L'optimiseur, lui, ne rend pas une liste de croisements mais un
-- **ordonnancement** : recharger le Baffeur dans 20 minutes, récupérer la
-- génération dans 2 h 20. Deux choses qu'aucune table existante ne peut porter,
-- et qui ont chacune leur raison d'être ici :
--
-- 1. **Le plan** (`plan`), tel que le modèle l'émet. Stocké en JSON brut et non
--    éclaté en lignes : sa forme appartient au modèle, qui évolue plus vite que
--    le schéma. Une migration par changement d'ordonnanceur serait intenable, et
--    le SQL n'a de toute façon rien à interroger là-dedans — la page lit le plan
--    entier ou rien.
--
-- 2. **L'horloge** (`started_at`, `paused_at`, `paused_seconds`), qui dit où l'on
--    en est. Elle vit en base plutôt qu'en local pour une raison précise : une
--    pause de week-end dure plus longtemps qu'un onglet, et se rouvrir lundi sur
--    une timeline repartie à zéro ferait rater la reprise.
--
-- ## Pourquoi trois colonnes pour une pause
--
-- Un booléen ne suffit pas : il faut savoir **de combien** décaler. On garde donc
-- l'instant de départ, le cumul des pauses déjà terminées, et l'instant de la
-- pause en cours s'il y en a une.
--
--   temps de plan = (paused_at ou maintenant) − started_at − paused_seconds
--
-- Mettre en pause fige `paused_at` ; reprendre verse la durée écoulée dans
-- `paused_seconds` et remet `paused_at` à null. Les événements futurs glissent
-- alors tous de la durée de la pause, ce qui est exactement ce qu'on veut dire
-- par « j'ai arrêté de jouer » : le jeu ne progresse pas en notre absence, et
-- une timeline qui aurait continué de courir désignerait des actions déjà
-- manquées.
--
-- Le cumul est en secondes entières et non en intervalle : une pause se compte en
-- heures, la seconde près n'a aucun sens ici, et un entier se manipule sans
-- surprise côté client.

create table if not exists public.breeding_timeline (
  user_id uuid not null references auth.users(id) default auth.uid(),
  family text not null check (family in ('dragodinde', 'muldo', 'volkorne')),

  -- L'ordonnancement émis par le modèle. Voir `lib/dofus/breeding/timeline.ts`,
  -- qui porte le contrat et le valide à la lecture : rien ici ne garantit la
  -- forme, et c'est assumé — une contrainte SQL sur du JSON figerait justement
  -- ce qu'on veut laisser bouger.
  plan jsonb not null,

  -- Le début du plan, en temps réel. Relancer un plan, c'est le remettre à
  -- maintenant et remettre les compteurs de pause à zéro.
  started_at timestamp with time zone not null default timezone('utc'::text, now()),

  -- La pause en cours, ou null si la timeline tourne.
  paused_at timestamp with time zone,

  -- Le cumul des pauses **terminées**. La pause en cours n'y est pas : elle se
  -- déduit de `paused_at`, sans quoi il faudrait écrire en base à chaque tick.
  paused_seconds bigint not null default 0 check (paused_seconds >= 0),

  updated_at timestamp with time zone not null default timezone('utc'::text, now()),

  -- Une seule timeline par famille : on n'élève pas deux parcs de muldos en
  -- parallèle, et deux horloges concurrentes sur les mêmes cinq enclos
  -- donneraient deux consignes contraires devant le même enclos.
  primary key (user_id, family)
);

comment on column public.breeding_timeline.plan is
  'Ordonnancement émis par l''optimiseur. Contrat et validation dans lib/dofus/breeding/timeline.ts.';
comment on column public.breeding_timeline.paused_seconds is
  'Cumul des pauses terminées, en secondes. La pause en cours se déduit de paused_at.';

alter table public.breeding_timeline enable row level security;

-- Où en est un joueur dans son plan ne regarde que lui : rien à partager ici,
-- contrairement aux prix de marché.
drop policy if exists "Timeline d'élevage propre" on public.breeding_timeline;
create policy "Timeline d'élevage propre" on public.breeding_timeline
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
