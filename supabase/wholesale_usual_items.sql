-- 卸先ごとの「いつもの商品」(発注画面の左側のプルダウンに出す商品)。
-- 発注画面右側のチェックボックスで取引先自身が追加・削除でき、次回以降もその内容で表示する。
-- 行が無い取引先は app.js の STORES の usualItems を初期値として使う。
create table if not exists wholesale_usual_items (
  store_slug text primary key,
  items jsonb not null default '[]'::jsonb, -- WHOLESALE_PRODUCTSのcodeの配列
  updated_at timestamptz not null default now()
);

alter table wholesale_usual_items enable row level security;

drop policy if exists "wholesale_usual anon select" on wholesale_usual_items;
drop policy if exists "wholesale_usual anon insert" on wholesale_usual_items;
drop policy if exists "wholesale_usual anon update" on wholesale_usual_items;
create policy "wholesale_usual anon select" on wholesale_usual_items for select using (true);
create policy "wholesale_usual anon insert" on wholesale_usual_items for insert with check (true);
create policy "wholesale_usual anon update" on wholesale_usual_items for update using (true);
