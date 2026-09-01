-- 発注リマインド通知のDiscord宛先設定(店舗+商品カテゴリごとに、どのDiscordチャンネルの
-- Webhook URLへ送るかを1行で定義する)。notification_targets(LINE用)と同じ考え方で、
-- 複数の店舗+カテゴリが同じチャンネル(同じwebhook_url)を共有してもよい
-- (例: 牡蠣小屋もういっこ・東一店・はっこの3店を1つのチャンネルにまとめる場合)。
-- LINEと並行して両方に送る運用のため、既存のnotification_targetsとは別テーブルにしている。
-- Webhook URLはそれ自体が認証情報なので、クライアント(anon key)からは一切アクセスさせない
-- (RLSを有効にしてポリシーを1つも作らない=完全非公開)。
-- Edge Functionはservice_role keyでアクセスするためRLSの影響を受けない。
create table if not exists discord_notification_targets (
  id uuid primary key default gen_random_uuid(),
  store_slug text not null,
  category text not null,               -- 'pizza' | 'oyster'
  webhook_url text not null,            -- 通知を送るDiscordチャンネルのWebhook URL
  created_at timestamptz not null default now(),
  unique (store_slug, category)
);

alter table discord_notification_targets enable row level security;
