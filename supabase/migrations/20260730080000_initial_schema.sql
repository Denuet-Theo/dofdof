-- Table des prix (Partagée par tous les utilisateurs)
create table if not exists public.item_prices (
  item_id integer primary key,
  item_name text not null,
  icon_url text,
  price bigint default 0,
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  updated_by uuid references auth.users(id)
);

-- Table des ventes (Privée à chaque utilisateur via RLS)
create table if not exists public.user_sales (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) default auth.uid() not null,
  item_id integer not null,
  item_name text not null,
  icon_url text,
  quantity integer default 1,
  unit_price bigint not null,
  craft_cost bigint default 0,
  tax_paid bigint default 0,
  lot_size integer default 1 check (lot_size in (1, 10, 100)),
  lot_count integer default 1,
  status text check (status in ('active', 'sold')) default 'active',
  is_resale boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  sold_at timestamp with time zone
);

-- Activation de la sécurité au niveau des lignes (RLS)
alter table public.item_prices enable row level security;
alter table public.user_sales enable row level security;

-- Règles RLS : item_prices — Lecture/Écriture pour tous les utilisateurs connectés
-- (policies don't support "if not exists" in Postgres, so drop-then-create for idempotency)
drop policy if exists "Lecture prix" on public.item_prices;
create policy "Lecture prix" on public.item_prices
  for select using (auth.role() = 'authenticated');

drop policy if exists "Mise à jour prix" on public.item_prices;
create policy "Mise à jour prix" on public.item_prices
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "Edition prix" on public.item_prices;
create policy "Edition prix" on public.item_prices
  for update using (auth.role() = 'authenticated');

-- Règles RLS : user_sales — Uniquement par le propriétaire
drop policy if exists "Gestion ventes propres" on public.user_sales;
create policy "Gestion ventes propres" on public.user_sales
  for all using (auth.uid() = user_id);
