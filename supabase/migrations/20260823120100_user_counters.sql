-- Les compteurs de l'écran /counter : douze cases, une ligne par case remplie.
--
-- Compter à la main est le geste que l'outil ne rendait pas : combien de Peaux
-- de Bouftou tombées, combien de Bouftous tués, combien de bestioles de la
-- famille. Le jeu ne le dit nulle part, et un papier à côté du clavier se perd.

create table if not exists public.user_counters (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  -- La case dans la grille 4×3, de 0 à 11. C'est la **case** qui identifie le
  -- compteur, pas ce qu'elle compte : la grille est un tableau de bord dont la
  -- disposition se retient, et deux cases peuvent viser la même chose (deux
  -- sessions de farm du même item, comptées séparément) sans se marcher dessus.
  slot smallint not null check (slot between 0 and 11),

  -- Item du catalogue, monstre du bestiaire, ou famille de monstres. Trois
  -- tables différentes, donc `target_id` ne peut pas porter de clé étrangère :
  -- c'est `kind` qui dit dans laquelle il faut aller chercher.
  kind text not null check (kind in ('item', 'monster', 'race')),
  target_id integer not null,

  -- Le nom et l'icône, recopiés du miroir au moment du choix.
  --
  -- C'est ce qui rend l'absence de clé étrangère inoffensive : une resynchro qui
  -- ferait disparaître l'id laisse un compteur qui s'affiche encore et dont le
  -- total reste juste, là où une jointure rendrait une case vide portant un
  -- nombre. C'est aussi ce qui évite trois jointures pour douze cases.
  label text not null default '',
  img   text not null default '',

  -- `tally` et non `count` : PostgREST expose `count` comme agrégat dans la
  -- clause `select`, et une colonne du même nom oblige à la citer partout pour
  -- lever l'ambiguïté. Le nom vaut mieux que la vigilance.
  --
  -- Le plancher à zéro est dans la contrainte et pas seulement dans l'écran :
  -- 🔙 décrémente, et un compteur négatif ne veut rien dire.
  tally integer not null default 0 check (tally >= 0),

  updated_at timestamptz not null default now(),

  primary key (user_id, slot)
);

alter table public.user_counters enable row level security;

-- Strictement privé, comme les filtres de ferme : c'est une session de farm en
-- cours, pas une donnée de marché à partager.
drop policy if exists "Compteurs propres" on public.user_counters;
create policy "Compteurs propres" on public.user_counters
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
