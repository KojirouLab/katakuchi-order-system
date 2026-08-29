-- kaki_stock_out_internal の数量カラムが integer だったため、工場出庫(キロ→ケース換算、
-- 例: 1kg÷15=0.07ケース)のような小数を保存しようとすると
-- "invalid input syntax for type integer" エラーになっていた。
-- kaki_stock_in と同じ numeric 型に揃える(既存の整数値はそのまま numeric として保持される)。
alter table kaki_stock_out_internal
  alter column mixed_boxes type numeric using mixed_boxes::numeric,
  alter column s_boxes type numeric using s_boxes::numeric,
  alter column m_boxes type numeric using m_boxes::numeric;
