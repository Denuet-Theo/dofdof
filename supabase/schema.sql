-- =============================================================
-- Dofdof — Supabase Schema
-- Execute this SQL in your Supabase SQL Editor
-- =============================================================

-- Table des prix (Partagée par tous les utilisateurs)
create table public.item_prices (
  item_id integer primary key,
  item_name text not null,
  icon_url text,
  price bigint default 0,
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  updated_by uuid references auth.users(id)
);

-- Table des ventes (Privée à chaque utilisateur via RLS)
create table public.user_sales (
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
create policy "Lecture prix" on public.item_prices 
  for select using (auth.role() = 'authenticated');

create policy "Mise à jour prix" on public.item_prices 
  for insert with check (auth.role() = 'authenticated');

create policy "Edition prix" on public.item_prices 
  for update using (auth.role() = 'authenticated');

-- Règles RLS : user_sales — Uniquement par le propriétaire
create policy "Gestion ventes propres" on public.user_sales
  for all using (auth.uid() = user_id);

-- =============================================================
-- Fonction : vente atomique d'une partie (ou de la totalité) d'un lot
-- Remplace le duo update+insert fait côté client, qui pouvait laisser
-- des lots "perdus" si l'insert échouait après l'update. security invoker
-- garde la protection RLS existante (auth.uid() = user_id).
-- =============================================================
create or replace function public.sell_lots(p_sale_id uuid, p_count integer)
returns void
language plpgsql
security invoker
as $$
declare
  v_sale public.user_sales%rowtype;
  v_remaining integer;
  v_remaining_craft_cost bigint;
  v_remaining_tax_paid bigint;
  v_remaining_quantity integer;
  v_sold_craft_cost bigint;
  v_sold_tax_paid bigint;
  v_sold_quantity integer;
begin
  if p_count is null or p_count < 1 then
    raise exception 'p_count must be at least 1';
  end if;

  select * into v_sale
  from public.user_sales
  where id = p_sale_id and status = 'active'
  for update;

  if not found then
    raise exception 'Sale % not found or not active', p_sale_id;
  end if;

  if p_count > v_sale.lot_count then
    raise exception 'Cannot sell % lots, only % available', p_count, v_sale.lot_count;
  end if;

  if p_count = v_sale.lot_count then
    update public.user_sales
    set status = 'sold', sold_at = timezone('utc'::text, now())
    where id = p_sale_id;
  else
    v_remaining := v_sale.lot_count - p_count;

    v_remaining_craft_cost := floor(coalesce(v_sale.craft_cost, 0) * v_remaining::numeric / v_sale.lot_count);
    v_remaining_tax_paid := floor(coalesce(v_sale.tax_paid, 0) * v_remaining::numeric / v_sale.lot_count);
    v_remaining_quantity := v_sale.lot_size * v_remaining;

    v_sold_craft_cost := coalesce(v_sale.craft_cost, 0) - v_remaining_craft_cost;
    v_sold_tax_paid := coalesce(v_sale.tax_paid, 0) - v_remaining_tax_paid;
    v_sold_quantity := v_sale.lot_size * p_count;

    update public.user_sales
    set lot_count = v_remaining,
        quantity = v_remaining_quantity,
        craft_cost = v_remaining_craft_cost,
        tax_paid = v_remaining_tax_paid
    where id = p_sale_id;

    insert into public.user_sales (
      user_id, item_id, item_name, icon_url, quantity, unit_price,
      craft_cost, tax_paid, lot_size, lot_count, status, is_resale,
      created_at, sold_at
    ) values (
      v_sale.user_id, v_sale.item_id, v_sale.item_name, v_sale.icon_url,
      v_sold_quantity, v_sale.unit_price, v_sold_craft_cost, v_sold_tax_paid,
      v_sale.lot_size, p_count, 'sold', v_sale.is_resale,
      v_sale.created_at, timezone('utc'::text, now())
    );
  end if;
end;
$$;

grant execute on function public.sell_lots(uuid, integer) to authenticated;
