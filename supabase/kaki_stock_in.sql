-- 仙台のカタクチ商店冷凍庫における牡蠣の入庫記録。
-- 在庫残高 = 入庫合計 - 出荷合計(oyster_ordersの2026-08-04以降の合計)で計算する。
-- 出荷は既存のoyster_ordersと自動連動するため、このテーブルには入庫のみを記録する。
create table if not exists kaki_stock_in (
  id uuid primary key default gen_random_uuid(),
  in_date date not null,
  mixed_boxes numeric not null default 0,
  s_boxes numeric not null default 0,
  m_boxes numeric not null default 0,
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table kaki_stock_in enable row level security;

-- このアプリはログイン機能を持たず、URLを知っている人だけがアクセスできる運用のため、
-- 他のテーブル(pizza_orders/oyster_orders)と同様にanonキーからの読み書きを許可する。
create policy "kaki_stock_in anon select" on kaki_stock_in for select using (true);
create policy "kaki_stock_in anon insert" on kaki_stock_in for insert with check (true);
create policy "kaki_stock_in anon update" on kaki_stock_in for update using (true);
create policy "kaki_stock_in anon delete" on kaki_stock_in for delete using (true);
