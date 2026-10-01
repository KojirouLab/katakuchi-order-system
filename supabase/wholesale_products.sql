-- 卸先の発注画面に並べる商品マスタ。管理メニューの「卸の商品マスタ」ページから登録・変更・削除する。
-- code: 発注データ(wholesale_orders.items)・いつもの商品(app.jsのSTORES.usualItems)から参照する識別子。
-- stock: 牡蠣在庫(冷凍庫)の混合/S/Mに連動させる商品だけ 'mixed' | 's' | 'm'(数量はケース=15kg単位)。
-- suspended: 取り扱い休止中(発注画面のプルダウンに出さない)。
-- 過去の発注は商品名・単位をwholesale_orders側にも保存しているので、ここを変更・削除しても過去の発注表示は変わらない。
create table if not exists wholesale_products (
  code text primary key,
  group_name text not null default '',
  name text not null,
  unit text not null default '',
  stock text check (stock in ('mixed', 's', 'm')),
  suspended boolean not null default false,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table wholesale_products enable row level security;

drop policy if exists "wholesale_products anon select" on wholesale_products;
drop policy if exists "wholesale_products anon insert" on wholesale_products;
drop policy if exists "wholesale_products anon update" on wholesale_products;
drop policy if exists "wholesale_products anon delete" on wholesale_products;
create policy "wholesale_products anon select" on wholesale_products for select using (true);
create policy "wholesale_products anon insert" on wholesale_products for insert with check (true);
create policy "wholesale_products anon update" on wholesale_products for update using (true);
create policy "wholesale_products anon delete" on wholesale_products for delete using (true);

-- 初期データ(それまでapp.jsに直書きしていた商品)。
insert into wholesale_products (code, group_name, name, unit, stock, suspended, sort_order) values
  ('dough130', '生地', '130g玉生地100個入 送料込み', '個', null, false, 10),
  ('dough150', '生地', '150g玉生地100個入 送料込み', '個', null, false, 20),
  ('dough180', '生地', '180g玉生地 80個入 送料込み', '個', null, false, 30),
  ('dough200', '生地', '200g玉生地', '個', null, false, 40),
  ('napoli6', 'ナポリ', '6インチナポリ100枚入り 送料込み', '個', null, false, 50),
  ('napoli8', 'ナポリ', '8インチナポリ50枚入り 送料込み', '個', null, false, 60),
  ('napoli10', 'ナポリ', '10インチナポリ40枚入り 送料込み', '個', null, false, 70),
  ('napoli8plain', 'ナポリ', '8インチナポリプレーン', '枚', null, false, 80),
  ('michinoku', 'ナポリ', 'みちのくナポリピッツァ 16枚 送料込み', '個', null, false, 90),
  ('crispy8', 'クリスピー', '8インチクリスピー100枚 送料込み', '個', null, false, 100),
  ('frozen_s', '冷凍牡蠣', '冷凍牡蠣 Sサイズ', 'ケース', 's', false, 110),
  ('frozen_m', '冷凍牡蠣', '冷凍牡蠣 Mサイズ', 'ケース', 'm', false, 120),
  ('frozen_mixed', '冷凍牡蠣', '冷凍牡蠣 無選別(混合)', 'ケース', 'mixed', false, 130),
  ('raw_mixed', '生牡蠣', '生牡蠣 無選別', 'kg', null, true, 140),
  ('raw_s', '生牡蠣', '生牡蠣 S', 'kg', null, true, 150),
  ('chicken', 'その他', 'チキン 1kg', 'kg', null, false, 160),
  ('sausage', 'その他', '自家製ソーセージ 1kg', 'kg', null, false, 170),
  ('nori', 'その他', '生海苔', 'kg', null, false, 180),
  ('gorgonzola', 'その他', 'ゴルゴンゾーラクラッシュ 1kg', '個', null, false, 190)
on conflict (code) do nothing;
