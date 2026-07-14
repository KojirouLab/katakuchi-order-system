-- Supabase の SQL Editor にこの内容を貼り付けて実行してください。

create table if not exists pizza_orders (
  id uuid primary key default gen_random_uuid(),
  store_slug text not null,
  store_name text not null,
  order_date date not null,
  content text not null default '',
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (store_slug, order_date)
);

create table if not exists oyster_orders (
  id uuid primary key default gen_random_uuid(),
  store_slug text not null,
  store_name text not null,
  order_date date not null,
  mixed_boxes numeric not null default 0,
  s_boxes numeric not null default 0,
  m_boxes numeric not null default 0,
  no_order boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (store_slug, order_date)
);

alter table pizza_orders enable row level security;
alter table oyster_orders enable row level security;

-- このアプリはログイン機能を持たず、店舗ごとの専用URLを知っている人だけが
-- アクセスできる運用を前提としています。そのため anon キーからの読み書きを
-- そのまま許可しています。URLは店舗の発注担当者だけに共有してください。

create policy "pizza anon select" on pizza_orders for select using (true);
create policy "pizza anon insert" on pizza_orders for insert with check (true);
create policy "pizza anon update" on pizza_orders for update using (true);
create policy "pizza anon delete" on pizza_orders for delete using (true);

create policy "oyster anon select" on oyster_orders for select using (true);
create policy "oyster anon insert" on oyster_orders for insert with check (true);
create policy "oyster anon update" on oyster_orders for update using (true);
create policy "oyster anon delete" on oyster_orders for delete using (true);
