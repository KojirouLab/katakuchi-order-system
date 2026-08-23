-- 牡蠣受注(oyster_orders)にも、ピザ受注(pizza_orders)と同じ「確認済み」フラグを追加する。
-- カタクチ商店ページで牡蠣の発注(通常店舗・宅配発送=美人罠など)を確認済みにできるようにするため。
alter table oyster_orders add column if not exists confirmed_at timestamptz;
