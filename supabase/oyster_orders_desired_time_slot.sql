-- 宅配受付の店舗(ちょい飲みたかはしなど)向けに、着希望の時間帯を記録できるようにする。
-- 対象外の店舗(トラック配送)は常にnullのまま。
alter table oyster_orders add column if not exists desired_time_slot text;
