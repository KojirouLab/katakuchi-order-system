-- ちょい飲みたかはしの発注確定通知(oyster_placed)に「カタクチ事務所PC」ロールのメンションを付ける。
update discord_notification_targets
set mention_role_id = '1519224869118541895'
where store_slug = 'choinomi-takahashi' and category = 'oyster_placed';
