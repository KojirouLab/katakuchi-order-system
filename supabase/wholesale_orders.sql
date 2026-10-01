-- 卸先(牡蠣・ピザ生地などの取引先)の受注。カタクチ商店のピザ集計ページにだけ表示する。
-- items は [{code, name, unit, qty}] の配列、content は表示・納品明細書用に整形した文字列。
-- 冷凍牡蠣(S/M/無選別)の数量は、牡蠣在庫に連動させるため oyster_orders にも同じ
-- store_slug・order_date で書き込む(アプリ側で保存・削除のたびに同期する)。
create table if not exists wholesale_orders (
  id uuid primary key default gen_random_uuid(),
  store_slug text not null,
  store_name text not null,
  order_date date not null,
  items jsonb not null default '[]'::jsonb,
  content text not null default '',
  note text not null default '',
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (store_slug, order_date)
);

alter table wholesale_orders enable row level security;

drop policy if exists "wholesale anon select" on wholesale_orders;
drop policy if exists "wholesale anon insert" on wholesale_orders;
drop policy if exists "wholesale anon update" on wholesale_orders;
drop policy if exists "wholesale anon delete" on wholesale_orders;
create policy "wholesale anon select" on wholesale_orders for select using (true);
create policy "wholesale anon insert" on wholesale_orders for insert with check (true);
create policy "wholesale anon update" on wholesale_orders for update using (true);
create policy "wholesale anon delete" on wholesale_orders for delete using (true);
