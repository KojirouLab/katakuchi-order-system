-- 社内タスク管理(/tasks)用のテーブルです。
-- 発注システムと同じSupabaseプロジェクトの SQL Editor に、この内容を貼り付けて実行してください。
-- (発注システムの pizza_orders / oyster_orders などとは別のテーブルなので、影響はありません。)

create extension if not exists pgcrypto;

create table if not exists task_employees (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  pin_hash text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists task_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  assignee_id uuid not null references task_employees(id),
  requester_id uuid not null references task_employees(id),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  due_date date,
  report text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references task_items(id) on delete cascade,
  employee_id uuid not null references task_employees(id),
  action text not null check (action in ('created', 'status_changed', 'report', 'comment')),
  body text,
  created_at timestamptz not null default now()
);

-- 名前の一覧(PINは含めない)。ログイン画面の名前選択・タスク依頼先の選択に使う。
create or replace view task_employees_public as
  select id, name, is_admin from task_employees;

-- 名前+PINでログインする。PINそのものはクライアントに一切返さない・テーブルからも直接は読めない。
create or replace function task_login(p_name text, p_pin text)
returns table (employee_id uuid, name text, is_admin boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select e.id, e.name, e.is_admin
  from task_employees e
  where e.name = p_name
    and e.pin_hash = crypt(p_pin, e.pin_hash);
end;
$$;

alter table task_employees enable row level security;
alter table task_items enable row level security;
alter table task_logs enable row level security;

-- task_employees テーブル自体への直接アクセスは禁止(PINを守るため)。
-- 名前一覧は task_employees_public ビュー、ログインは task_login() 関数からのみアクセスできる。
grant select on task_employees_public to anon;
grant execute on function task_login(text, text) to anon;

-- タスク本体は、アプリ内で名前+PINによる本人確認を行っている前提で、
-- anonキーからの読み書きを許可しています(社内10人程度での利用を想定した簡易的な仕組みです)。
create policy "task_items anon select" on task_items for select using (true);
create policy "task_items anon insert" on task_items for insert with check (true);
create policy "task_items anon update" on task_items for update using (true);

create policy "task_logs anon select" on task_logs for select using (true);
create policy "task_logs anon insert" on task_logs for insert with check (true);

-- ここから先は最初の1回だけ実行してください(サンプルの管理者アカウント)。
-- 名前とPINは自由に書き換えてください。他の社員は同じ書き方で追加できます(SETUP.md参照)。
insert into task_employees (name, pin_hash, is_admin) values
  ('管理者', crypt('0000', gen_salt('bf')), true)
on conflict (name) do nothing;
