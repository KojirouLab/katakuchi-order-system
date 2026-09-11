-- ちょい飲みたかはしの発注は、送付先を「ちょい飲みたかはし」または「ほうりょう」から選べる。
-- 対象外の店舗は常にnull(=自店へ配送)のまま。null は「ちょい飲みたかはし」とみなす。
alter table oyster_orders add column if not exists ship_to text;
