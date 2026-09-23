const STORAGE_KEY = 'katakuchi_task_user';
const STATUS_LABELS = { todo: '未着手', in_progress: '進行中', done: '完了' };
const STATUS_CLASS = { todo: 'status-todo', in_progress: 'status-progress', done: 'status-done' };
const PRIORITY_LABELS = { low: '低', normal: '中', high: '高' };
const PRIORITY_CLASS = { low: 'priority-low', normal: 'priority-normal', high: 'priority-high' };

let currentUser = null;
let employees = [];
let activeTab = 'mine';
let statusFilter = 'all';
let employeeFilter = 'all';
let tasksCache = { mine: [], requested: [], all: [] };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt)) return '-';
  return dt.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateTime(d) {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt)) return '-';
  return dt.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function isOverdue(task) {
  return !!task.due_date && task.status !== 'done' && task.due_date < todayStr();
}

let toastTimer = null;
function showToast(message, isError) {
  const el = $('#toast');
  el.textContent = message;
  el.className = isError ? 'toast error show' : 'toast show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---- 初期化 ----

async function init() {
  bindStaticEvents();
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
    } catch (e) {
      currentUser = null;
    }
  }
  if (currentUser) {
    await enterApp();
  } else {
    await showLoginScreen();
  }
}

async function showLoginScreen() {
  $('#screen-app').classList.add('hidden');
  $('#screen-login').classList.remove('hidden');
  $('#fab-new-task').classList.add('hidden');
  const select = $('#login-name');
  select.innerHTML = '<option value="">読み込み中...</option>';
  try {
    const list = await fetchEmployeeNames();
    if (list.length === 0) {
      select.innerHTML = '<option value="">(従業員が未登録です)</option>';
      return;
    }
    select.innerHTML = list.map((e) => `<option value="${escapeHtml(e.name)}">${escapeHtml(e.name)}</option>`).join('');
  } catch (e) {
    select.innerHTML = '<option value="">読み込みに失敗しました</option>';
    showToast('従業員一覧の取得に失敗しました: ' + e.message, true);
  }
}

async function enterApp() {
  $('#screen-login').classList.add('hidden');
  $('#screen-app').classList.remove('hidden');
  $('#fab-new-task').classList.remove('hidden');
  $('#user-name').textContent = currentUser.name;
  $('#user-badge').classList.toggle('hidden', !currentUser.isAdmin);
  $('#tab-all').classList.toggle('hidden', !currentUser.isAdmin);

  try {
    employees = await fetchEmployeeNames();
  } catch (e) {
    showToast('従業員一覧の取得に失敗しました: ' + e.message, true);
    employees = [];
  }
  const filterSelect = $('#employee-filter');
  filterSelect.innerHTML = '<option value="all">全員</option>' + employees.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');

  activeTab = 'mine';
  statusFilter = 'all';
  employeeFilter = 'all';
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === activeTab));
  $$('.chip').forEach((c) => c.classList.toggle('active', c.dataset.status === 'all'));
  $('#employee-filter').classList.add('hidden');

  await loadTasksForActiveTab();
}

function logout() {
  localStorage.removeItem(STORAGE_KEY);
  currentUser = null;
  tasksCache = { mine: [], requested: [], all: [] };
  showLoginScreen();
}

// ---- イベント登録(固定要素のみ・1回だけ) ----

function bindStaticEvents() {
  $('#login-submit').addEventListener('click', handleLogin);
  $('#login-pin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
  $('#logout-btn').addEventListener('click', logout);

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      if (tab.classList.contains('hidden')) return;
      activeTab = tab.dataset.tab;
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('#employee-filter').classList.toggle('hidden', activeTab !== 'all');
      statusFilter = 'all';
      $$('.chip').forEach((c) => c.classList.toggle('active', c.dataset.status === 'all'));
      await loadTasksForActiveTab();
    });
  });

  $$('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      statusFilter = chip.dataset.status;
      $$('.chip').forEach((c) => c.classList.toggle('active', c === chip));
      renderTaskList();
    });
  });

  $('#employee-filter').addEventListener('change', (e) => {
    employeeFilter = e.target.value;
    renderTaskList();
  });

  $('#fab-new-task').addEventListener('click', openNewTaskModal);
  $('#new-task-cancel').addEventListener('click', closeNewTaskModal);
  $('#new-task-submit').addEventListener('click', submitNewTask);
  $('#modal-new-task').addEventListener('click', (e) => {
    if (e.target.id === 'modal-new-task') closeNewTaskModal();
  });

  $('#detail-close').addEventListener('click', closeTaskDetail);
  $('#modal-task-detail').addEventListener('click', (e) => {
    if (e.target.id === 'modal-task-detail') closeTaskDetail();
  });

  $('#task-list').addEventListener('click', (e) => {
    const card = e.target.closest('.task-card');
    if (card) openTaskDetail(card.dataset.id);
  });
}

async function handleLogin() {
  const name = $('#login-name').value;
  const pin = $('#login-pin').value.trim();
  const errEl = $('#login-error');
  errEl.textContent = '';
  if (!name || !pin) {
    errEl.textContent = '名前とPINを入力してください';
    return;
  }
  const btn = $('#login-submit');
  btn.disabled = true;
  btn.textContent = 'ログイン中...';
  try {
    const user = await loginEmployee(name, pin);
    if (!user) {
      errEl.textContent = '名前またはPINが違います';
      return;
    }
    currentUser = user;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    $('#login-pin').value = '';
    await enterApp();
  } catch (e) {
    errEl.textContent = 'ログインに失敗しました: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'ログイン';
  }
}

// ---- タスク一覧 ----

async function loadTasksForActiveTab() {
  const listEl = $('#task-list');
  listEl.innerHTML = '<p class="hint center">読み込み中...</p>';
  try {
    if (activeTab === 'mine') tasksCache.mine = await fetchMyTasks(currentUser.id);
    else if (activeTab === 'requested') tasksCache.requested = await fetchRequestedTasks(currentUser.id);
    else if (activeTab === 'all') tasksCache.all = await fetchAllTasks();
  } catch (e) {
    listEl.innerHTML = `<p class="hint center">読み込みに失敗しました: ${escapeHtml(e.message)}</p>`;
    return;
  }
  renderTaskList();
}

function currentTabData() {
  let data = tasksCache[activeTab] || [];
  if (activeTab === 'all' && employeeFilter !== 'all') {
    data = data.filter((t) => t.assignee_id === employeeFilter);
  }
  return data;
}

function renderTaskList() {
  const data = currentTabData();

  const counts = { all: data.length, todo: 0, in_progress: 0, done: 0 };
  data.forEach((t) => counts[t.status]++);
  $$('.chip').forEach((c) => {
    const key = c.dataset.status;
    const label = key === 'all' ? 'すべて' : STATUS_LABELS[key];
    c.textContent = `${label}(${counts[key]})`;
  });

  const filtered = statusFilter === 'all' ? data : data.filter((t) => t.status === statusFilter);

  const listEl = $('#task-list');
  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="hint center">タスクはありません</p>';
    return;
  }
  listEl.innerHTML = filtered.map((t) => renderTaskCard(t)).join('');
}

function renderTaskCard(task) {
  const overdue = isOverdue(task);
  const sub =
    activeTab === 'mine'
      ? `依頼者: ${escapeHtml(task.requester?.name || '-')}`
      : activeTab === 'requested'
      ? `担当: ${escapeHtml(task.assignee?.name || '-')}`
      : `担当: ${escapeHtml(task.assignee?.name || '-')} / 依頼者: ${escapeHtml(task.requester?.name || '-')}`;
  return `
    <div class="task-card" data-id="${task.id}">
      <div class="task-card-top">
        <span class="badge ${STATUS_CLASS[task.status]}">${STATUS_LABELS[task.status]}</span>
        <span class="badge ${PRIORITY_CLASS[task.priority]}">優先度: ${PRIORITY_LABELS[task.priority]}</span>
        ${overdue ? '<span class="badge status-overdue">期限超過</span>' : ''}
      </div>
      <div class="task-card-title">${escapeHtml(task.title)}</div>
      <div class="task-card-sub">${sub}</div>
      <div class="task-card-due ${overdue ? 'overdue' : ''}">期限: ${formatDate(task.due_date)}</div>
    </div>
  `;
}

// ---- 新規タスク依頼 ----

function openNewTaskModal() {
  const select = $('#new-task-assignee');
  select.innerHTML = employees.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  $('#new-task-title').value = '';
  $('#new-task-description').value = '';
  $('#new-task-due').value = '';
  $('#new-task-priority').value = 'normal';
  $('#new-task-error').textContent = '';
  $('#modal-new-task').classList.remove('hidden');
}

function closeNewTaskModal() {
  $('#modal-new-task').classList.add('hidden');
}

async function submitNewTask() {
  const assigneeId = $('#new-task-assignee').value;
  const title = $('#new-task-title').value.trim();
  const description = $('#new-task-description').value.trim();
  const dueDate = $('#new-task-due').value;
  const priority = $('#new-task-priority').value;
  const errEl = $('#new-task-error');

  if (!assigneeId || !title) {
    errEl.textContent = '依頼先とタイトルは必須です';
    return;
  }

  const btn = $('#new-task-submit');
  btn.disabled = true;
  try {
    await createTask({ title, description, assigneeId, requesterId: currentUser.id, dueDate, priority });
    closeNewTaskModal();
    showToast('タスクを依頼しました');
    await loadTasksForActiveTab();
  } catch (e) {
    errEl.textContent = '依頼に失敗しました: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

// ---- タスク詳細 ----

let detailTaskId = null;

function findTaskInCache(id) {
  return tasksCache.mine.find((t) => t.id === id) || tasksCache.requested.find((t) => t.id === id) || tasksCache.all.find((t) => t.id === id);
}

function updateTaskInCaches(updated) {
  ['mine', 'requested', 'all'].forEach((key) => {
    const idx = tasksCache[key].findIndex((t) => t.id === updated.id);
    if (idx !== -1) tasksCache[key][idx] = updated;
  });
}

async function openTaskDetail(id) {
  const task = findTaskInCache(id);
  if (!task) return;
  detailTaskId = id;
  $('#modal-task-detail').classList.remove('hidden');
  $('#detail-body').innerHTML = '<p class="hint center">読み込み中...</p>';
  let logs = [];
  try {
    logs = await fetchTaskLogs(id);
  } catch (e) {
    showToast('履歴の取得に失敗しました: ' + e.message, true);
  }
  renderTaskDetail(task, logs);
}

function closeTaskDetail() {
  $('#modal-task-detail').classList.add('hidden');
  detailTaskId = null;
}

function canChangeStatus(task) {
  return currentUser.isAdmin || currentUser.id === task.assignee_id;
}

function logLine(log) {
  const who = escapeHtml(log.employee?.name || '-');
  const when = formatDateTime(log.created_at);
  let text = '';
  if (log.action === 'created') text = `${who} さんがタスクを作成しました`;
  else if (log.action === 'status_changed') text = `${who} さんがステータスを「${STATUS_LABELS[log.body] || log.body}」に変更しました`;
  else if (log.action === 'report') text = `${who} さんが完了を報告しました`;
  else if (log.action === 'comment') text = `${who} さんのコメント`;
  const body = log.action === 'report' || log.action === 'comment' ? (log.body ? `<div class="timeline-body">${escapeHtml(log.body)}</div>` : '') : '';
  return `<div class="timeline-item"><div class="timeline-head"><span>${text}</span><span class="timeline-time">${when}</span></div>${body}</div>`;
}

function renderTaskDetail(task, logs) {
  const overdue = isOverdue(task);
  let actionsHtml = '';
  if (canChangeStatus(task)) {
    if (task.status === 'todo') {
      actionsHtml = `<button class="btn primary" id="btn-start">着手する</button>`;
    } else if (task.status === 'in_progress') {
      actionsHtml = `
        <div class="report-form">
          <label>完了報告</label>
          <textarea id="report-input" rows="3" placeholder="作業内容や結果を記入してください"></textarea>
          <button class="btn primary" id="btn-done">完了として報告する</button>
        </div>
        <button class="btn ghost small" id="btn-back-todo">未着手に戻す</button>
      `;
    } else if (task.status === 'done') {
      actionsHtml = `<button class="btn ghost small" id="btn-reopen">やり直す(未着手に戻す)</button>`;
    }
  }

  $('#detail-body').innerHTML = `
    <div class="detail-meta">
      <span class="badge ${STATUS_CLASS[task.status]}">${STATUS_LABELS[task.status]}</span>
      <span class="badge ${PRIORITY_CLASS[task.priority]}">優先度: ${PRIORITY_LABELS[task.priority]}</span>
      ${overdue ? '<span class="badge status-overdue">期限超過</span>' : ''}
    </div>
    <h2 class="detail-title">${escapeHtml(task.title)}</h2>
    <p class="detail-desc">${task.description ? escapeHtml(task.description) : '(詳細なし)'}</p>
    <div class="detail-grid">
      <div><span class="label">担当</span>${escapeHtml(task.assignee?.name || '-')}</div>
      <div><span class="label">依頼者</span>${escapeHtml(task.requester?.name || '-')}</div>
      <div><span class="label">期限</span>${formatDate(task.due_date)}</div>
      <div><span class="label">依頼日</span>${formatDate(task.created_at)}</div>
    </div>
    ${task.report ? `<div class="report-box"><span class="label">完了報告</span><p>${escapeHtml(task.report)}</p></div>` : ''}
    <div class="detail-actions">${actionsHtml}</div>
    <div class="detail-comment">
      <textarea id="detail-comment-input" rows="2" placeholder="コメントを追加"></textarea>
      <button class="btn small" id="detail-comment-submit">コメントする</button>
    </div>
    <div class="detail-timeline">${logs.map(logLine).join('') || '<p class="hint">履歴はありません</p>'}</div>
  `;

  const startBtn = $('#btn-start');
  if (startBtn) startBtn.addEventListener('click', () => changeStatus('in_progress'));

  const doneBtn = $('#btn-done');
  if (doneBtn)
    doneBtn.addEventListener('click', () => {
      const report = $('#report-input').value.trim();
      if (!report) {
        showToast('完了報告を入力してください', true);
        return;
      }
      changeStatus('done', report);
    });

  const backBtn = $('#btn-back-todo');
  if (backBtn) backBtn.addEventListener('click', () => changeStatus('todo'));

  const reopenBtn = $('#btn-reopen');
  if (reopenBtn) reopenBtn.addEventListener('click', () => changeStatus('todo'));

  $('#detail-comment-submit').addEventListener('click', submitComment);
}

async function changeStatus(status, report) {
  if (!detailTaskId) return;
  try {
    const updated = await updateTaskStatus({ taskId: detailTaskId, status, employeeId: currentUser.id, report });
    updateTaskInCaches(updated);
    renderTaskList();
    const logs = await fetchTaskLogs(detailTaskId);
    renderTaskDetail(updated, logs);
    showToast('更新しました');
  } catch (e) {
    showToast('更新に失敗しました: ' + e.message, true);
  }
}

async function submitComment() {
  const input = $('#detail-comment-input');
  const body = input.value.trim();
  if (!body || !detailTaskId) return;
  try {
    await addTaskLog({ taskId: detailTaskId, employeeId: currentUser.id, action: 'comment', body });
    input.value = '';
    const task = findTaskInCache(detailTaskId);
    const logs = await fetchTaskLogs(detailTaskId);
    renderTaskDetail(task, logs);
  } catch (e) {
    showToast('コメントの投稿に失敗しました: ' + e.message, true);
  }
}

init();
