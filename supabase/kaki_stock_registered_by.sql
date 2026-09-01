-- 牡蠣の入庫・出庫を「誰が登録したか」を記録できるようにする。
-- アプリ側はスタッフ名のプルダウン(STAFF_NAMES)から選ばせる想定。未入力(null)も許容する。
alter table kaki_stock_in add column if not exists registered_by text;
alter table kaki_stock_out_internal add column if not exists registered_by text;
