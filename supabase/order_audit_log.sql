-- ピザの発注(pizza_orders)と卸先の発注(wholesale_orders)への変更を自動で記録する変更履歴。
-- 牡蠣在庫まわり(kaki_stock_audit_log)とは別テーブルにして、牡蠣在庫の変更履歴ページに混ざらないようにする。
-- INSERT/UPDATE/DELETEをすべてトリガーで捕捉するので、キャンセル(削除)や送り直し(上書き)の前の中身も残る。
--
-- 調査するときは例えば:
--   select changed_at, table_name, operation,
--          coalesce(new_data->>'store_name', old_data->>'store_name') as store,
--          coalesce(new_data->>'order_date', old_data->>'order_date') as order_date,
--          old_data->>'content' as before, new_data->>'content' as after
--   from order_audit_log
--   where changed_at >= now() - interval '7 days'
--   order by changed_at desc;

create table if not exists order_audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id uuid not null,
  operation text not null, -- 'INSERT' | 'UPDATE' | 'DELETE'
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz not null default now()
);

create index if not exists order_audit_log_row_idx on order_audit_log (table_name, row_id);
create index if not exists order_audit_log_changed_at_idx on order_audit_log (changed_at);

alter table order_audit_log enable row level security;
-- 読み取りはanonキー(アプリ)からも許可する。書き込みはトリガー(security definer)だけ。
drop policy if exists "order_audit_log anon select" on order_audit_log;
create policy "order_audit_log anon select" on order_audit_log for select using (true);

create or replace function order_audit_trigger() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    insert into order_audit_log (table_name, row_id, operation, new_data)
    values (tg_table_name, new.id, tg_op, to_jsonb(new));
    return new;
  elsif (tg_op = 'UPDATE') then
    insert into order_audit_log (table_name, row_id, operation, old_data, new_data)
    values (tg_table_name, new.id, tg_op, to_jsonb(old), to_jsonb(new));
    return new;
  elsif (tg_op = 'DELETE') then
    insert into order_audit_log (table_name, row_id, operation, old_data)
    values (tg_table_name, old.id, tg_op, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists pizza_orders_audit on pizza_orders;
create trigger pizza_orders_audit
  after insert or update or delete on pizza_orders
  for each row execute function order_audit_trigger();

drop trigger if exists wholesale_orders_audit on wholesale_orders;
create trigger wholesale_orders_audit
  after insert or update or delete on wholesale_orders
  for each row execute function order_audit_trigger();
