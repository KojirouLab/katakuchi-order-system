-- 牡蠣在庫まわりのテーブル(入庫・手動出庫・発注)への変更を自動で記録する監査ログ。
-- 「システム上の在庫と実在庫が合わない」といった調査を後日できるように、
-- INSERT/UPDATE/DELETEをすべてトリガーで捕捉する(アプリ側のコード変更に依存しない)。
--
-- 対象テーブル:
--   kaki_stock_in            (入庫)
--   kaki_stock_out_internal  (手動出庫: 自社使用・店舗配達分の仕入れ先記録)
--   oyster_orders            (牡蠣の発注。自動計算される出荷数のもと)
--
-- 調査するときは例えば:
--   select * from kaki_stock_audit_log
--   where table_name = 'kaki_stock_out_internal' and row_id = '対象のid'
--   order by changed_at;
--
--   select * from kaki_stock_audit_log
--   where changed_at >= '2026-08-17' and changed_at < '2026-08-19'
--   order by changed_at;

create table if not exists kaki_stock_audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id uuid not null,
  operation text not null, -- 'INSERT' | 'UPDATE' | 'DELETE'
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz not null default now()
);

create index if not exists kaki_stock_audit_log_row_idx on kaki_stock_audit_log (table_name, row_id);
create index if not exists kaki_stock_audit_log_changed_at_idx on kaki_stock_audit_log (changed_at);

alter table kaki_stock_audit_log enable row level security;
-- 読み取りはanonキー(アプリ)からも許可し、在庫管理ページ内の変更履歴ビュー(?stock_audit=1)
-- から日付を指定して閲覧できるようにする。insert/update/delete用のポリシーは意図的に作らない
-- (トリガー関数はsecurity definerで書き込むため、クライアントから直接このテーブルへの書き込みは不可)。
create policy "kaki_stock_audit_log anon select" on kaki_stock_audit_log for select using (true);

create or replace function kaki_stock_audit_trigger() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    insert into kaki_stock_audit_log (table_name, row_id, operation, new_data)
    values (tg_table_name, new.id, tg_op, to_jsonb(new));
    return new;
  elsif (tg_op = 'UPDATE') then
    insert into kaki_stock_audit_log (table_name, row_id, operation, old_data, new_data)
    values (tg_table_name, new.id, tg_op, to_jsonb(old), to_jsonb(new));
    return new;
  elsif (tg_op = 'DELETE') then
    insert into kaki_stock_audit_log (table_name, row_id, operation, old_data)
    values (tg_table_name, old.id, tg_op, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists kaki_stock_in_audit on kaki_stock_in;
create trigger kaki_stock_in_audit
  after insert or update or delete on kaki_stock_in
  for each row execute function kaki_stock_audit_trigger();

drop trigger if exists kaki_stock_out_internal_audit on kaki_stock_out_internal;
create trigger kaki_stock_out_internal_audit
  after insert or update or delete on kaki_stock_out_internal
  for each row execute function kaki_stock_audit_trigger();

drop trigger if exists oyster_orders_audit on oyster_orders;
create trigger oyster_orders_audit
  after insert or update or delete on oyster_orders
  for each row execute function kaki_stock_audit_trigger();
