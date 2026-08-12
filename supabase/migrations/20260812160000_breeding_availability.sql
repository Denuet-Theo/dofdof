-- Quand un éleveur peut **agir**, en préréglages nommés.
--
-- Les jauges tournent en continu — une monture monte pendant qu'on dort — mais
-- lancer et récupérer une fournée demande d'être devant le jeu. Le plan ne peut
-- donc pas se contenter d'un budget d'heures : il lui faut savoir à quels moments
-- on sera là.
--
-- ## Pourquoi des préréglages et non deux patterns
--
-- Le premier réflexe était de coder « journée de travail » et « journée de
-- repos ». Ça ne tient pas : les horaires d'un télétravail ne sont pas ceux d'un
-- bureau, et surtout ce sont ceux **de cette personne-là**. Un guilde entière
-- partagerait deux formes qui ne conviendraient à personne.
--
-- D'où des préréglages que le joueur nomme et modifie lui-même, et un choix du
-- jour parmi eux.
--
-- ## Pourquoi du jsonb
--
-- Même raisonnement que `user_farm_filters` (20260804230000), et il vaut ici pour
-- la même raison : **rien de ce contenu n'est lu par du SQL**. Aucune fonction ne
-- filtre, n'agrège ni ne contraint des créneaux ; c'est le client qui les place
-- sur une timeline. En colonnes il faudrait une table de créneaux, une jointure,
-- et une migration à chaque fois qu'un préréglage gagne un champ — pour une
-- donnée dont le client est la seule définition qui compte.
--
-- La contrepartie est que la forme n'est pas validée ici. Le client recolle ce
-- qu'il relit sur ses propres défauts et ignore ce qu'il ne comprend pas, ce qui
-- absorbe aussi bien un champ retiré qu'un champ ajouté depuis la dernière visite.

create table if not exists public.user_breeding_availability (
  user_id uuid primary key references auth.users(id) default auth.uid(),

  -- Les préréglages du joueur, et celui retenu pour aujourd'hui.
  --
  -- Forme attendue, dont `AvailabilityState` est la définition :
  --
  --   {
  --     "presets": [
  --       { "id": "...", "name": "Télétravail",
  --         "windows": [{ "from": 480, "to": 600 }, { "from": 720, "to": 840 }] }
  --     ],
  --     "chosen": { "presetId": "...", "date": "2026-08-12" }
  --   }
  --
  -- `from`/`to` en minutes depuis minuit. `to` peut dépasser 1440 : un créneau de
  -- 20 h à 2 h se dit `{ "from": 1200, "to": 1560 }`, ce qui évite d'avoir à
  -- couper une soirée en deux morceaux dont l'un appartient au lendemain.
  --
  -- `chosen` porte la **date** avec le choix, à dessein : le préréglage se choisit
  -- pour la journée, donc rouvrir l'écran le même jour doit retrouver le choix,
  -- et le lendemain doit le redemander plutôt que de rejouer celui d'hier.
  availability jsonb not null default '{}'::jsonb
    check (jsonb_typeof(availability) = 'object'),

  updated_at timestamp with time zone default timezone('utc'::text, now())
);

alter table public.user_breeding_availability enable row level security;

-- Strictement privé. Ce sont des horaires de présence : la donnée la plus
-- personnelle du schéma, et elle n'a aucune raison d'être lisible par un tiers.
drop policy if exists "Disponibilités propres" on public.user_breeding_availability;
create policy "Disponibilités propres" on public.user_breeding_availability
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
