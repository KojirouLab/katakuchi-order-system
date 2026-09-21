// 発注システムと同じSupabaseプロジェクトを使い回しています(URL/keyは共通)。
// (anon keyは公開されても問題ない設計です。アクセス制御は名前+PINでのログインで行っています。)
const SUPABASE_URL = 'https://krdwyfemepbbyrteyoeb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ouoTLzgoCxmyMf7D_kWdzQ_YTEXc2tk';

let sb = null;
try {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.error('Supabase client init failed', e);
}

function assertClient() {
  if (!sb) throw new Error('Supabase未設定です。tasks/storage.js の SUPABASE_URL / SUPABASE_ANON_KEY を設定してください。');
}

// ---- ログイン ----

async function fetchEmployeeNames() {
  assertClient();
  const { data, error } = await sb.from('task_employees_public').select('*').order('name');
  if (error) throw error;
  return data || [];
}

async function loginEmployee(name, pin) {
  assertClient();
  const { data, error } = await sb.rpc('task_login', { p_name: name, p_pin: pin });
  if (error) throw error;
  if (!data || data.length === 0) return null;
  const row = data[0];
  return { id: row.employee_id, name: row.name, isAdmin: row.is_admin };
}

// ---- タスク ----

const TASK_SELECT = '*, assignee:assignee_id(id,name), requester:requester_id(id,name)';

async function fetchMyTasks(employeeId) {
  assertClient();
  const { data, error } = await sb
    .from('task_items')
    .select(TASK_SELECT)
    .eq('assignee_id', employeeId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function fetchRequestedTasks(employeeId) {
  assertClient();
  const { data, error } = await sb
    .from('task_items')
    .select(TASK_SELECT)
    .eq('requester_id', employeeId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function fetchAllTasks() {
  assertClient();
  const { data, error } = await sb
    .from('task_items')
    .select(TASK_SELECT)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createTask({ title, description, assigneeId, requesterId, dueDate, priority }) {
  assertClient();
  const { data, error } = await sb
    .from('task_items')
    .insert({
      title,
      description: description || '',
      assignee_id: assigneeId,
      requester_id: requesterId,
      due_date: dueDate || null,
      priority: priority || 'normal',
    })
    .select(TASK_SELECT)
    .single();
  if (error) throw error;
  await addTaskLog({ taskId: data.id, employeeId: requesterId, action: 'created', body: null });
  return data;
}

async function updateTaskStatus({ taskId, status, employeeId, report }) {
  assertClient();
  const patch = { status, updated_at: new Date().toISOString() };
  if (status === 'done') patch.report = report || '';
  const { data, error } = await sb.from('task_items').update(patch).eq('id', taskId).select(TASK_SELECT);
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('更新できませんでした(権限設定が反映されていない可能性があります)');
  await addTaskLog({
    taskId,
    employeeId,
    action: status === 'done' ? 'report' : 'status_changed',
    body: status === 'done' ? report || '' : status,
  });
  return data[0];
}

async function addTaskLog({ taskId, employeeId, action, body }) {
  assertClient();
  const { error } = await sb.from('task_logs').insert({
    task_id: taskId,
    employee_id: employeeId,
    action,
    body: body ?? null,
  });
  if (error) throw error;
}

async function fetchTaskLogs(taskId) {
  assertClient();
  const { data, error } = await sb
    .from('task_logs')
    .select('*, employee:employee_id(id,name)')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}
