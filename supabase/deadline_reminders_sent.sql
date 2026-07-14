-- 締切リマインドの重複送信を防ぐための記録テーブル。
-- 同じ店舗+カテゴリ+発注日への通知は一度送ったら二度と送らない。
create table if not exists deadline_reminders_sent (
  id uuid primary key default gen_random_uuid(),
  store_slug text not null,
  category text not null,
  order_date date not null,
  sent_at timestamptz not null default now(),
  unique (store_slug, category, order_date)
);

alter table deadline_reminders_sent enable row level security;
-- クライアントからは一切アクセスさせない(RLS有効・ポリシーなし)。Edge Functionはservice_role経由。
