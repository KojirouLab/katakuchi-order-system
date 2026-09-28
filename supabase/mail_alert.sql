-- 会社共用メール(shopify@catakuchi6.co.jp)を10分おきにチェックし、重要そうなメールが
-- 来たらDiscordへ個人DMで通知する仕組みのSQL。SQL Editorで実行してください。
-- 何度実行しても問題ありません(既存データは壊れません)。
--
-- 仕組み:
--   pg_cronが10分おきに trigger_mail_alert_check() を呼ぶ
--   → Edge Function「mail-alert-check」がIMAPでメールを取得し、Claudeに重要かどうか判定させる
--   → 重要なら、既存の task-notify と同じDiscord Botトークンを使ってDMを送る。
--
-- 前提: Edge Function「mail-alert-check」をデプロイし、
--   Supabaseの Secrets に以下を設定しておくこと(いずれも Project Settings > Edge Functions > Secrets):
--     MAIL_IMAP_PASSWORD        … shopify@catakuchi6.co.jp のメールパスワード
--     ANTHROPIC_API_KEY         … Claude APIキー
--     MAIL_ALERT_SECRET         … このSQLが埋め込む合言葉と同じ値(下のinsertで自動生成されます)
--     DISCORD_BOT_TOKEN         … 既にtask-notify用に設定済みなら追加不要(同一Supabaseプロジェクトのため共有される)
--   MAIL_IMAP_HOST / MAIL_IMAP_USER / MAIL_ALERT_DISCORD_USER_ID は
--   コード側にデフォルト値が入っているため、変更したい場合のみSecretsで上書きしてください。

-- ============ 状態(最後に処理したメールのUID、DM用チャンネルIDのキャッシュ) ============

create table if not exists mail_alert_state (
  key text primary key,
  value text
);
alter table mail_alert_state enable row level security;

insert into mail_alert_state (key, value) values ('last_uid', '0')
on conflict (key) do nothing;

-- ============ 設定(Edge FunctionのURLと、呼び出しの合言葉) ============
-- RLSを有効にしてポリシーを1つも作らない = アプリ側からは一切読めない。

create table if not exists mail_alert_settings (
  key text primary key,
  value text not null
);
alter table mail_alert_settings enable row level security;

insert into mail_alert_settings (key, value) values
  ('function_url', 'https://krdwyfemepbbyrteyoeb.supabase.co/functions/v1/mail-alert-check'),
  ('secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- 上のinsertで生成された合言葉を確認し、Edge FunctionのSecrets「MAIL_ALERT_SECRET」に
-- 同じ値を設定してください。確認は次のSELECTで:
--   select value from mail_alert_settings where key = 'secret';

-- ============ Edge Functionを呼ぶ関数 ============

create or replace function trigger_mail_alert_check() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from mail_alert_settings where key = 'function_url';
  select value into v_secret from mail_alert_settings where key = 'secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret)
  );
exception when others then
  -- 失敗しても他の処理に影響させない
  raise warning 'trigger_mail_alert_check failed: %', sqlerrm;
end $$;

revoke execute on function trigger_mail_alert_check() from public, anon, authenticated;

-- ============ 10分おきに実行 ============

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mail-alert-check') then
    perform cron.unschedule('mail-alert-check');
  end if;
  perform cron.schedule('mail-alert-check', '*/10 * * * *', 'select trigger_mail_alert_check()');
end $$;
