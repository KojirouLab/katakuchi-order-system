-- 美人罠の発注通知(oyster_placed)を、ちょい飲みたかはしと同じDiscordチャンネル・同じメンション
-- (カタクチ事務所PCロール)で登録する。Webhook URLはDB内でコピーするだけで、リポジトリには書かない。
insert into discord_notification_targets (store_slug, category, webhook_url, mention_role_id)
select 'bijinwana', 'oyster_placed', webhook_url, mention_role_id
from discord_notification_targets
where store_slug = 'choinomi-takahashi' and category = 'oyster_placed'
on conflict (store_slug, category) do nothing;
