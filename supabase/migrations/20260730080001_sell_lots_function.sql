-- Fonction : vente atomique d'une partie (ou de la totalité) d'un lot.
-- Remplace le duo update+insert fait côté client, qui pouvait laisser
-- des lots "perdus" si l'insert échouait après l'update. security invoker
-- garde la protection RLS existante (auth.uid() = user_id).
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
