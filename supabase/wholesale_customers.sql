-- 卸先(取引先)の一覧。管理メニューの「卸先・商品の登録」ページから誰でも追加・変更できる。
-- slug: 発注ページのURL(?store=slug)と、各発注データ(store_slug)の識別子。登録後は変えない。
-- usual_items: 注文履歴がまだ無いときに、商品プルダウンの先頭に出す「いつもの商品」(wholesale_productsのcode)。
-- active: falseにすると取引停止(発注ページは受付停止の表示になり、トップページの一覧からも消える。過去の発注は残る)。
-- 卸先は全て宅配発送扱い(牡蠣在庫では「宅配発送」に計上)。
create table if not exists wholesale_customers (
  slug text primary key,
  name text not null,
  usual_items jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table wholesale_customers enable row level security;

drop policy if exists "wholesale_customers anon select" on wholesale_customers;
drop policy if exists "wholesale_customers anon insert" on wholesale_customers;
drop policy if exists "wholesale_customers anon update" on wholesale_customers;
create policy "wholesale_customers anon select" on wholesale_customers for select using (true);
create policy "wholesale_customers anon insert" on wholesale_customers for insert with check (true);
create policy "wholesale_customers anon update" on wholesale_customers for update using (true);

-- 初期データ(それまでapp.jsに直書きしていた22件)。
insert into wholesale_customers (slug, name, usual_items, sort_order) values
  ('w-houryou', '有限会社 ほうりょう', '["raw_mixed", "raw_s", "frozen_mixed", "frozen_s"]'::jsonb, 10),
  ('w-eda-hiroki', '江田浩樹', '["dough200", "chicken", "sausage", "frozen_m"]'::jsonb, 20),
  ('w-kainuma', '開沼 拓', '["crispy8", "dough130", "dough150", "napoli10"]'::jsonb, 30),
  ('w-ashimoka', '株式会社ashimoka', '["dough180", "dough130"]'::jsonb, 40),
  ('w-eda-kitasendai', '江田宏樹 北仙台', '["dough200", "chicken", "sausage", "nori"]'::jsonb, 50),
  ('w-tasso', 'TASSO 開沼', '["dough150"]'::jsonb, 60),
  ('w-inthesoup', 'in the Soup.', '["napoli10", "napoli8"]'::jsonb, 70),
  ('w-izukogen', '伊豆高原ビール(株)レストラン', '["napoli6"]'::jsonb, 80),
  ('w-osteria32', 'osteria32', '["dough180", "gorgonzola"]'::jsonb, 90),
  ('w-soma', 'SOMA', '["napoli10", "napoli8"]'::jsonb, 100),
  ('w-shunrakuzen', '株式会社旬楽膳', '["napoli8"]'::jsonb, 110),
  ('w-yourgurt', '株式会社YOURGURT', '["crispy8"]'::jsonb, 120),
  ('w-tsurumai', '株式会社鶴舞商店', '["frozen_s", "frozen_mixed"]'::jsonb, 130),
  ('w-acecafe', 'Acecafe', '["napoli10"]'::jsonb, 140),
  ('w-okano', '日本酒トワイン岡野', '["napoli6"]'::jsonb, 150),
  ('w-tokai', '株式会社東海', '["napoli8plain"]'::jsonb, 160),
  ('w-ito', '伊藤正枝', '["michinoku"]'::jsonb, 170),
  ('w-kanesue', '株式会社 カネスエ', '["napoli8"]'::jsonb, 180),
  ('w-nicolo', 'BISTRO ITALIAN NICOLO', '["dough150"]'::jsonb, 190),
  ('w-romero', 'イタリアンサカバ ロメロ', '["dough150"]'::jsonb, 200),
  ('w-patata', 'カフェ＆パーティ パタータ', '["napoli10"]'::jsonb, 210),
  ('w-pierrot', 'ビストロピエロ', '["dough130", "dough150", "crispy8"]'::jsonb, 220)
on conflict (slug) do nothing;

-- 新しく登録された卸先の発注通知の送り先。個別の登録(store_slug=取引先)が無い卸先は、
-- この既定の行('_default')の送り先に通知する(notify-order-placed参照)。既存の卸先の送り先をコピーする。
insert into discord_notification_targets (store_slug, category, webhook_url, mention_role_id)
select '_default', 'wholesale_placed', webhook_url, mention_role_id
from discord_notification_targets
where store_slug = 'w-ashimoka' and category = 'wholesale_placed'
on conflict (store_slug, category) do nothing;
