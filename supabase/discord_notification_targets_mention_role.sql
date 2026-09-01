-- discord_notification_targetsに、店舗ごとにメンションするDiscordロールのIDを追加。
-- 未設定(null)ならメンションなしでメッセージのみ送信する。
alter table discord_notification_targets add column if not exists mention_role_id text;
