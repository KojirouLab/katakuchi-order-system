-- 発注リマインド通知の宛先設定(店舗+商品カテゴリごとに、どのLINEグループへ
-- 送るか・誰をメンションするかを1行で定義する)。
-- LINEのグループID・ユーザーIDを保持するテーブルなので、クライアント(anon key)
-- からは一切アクセスさせない(RLSを有効にしてポリシーを1つも作らない=完全非公開)。
-- Edge Functionはservice_role keyでアクセスするためRLSの影響を受けない。
create table if not exists notification_targets (
  id uuid primary key default gen_random_uuid(),
  store_slug text not null,
  category text not null,               -- 'pizza' | 'oyster'
  group_id text not null,               -- 通知を送るLINEグループ/トークルームのID
  mentions jsonb not null default '[]'::jsonb, -- [{"userId": "U...", "label": "田中さん"}]
  created_at timestamptz not null default now(),
  unique (store_slug, category)
);

alter table notification_targets enable row level security;
