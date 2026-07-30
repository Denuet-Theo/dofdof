-- The UI already supports selling in lots of 1000, but the check
-- constraint on user_sales.lot_size only allowed 1, 10, or 100,
-- causing inserts to fail. Widen it to include 1000.
alter table public.user_sales
  drop constraint user_sales_lot_size_check;

alter table public.user_sales
  add constraint user_sales_lot_size_check check (lot_size in (1, 10, 100, 1000));
