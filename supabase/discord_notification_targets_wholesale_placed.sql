-- 卸先(22件)の発注通知(wholesale_placed)を、ちょい飲みたかはしの発注通知と同じDiscordチャンネル・
-- 同じメンション(カタクチ事務所PCロール)で登録する。Webhook URLはDB内でコピーするだけで、
-- このファイルやリポジトリには書かない。
insert into discord_notification_targets (store_slug, category, webhook_url, mention_role_id)
select s.slug, 'wholesale_placed', t.webhook_url, t.mention_role_id
from discord_notification_targets t
cross join unnest(array['w-houryou','w-eda-hiroki','w-kainuma','w-ashimoka','w-eda-kitasendai','w-tasso','w-inthesoup','w-izukogen','w-osteria32','w-soma','w-shunrakuzen','w-yourgurt','w-tsurumai','w-acecafe','w-okano','w-tokai','w-ito','w-kanesue','w-nicolo','w-romero','w-patata','w-pierrot']) as s(slug)
where t.store_slug = 'choinomi-takahashi' and t.category = 'oyster_placed'
on conflict (store_slug, category) do nothing;
