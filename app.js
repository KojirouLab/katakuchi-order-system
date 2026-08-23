const STORES = [
  { slug: 'bansui', name: '晩翠通り店', categories: ['pizza'] },
  { slug: 'pizzarokko', name: 'ピザろっこ', categories: ['pizza'] },
  { slug: 'asakusa', name: '浅草店', categories: ['pizza'] },
  { slug: 'kaki-rokko', name: '牡蠣小屋ろっこ', categories: ['oyster', 'pizza'] },
  { slug: 'kaki-mouikko', name: '牡蠣小屋もういっこ', categories: ['oyster'] },
  { slug: 'kaki-higashiichi', name: '牡蠣小屋東一店', categories: ['oyster'] },
  { slug: 'kai-hakko', name: '貝小屋はっこ', categories: ['oyster'] },
  { slug: 'choinomi-takahashi', name: 'ちょい飲みたかはし', categories: ['oyster'] },
  // shipping: 'courier' の店舗は配送トラックには載らず宅配便で発送するため、
  // 牡蠣受注の集計ではトラック積み込み用の「配送分」とは別に「宅配発送分」として扱う。
  { slug: 'bijinwana', name: '美人罠', categories: ['oyster'], shipping: 'courier' },
];

const PIZZA_STORES = STORES.filter((s) => s.categories.includes('pizza'));
const OYSTER_STORES = STORES.filter((s) => s.categories.includes('oyster'));
const STORES_BY_CATEGORY = { pizza: PIZZA_STORES, oyster: OYSTER_STORES };
// 宅配便発送(トラック配送に載らない)店舗のslug一覧。牡蠣在庫管理・受注集計のどちらでも、
// 「配送」扱いの集計から除いて「宅配発送」として別枠にするために使う。
const COURIER_STORE_SLUGS = new Set(STORES.filter((s) => s.shipping === 'courier').map((s) => s.slug));

const ADMIN_SHOPS = {
  katakuchi: { name: 'カタクチ商店', categories: ['pizza'] },
  'kaki-juchu': { name: '牡蠣受注店', categories: ['oyster'] },
  'haiso-juchu': { name: '配送受注店', categories: ['pizza', 'oyster'] },
};

// 混合サイズの発注を一時休止する開始日(この日付以降の配達分は混合を選択不可にする)。再開時はこの定数と関連ロジックを削除すること。
const MIXED_SUSPENDED_FROM = '2026-08-04';

// 日本の祝日(年ごとに更新が必要。内閣府 https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html を参照)
const JP_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29',
  '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11',
  '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22',
  '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19', '2027-08-11',
  '2027-09-20', '2027-09-23', '2027-10-11', '2027-11-03', '2027-11-23',
]);

function isBusinessDay(d) {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const tz = d.getTimezoneOffset() * 60000;
  const dateStr = new Date(d.getTime() - tz).toISOString().slice(0, 10);
  return !JP_HOLIDAYS.has(dateStr);
}

function findStore(slug) {
  return STORES.find((s) => s.slug === slug) || null;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// ExcelJSはこのページ(牡蠣在庫管理の帳票出力)でしか使わないため、通常は読み込まず
// ボタンが押された時に初めてCDNから取り込む(他のページ・店舗担当者の読み込みを遅くしないため)。
let excelJsLoadPromise = null;
function loadExcelJs() {
  if (window.ExcelJS) return Promise.resolve();
  if (excelJsLoadPromise) return excelJsLoadPromise;
  excelJsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('ExcelJSの読み込みに失敗しました'));
    document.head.appendChild(script);
  });
  return excelJsLoadPromise;
}

function todayStr() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function formatDateJp(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`;
}

function formatDateTimeJp(isoString) {
  const d = new Date(isoString);
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function orderDeadline(dateStr, category) {
  const def = PRODUCT_DEFS[category];
  const d = new Date(dateStr + 'T00:00:00');
  let remaining = def.deadlineDaysBefore || 1;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    if (!def.skipNonBusinessDays || isBusinessDay(d)) {
      remaining--;
    }
  }
  d.setHours(def.deadlineHour, 0, 0, 0);
  return d;
}

function isPastDeadline(dateStr, category) {
  return new Date() >= orderDeadline(dateStr, category);
}

function formatDeadlineJp(dateStr, category) {
  const d = orderDeadline(dateStr, category);
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w}) ${String(d.getHours()).padStart(2, '0')}:00`;
}

function qtyOptionsHtml(max = 10) {
  let html = '';
  for (let i = 0; i <= max; i++) {
    html += `<option value="${i}">${i}</option>`;
  }
  return html;
}

function nextDateStr(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

// 締切をまだ過ぎていない最短の発注可能日を返す(今日が締切済みなら翌日以降を探す)。
function earliestOrderableDate(category) {
  let d = todayStr();
  for (let i = 0; i < 30 && isPastDeadline(d, category); i++) {
    d = nextDateStr(d);
  }
  return d;
}

// 商品カテゴリごとの入力欄・保存/取得ロジックの定義。pizzaは自由記述のcontent、oysterはケース数の3項目。
const PRODUCT_DEFS = {
  pizza: {
    label: 'ピザ',
    deadlineHour: 12,
    deadlineDaysBefore: 2,
    skipNonBusinessDays: true,
    deadlineLabel: '2営業日前(土日祝を除く) 12:00',
    fieldsHtml: (id) => `
      <label class="checkbox-label">
        <input type="checkbox" id="${id}-noOrder">
        この日は発注なし
      </label>
      <div class="field">
        <label for="${id}-content">注文内容(商品名・個数・キロ数など自由に記入)</label>
        <textarea id="${id}-content" rows="6" placeholder="例) マルゲリータ 3枚&#10;シーフード 2枚"></textarea>
      </div>`,
    readValue: (id) => {
      const noOrder = document.getElementById(`${id}-noOrder`).checked;
      const content = document.getElementById(`${id}-content`).value.trim();
      return { content: noOrder ? '発注なし' : content };
    },
    fillValue: (id, row) => {
      const isNoOrder = !!(row && row.content === '発注なし');
      document.getElementById(`${id}-noOrder`).checked = isNoOrder;
      document.getElementById(`${id}-content`).value = row && !isNoOrder ? row.content : '';
    },
    clearValue: (id) => {
      document.getElementById(`${id}-noOrder`).checked = false;
      document.getElementById(`${id}-content`).value = '';
    },
    applyExtraFieldState: (id) => {
      const noOrder = document.getElementById(`${id}-noOrder`).checked;
      const el = document.getElementById(`${id}-content`);
      if (noOrder) {
        el.disabled = true;
        el.value = '';
      }
    },
    hasValue: (row) => !!(row && row.content && row.content.trim()),
    recentText: (row) => {
      const content = escapeHtml(row.content).replace(/\n/g, '<br>');
      const status = row.confirmed_at
        ? `<span class="confirm-badge confirmed">✓ カタクチ商店 確認済み(${formatDateTimeJp(row.confirmed_at)})</span>`
        : `<span class="confirm-badge pending">未確認</span>`;
      return `${status}<br>${content}`;
    },
    fetchOne: fetchPizzaOrder,
    save: (base, values) => savePizzaOrder({ ...base, ...values }),
    fetchRecent: fetchPizzaOrdersByStore,
    fetchRange: fetchPizzaOrdersRange,
    del: deletePizzaOrder,
  },
  oyster: {
    label: '牡蠣',
    clearAfterSubmit: true,
    deadlineHour: 6,
    deadlineDaysBefore: 1,
    skipNonBusinessDays: false,
    deadlineLabel: '前日 6:00',
    fieldsHtml: (id) => `
      <p class="hint" style="margin:-4px 0 10px;">1ケース=15kg</p>
      <label class="checkbox-label">
        <input type="checkbox" id="${id}-noOrder">
        この日は発注なし
      </label>
      <p id="${id}-mixed-suspended-msg" class="deadline-msg" style="display:none">${formatDateJp(
        MIXED_SUSPENDED_FROM
      )}配送分より、混合サイズの発注を一時休止しています。</p>
      <div class="field-row">
        <div class="field">
          <label for="${id}-mixed">混合(ケース)</label>
          <select id="${id}-mixed">${qtyOptionsHtml()}</select>
          <div class="field-kg" id="${id}-mixed-kg">0kg</div>
        </div>
        <div class="field">
          <label for="${id}-s">Sサイズ(ケース)</label>
          <select id="${id}-s">${qtyOptionsHtml()}</select>
          <div class="field-kg" id="${id}-s-kg">0kg</div>
        </div>
        <div class="field">
          <label for="${id}-m">Mサイズ(ケース)</label>
          <select id="${id}-m">${qtyOptionsHtml()}</select>
          <div class="field-kg" id="${id}-m-kg">0kg</div>
        </div>
      </div>`,
    readValue: (id) => {
      let noOrder = document.getElementById(`${id}-noOrder`).checked;
      const mixedBoxes = noOrder ? 0 : Number(document.getElementById(`${id}-mixed`).value) || 0;
      const sBoxes = noOrder ? 0 : Number(document.getElementById(`${id}-s`).value) || 0;
      const mBoxes = noOrder ? 0 : Number(document.getElementById(`${id}-m`).value) || 0;
      if (!noOrder && mixedBoxes === 0 && sBoxes === 0 && mBoxes === 0) noOrder = true;
      return { mixedBoxes, sBoxes, mBoxes, noOrder };
    },
    fillValue: (id, row) => {
      document.getElementById(`${id}-noOrder`).checked = !!(row && row.no_order);
      document.getElementById(`${id}-mixed`).value = row ? row.mixed_boxes : 0;
      document.getElementById(`${id}-s`).value = row ? row.s_boxes : 0;
      document.getElementById(`${id}-m`).value = row ? row.m_boxes : 0;
    },
    clearValue: (id) => {
      document.getElementById(`${id}-noOrder`).checked = false;
      document.getElementById(`${id}-mixed`).value = 0;
      document.getElementById(`${id}-s`).value = 0;
      document.getElementById(`${id}-m`).value = 0;
    },
    applyExtraFieldState: (id) => {
      const noOrder = document.getElementById(`${id}-noOrder`).checked;
      const dateVal = document.getElementById(`${id}-date`).value;
      const mixedSuspended = !!dateVal && dateVal >= MIXED_SUSPENDED_FROM;
      document.getElementById(`${id}-mixed-suspended-msg`).style.display = mixedSuspended ? '' : 'none';
      ['mixed', 's', 'm'].forEach((k) => {
        const el = document.getElementById(`${id}-${k}`);
        if (noOrder || (k === 'mixed' && mixedSuspended)) {
          el.disabled = true;
          el.value = 0;
        }
        const kgEl = document.getElementById(`${id}-${k}-kg`);
        kgEl.textContent = `${(Number(el.value) || 0) * 15}kg`;
      });
    },
    hasValue: (row) => !!row,
    recentText: (row) =>
      row.no_order
        ? '発注なし'
        : `混${row.mixed_boxes}ケース / S${row.s_boxes}ケース / M${row.m_boxes}ケース<span class="recent-kg">混${
            row.mixed_boxes * 15
          }kg / S${row.s_boxes * 15}kg / M${row.m_boxes * 15}kg</span>`,
    fetchOne: fetchOysterOrder,
    save: (base, values) => saveOysterOrder({ ...base, ...values }),
    fetchRecent: fetchOysterOrdersByStore,
    fetchRange: fetchOysterOrdersRange,
    del: deleteOysterOrder,
  },
};

const app = document.getElementById('app');

function route() {
  const params = new URLSearchParams(location.search);
  const storeSlug = params.get('store');
  const shopSlug = params.get('shop');
  const isParent = params.get('parent') === '1';
  const isStock = params.get('stock') === '1';
  const isStockAudit = params.get('stock_audit') === '1';
  const isAdminMenu = params.get('admin') === '1';
  if (isAdminMenu) return renderAdminMenuPage();
  if (isParent) return renderParentOrderPage();
  if (isStockAudit) return renderStockAuditPage();
  if (isStock) return renderStockPage();
  if (storeSlug) return renderOrderPage(storeSlug);
  if (shopSlug === 'custom') return renderCustomAggregatePage();
  if (shopSlug) return renderAdminPage(shopSlug);
  renderHome();
}

function renderHome() {
  const storeLinks = STORES.map(
    (s) =>
      `<li><a href="?store=${s.slug}">${escapeHtml(s.name)}(${s.categories.map((c) => PRODUCT_DEFS[c].label).join('・')})</a></li>`
  ).join('');
  app.innerHTML = `
    <div class="page">
      <h1>カタクチ商店 受発注システム</h1>
      <p class="hint">このページのリンクを各店舗・受注担当者に共有してください。URLを知っている人だけがアクセスできる運用です。</p>
      <p class="hint">発注には締切があります(商品によって締切時刻が異なります。各店舗ページをご確認ください)。</p>
      <div class="card">
        <h2>各店舗の発注</h2>
        <ul class="home-links">${storeLinks}</ul>
      </div>
      <div class="card">
        <h2>受注集計</h2>
        <ul class="home-links">
          <li><a href="?shop=katakuchi">カタクチ商店(ピザ集計)</a></li>
          <li><a href="?shop=kaki-juchu">牡蠣受注店(牡蠣集計)</a></li>
          <li><a href="?shop=haiso-juchu">配送受注店(全集計)</a></li>
          <li><a href="?shop=custom">店舗ごとの集計(店舗・期間を選択)</a></li>
        </ul>
      </div>
      <div class="card">
        <h2>管理者ページ(締切後も変更・キャンセル可)</h2>
        <p class="hint">店舗からの電話連絡などで、締切後にカタクチ商店・牡蠣受注店側が代わりに発注内容を直す場合に使います。取り扱いにご注意ください。</p>
        <ul class="home-links">
          <li><a href="?parent=1">管理者ページを開く</a></li>
        </ul>
      </div>
      <div class="card">
        <h2>牡蠣在庫管理(カタクチ商店冷凍庫)</h2>
        <p class="hint">仙台のカタクチ商店冷凍庫にある牡蠣の在庫を管理します。</p>
        <ul class="home-links">
          <li><a href="?stock=1">在庫管理ページを開く</a></li>
        </ul>
      </div>
    </div>`;
}

// 「管理メニューへ戻る」リンク。katakuchi/kaki-juchu/haiso-juchuなどのページは
// ホーム画面からも辿れる(=誰でも知り得る)ため、管理メニュー(?admin=1)から
// 遷移してきた場合(URLに ref=admin が付いている場合)だけ表示する。ホーム経由
// で来た人にまで管理メニューのURLを教えてしまわないようにするための出し分け。
function adminBackLinkHtml() {
  const params = new URLSearchParams(location.search);
  if (params.get('ref') !== 'admin') return '';
  return '<p class="admin-back-link"><a href="?admin=1">← 管理メニューへ戻る</a></p>';
}

function renderAdminMenuPage() {
  app.innerHTML = `
    <div class="page">
      <h1>管理メニュー</h1>
      <p class="hint">管理者だけが使う集計・管理ページの一覧です。URLを知っている人だけがアクセスできます。</p>
      <div class="card">
        <h2>受注集計</h2>
        <ul class="home-links">
          <li><a href="?shop=katakuchi&ref=admin">ピザ集計(カタクチ商店)</a></li>
          <li><a href="?shop=kaki-juchu&ref=admin">牡蠣集計(牡蠣受注店)</a></li>
          <li><a href="?shop=haiso-juchu&ref=admin">全集計(配送受注店)</a></li>
          <li><a href="?shop=custom&ref=admin">店舗ごとの集計(店舗・期間を選択)</a></li>
        </ul>
      </div>
      <div class="card">
        <h2>管理者ページ(締切後も変更・キャンセル可)</h2>
        <ul class="home-links">
          <li><a href="?parent=1&ref=admin">管理者ページを開く</a></li>
        </ul>
      </div>
      <div class="card">
        <h2>牡蠣在庫管理(カタクチ商店冷凍庫)</h2>
        <ul class="home-links">
          <li><a href="?stock=1&ref=admin">在庫管理ページを開く</a></li>
          <li><a href="?stock_audit=1&ref=admin">在庫の変更履歴を見る</a></li>
        </ul>
      </div>
    </div>`;
}

function renderError(msg) {
  app.innerHTML = `<div class="page"><div class="card"><p class="msg-error">${escapeHtml(msg)}</p></div></div>`;
}

async function renderOrderPage(slug) {
  const store = findStore(slug);
  if (!store) return renderError('無効なURLです。店舗担当のURLを確認してください。');

  app.innerHTML = `
    <div class="page">
      <h1>${escapeHtml(store.name)}</h1>
      <p class="hint">発注</p>
    </div>`;

  const page = app.querySelector('.page');
  store.categories.forEach((category) => mountProductSection(page, store, category));
}

function renderParentOrderPage() {
  app.innerHTML = `
    <div class="page">
      <h1>管理者ページ</h1>
      ${adminBackLinkHtml()}
      <p class="hint">締切に関係なく、どの店舗の発注でも追加・変更・キャンセルできます。取り扱いにご注意ください。</p>
      <div class="card">
        <div class="field">
          <label for="parent-store">店舗を選択</label>
          <select id="parent-store">
            <option value="">選んでください</option>
            ${STORES.map((s) => `<option value="${s.slug}">${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="parent-sections"></div>
    </div>`;

  const select = document.getElementById('parent-store');
  const sectionsEl = document.getElementById('parent-sections');

  select.addEventListener('change', () => {
    sectionsEl.innerHTML = '';
    const store = findStore(select.value);
    if (!store) return;
    store.categories.forEach((category) => mountProductSection(sectionsEl, store, category, { bypassLock: true }));
  });
}

function mountProductSection(container, store, category, options = {}) {
  const bypassLock = !!options.bypassLock;
  const def = PRODUCT_DEFS[category];
  const id = category;

  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card">
      <h2>${def.label}の発注</h2>
      <p class="hint">締切: ${def.deadlineLabel}</p>
      <div class="field">
        <label for="${id}-date">発注日</label>
        <input type="date" id="${id}-date" value="${bypassLock ? todayStr() : earliestOrderableDate(category)}">
      </div>
      <p id="${id}-deadline-msg" class="deadline-msg" style="display:none"></p>
      <div id="${id}-fields">
        ${def.fieldsHtml(id)}
        <button id="${id}-submitBtn" class="primary">この内容で発注する</button>
        <button id="${id}-cancelBtn" class="secondary" style="display:none">この日の発注をキャンセルする</button>
      </div>
      <p id="${id}-msg" class="msg"></p>
      <h3 style="margin:20px 0 12px;font-size:14px;">これまでの発注(直近10件・タップで選択)</h3>
      <div id="${id}-recent">読み込み中…</div>
    </div>`
  );

  const dateInput = document.getElementById(`${id}-date`);
  const msgEl = document.getElementById(`${id}-msg`);
  const deadlineMsgEl = document.getElementById(`${id}-deadline-msg`);
  const fieldsEl = document.getElementById(`${id}-fields`);
  const cancelBtn = document.getElementById(`${id}-cancelBtn`);
  const submitBtn = document.getElementById(`${id}-submitBtn`);
  const recentEl = document.getElementById(`${id}-recent`);
  let hasExisting = false;
  let locked = false;
  let lockReason = null; // 'deadline' | 'confirmed' | null

  function applyLockState() {
    fieldsEl.querySelectorAll('input, textarea, select').forEach((el) => {
      el.disabled = locked;
    });
    if (def.applyExtraFieldState) def.applyExtraFieldState(id);
    submitBtn.disabled = locked;
    cancelBtn.style.display = hasExisting && !locked ? '' : 'none';
    if (locked && lockReason === 'confirmed') {
      deadlineMsgEl.textContent = 'カタクチ商店が確認済みのため、この日の発注は変更できません。修正が必要な場合はカタクチ商店にご連絡ください。';
      deadlineMsgEl.style.display = '';
    } else if (locked) {
      deadlineMsgEl.textContent = `締切(${formatDeadlineJp(dateInput.value, category)})を過ぎているため、この日の発注は変更できません。`;
      deadlineMsgEl.style.display = '';
    } else {
      deadlineMsgEl.style.display = 'none';
    }
  }

  const noOrderCheckbox = document.getElementById(`${id}-noOrder`);
  if (noOrderCheckbox) {
    noOrderCheckbox.addEventListener('change', applyLockState);
  }

  if (def.applyExtraFieldState) {
    fieldsEl.querySelectorAll('input[type="number"], select').forEach((el) => {
      el.addEventListener('input', () => def.applyExtraFieldState(id));
      el.addEventListener('change', () => def.applyExtraFieldState(id));
    });
  }

  async function loadForDate() {
    msgEl.textContent = '';
    msgEl.className = 'msg';
    const date = dateInput.value;
    if (!date) return;
    try {
      const row = await def.fetchOne(store.slug, date);
      def.fillValue(id, row);
      hasExisting = def.hasValue(row);
      const isConfirmed = !!(row && row.confirmed_at);
      const deadlinePassed = isPastDeadline(date, category);
      locked = !bypassLock && (deadlinePassed || isConfirmed);
      lockReason = !bypassLock && isConfirmed ? 'confirmed' : 'deadline';
      applyLockState();
    } catch (e) {
      console.error(e);
      msgEl.textContent = '読み込みに失敗しました。通信状況を確認してください。';
      msgEl.className = 'msg msg-error';
    }
  }

  async function loadRecent() {
    try {
      const rows = await def.fetchRecent(store.slug, 10);
      if (!rows.length) {
        recentEl.innerHTML = '<p class="hint">まだ発注履歴がありません。</p>';
        return;
      }
      recentEl.innerHTML = `<ul class="recent-list">${rows
        .map(
          (r) =>
            `<li class="clickable" data-date="${r.order_date}"><span class="recent-date">${formatDateJp(
              r.order_date
            )}${
              bypassLock ? `<span class="recent-submitted">発注日時: ${formatDateTimeJp(r.updated_at)}</span>` : ''
            }</span><span class="recent-body">${def.recentText(r)}</span></li>`
        )
        .join('')}</ul>`;
      recentEl.querySelectorAll('li[data-date]').forEach((li) => {
        li.addEventListener('click', () => {
          dateInput.value = li.dataset.date;
          loadForDate();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
    } catch (e) {
      console.error(e);
      recentEl.innerHTML = '<p class="msg-error">履歴の読み込みに失敗しました。</p>';
    }
  }

  dateInput.addEventListener('change', loadForDate);

  submitBtn.addEventListener('click', async () => {
    const date = dateInput.value;
    if (!date) {
      msgEl.textContent = '発注日を選択してください。';
      msgEl.className = 'msg msg-error';
      return;
    }
    if (locked) {
      msgEl.textContent =
        lockReason === 'confirmed'
          ? 'カタクチ商店が確認済みのため発注できません。修正が必要な場合はカタクチ商店にご連絡ください。'
          : `締切(${formatDeadlineJp(date, category)})を過ぎているため発注できません。`;
      msgEl.className = 'msg msg-error';
      return;
    }
    if (bypassLock && !confirm(`${formatDateJp(date)}の発注を保存します。よろしいですか？`)) return;
    submitBtn.disabled = true;
    msgEl.textContent = '送信中…';
    msgEl.className = 'msg';
    try {
      const values = def.readValue(id);
      await def.save({ storeSlug: store.slug, storeName: store.name, date }, values);
      msgEl.textContent = `✓ ${formatDateJp(date)}の発注を保存しました。`;
      msgEl.className = 'msg msg-success';
      hasExisting = true;
      if (def.clearAfterSubmit) def.clearValue(id);
      applyLockState();
      loadRecent();
    } catch (e) {
      console.error(e);
      msgEl.textContent = '保存に失敗しました。通信状況を確認してもう一度お試しください。';
      msgEl.className = 'msg msg-error';
    } finally {
      submitBtn.disabled = locked;
    }
  });

  cancelBtn.addEventListener('click', async () => {
    const date = dateInput.value;
    if (!date || !hasExisting || locked) return;
    if (!confirm(`${formatDateJp(date)}の発注をキャンセルします。よろしいですか？`)) return;
    cancelBtn.disabled = true;
    msgEl.textContent = 'キャンセル中…';
    msgEl.className = 'msg';
    try {
      await def.del(store.slug, date);
      def.clearValue(id);
      hasExisting = false;
      msgEl.textContent = `${formatDateJp(date)}の発注をキャンセルしました。`;
      msgEl.className = 'msg msg-success';
      applyLockState();
      loadRecent();
    } catch (e) {
      console.error(e);
      msgEl.textContent = 'キャンセルに失敗しました。通信状況を確認してもう一度お試しください。';
      msgEl.className = 'msg msg-error';
    } finally {
      cancelBtn.disabled = false;
    }
  });

  loadForDate();
  loadRecent();
}

async function renderAdminPage(slug) {
  const shop = ADMIN_SHOPS[slug];
  if (!shop) return renderError('無効なURLです。');
  const subtitle = `${shop.categories.map((c) => PRODUCT_DEFS[c].label).join('・')}受注集計`;

  app.innerHTML = `
    <div class="page wide shop-${slug}">
      <h1>${escapeHtml(shop.name)}</h1>
      ${adminBackLinkHtml()}
      <p class="hint">${subtitle}</p>
      <div class="card">
        <div class="field">
          <label>期間を選択</label>
          <p class="hint" id="rangeLabel"></p>
          <div class="calendar-header">
            <button id="rangeCalPrevBtn" class="cal-nav-btn" type="button">◀</button>
            <h2 id="rangeCalMonthLabel"></h2>
            <button id="rangeCalNextBtn" class="cal-nav-btn" type="button">▶</button>
          </div>
          <div id="rangeCalendar" class="stock-calendar range-calendar"></div>
        </div>
        ${
          slug === 'katakuchi'
            ? `<label class="checkbox-label">
                <input type="checkbox" id="showOysterToo">
                牡蠣の受注状況も表示する
              </label>`
            : ''
        }
        <button id="applyBtn" class="primary">表示</button>
        ${slug === 'katakuchi' ? '<button id="showOysterBtn" class="btn-plain" type="button">牡蠣も確認</button>' : ''}
      </div>
      <div id="summary"></div>
    </div>`;

  const rangeCalendarEl = document.getElementById('rangeCalendar');
  const rangeCalMonthLabelEl = document.getElementById('rangeCalMonthLabel');
  const rangeLabelEl = document.getElementById('rangeLabel');

  let rangeStart = todayStr();
  let rangeEnd = todayStr();
  let selectingEnd = false;
  let calMonth = new Date(`${todayStr()}T00:00:00Z`);
  calMonth.setUTCDate(1);

  function updateRangeLabel() {
    rangeLabelEl.textContent =
      rangeStart === rangeEnd
        ? `${formatDateJp(rangeStart)}の1日間`
        : `${formatDateJp(rangeStart)} 〜 ${formatDateJp(rangeEnd)}`;
  }

  function renderRangeCalendar() {
    const year = calMonth.getUTCFullYear();
    const month = calMonth.getUTCMonth();
    rangeCalMonthLabelEl.textContent = `${year}年${month + 1}月`;
    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const firstWeekday = new Date(`${monthStart}T00:00:00Z`).getUTCDay();
    const weekdayHeaders = ['日', '月', '火', '水', '木', '金', '土']
      .map((w) => `<div class="cal-weekday">${w}</div>`)
      .join('');
    const leadingBlanks = Array.from({ length: firstWeekday }, () => '<div class="cal-cell cal-empty"></div>').join('');
    const dayCells = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isStart = dateStr === rangeStart;
      const isEnd = dateStr === rangeEnd;
      const isMid = dateStr > rangeStart && dateStr < rangeEnd;
      const isToday = dateStr === todayStr();
      const cls = [
        'cal-cell',
        'cal-pickable',
        isToday ? 'cal-today' : '',
        isStart ? 'cal-range-start' : '',
        isEnd ? 'cal-range-end' : '',
        isMid ? 'cal-range-mid' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<div class="${cls}" data-date="${dateStr}"><div class="cal-daynum">${day}</div></div>`;
    }).join('');
    rangeCalendarEl.innerHTML = weekdayHeaders + leadingBlanks + dayCells;
    rangeCalendarEl.querySelectorAll('.cal-pickable').forEach((cell) => {
      cell.addEventListener('click', () => {
        const dateStr = cell.dataset.date;
        if (!selectingEnd) {
          rangeStart = dateStr;
          rangeEnd = dateStr;
          selectingEnd = true;
        } else {
          if (dateStr < rangeStart) {
            rangeEnd = rangeStart;
            rangeStart = dateStr;
          } else {
            rangeEnd = dateStr;
          }
          selectingEnd = false;
          load();
        }
        updateRangeLabel();
        renderRangeCalendar();
      });
    });
  }

  document.getElementById('rangeCalPrevBtn').addEventListener('click', () => {
    calMonth.setUTCMonth(calMonth.getUTCMonth() - 1);
    renderRangeCalendar();
  });
  document.getElementById('rangeCalNextBtn').addEventListener('click', () => {
    calMonth.setUTCMonth(calMonth.getUTCMonth() + 1);
    renderRangeCalendar();
  });

  updateRangeLabel();
  renderRangeCalendar();

  document.getElementById('applyBtn').addEventListener('click', load);
  if (slug === 'katakuchi') {
    document.getElementById('showOysterBtn').addEventListener('click', () => {
      document.getElementById('showOysterToo').checked = true;
      load();
    });
  }

  async function load() {
    const from = rangeStart;
    const to = rangeEnd;
    const summaryEl = document.getElementById('summary');
    summaryEl.innerHTML = '<p class="hint">読み込み中…</p>';
    const showOysterToo = slug === 'katakuchi' && document.getElementById('showOysterToo').checked;
    const categories = showOysterToo ? [...shop.categories, 'oyster'] : shop.categories;
    // 美人罠など宅配便発送の牡蠣店舗は、牡蠣受注店・配送受注店ページの集計には含めず、
    // 発注品は牡蠣でもカタクチ商店(ピザ集計)ページ側にまとめて表示する。
    const courierOysterStores = OYSTER_STORES.filter((s) => s.shipping === 'courier');
    try {
      const pizzaRowsByKey = {};
      const oysterRowsByKey = {};
      let oysterRowsCache = null;
      const fetchOysterRowsOnce = async () => {
        if (!oysterRowsCache) oysterRowsCache = await fetchOysterOrdersRange(from, to);
        return oysterRowsCache;
      };
      const sections = await Promise.all(
        categories.map(async (category) => {
          const def = PRODUCT_DEFS[category];
          const isOyster = category === 'oyster';
          const stores = isOyster ? STORES_BY_CATEGORY.oyster.filter((s) => s.shipping !== 'courier') : STORES_BY_CATEGORY[category];
          const rows = isOyster ? await fetchOysterRowsOnce() : await def.fetchRange(from, to);
          if (category === 'pizza') {
            rows.forEach((r) => {
              pizzaRowsByKey[`${r.order_date}__${r.store_slug}`] = r;
            });
          } else if (isOyster) {
            rows.forEach((r) => {
              oysterRowsByKey[`${r.order_date}__${r.store_slug}`] = r;
            });
          }
          const heading = categories.length > 1 ? `<h2 class="section-title">${def.label}</h2>` : '';
          const body = isOyster
            ? renderOysterSummary(rows, stores, { showPrint: showOysterToo })
            : renderTextOrderSummary(rows, stores, { showActions: slug === 'katakuchi' });
          return heading + body;
        })
      );

      let courierSection = '';
      if (slug === 'katakuchi' && courierOysterStores.length > 0) {
        const rows = await fetchOysterRowsOnce();
        rows.forEach((r) => {
          oysterRowsByKey[`${r.order_date}__${r.store_slug}`] = r;
        });
        courierSection =
          '<h2 class="section-title">牡蠣の発注(宅配発送)</h2>' +
          renderOysterSummary(rows, courierOysterStores, { showPrint: true });
      }

      summaryEl.innerHTML = sections.join('') + courierSection;
      const bindConfirmToggle = (selector, action, resetLabel) => {
        summaryEl.querySelectorAll(selector).forEach((btn) => {
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = '更新中…';
            try {
              await action(btn.dataset.store, btn.dataset.date);
              load();
            } catch (e) {
              console.error(e);
              btn.textContent = resetLabel;
              btn.disabled = false;
              alert('更新に失敗しました。通信状況を確認してもう一度お試しください。');
            }
          });
        });
      };
      bindConfirmToggle('.confirm-btn', confirmPizzaOrder, '確認済みにする');
      bindConfirmToggle('.unconfirm-btn', unconfirmPizzaOrder, '未確認に戻す');
      bindConfirmToggle('.confirm-btn-oyster', confirmOysterOrder, '確認済みにする');
      bindConfirmToggle('.unconfirm-btn-oyster', unconfirmOysterOrder, '未確認に戻す');
      summaryEl.querySelectorAll('.print-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = `${btn.dataset.date}__${btn.dataset.store}`;
          const pizzaRow = pizzaRowsByKey[key];
          if (pizzaRow) {
            printDeliverySlip(btn.dataset.storename, btn.dataset.date, pizzaRow.content);
            return;
          }
          const oysterRow = oysterRowsByKey[key];
          if (oysterRow) {
            const content = oysterRow.no_order
              ? '発注なし'
              : `混合 ${oysterRow.mixed_boxes}ケース\nSサイズ ${oysterRow.s_boxes}ケース\nMサイズ ${oysterRow.m_boxes}ケース`;
            printDeliverySlip(btn.dataset.storename, btn.dataset.date, content);
          }
        });
      });
    } catch (e) {
      console.error(e);
      summaryEl.innerHTML = '<p class="msg-error">読み込みに失敗しました。</p>';
    }
  }

  load();
}

async function renderCustomAggregatePage() {
  const defaultFrom = todayStr();
  const defaultTo = todayStr();

  const storeCheckboxes = STORES.map(
    (s) => `
      <label class="checkbox-label">
        <input type="checkbox" class="store-check" value="${s.slug}">
        ${escapeHtml(s.name)}
      </label>`
  ).join('');

  app.innerHTML = `
    <div class="page wide">
      <h1>店舗ごとの集計</h1>
      ${adminBackLinkHtml()}
      <p class="hint">集計したい店舗を選び、期間を指定して表示してください。</p>
      <div class="card">
        <div class="field">
          <label>店舗を選択</label>
          ${storeCheckboxes}
        </div>
        <div class="field">
          <label for="fromDate">開始日</label>
          <input type="date" id="fromDate" value="${defaultFrom}">
        </div>
        <div class="field">
          <label for="toDate">終了日</label>
          <input type="date" id="toDate" value="${defaultTo}">
        </div>
        <button id="applyBtn" class="primary">表示</button>
      </div>
      <div id="summary"></div>
    </div>`;

  document.getElementById('applyBtn').addEventListener('click', load);

  async function load() {
    const from = document.getElementById('fromDate').value;
    const to = document.getElementById('toDate').value;
    const selectedSlugs = [...document.querySelectorAll('.store-check:checked')].map((el) => el.value);
    const summaryEl = document.getElementById('summary');

    if (!selectedSlugs.length) {
      summaryEl.innerHTML = '<div class="card"><p class="hint">店舗を1つ以上選択してください。</p></div>';
      return;
    }

    const selectedStores = STORES.filter((s) => selectedSlugs.includes(s.slug));
    const categories = [...new Set(selectedStores.flatMap((s) => s.categories))];

    summaryEl.innerHTML = '<p class="hint">読み込み中…</p>';
    try {
      const sections = await Promise.all(
        categories.map(async (category) => {
          const def = PRODUCT_DEFS[category];
          const stores = selectedStores.filter((s) => s.categories.includes(category));
          const rows = (await def.fetchRange(from, to)).filter((r) => selectedSlugs.includes(r.store_slug));
          const heading = categories.length > 1 ? `<h2 class="section-title">${def.label}</h2>` : '';
          const body =
            category === 'oyster'
              ? renderOysterTable(rows, stores, { showPrint: true })
              : renderTextOrderSummary(rows, stores, { showActions: false });
          return heading + body;
        })
      );
      summaryEl.innerHTML = sections.join('');
      bindPrintTableButtons(summaryEl);
    } catch (e) {
      console.error(e);
      summaryEl.innerHTML = '<p class="msg-error">読み込みに失敗しました。</p>';
    }
  }
}

// 出荷(在庫減)は、この日付以降のoyster_ordersの合計を自動で差し引く。
// この日より前の発注はこの冷凍庫在庫とは無関係(在庫管理開始前の出荷)として扱う。
const KAKI_STOCK_TRACKING_START_DATE = '2026-08-04';

// 入庫の仕入れ元。増える場合はここに追記する(kaki_stock_in.noteカラムに文字列で保存)。
const STOCK_SUPPLIERS = ['カタクチ', '拓人', '勝又商店'];

// 出庫記録フォームで最初から選ばれている仕入れ先。通常の出庫は拓人の牡蠣がほとんどのため。
const STOCK_OUT_DEFAULT_SUPPLIER = '拓人';

// 直近の出荷実績(shippedByDate)から曜日別の平均出荷ペースを求め、現在庫が
// いつ頃尽きそうかを予測して一言メッセージにする。祝日は出荷が減る傾向を
// 見込んで日曜相当のペースとして計算する(実績が乏しい祝日固有の平均は
// 使わず、既知の日曜実績で代用する簡易的な扱い)。
function buildStockoutForecast(balance, shippedByDate, asOfDate) {
  const dateKeys = Object.keys(shippedByDate);
  if (!dateKeys.length) return '出荷実績がまだないため、在庫が持つ期間を予測できません。';

  const weekdaySum = Array.from({ length: 7 }, () => ({ s: 0, m: 0, count: 0 }));
  const overallSum = { s: 0, m: 0, count: 0 };
  dateKeys.forEach((date) => {
    const t = shippedByDate[date];
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    weekdaySum[dow].s += t.s;
    weekdaySum[dow].m += t.m;
    weekdaySum[dow].count++;
    overallSum.s += t.s;
    overallSum.m += t.m;
    overallSum.count++;
  });
  const overallAvg = { s: overallSum.s / overallSum.count, m: overallSum.m / overallSum.count };

  function expectedFor(dateStr) {
    const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
    const lookupDow = JP_HOLIDAYS.has(dateStr) ? 0 : dow; // 祝日は日曜相当の出荷ペースとして扱う
    const w = weekdaySum[lookupDow];
    return w.count > 0 ? { s: w.s / w.count, m: w.m / w.count } : overallAvg;
  }

  const MAX_DAYS = 90;
  let remainingS = balance.s;
  let remainingM = balance.m;
  let depleteDateS = balance.s <= 0 ? asOfDate : null;
  let depleteDateM = balance.m <= 0 ? asOfDate : null;
  const cur = new Date(`${asOfDate}T00:00:00Z`);
  for (let i = 1; i <= MAX_DAYS && (!depleteDateS || !depleteDateM); i++) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const dateStr = cur.toISOString().slice(0, 10);
    const exp = expectedFor(dateStr);
    if (!depleteDateS) {
      remainingS -= exp.s;
      if (remainingS <= 0) depleteDateS = dateStr;
    }
    if (!depleteDateM) {
      remainingM -= exp.m;
      if (remainingM <= 0) depleteDateM = dateStr;
    }
  }

  const sPart =
    balance.s <= 0 ? 'Sサイズは在庫切れ' : depleteDateS ? `Sサイズは${formatDateJp(depleteDateS)}頃` : `Sサイズは${MAX_DAYS}日以上`;
  const mPart =
    balance.m <= 0 ? 'Mサイズは在庫切れ' : depleteDateM ? `Mサイズは${formatDateJp(depleteDateM)}頃` : `Mサイズは${MAX_DAYS}日以上`;

  return `直近の曜日別出荷ペース(祝日は日曜相当で計算)だと、${sPart}、${mPart}まで在庫が持つ見込みです。余裕をもって入庫の手配をおすすめします。`;
}

// 牡蠣在庫の帳票(Excel)の列構成を作る共通処理。
// A日付/B入庫合計/C出庫合計/ 入庫(仕入れ先×混合・S・M)/ 配達出庫・イベント出庫
// (それぞれ仕入れ先×S・M + 未記録)。ユーザーに個別配布していたxlsxと同じ様式。
// 日別・月別のどちらの帳票もこのヘッダー構成を共有する。
function setupStockExcelSheet(wb, sheetName, firstColLabel) {
  const ws = wb.addWorksheet(sheetName);

  const headerFont = { name: '游ゴシック', bold: true, size: 10 };
  const normalFont = { name: '游ゴシック', size: 10 };
  const totalFont = { name: '游ゴシック', bold: true, size: 10 };
  const noteFont = { name: '游ゴシック', size: 9, italic: true, color: { argb: 'FF767671' } };
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
  const unrecordedFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE9E7' } };
  const totalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F0EC' } };
  const thin = { style: 'thin', color: { argb: 'FFD9D9D9' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const center = { horizontal: 'center', vertical: 'middle', wrapText: true };

  function setCell(r, c, value, { font = normalFont, fill } = {}) {
    const cell = ws.getCell(r, c);
    cell.value = value;
    cell.font = font;
    cell.alignment = center;
    cell.border = border;
    if (fill) cell.fill = fill;
    return cell;
  }

  const EXPORT_SUPPLIERS = ['拓人', '勝又商店', 'カタクチ'];

  setCell(1, 1, firstColLabel, { font: headerFont, fill: headerFill });
  ws.mergeCells(1, 1, 2, 1);
  setCell(1, 2, '入庫合計', { font: headerFont, fill: headerFill });
  ws.mergeCells(1, 2, 2, 2);
  setCell(1, 3, '出庫合計', { font: headerFont, fill: headerFill });
  ws.mergeCells(1, 3, 2, 3);

  // 入庫: E-M(仕入れ先ごとに混合/S/M)
  const inColStart = 5; // E
  EXPORT_SUPPLIERS.forEach((supplier, i) => {
    const c0 = inColStart + i * 3;
    setCell(1, c0, `${supplier}入庫`, { font: headerFont, fill: headerFill });
    ws.mergeCells(1, c0, 1, c0 + 2);
    ['混合', 'S', 'M'].forEach((label, j) => setCell(2, c0 + j, label, { font: headerFont, fill: headerFill }));
  });

  // 配達出庫(店舗配送): O- (仕入れ先+未記録、それぞれS/M)
  const storeColStart = inColStart + EXPORT_SUPPLIERS.length * 3 + 1; // 空列1つ空けて開始
  const outGroups = [
    { label: '配達出庫(店舗配送)', start: storeColStart },
    { label: 'イベント出庫(自社使用)', start: storeColStart + (EXPORT_SUPPLIERS.length + 1) * 2 + 1 },
  ];
  // 配達出庫/イベント出庫の見出し1行目には、印刷時に見分けやすいよう仕入れ先名(略称)も付ける
  // (未記録は特定の仕入れ先ではないので付けない)。ユーザー提供の様式(kaki_stock_log_by_supplier.xlsx)に合わせた表記。
  const SUPPLIER_HEADER_ABBR = { 拓人: '拓人', 勝又商店: '勝又', カタクチ: 'カタクチ' };
  outGroups.forEach((group) => {
    [...EXPORT_SUPPLIERS, '未記録'].forEach((supplier, i) => {
      const c0 = group.start + i * 2;
      const abbr = SUPPLIER_HEADER_ABBR[supplier] || '';
      setCell(1, c0, `${group.label}${abbr}\n${supplier}`, {
        font: headerFont,
        fill: supplier === '未記録' ? unrecordedFill : headerFill,
      });
      ws.mergeCells(1, c0, 1, c0 + 1);
      ['S', 'M'].forEach((label, j) =>
        setCell(2, c0 + j, label, { font: headerFont, fill: supplier === '未記録' ? unrecordedFill : headerFill })
      );
    });
  });

  const storeCols = {};
  EXPORT_SUPPLIERS.forEach((s, i) => (storeCols[s] = outGroups[0].start + i * 2));
  storeCols['未記録'] = outGroups[0].start + EXPORT_SUPPLIERS.length * 2;
  const selfCols = {};
  EXPORT_SUPPLIERS.forEach((s, i) => (selfCols[s] = outGroups[1].start + i * 2));
  selfCols['未記録'] = outGroups[1].start + EXPORT_SUPPLIERS.length * 2;
  const outStartCol = outGroups[0].start;
  const outEndCol = outGroups[1].start + EXPORT_SUPPLIERS.length * 2 + 1;
  const inEndCol = inColStart + EXPORT_SUPPLIERS.length * 3 - 1;
  // 空列(D/入庫と配達出庫の間、配達出庫とイベント出庫の間)。合計行の数式もここは飛ばす。
  const spacerCols = [4, storeColStart - 1, outGroups[1].start - 1];

  return {
    ws,
    setCell,
    EXPORT_SUPPLIERS,
    inColStart,
    inEndCol,
    storeCols,
    selfCols,
    outStartCol,
    outEndCol,
    spacerCols,
    unrecordedFill,
    totalFill,
    totalFont,
    noteFont,
  };
}

// 集計済みの行の下に合計行を書き込む(B〜outEndColをSUM数式で、空列は飛ばす)。
function writeStockExcelTotalRow(sheet, row, label, firstDataRow, lastDataRow, { font, fill, topBorder } = {}) {
  const { ws, setCell, outEndCol, spacerCols } = sheet;
  setCell(row, 1, label, { font, fill });
  for (let c = 2; c <= outEndCol; c++) {
    if (spacerCols.includes(c)) continue;
    const colLetter = ws.getColumn(c).letter;
    setCell(row, c, { formula: `SUM(${colLetter}${firstDataRow}:${colLetter}${lastDataRow})` }, { font, fill });
  }
  if (topBorder) {
    for (let c = 1; c <= outEndCol; c++) {
      const cell = ws.getCell(row, c);
      cell.border = { ...cell.border, top: { style: 'medium', color: { argb: 'FFB0B0B0' } } };
    }
  }
}

// 集計済みの1行分(その日/その月の合計)をシートに書き込む。B/C列はSUM数式。
function writeStockExcelRow(sheet, row, rowLabel, { inBySupplier, storeAttrBySupplier, storeTotal, storeAttrTotal, selfAttrBySupplier, selfUnrecorded }) {
  const { setCell, EXPORT_SUPPLIERS, inColStart, inEndCol, storeCols, selfCols, outStartCol, outEndCol, unrecordedFill, ws } = sheet;
  setCell(row, 1, rowLabel);

  let hasIn = false;
  EXPORT_SUPPLIERS.forEach((supplier, i) => {
    const vals = (inBySupplier && inBySupplier[supplier]) || [0, 0, 0];
    const c0 = inColStart + i * 3;
    vals.forEach((v, j) => {
      if (v) {
        setCell(row, c0 + j, v);
        hasIn = true;
      }
    });
  });

  let hasOut = false;
  const storeAttr = storeAttrBySupplier || {};
  EXPORT_SUPPLIERS.forEach((supplier) => {
    const [s, m] = storeAttr[supplier] || [0, 0];
    if (s) { setCell(row, storeCols[supplier], s); hasOut = true; }
    if (m) { setCell(row, storeCols[supplier] + 1, m); hasOut = true; }
  });
  const storeUnrecorded = (storeTotal || 0) - (storeAttrTotal || 0);
  if (storeUnrecorded > 0) {
    setCell(row, storeCols['未記録'], storeUnrecorded, { fill: unrecordedFill });
    hasOut = true;
  }
  const selfAttr = selfAttrBySupplier || {};
  EXPORT_SUPPLIERS.forEach((supplier) => {
    const [s, m] = selfAttr[supplier] || [0, 0];
    if (s) { setCell(row, selfCols[supplier], s); hasOut = true; }
    if (m) { setCell(row, selfCols[supplier] + 1, m); hasOut = true; }
  });
  const [selfUnS, selfUnM] = selfUnrecorded || [0, 0];
  if (selfUnS) { setCell(row, selfCols['未記録'], selfUnS, { fill: unrecordedFill }); hasOut = true; }
  if (selfUnM) { setCell(row, selfCols['未記録'] + 1, selfUnM, { fill: unrecordedFill }); hasOut = true; }

  if (hasIn) setCell(row, 2, { formula: `SUM(${ws.getColumn(inColStart).letter}${row}:${ws.getColumn(inEndCol).letter}${row})` });
  if (hasOut) setCell(row, 3, { formula: `SUM(${ws.getColumn(outStartCol).letter}${row}:${ws.getColumn(outEndCol).letter}${row})` });
  return hasIn || hasOut;
}

function finishStockExcelSheet(sheet, lastDataRow, notes) {
  const { ws, outEndCol, noteFont } = sheet;
  let noteRow = lastDataRow + 1;
  notes.forEach((text) => {
    const cell = ws.getCell(noteRow, 1);
    cell.value = text;
    cell.font = noteFont;
    ws.mergeCells(noteRow, 1, noteRow, outEndCol);
    noteRow += 1;
  });

  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 9;
  ws.getColumn(3).width = 9;
  for (let c = 4; c <= outEndCol; c++) ws.getColumn(c).width = 6.5;
  ws.getRow(1).height = 32;
  ws.getRow(2).height = 16;
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

async function downloadWorkbook(wb, filename) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return buffer;
}

function boxesOfRow(r) {
  return (Number(r.mixed_boxes) || 0) + (Number(r.s_boxes) || 0) + (Number(r.m_boxes) || 0);
}

// 入庫・手動出庫・発注データから、日付キー(YYYY-MM-DDでもYYYY-MMでも可)ごとの集計マップを作る。
// keyFn(dateStr) でグルーピング単位(日別/月別)を切り替える。
function aggregateStockRecords(stockIn, stockOutInternal, oysterOrders, keyFn) {
  const inByKey = {};
  stockIn.forEach((r) => {
    const key = keyFn(r.in_date);
    const supplier = r.note || '';
    if (!inByKey[key]) inByKey[key] = {};
    if (!inByKey[key][supplier]) inByKey[key][supplier] = [0, 0, 0];
    inByKey[key][supplier][0] += Number(r.mixed_boxes) || 0;
    inByKey[key][supplier][1] += Number(r.s_boxes) || 0;
    inByKey[key][supplier][2] += Number(r.m_boxes) || 0;
  });

  const storeTotalByKey = {};
  oysterOrders.forEach((r) => {
    if (r.no_order) return;
    const key = keyFn(r.order_date);
    storeTotalByKey[key] = (storeTotalByKey[key] || 0) + boxesOfRow(r);
  });

  const storeAttrByKey = {};
  const storeAttrTotalByKey = {};
  const selfAttrByKey = {};
  const selfUnrecordedByKey = {};
  stockOutInternal.forEach((r) => {
    const key = keyFn(r.out_date);
    const supplier = r.supplier || '';
    const s = Number(r.s_boxes) || 0;
    const m = Number(r.m_boxes) || 0;
    if (r.purpose === 'store') {
      if (STOCK_SUPPLIERS.includes(supplier)) {
        if (!storeAttrByKey[key]) storeAttrByKey[key] = {};
        if (!storeAttrByKey[key][supplier]) storeAttrByKey[key][supplier] = [0, 0];
        storeAttrByKey[key][supplier][0] += s;
        storeAttrByKey[key][supplier][1] += m;
      }
      storeAttrTotalByKey[key] = (storeAttrTotalByKey[key] || 0) + boxesOfRow(r);
    } else {
      if (STOCK_SUPPLIERS.includes(supplier)) {
        if (!selfAttrByKey[key]) selfAttrByKey[key] = {};
        if (!selfAttrByKey[key][supplier]) selfAttrByKey[key][supplier] = [0, 0];
        selfAttrByKey[key][supplier][0] += s;
        selfAttrByKey[key][supplier][1] += m;
      } else {
        if (!selfUnrecordedByKey[key]) selfUnrecordedByKey[key] = [0, 0];
        selfUnrecordedByKey[key][0] += s;
        selfUnrecordedByKey[key][1] += m;
      }
    }
  });

  return { inByKey, storeTotalByKey, storeAttrByKey, storeAttrTotalByKey, selfAttrByKey, selfUnrecordedByKey };
}

function addDaysStr(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// 日別の帳票(from〜to指定)。
async function buildAndDownloadStockExcel(from, to) {
  const [allStockIn, allStockOutInternal, oysterOrdersInRange] = await Promise.all([
    fetchStockInAll(),
    fetchStockOutInternalAll(),
    fetchOysterOrdersRange(from, to),
  ]);
  const stockIn = allStockIn.filter((r) => r.in_date >= from && r.in_date <= to);
  const stockOutInternal = allStockOutInternal.filter((r) => r.out_date >= from && r.out_date <= to);
  // 美人罠など宅配便発送分は配送トラックの「配達出庫(店舗配送)」には含めない。
  const truckOysterOrders = oysterOrdersInRange.filter((r) => !COURIER_STORE_SLUGS.has(r.store_slug));
  const agg = aggregateStockRecords(stockIn, stockOutInternal, truckOysterOrders, (d) => d);

  await loadExcelJs();
  const wb = new ExcelJS.Workbook();
  const sheet = setupStockExcelSheet(wb, '牡蠣入出庫記録(仕入れ先別)', '日付');

  let row = 3;
  let cur = from;
  while (cur <= to) {
    const d = new Date(`${cur}T00:00:00Z`);
    writeStockExcelRow(sheet, row, `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`, {
      inBySupplier: agg.inByKey[cur],
      storeAttrBySupplier: agg.storeAttrByKey[cur],
      storeTotal: agg.storeTotalByKey[cur],
      storeAttrTotal: agg.storeAttrTotalByKey[cur],
      selfAttrBySupplier: agg.selfAttrByKey[cur],
      selfUnrecorded: agg.selfUnrecordedByKey[cur],
    });
    row += 1;
    cur = addDaysStr(cur, 1);
  }

  const firstDataRow = 3;
  const lastDataRow = row - 1;
  writeStockExcelTotalRow(sheet, row, '月計', firstDataRow, lastDataRow, { topBorder: true });
  row += 1;

  finishStockExcelSheet(sheet, row - 1, []);

  // from〜toがまるまる1ヶ月分ならファイル名も「YYYY-MM」で簡潔に
  const isFullMonth = from.endsWith('-01') && addDaysStr(to, 1).slice(0, 7) !== to.slice(0, 7);
  const filenameLabel = isFullMonth ? from.slice(0, 7) : `${from}_${to}`;
  return downloadWorkbook(wb, `牡蠣入出庫記録_${filenameLabel}.xlsx`);
}

async function renderStockPage() {
  app.innerHTML = `
    <div class="page wide">
      <h1>牡蠣在庫管理</h1>
      ${adminBackLinkHtml()}
      <p class="hint">仙台のカタクチ商店冷凍庫にある牡蠣の在庫です。指定した日までに確定した入庫・各店舗への発注(牡蠣)から、その時点の在庫を計算します。それより先の発注はまだ出荷していないため在庫からは引かれません。<a href="?stock_audit=1${
        new URLSearchParams(location.search).get('ref') === 'admin' ? '&ref=admin' : ''
      }">在庫の変更履歴を見る →</a></p>
      <div class="card">
        <div class="field">
          <label for="asOfDate">この日時点の在庫を表示</label>
          <input type="date" id="asOfDate" value="${todayStr()}">
        </div>
        <button id="asOfApplyBtn" class="primary">表示</button>
      </div>
      <div id="stockBalance"><p class="hint">読み込み中…</p></div>
      <div class="card">
        <h2>帳票を出力(Excel)</h2>
        <p class="hint">指定した月の入庫・出庫(仕入れ先別)を1日ごとにまとめ、最終行に月計を付けた管理表をExcel形式でダウンロードします。入出庫が無い日も表示されます。ダウンロード後、ExcelやNumbersから印刷してください。</p>
        <div class="field">
          <label for="exportMonth">出力する月</label>
          <input type="month" id="exportMonth" value="${todayStr().slice(0, 7)}">
        </div>
        <button id="exportExcelBtn" class="primary">Excelをダウンロード</button>
        <p id="exportMsg" class="msg"></p>
      </div>
      <div class="card">
        <h2>入庫を記録する</h2>
        <div class="field">
          <label for="stockInDate">入庫日</label>
          <input type="date" id="stockInDate" value="${todayStr()}">
        </div>
        <div class="field">
          <label for="stockInSupplier">仕入れ元</label>
          <select id="stockInSupplier">${[...STOCK_SUPPLIERS]
            .sort((a, b) => (a === STOCK_OUT_DEFAULT_SUPPLIER ? -1 : b === STOCK_OUT_DEFAULT_SUPPLIER ? 1 : 0))
            .map(
              (s) =>
                `<option value="${escapeHtml(s)}"${s === STOCK_OUT_DEFAULT_SUPPLIER ? ' selected' : ''}>${escapeHtml(
                  s
                )}</option>`
            )
            .join('')}</select>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="stockInMixed">混合(ケース)</label>
            <select id="stockInMixed">${qtyOptionsHtml(100)}</select>
          </div>
          <div class="field">
            <label for="stockInS">Sサイズ(ケース)</label>
            <select id="stockInS">${qtyOptionsHtml(100)}</select>
          </div>
          <div class="field">
            <label for="stockInM">Mサイズ(ケース)</label>
            <select id="stockInM">${qtyOptionsHtml(100)}</select>
          </div>
        </div>
        <button id="stockInSubmitBtn" class="primary">入庫を登録する</button>
        <p id="stockInMsg" class="msg"></p>
      </div>
      <div class="card" id="stockOutCard">
        <h2>出庫を記録する</h2>
        <p class="hint">自社使用(イベントなど)や、店舗配達分がどの仕入れ先の在庫から出たかを記録できます。「自社使用」は全体の在庫残高からも差し引かれます。「店舗配達分の記録」は仕入れ先ごとの残りにだけ反映され、全体の在庫残高には影響しません(店舗への出荷は発注データから別途自動計算されているため)。下のカレンダーの出庫表示をタップすると、この日の内容を編集・記録できます。</p>
        <p id="stockOutEditBanner" class="form-edit-banner" style="display:none;"></p>
        <div class="field">
          <label for="stockOutDate">出庫日</label>
          <input type="date" id="stockOutDate" value="${todayStr()}">
        </div>
        <div class="field">
          <label for="stockOutPurpose">用途</label>
          <select id="stockOutPurpose">
            <option value="self">自社使用など(在庫残高からも差し引く)</option>
            <option value="store">店舗配達分の記録(仕入れ先の残りにのみ反映)</option>
          </select>
        </div>
        <div class="field">
          <label for="stockOutNote">メモ(任意)</label>
          <input type="text" id="stockOutNote" placeholder="例: 〇〇イベント、8/20配達分など">
        </div>
        <p class="hint">同じ日の出庫を複数の仕入れ先に分けて記録したい場合は「+ 別の仕入れ先を追加」で内訳を増やせます(例: Mを勝又商店から3箱、拓人から2箱など)。</p>
        <div id="stockOutBreakdownRows"></div>
        <button id="stockOutAddRowBtn" type="button" class="btn-plain">+ 別の仕入れ先を追加</button>
        <button id="stockOutSubmitBtn" class="primary">出庫を登録する</button>
        <button id="stockOutCancelBtn" type="button" class="btn-plain" style="display:none;">キャンセル(新規登録に戻す)</button>
        <p id="stockOutMsg" class="msg"></p>
      </div>
      <div class="card">
        <div class="view-toggle">
          <button id="viewCalendarBtn" class="view-toggle-btn active" type="button">📅 カレンダー表示</button>
          <button id="viewListBtn" class="view-toggle-btn" type="button">📋 一覧表示</button>
        </div>
        <div class="calendar-header">
          <button id="calPrevBtn" class="cal-nav-btn" type="button">◀</button>
          <h2 id="calMonthLabel"></h2>
          <button id="calNextBtn" class="cal-nav-btn" type="button">▶</button>
        </div>
        <p class="hint">カレンダー表示は見やすさ優先で「入庫/配達(店舗への自動出荷)/他出庫(自社使用など)」の3行だけを表示します。オレンジの「配達」をタップすると、上の「出庫を記録する」フォームにその日の内容が読み込まれ、仕入れ先の記録・修正ができます。個別記録の削除・仕入れ先ごとの内訳・受注データとの差分警告など詳しい内容は「📋 一覧表示」でご確認ください(その月のうち入出庫があった日だけを表形式で並べます)。</p>
        <div id="stockCalendar" class="stock-calendar"><p class="hint">読み込み中…</p></div>
      </div>
      <div id="supplierBreakdown"></div>
    </div>`;

  const balanceEl = document.getElementById('stockBalance');
  const supplierBreakdownEl = document.getElementById('supplierBreakdown');
  const calendarEl = document.getElementById('stockCalendar');
  const calMonthLabelEl = document.getElementById('calMonthLabel');

  let calendarMonth = new Date(`${todayStr()}T00:00:00Z`);
  calendarMonth.setUTCDate(1);
  let stockView = 'calendar'; // 'calendar' or 'list'

  document.getElementById('asOfApplyBtn').addEventListener('click', load);
  document.getElementById('exportExcelBtn').addEventListener('click', async () => {
    const monthVal = document.getElementById('exportMonth').value; // 'YYYY-MM'
    const msgEl = document.getElementById('exportMsg');
    if (!monthVal) {
      msgEl.textContent = '出力する月を指定してください。';
      msgEl.className = 'msg msg-error';
      return;
    }
    const [y, m] = monthVal.split('-').map(Number);
    const from = `${monthVal}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const to = `${monthVal}-${String(lastDay).padStart(2, '0')}`;
    const btn = document.getElementById('exportExcelBtn');
    btn.disabled = true;
    msgEl.textContent = '作成中…';
    msgEl.className = 'msg';
    try {
      await buildAndDownloadStockExcel(from, to);
      msgEl.textContent = '✓ ダウンロードしました。';
      msgEl.className = 'msg msg-success';
    } catch (e) {
      console.error(e);
      msgEl.textContent = '作成に失敗しました。通信状況を確認してもう一度お試しください。';
      msgEl.className = 'msg msg-error';
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById('calPrevBtn').addEventListener('click', () => {
    calendarMonth.setUTCMonth(calendarMonth.getUTCMonth() - 1);
    loadCalendar();
  });
  document.getElementById('calNextBtn').addEventListener('click', () => {
    calendarMonth.setUTCMonth(calendarMonth.getUTCMonth() + 1);
    loadCalendar();
  });
  document.getElementById('viewCalendarBtn').addEventListener('click', () => {
    if (stockView === 'calendar') return;
    stockView = 'calendar';
    document.getElementById('viewCalendarBtn').classList.add('active');
    document.getElementById('viewListBtn').classList.remove('active');
    loadCalendar();
  });
  document.getElementById('viewListBtn').addEventListener('click', () => {
    if (stockView === 'list') return;
    stockView = 'list';
    document.getElementById('viewListBtn').classList.add('active');
    document.getElementById('viewCalendarBtn').classList.remove('active');
    loadCalendar();
  });

  function compactQty(mixed, s, m) {
    const parts = [];
    if (mixed) parts.push(`混${mixed}`);
    if (s) parts.push(`S${s}`);
    if (m) parts.push(`M${m}`);
    return parts.length ? parts.join('/') : '0';
  }

  // 仕入れ先別出庫の内訳表示用: Sが0でも省略せず必ず表示する(混合は0なら省略)。
  function breakdownQty(mixed, s, m) {
    const parts = [];
    if (mixed) parts.push(`混${mixed}`);
    parts.push(`S${s}`);
    parts.push(`M${m}`);
    return parts.join('/');
  }

  // 受注システム(発注データから自動計算した出荷数=オレンジ)と、手動で記録した
  // 「店舗配達分」の仕入れ先内訳(紫・purpose==='store')の差分を符号付きで表示する。
  // 正の値=まだ仕入れ先が記録できていない分、負の値=記録が実際の出荷より多い(入力ミスの疑い)。
  function compactDiff(mixed, s, m) {
    const parts = [];
    if (mixed) parts.push(`混${mixed > 0 ? '+' : ''}${mixed}`);
    if (s) parts.push(`S${s > 0 ? '+' : ''}${s}`);
    if (m) parts.push(`M${m > 0 ? '+' : ''}${m}`);
    return parts.join('/');
  }

  // カレンダーの出庫表示をタップした時、下の「出庫を記録する」フォームに内容を読み込む。
  // editingStockOutId がセットされている間は「更新」、nullなら「新規登録」として扱う。
  let editingStockOutId = null;

  // 出庫フォームの「仕入れ先+数量」の内訳行。複数の仕入れ先に分けて記録できるよう、
  // 行を動的に増減できるようにしている(既存の1件を編集/更新する時は常に1行のみ)。
  let breakdownRowSeq = 0;

  function createBreakdownRow({ supplier, mixed, s, m } = {}) {
    breakdownRowSeq += 1;
    const wrapper = document.createElement('div');
    wrapper.className = 'stock-out-row';
    wrapper.dataset.rowId = String(breakdownRowSeq);
    wrapper.innerHTML = `
      <div class="field">
        <label>どこの牡蠣か(仕入れ先)</label>
        <select class="bo-supplier">${[...STOCK_SUPPLIERS]
          .sort((a, b) => (a === STOCK_OUT_DEFAULT_SUPPLIER ? -1 : b === STOCK_OUT_DEFAULT_SUPPLIER ? 1 : 0))
          .map((s2) => `<option value="${escapeHtml(s2)}">${escapeHtml(s2)}</option>`)
          .join('')}</select>
      </div>
      <div class="field-row">
        <div class="field"><label>混合(ケース)</label><select class="bo-mixed">${qtyOptionsHtml(100)}</select></div>
        <div class="field"><label>Sサイズ(ケース)</label><select class="bo-s">${qtyOptionsHtml(100)}</select></div>
        <div class="field"><label>Mサイズ(ケース)</label><select class="bo-m">${qtyOptionsHtml(100)}</select></div>
      </div>
      <button type="button" class="bo-remove btn-plain">この仕入れ先を削除</button>
    `;
    wrapper.querySelector('.bo-supplier').value = supplier || STOCK_OUT_DEFAULT_SUPPLIER;
    wrapper.querySelector('.bo-mixed').value = mixed || 0;
    wrapper.querySelector('.bo-s').value = s || 0;
    wrapper.querySelector('.bo-m').value = m || 0;
    wrapper.querySelector('.bo-remove').addEventListener('click', () => {
      if (document.querySelectorAll('#stockOutBreakdownRows .stock-out-row').length <= 1) return; // 最低1行は残す
      wrapper.remove();
      updateBreakdownRemoveButtons();
    });
    return wrapper;
  }

  function updateBreakdownRemoveButtons() {
    const rows = document.querySelectorAll('#stockOutBreakdownRows .stock-out-row');
    rows.forEach((row) => {
      row.querySelector('.bo-remove').style.display = rows.length > 1 ? '' : 'none';
    });
  }

  // rows未指定、または空配列の場合は仕入れ先1行(デフォルト値)だけの状態に戻す。
  function resetBreakdownRows(rows) {
    const container = document.getElementById('stockOutBreakdownRows');
    container.innerHTML = '';
    const list = rows && rows.length ? rows : [{ supplier: STOCK_OUT_DEFAULT_SUPPLIER, mixed: 0, s: 0, m: 0 }];
    list.forEach((r) => container.appendChild(createBreakdownRow(r)));
    updateBreakdownRemoveButtons();
  }

  function getBreakdownRowsData() {
    return Array.from(document.querySelectorAll('#stockOutBreakdownRows .stock-out-row')).map((row) => ({
      supplier: row.querySelector('.bo-supplier').value,
      mixedBoxes: Number(row.querySelector('.bo-mixed').value) || 0,
      sBoxes: Number(row.querySelector('.bo-s').value) || 0,
      mBoxes: Number(row.querySelector('.bo-m').value) || 0,
    }));
  }

  document.getElementById('stockOutAddRowBtn').addEventListener('click', () => {
    document.getElementById('stockOutBreakdownRows').appendChild(createBreakdownRow());
    updateBreakdownRemoveButtons();
  });

  function fillStockOutForm({ outDate, mixedBoxes, sBoxes, mBoxes, supplier, purpose, note }) {
    document.getElementById('stockOutDate').value = outDate;
    document.getElementById('stockOutPurpose').value = purpose;
    document.getElementById('stockOutNote').value = note;
    resetBreakdownRows([{ supplier, mixed: mixedBoxes, s: sBoxes, m: mBoxes }]);
  }

  // mode: 'edit'(既存の手動出庫を編集) / 'prefill'(店舗出荷分に仕入れ先を新規記録) /
  //       'warn'(受注データとの差分を埋めるための新規記録) / 'selfwarn'(仕入れ先未記録の自社使用を編集)
  function selectStockOutForEdit(entry, mode) {
    editingStockOutId = entry.id || null;
    fillStockOutForm(entry);
    const submitBtn = document.getElementById('stockOutSubmitBtn');
    const banner = document.getElementById('stockOutEditBanner');
    const cancelBtn = document.getElementById('stockOutCancelBtn');
    // 既存1件の編集中は内訳を複数に分けられると更新の意味が曖昧になるため、追加ボタンを隠す。
    document.getElementById('stockOutAddRowBtn').style.display = editingStockOutId ? 'none' : '';
    submitBtn.textContent = editingStockOutId ? 'この出庫記録を更新する' : '出庫を登録する';
    if (mode === 'edit') {
      banner.textContent = `${formatDateJp(entry.outDate)}の出庫記録を編集中です。内容を直して「更新する」を押してください。`;
    } else if (mode === 'warn') {
      banner.textContent = `${formatDateJp(
        entry.outDate
      )}は受注データと仕入れ先記録の数が合っていません(未記録分がある場合、下の数量に自動で入力済みです)。内容を確認して登録してください。`;
    } else if (mode === 'selfwarn') {
      banner.textContent = `${formatDateJp(
        entry.outDate
      )}の自社使用は、どこの牡蠣を使ったか(仕入れ先)が記録されていません。仕入れ先を選んで「更新する」を押してください。`;
    } else {
      banner.textContent = `${formatDateJp(entry.outDate)}の店舗出荷分です。仕入れ先を確認・修正して登録してください。`;
    }
    banner.style.display = '';
    cancelBtn.style.display = '';
    document.getElementById('stockOutCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // 編集モードの表示だけを解除する(日付・仕入れ先などの入力値はそのまま残す)。
  // 保存成功直後は同じ日付・仕入れ先で続けて記録したいことが多いため。
  function exitStockOutEditMode() {
    editingStockOutId = null;
    document.getElementById('stockOutSubmitBtn').textContent = '出庫を登録する';
    document.getElementById('stockOutEditBanner').style.display = 'none';
    document.getElementById('stockOutCancelBtn').style.display = 'none';
    document.getElementById('stockOutAddRowBtn').style.display = '';
  }

  // 「キャンセル」ボタン用: 編集モードを抜けたうえでフォーム全体も初期値に戻す。
  function clearStockOutSelection() {
    exitStockOutEditMode();
    fillStockOutForm({
      outDate: todayStr(),
      mixedBoxes: 0,
      sBoxes: 0,
      mBoxes: 0,
      supplier: STOCK_OUT_DEFAULT_SUPPLIER,
      purpose: 'self',
      note: '',
    });
  }

  async function loadCalendar() {
    const year = calendarMonth.getUTCFullYear();
    const month = calendarMonth.getUTCMonth();
    calMonthLabelEl.textContent = `${year}年${month + 1}月`;
    calendarEl.innerHTML = '<p class="hint">読み込み中…</p>';
    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    const shippedRangeStart = monthStart < KAKI_STOCK_TRACKING_START_DATE ? KAKI_STOCK_TRACKING_START_DATE : monthStart;
    try {
      const [allStockInRows, shippedRows, internalOutRows] = await Promise.all([
        fetchStockInAll(),
        shippedRangeStart <= monthEnd ? fetchOysterOrdersRange(shippedRangeStart, monthEnd) : Promise.resolve([]),
        fetchStockOutInternalAll(),
      ]);
      const stockInByDate = {};
      allStockInRows
        .filter((r) => r.in_date >= monthStart && r.in_date <= monthEnd)
        .forEach((r) => {
          if (!stockInByDate[r.in_date]) stockInByDate[r.in_date] = [];
          stockInByDate[r.in_date].push(r);
        });
      const internalOutByDate = {};
      internalOutRows
        .filter((r) => r.out_date >= monthStart && r.out_date <= monthEnd)
        .forEach((r) => {
          if (!internalOutByDate[r.out_date]) internalOutByDate[r.out_date] = [];
          internalOutByDate[r.out_date].push(r);
        });
      // shippedByDate: 全店舗合計(⚠受注と差の判定・仕入れ先残り計算に使う。配送方法を問わず出荷した分は全部含む)。
      // truckShippedByDate/courierShippedByDate: 表示ラベル「配達」「宅配」を分けるための内訳
      // (美人罠など宅配便発送の店舗は配送トラックには載らないため)。
      const shippedByDate = {};
      const truckShippedByDate = {};
      const courierShippedByDate = {};
      shippedRows.forEach((r) => {
        const key = r.order_date;
        const isCourier = COURIER_STORE_SLUGS.has(r.store_slug);
        [shippedByDate, isCourier ? courierShippedByDate : truckShippedByDate].forEach((bucket) => {
          if (!bucket[key]) bucket[key] = { mixed: 0, s: 0, m: 0 };
          bucket[key].mixed += Number(r.mixed_boxes) || 0;
          bucket[key].s += Number(r.s_boxes) || 0;
          bucket[key].m += Number(r.m_boxes) || 0;
        });
      });

      const firstWeekday = new Date(`${monthStart}T00:00:00Z`).getUTCDay();
      const weekdayHeaders = ['日', '月', '火', '水', '木', '金', '土']
        .map((w) => `<div class="cal-weekday">${w}</div>`)
        .join('');
      const leadingBlanks = Array.from({ length: firstWeekday }, () => '<div class="cal-cell cal-empty"></div>').join('');
      const dayInfos = Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const inEntries = stockInByDate[dateStr] || [];
        const shipped = shippedByDate[dateStr];
        const truckShipped = truckShippedByDate[dateStr];
        const truckShippedTotal = truckShipped ? truckShipped.mixed + truckShipped.s + truckShipped.m : 0;
        const courierShipped = courierShippedByDate[dateStr];
        const courierShippedTotal = courierShipped ? courierShipped.mixed + courierShipped.s + courierShipped.m : 0;
        const inHtml = inEntries
          .map(
            (r) =>
              `<div class="cal-in">入 ${compactQty(
                Number(r.mixed_boxes),
                Number(r.s_boxes),
                Number(r.m_boxes)
              )}${r.note ? `(${escapeHtml(r.note)})` : ''}<button class="cal-del-btn" data-id="${r.id}">×</button></div>`
          )
          .join('');
        const outHtml =
          (truckShippedTotal > 0
            ? `<div class="cal-out cal-out-clickable" data-date="${dateStr}" data-mixed="${truckShipped.mixed}" data-s="${truckShipped.s}" data-m="${truckShipped.m}">出 ${compactQty(
                truckShipped.mixed,
                truckShipped.s,
                truckShipped.m
              )}</div>`
            : '') +
          (courierShippedTotal > 0
            ? `<div class="cal-out cal-out-clickable" data-date="${dateStr}" data-mixed="${courierShipped.mixed}" data-s="${courierShipped.s}" data-m="${courierShipped.m}">宅配 ${compactQty(
                courierShipped.mixed,
                courierShipped.s,
                courierShipped.m
              )}</div>`
            : '');
        const useEntries = internalOutByDate[dateStr] || [];
        const useHtml = useEntries
          .map((r) => {
            const purposeLabel = r.purpose === 'store' ? '店舗配達分' : '自社使用';
            const detail = [r.supplier, purposeLabel, r.note].filter(Boolean).join('・');
            return `<div class="cal-use cal-use-clickable" data-id="${r.id}" data-date="${dateStr}" data-mixed="${Number(
              r.mixed_boxes
            )}" data-s="${Number(r.s_boxes)}" data-m="${Number(r.m_boxes)}" data-supplier="${escapeHtml(
              r.supplier || ''
            )}" data-purpose="${escapeHtml(r.purpose || 'self')}" data-note="${escapeHtml(r.note || '')}">出 ${compactQty(
              Number(r.mixed_boxes),
              Number(r.s_boxes),
              Number(r.m_boxes)
            )}${detail ? `(${escapeHtml(detail)})` : ''}<button class="cal-deluse-btn" data-id="${r.id}">×</button></div>`;
          })
          .join('');

        // 受注システムの出荷数(オレンジ)と、店舗配達分として記録した仕入れ先内訳(紫・purpose==='store')の
        // 合計が一致しているかチェックする。在庫管理開始日より前は出荷データ自体を取得していないので対象外。
        let warnHtml = '';
        if (dateStr >= KAKI_STOCK_TRACKING_START_DATE) {
          const storeManualTotal = useEntries
            .filter((r) => r.purpose === 'store')
            .reduce(
              (acc, r) => {
                acc.mixed += Number(r.mixed_boxes) || 0;
                acc.s += Number(r.s_boxes) || 0;
                acc.m += Number(r.m_boxes) || 0;
                return acc;
              },
              { mixed: 0, s: 0, m: 0 }
            );
          const shippedForCompare = shipped || { mixed: 0, s: 0, m: 0 };
          const diffMixed = shippedForCompare.mixed - storeManualTotal.mixed;
          const diffS = shippedForCompare.s - storeManualTotal.s;
          const diffM = shippedForCompare.m - storeManualTotal.m;
          if (diffMixed !== 0 || diffS !== 0 || diffM !== 0) {
            warnHtml = `<div class="cal-warn cal-warn-clickable" data-date="${dateStr}" data-mixed="${Math.max(
              diffMixed,
              0
            )}" data-s="${Math.max(diffS, 0)}" data-m="${Math.max(diffM, 0)}">⚠受注と差${compactDiff(
              diffMixed,
              diffS,
              diffM
            )}</div>`;
          }
        }

        // 自社使用(purpose!=='store')の出庫のうち、仕入れ先(STOCK_SUPPLIERS)が記録されていないものを
        // チェックする。1件でもあれば、最初の1件をタップで開いて仕入れ先を直せるようにする。
        const selfUnknownEntries = useEntries.filter(
          (r) => r.purpose !== 'store' && !STOCK_SUPPLIERS.includes(r.supplier)
        );
        let selfWarnHtml = '';
        if (selfUnknownEntries.length) {
          const selfUnknownTotal = selfUnknownEntries.reduce(
            (acc, r) => {
              acc.mixed += Number(r.mixed_boxes) || 0;
              acc.s += Number(r.s_boxes) || 0;
              acc.m += Number(r.m_boxes) || 0;
              return acc;
            },
            { mixed: 0, s: 0, m: 0 }
          );
          const first = selfUnknownEntries[0];
          selfWarnHtml = `<div class="cal-warn cal-selfwarn-clickable" data-id="${first.id}" data-date="${dateStr}" data-mixed="${Number(
            first.mixed_boxes
          )}" data-s="${Number(first.s_boxes)}" data-m="${Number(first.m_boxes)}" data-supplier="${escapeHtml(
            first.supplier || ''
          )}" data-purpose="${escapeHtml(first.purpose || 'self')}" data-note="${escapeHtml(
            first.note || ''
          )}">⚠自社使用の仕入れ先未記録 ${compactQty(
            selfUnknownTotal.mixed,
            selfUnknownTotal.s,
            selfUnknownTotal.m
          )}</div>`;
        }

        // 一覧表示専用: その日の手動出庫を「店舗配送/自社使用」それぞれについて、
        // 合計とその内訳(どの仕入れ先から何個か)をセットで表示する。
        let breakdownHtml = '';
        if (useEntries.length) {
          const zero = () => ({ mixed: 0, s: 0, m: 0 });
          const addQty = (acc, r) => {
            acc.mixed += Number(r.mixed_boxes) || 0;
            acc.s += Number(r.s_boxes) || 0;
            acc.m += Number(r.m_boxes) || 0;
          };
          const qtyHasAnyLocal = (q) => q.mixed || q.s || q.m;

          // purpose('store'/'self')ごとに、合計と仕入れ先別の内訳行(インデント付き)を作る
          function purposeSection(label, entries) {
            const total = zero();
            const perSupplier = {};
            STOCK_SUPPLIERS.forEach((s) => {
              perSupplier[s] = zero();
            });
            entries.forEach((r) => {
              addQty(total, r);
              if (perSupplier[r.supplier]) addQty(perSupplier[r.supplier], r);
            });
            const supplierLines = STOCK_SUPPLIERS.filter((s) => qtyHasAnyLocal(perSupplier[s])).map(
              (s) => `<div class="cal-breakdown-sub">${escapeHtml(s)}${breakdownQty(perSupplier[s].mixed, perSupplier[s].s, perSupplier[s].m)}</div>`
            );
            return {
              total,
              html: `<div class="cal-breakdown-line">${label}${breakdownQty(total.mixed, total.s, total.m)}</div>${supplierLines.join('')}`,
            };
          }

          const storeEntries = useEntries.filter((r) => r.purpose === 'store');
          const selfEntries = useEntries.filter((r) => r.purpose !== 'store');
          const storeSection = purposeSection('店舗配送', storeEntries);
          const selfSection = purposeSection('自社使用', selfEntries);
          const grandTotal = {
            mixed: storeSection.total.mixed + selfSection.total.mixed,
            s: storeSection.total.s + selfSection.total.s,
            m: storeSection.total.m + selfSection.total.m,
          };
          breakdownHtml = `<div class="cal-breakdown">${storeSection.html}${selfSection.html}<div class="cal-breakdown-line">計${breakdownQty(
            grandTotal.mixed,
            grandTotal.s,
            grandTotal.m
          )}</div></div>`;
        }

        // カレンダー表示(グリッド)専用: 見やすさ優先で「入庫/配達/他出庫」の3行だけに簡略化する。
        // 個別の削除・仕入れ先の細かい記録/修正は一覧表示側で行う想定。
        const gridInHtml = inEntries
          .map(
            (r) =>
              `<div class="cal-in">入庫 ${compactQty(Number(r.mixed_boxes), Number(r.s_boxes), Number(r.m_boxes))}${
                r.note ? `(${escapeHtml(r.note)})` : ''
              }</div>`
          )
          .join('');
        const gridDeliveryHtml =
          (truckShippedTotal > 0
            ? `<div class="cal-out cal-out-clickable" data-date="${dateStr}" data-mixed="${truckShipped.mixed}" data-s="${truckShipped.s}" data-m="${truckShipped.m}">配達 ${compactQty(
                truckShipped.mixed,
                truckShipped.s,
                truckShipped.m
              )}</div>`
            : '') +
          (courierShippedTotal > 0
            ? `<div class="cal-out cal-out-clickable" data-date="${dateStr}" data-mixed="${courierShipped.mixed}" data-s="${courierShipped.s}" data-m="${courierShipped.m}">宅配 ${compactQty(
                courierShipped.mixed,
                courierShipped.s,
                courierShipped.m
              )}</div>`
            : '');
        const selfEntriesForGrid = useEntries.filter((r) => r.purpose !== 'store');
        const selfTotalForGrid = selfEntriesForGrid.reduce(
          (acc, r) => {
            acc.mixed += Number(r.mixed_boxes) || 0;
            acc.s += Number(r.s_boxes) || 0;
            acc.m += Number(r.m_boxes) || 0;
            return acc;
          },
          { mixed: 0, s: 0, m: 0 }
        );
        const gridOtherOutHtml =
          selfEntriesForGrid.length > 0
            ? `<div class="cal-use">他出庫 ${compactQty(selfTotalForGrid.mixed, selfTotalForGrid.s, selfTotalForGrid.m)}</div>`
            : '';

        const isToday = dateStr === todayStr();
        const hasAny = !!(inHtml || outHtml || useHtml || warnHtml || selfWarnHtml);
        return {
          day,
          dateStr,
          isToday,
          hasAny,
          inHtml,
          outHtml,
          useHtml,
          warnHtml: warnHtml + selfWarnHtml,
          breakdownHtml,
          gridInHtml,
          gridDeliveryHtml,
          gridOtherOutHtml,
        };
      });

      if (stockView === 'list') {
        const rows = dayInfos.filter((d) => d.hasAny);
        const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];
        const rowsHtml = rows.length
          ? rows
              .map((d) => {
                const dow = new Date(`${d.dateStr}T00:00:00Z`).getUTCDay();
                return `<tr class="${d.isToday ? 'cal-list-today' : ''}">
                  <td class="cal-list-date">${d.day}日(${weekdayLabels[dow]})</td>
                  <td>${d.inHtml || ''}</td>
                  <td>${d.outHtml || ''}${d.useHtml || ''}</td>
                  <td>${d.breakdownHtml || ''}${d.warnHtml || ''}</td>
                </tr>`;
              })
              .join('')
          : `<tr><td colspan="4" class="hint">この月は入出庫の記録がありません。</td></tr>`;
        calendarEl.innerHTML = `<div class="cal-list-wrap"><table class="cal-list-table">
          <thead><tr><th>日付</th><th>入庫</th><th>出庫</th><th>仕入れ先別出庫</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table></div>`;
      } else {
        const dayCells = dayInfos
          .map(
            (d) => `<div class="cal-cell${d.isToday ? ' cal-today' : ''}">
          <div class="cal-daynum">${d.day}</div>
          ${d.gridInHtml}
          ${d.gridDeliveryHtml}
          ${d.gridOtherOutHtml}
        </div>`
          )
          .join('');
        calendarEl.innerHTML = weekdayHeaders + leadingBlanks + dayCells;
      }

      calendarEl.querySelectorAll('.cal-del-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('この入庫記録を削除します。よろしいですか？')) return;
          btn.disabled = true;
          try {
            await deleteStockIn(btn.dataset.id);
            loadCalendar();
            load();
          } catch (e) {
            console.error(e);
            alert('削除に失敗しました。通信状況を確認してもう一度お試しください。');
            btn.disabled = false;
          }
        });
      });
      calendarEl.querySelectorAll('.cal-deluse-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('この出庫記録を削除します。よろしいですか？')) return;
          btn.disabled = true;
          try {
            await deleteStockOutInternal(btn.dataset.id);
            loadCalendar();
            load();
          } catch (e) {
            console.error(e);
            alert('削除に失敗しました。通信状況を確認してもう一度お試しください。');
            btn.disabled = false;
          }
        });
      });
      calendarEl.querySelectorAll('.cal-out-clickable').forEach((el) => {
        el.addEventListener('click', () => {
          selectStockOutForEdit(
            {
              id: null,
              outDate: el.dataset.date,
              mixedBoxes: Number(el.dataset.mixed) || 0,
              sBoxes: Number(el.dataset.s) || 0,
              mBoxes: Number(el.dataset.m) || 0,
              supplier: STOCK_OUT_DEFAULT_SUPPLIER,
              purpose: 'store',
              note: '',
            },
            'prefill'
          );
        });
      });
      calendarEl.querySelectorAll('.cal-use-clickable').forEach((el) => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('button')) return; // ×(削除)は個別のハンドラに任せる
          selectStockOutForEdit(
            {
              id: el.dataset.id,
              outDate: el.dataset.date,
              mixedBoxes: Number(el.dataset.mixed) || 0,
              sBoxes: Number(el.dataset.s) || 0,
              mBoxes: Number(el.dataset.m) || 0,
              supplier: el.dataset.supplier || STOCK_OUT_DEFAULT_SUPPLIER,
              purpose: el.dataset.purpose || 'self',
              note: el.dataset.note || '',
            },
            'edit'
          );
        });
      });
      calendarEl.querySelectorAll('.cal-warn-clickable').forEach((el) => {
        el.addEventListener('click', () => {
          selectStockOutForEdit(
            {
              id: null,
              outDate: el.dataset.date,
              mixedBoxes: Number(el.dataset.mixed) || 0,
              sBoxes: Number(el.dataset.s) || 0,
              mBoxes: Number(el.dataset.m) || 0,
              supplier: STOCK_OUT_DEFAULT_SUPPLIER,
              purpose: 'store',
              note: '',
            },
            'warn'
          );
        });
      });
      calendarEl.querySelectorAll('.cal-selfwarn-clickable').forEach((el) => {
        el.addEventListener('click', () => {
          selectStockOutForEdit(
            {
              id: el.dataset.id,
              outDate: el.dataset.date,
              mixedBoxes: Number(el.dataset.mixed) || 0,
              sBoxes: Number(el.dataset.s) || 0,
              mBoxes: Number(el.dataset.m) || 0,
              supplier: el.dataset.supplier || STOCK_OUT_DEFAULT_SUPPLIER,
              purpose: el.dataset.purpose || 'self',
              note: el.dataset.note || '',
            },
            'selfwarn'
          );
        });
      });
    } catch (e) {
      console.error(e);
      calendarEl.innerHTML = '<p class="msg-error">読み込みに失敗しました。</p>';
    }
  }

  async function load() {
    const asOfDate = document.getElementById('asOfDate').value || todayStr();
    balanceEl.innerHTML = '<p class="hint">読み込み中…</p>';
    try {
      const [allStockInRows, shippedRows, internalOutRows] = await Promise.all([
        fetchStockInAll(),
        fetchOysterOrdersRange(KAKI_STOCK_TRACKING_START_DATE, asOfDate),
        fetchStockOutInternalAll(),
      ]);
      const stockInRowsUpToDate = allStockInRows.filter((r) => r.in_date <= asOfDate);
      const internalOutRowsUpToDate = internalOutRows.filter(
        (r) => r.out_date <= asOfDate && r.out_date >= KAKI_STOCK_TRACKING_START_DATE
      );

      const inTotal = { mixed: 0, s: 0, m: 0 };
      stockInRowsUpToDate.forEach((r) => {
        inTotal.mixed += Number(r.mixed_boxes) || 0;
        inTotal.s += Number(r.s_boxes) || 0;
        inTotal.m += Number(r.m_boxes) || 0;
      });
      const shippedByDate = {};
      shippedRows.forEach((r) => {
        const key = r.order_date;
        if (!shippedByDate[key]) shippedByDate[key] = { mixed: 0, s: 0, m: 0 };
        shippedByDate[key].mixed += Number(r.mixed_boxes) || 0;
        shippedByDate[key].s += Number(r.s_boxes) || 0;
        shippedByDate[key].m += Number(r.m_boxes) || 0;
      });
      // 用途が「自社使用など」の分だけ全体在庫からも差し引く。「店舗配達分の記録」は
      // 発注データ側(shippedRows)ですでに全体在庫から引かれているため、ここでは
      // 仕入れ先ごとの残り計算にのみ使う(二重に引かない)。
      internalOutRowsUpToDate
        .filter((r) => r.purpose !== 'store')
        .forEach((r) => {
          const key = r.out_date;
          if (!shippedByDate[key]) shippedByDate[key] = { mixed: 0, s: 0, m: 0 };
          shippedByDate[key].mixed += Number(r.mixed_boxes) || 0;
          shippedByDate[key].s += Number(r.s_boxes) || 0;
          shippedByDate[key].m += Number(r.m_boxes) || 0;
        });
      const outTotal = { mixed: 0, s: 0, m: 0 };
      Object.values(shippedByDate).forEach((t) => {
        outTotal.mixed += t.mixed;
        outTotal.s += t.s;
        outTotal.m += t.m;
      });
      const balance = {
        mixed: inTotal.mixed - outTotal.mixed,
        s: inTotal.s - outTotal.s,
        m: inTotal.m - outTotal.m,
      };
      const totalCases = balance.mixed + balance.s + balance.m;
      const forecastMsg = buildStockoutForecast(balance, shippedByDate, asOfDate);
      const balanceHeading = asOfDate === todayStr() ? '現在庫(残り)' : `在庫(${formatDateJp(asOfDate)}時点)`;

      // 仕入れ先ごとの残り = その仕入れ先の入庫合計 − その仕入れ先を指定して記録した出庫合計
      // (用途が自社使用・店舗配達どちらでも、仕入れ先が分かっているものはすべて差し引く)
      const supplierBalance = {};
      STOCK_SUPPLIERS.forEach((s) => {
        supplierBalance[s] = { mixed: 0, s: 0, m: 0 };
      });
      stockInRowsUpToDate.forEach((r) => {
        if (supplierBalance[r.note]) {
          supplierBalance[r.note].mixed += Number(r.mixed_boxes) || 0;
          supplierBalance[r.note].s += Number(r.s_boxes) || 0;
          supplierBalance[r.note].m += Number(r.m_boxes) || 0;
        }
      });
      internalOutRowsUpToDate.forEach((r) => {
        if (supplierBalance[r.supplier]) {
          supplierBalance[r.supplier].mixed -= Number(r.mixed_boxes) || 0;
          supplierBalance[r.supplier].s -= Number(r.s_boxes) || 0;
          supplierBalance[r.supplier].m -= Number(r.m_boxes) || 0;
        }
      });

      // 店舗配達分のうち、仕入れ先が未記録の日は「標準で拓人」として拓人の残りから
      // 自動的に差し引く(牡蠣の仕入れはほぼ拓人のため)。他の仕入れ先(勝又商店・カタクチ)から
      // 出た分は、これまで通り出庫記録で明示的に記録すれば正しくそちらから引かれる。
      const shippedByDateRaw = {};
      shippedRows.forEach((r) => {
        const key = r.order_date;
        if (!shippedByDateRaw[key]) shippedByDateRaw[key] = { mixed: 0, s: 0, m: 0 };
        shippedByDateRaw[key].mixed += Number(r.mixed_boxes) || 0;
        shippedByDateRaw[key].s += Number(r.s_boxes) || 0;
        shippedByDateRaw[key].m += Number(r.m_boxes) || 0;
      });
      const attributedStoreByDate = {};
      internalOutRowsUpToDate
        .filter((r) => r.purpose === 'store')
        .forEach((r) => {
          const key = r.out_date;
          if (!attributedStoreByDate[key]) attributedStoreByDate[key] = { mixed: 0, s: 0, m: 0 };
          attributedStoreByDate[key].mixed += Number(r.mixed_boxes) || 0;
          attributedStoreByDate[key].s += Number(r.s_boxes) || 0;
          attributedStoreByDate[key].m += Number(r.m_boxes) || 0;
        });
      Object.keys(shippedByDateRaw).forEach((d) => {
        const shipped = shippedByDateRaw[d];
        const attributed = attributedStoreByDate[d] || { mixed: 0, s: 0, m: 0 };
        const unrecorded = {
          mixed: Math.max(shipped.mixed - attributed.mixed, 0),
          s: Math.max(shipped.s - attributed.s, 0),
          m: Math.max(shipped.m - attributed.m, 0),
        };
        supplierBalance[STOCK_OUT_DEFAULT_SUPPLIER].mixed -= unrecorded.mixed;
        supplierBalance[STOCK_OUT_DEFAULT_SUPPLIER].s -= unrecorded.s;
        supplierBalance[STOCK_OUT_DEFAULT_SUPPLIER].m -= unrecorded.m;
      });

      const supplierRows = STOCK_SUPPLIERS.map((s) => {
        const b = supplierBalance[s];
        return `<li><span class="recent-store">${escapeHtml(s)}</span><span class="oyster-qty">混 ${b.mixed} / S ${b.s} / M ${b.m}</span></li>`;
      }).join('');

      // 仕入れ先別・用途別(店舗配送/自社使用)の出庫内訳(混合/S/Mのサイズ別)。
      const zeroQty = () => ({ mixed: 0, s: 0, m: 0 });
      const addQtyTo = (acc, r) => {
        acc.mixed += Number(r.mixed_boxes) || 0;
        acc.s += Number(r.s_boxes) || 0;
        acc.m += Number(r.m_boxes) || 0;
      };
      const supplierPurposeBreakdown = {};
      STOCK_SUPPLIERS.forEach((s) => {
        supplierPurposeBreakdown[s] = { store: zeroQty(), self: zeroQty() };
      });
      const unknownSupplierBreakdown = { store: zeroQty(), self: zeroQty() };
      internalOutRowsUpToDate.forEach((r) => {
        const bucket = r.purpose === 'store' ? 'store' : 'self';
        if (supplierPurposeBreakdown[r.supplier]) {
          addQtyTo(supplierPurposeBreakdown[r.supplier][bucket], r);
        } else {
          addQtyTo(unknownSupplierBreakdown[bucket], r);
        }
      });
      const sumQty = (a, b) => ({ mixed: a.mixed + b.mixed, s: a.s + b.s, m: a.m + b.m });
      const qtyHasAny = (q) => q.mixed || q.s || q.m;
      const breakdownRows = STOCK_SUPPLIERS.map((s) => {
        const b = supplierPurposeBreakdown[s];
        const total = sumQty(b.store, b.self);
        return `<tr><td>${escapeHtml(s)}</td><td>${breakdownQty(b.store.mixed, b.store.s, b.store.m)}</td><td>${breakdownQty(
          b.self.mixed,
          b.self.s,
          b.self.m
        )}</td><td>${breakdownQty(total.mixed, total.s, total.m)}</td></tr>`;
      }).join('');
      const unknownTotal = sumQty(unknownSupplierBreakdown.store, unknownSupplierBreakdown.self);
      const unknownRow = qtyHasAny(unknownTotal)
        ? `<tr class="supplier-breakdown-unknown"><td>仕入れ先未記録</td><td>${breakdownQty(
            unknownSupplierBreakdown.store.mixed,
            unknownSupplierBreakdown.store.s,
            unknownSupplierBreakdown.store.m
          )}</td><td>${breakdownQty(
            unknownSupplierBreakdown.self.mixed,
            unknownSupplierBreakdown.self.s,
            unknownSupplierBreakdown.self.m
          )}</td><td>${breakdownQty(unknownTotal.mixed, unknownTotal.s, unknownTotal.m)}</td></tr>`
        : '';
      const grandStore = STOCK_SUPPLIERS.reduce(
        (sum, s) => sumQty(sum, supplierPurposeBreakdown[s].store),
        zeroQty()
      );
      const grandStoreAll = sumQty(grandStore, unknownSupplierBreakdown.store);
      const grandSelf = STOCK_SUPPLIERS.reduce((sum, s) => sumQty(sum, supplierPurposeBreakdown[s].self), zeroQty());
      const grandSelfAll = sumQty(grandSelf, unknownSupplierBreakdown.self);
      const grandAll = sumQty(grandStoreAll, grandSelfAll);

      balanceEl.innerHTML = `
        <div class="card">
          <h2>${balanceHeading}</h2>
          <span class="oyster-qty">混 ${balance.mixed} / S ${balance.s} / M ${balance.m}</span>
          <span class="recent-submitted">合計${totalCases}ケース(${totalCases * 15}kg)</span>
          <p class="stock-forecast">${escapeHtml(forecastMsg)}</p>
        </div>
        <div class="card">
          <h2>仕入れ先ごとの残り(${formatDateJp(asOfDate)}時点)</h2>
          <p class="hint">出庫記録で仕入れ先を指定した分に加えて、店舗配達分のうち仕入れ先が未記録の日は標準で拓人として計算しています(牡蠣の仕入れはほぼ拓人のため)。実際に他の仕入れ先(勝又商店・カタクチ)から出した場合は、出庫記録で明示的に記録してください。</p>
          <ul class="recent-list">${supplierRows}</ul>
        </div>`;

      // 「仕入れ先別の出庫内訳」はページ最後(カレンダー/一覧表示カードの下)に表示する。
      supplierBreakdownEl.innerHTML = `
        <div class="card">
          <h2>仕入れ先別の出庫内訳(${formatDateJp(asOfDate)}まで)</h2>
          <p class="hint">出庫記録(手動)を仕入れ先・用途別に集計した数量です(混合/S/M)。</p>
          <div class="cal-list-wrap">
            <table class="cal-list-table supplier-breakdown-table">
              <thead><tr><th>仕入れ先</th><th>店舗配送</th><th>自社使用</th><th>合計出庫</th></tr></thead>
              <tbody>
                ${breakdownRows}
                ${unknownRow}
                <tr class="supplier-breakdown-total"><td>合計</td><td>${breakdownQty(
                  grandStoreAll.mixed,
                  grandStoreAll.s,
                  grandStoreAll.m
                )}</td><td>${breakdownQty(grandSelfAll.mixed, grandSelfAll.s, grandSelfAll.m)}</td><td>${breakdownQty(
                  grandAll.mixed,
                  grandAll.s,
                  grandAll.m
                )}</td></tr>
              </tbody>
            </table>
          </div>
        </div>`;
    } catch (e) {
      console.error(e);
      balanceEl.innerHTML = '<p class="msg-error">読み込みに失敗しました。</p>';
    }
  }

  document.getElementById('stockInSubmitBtn').addEventListener('click', async () => {
    const inDate = document.getElementById('stockInDate').value;
    const mixedBoxes = Number(document.getElementById('stockInMixed').value) || 0;
    const sBoxes = Number(document.getElementById('stockInS').value) || 0;
    const mBoxes = Number(document.getElementById('stockInM').value) || 0;
    const supplier = document.getElementById('stockInSupplier').value;
    const msgEl = document.getElementById('stockInMsg');
    if (!inDate) {
      msgEl.textContent = '入庫日を選択してください。';
      msgEl.className = 'msg msg-error';
      return;
    }
    if (mixedBoxes === 0 && sBoxes === 0 && mBoxes === 0) {
      msgEl.textContent = 'ケース数を入力してください。';
      msgEl.className = 'msg msg-error';
      return;
    }
    if (
      !confirm(
        `${formatDateJp(inDate)}の入庫(混${mixedBoxes}/S${sBoxes}/M${mBoxes}・仕入れ元:${supplier})を登録します。よろしいですか？`
      )
    )
      return;
    const btn = document.getElementById('stockInSubmitBtn');
    btn.disabled = true;
    msgEl.textContent = '登録中…';
    msgEl.className = 'msg';
    try {
      await saveStockIn({ inDate, mixedBoxes, sBoxes, mBoxes, note: supplier });
      msgEl.textContent = `✓ ${formatDateJp(inDate)}の入庫を登録しました。`;
      msgEl.className = 'msg msg-success';
      document.getElementById('stockInMixed').value = 0;
      document.getElementById('stockInS').value = 0;
      document.getElementById('stockInM').value = 0;
      load();
      loadCalendar();
    } catch (e) {
      console.error(e);
      msgEl.textContent = '登録に失敗しました。通信状況を確認してもう一度お試しください。';
      msgEl.className = 'msg msg-error';
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('stockOutSubmitBtn').addEventListener('click', async () => {
    const outDate = document.getElementById('stockOutDate').value;
    const purpose = document.getElementById('stockOutPurpose').value;
    const note = document.getElementById('stockOutNote').value.trim();
    const msgEl = document.getElementById('stockOutMsg');
    const isEdit = !!editingStockOutId;
    const purposeLabel = purpose === 'store' ? '店舗配達分の記録' : '自社使用';
    if (!outDate) {
      msgEl.textContent = '出庫日を選択してください。';
      msgEl.className = 'msg msg-error';
      return;
    }
    // 編集中は常に1行のみ(add-rowボタンを隠しているので通常は1行だが念のため先頭行だけを使う)。
    // 新規登録時は、数量が入っている行だけを対象にする(空の行は無視)。
    const allRows = getBreakdownRowsData();
    const rows = isEdit ? allRows.slice(0, 1) : allRows.filter((r) => r.mixedBoxes || r.sBoxes || r.mBoxes);
    if (!rows.length) {
      msgEl.textContent = 'ケース数を入力してください。';
      msgEl.className = 'msg msg-error';
      return;
    }
    const summary = rows
      .map((r) => `${r.supplier} 混${r.mixedBoxes}/S${r.sBoxes}/M${r.mBoxes}`)
      .join('、');
    if (
      !confirm(
        `${formatDateJp(outDate)}の出庫(${summary}・${purposeLabel}${
          note ? `・${note}` : ''
        })を${isEdit ? '更新' : '登録'}します。よろしいですか？`
      )
    )
      return;
    const btn = document.getElementById('stockOutSubmitBtn');
    btn.disabled = true;
    msgEl.textContent = isEdit ? '更新中…' : '登録中…';
    msgEl.className = 'msg';
    try {
      if (isEdit) {
        const r = rows[0];
        await updateStockOutInternal(editingStockOutId, {
          outDate,
          mixedBoxes: r.mixedBoxes,
          sBoxes: r.sBoxes,
          mBoxes: r.mBoxes,
          supplier: r.supplier,
          purpose,
          note,
        });
        msgEl.textContent = `✓ ${formatDateJp(outDate)}の出庫記録を更新しました。`;
      } else {
        for (const r of rows) {
          await saveStockOutInternal({
            outDate,
            mixedBoxes: r.mixedBoxes,
            sBoxes: r.sBoxes,
            mBoxes: r.mBoxes,
            supplier: r.supplier,
            purpose,
            note,
          });
        }
        msgEl.textContent = `✓ ${formatDateJp(outDate)}の出庫を${rows.length > 1 ? `${rows.length}件` : ''}登録しました。`;
      }
      msgEl.className = 'msg msg-success';
      exitStockOutEditMode();
      resetBreakdownRows();
      document.getElementById('stockOutNote').value = '';
      load();
      loadCalendar();
    } catch (e) {
      console.error(e);
      msgEl.textContent = `${isEdit ? '更新' : '登録'}に失敗しました。通信状況を確認してもう一度お試しください。`;
      msgEl.className = 'msg msg-error';
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('stockOutCancelBtn').addEventListener('click', () => {
    clearStockOutSelection();
    document.getElementById('stockOutMsg').textContent = '';
    document.getElementById('stockOutMsg').className = 'msg';
  });

  resetBreakdownRows();
  load();
  loadCalendar();
}

// 牡蠣在庫まわり(入庫/手動出庫/発注)の変更履歴ビュー。DBトリガーが自動記録した
// kaki_stock_audit_log を、日付を指定して表示するだけの調査用ページ(?stock_audit=1)。
const STOCK_AUDIT_TABLE_LABELS = {
  kaki_stock_in: '入庫',
  kaki_stock_out_internal: '出庫(手動)',
  oyster_orders: '発注(牡蠣)',
};
const STOCK_AUDIT_OP_LABELS = { INSERT: '追加', UPDATE: '変更', DELETE: '削除' };

function describeStockAuditRow(tableName, data) {
  if (!data) return '';
  if (tableName === 'kaki_stock_in') {
    return `${data.in_date} 混${data.mixed_boxes}/S${data.s_boxes}/M${data.m_boxes} 仕入れ元:${escapeHtml(data.note || '(空欄)')}`;
  }
  if (tableName === 'kaki_stock_out_internal') {
    const purposeLabel = data.purpose === 'store' ? '店舗配達分' : '自社使用';
    return `${data.out_date} 混${data.mixed_boxes}/S${data.s_boxes}/M${data.m_boxes} ${escapeHtml(
      data.supplier || '(仕入れ先未記入)'
    )}・${purposeLabel}${data.note ? '・' + escapeHtml(data.note) : ''}`;
  }
  if (tableName === 'oyster_orders') {
    return `${data.order_date} ${escapeHtml(data.store_slug)} 混${data.mixed_boxes}/S${data.s_boxes}/M${data.m_boxes}${
      data.no_order ? '(この日は発注なし)' : ''
    }`;
  }
  return escapeHtml(JSON.stringify(data));
}

async function renderStockAuditPage() {
  const isAdminRef = new URLSearchParams(location.search).get('ref') === 'admin';
  const backToStock = `?stock=1${isAdminRef ? '&ref=admin' : ''}`;
  app.innerHTML = `
    <div class="page wide">
      <h1>牡蠣在庫の変更履歴</h1>
      ${adminBackLinkHtml()}
      <p class="hint">入庫・手動出庫・牡蠣の発注(自動出荷のもと)への追加・変更・削除を、システムが自動で記録したものです。<a href="${backToStock}">← 在庫管理ページに戻る</a></p>
      <div class="card">
        <div class="field-row">
          <div class="field">
            <label for="auditFrom">from</label>
            <input type="date" id="auditFrom" value="${todayStr()}">
          </div>
          <div class="field">
            <label for="auditTo">to</label>
            <input type="date" id="auditTo" value="${todayStr()}">
          </div>
        </div>
        <button id="auditApplyBtn" class="primary">表示</button>
      </div>
      <div id="auditResult"><p class="hint">読み込み中…</p></div>
    </div>`;

  const resultEl = document.getElementById('auditResult');

  async function load() {
    const from = document.getElementById('auditFrom').value;
    const to = document.getElementById('auditTo').value;
    if (!from || !to) return;
    resultEl.innerHTML = '<p class="hint">読み込み中…</p>';
    try {
      const rows = await fetchStockAuditLog({ from, to });
      if (!rows.length) {
        resultEl.innerHTML = '<div class="card"><p class="hint">この期間の変更記録はありません。</p></div>';
        return;
      }
      const rowsHtml = rows
        .map((r) => {
          const tableLabel = STOCK_AUDIT_TABLE_LABELS[r.table_name] || r.table_name;
          const opLabel = STOCK_AUDIT_OP_LABELS[r.operation] || r.operation;
          let bodyHtml;
          if (r.operation === 'INSERT') {
            bodyHtml = describeStockAuditRow(r.table_name, r.new_data);
          } else if (r.operation === 'DELETE') {
            bodyHtml = `<span class="audit-old">${describeStockAuditRow(r.table_name, r.old_data)}</span>`;
          } else {
            bodyHtml = `旧: <span class="audit-old">${describeStockAuditRow(
              r.table_name,
              r.old_data
            )}</span><br>新: ${describeStockAuditRow(r.table_name, r.new_data)}`;
          }
          return `<tr>
            <td class="cal-list-date">${formatDateTimeJp(r.changed_at)}</td>
            <td>${escapeHtml(tableLabel)}</td>
            <td class="audit-op audit-op-${r.operation.toLowerCase()}">${escapeHtml(opLabel)}</td>
            <td>${bodyHtml}</td>
          </tr>`;
        })
        .join('');
      resultEl.innerHTML = `<div class="card">
        <p class="hint">${rows.length}件(新しい順)</p>
        <div class="cal-list-wrap">
          <table class="cal-list-table">
            <thead><tr><th>変更日時</th><th>対象</th><th>種別</th><th>内容</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
    } catch (e) {
      console.error(e);
      resultEl.innerHTML = '<p class="msg-error">読み込みに失敗しました。</p>';
    }
  }

  document.getElementById('auditApplyBtn').addEventListener('click', load);
  load();
}

function renderTextOrderSummary(rows, stores, options = {}) {
  const showActions = options.showActions !== false;
  const dates = [...new Set(rows.map((r) => r.order_date))].sort();
  if (!dates.length) return '<div class="card"><p class="hint">この期間の発注はありません。</p></div>';
  const byKey = {};
  rows.forEach((r) => {
    byKey[`${r.order_date}__${r.store_slug}`] = r;
  });

  const dateGroups = dates
    .map((date) => {
      const storeItems = stores
        .map((s) => {
          const r = byKey[`${date}__${s.slug}`];
          if (!r || !r.content || !r.content.trim()) return '';
          const status = showActions
            ? r.confirmed_at
              ? `<span class="confirm-badge confirmed">✓ 確認済み(${formatDateTimeJp(r.confirmed_at)})</span> <button class="unconfirm-btn" data-store="${s.slug}" data-date="${date}">未確認に戻す</button>`
              : `<button class="confirm-btn" data-store="${s.slug}" data-date="${date}">確認済みにする</button>`
            : '';
          const printBtn = showActions
            ? `<button class="print-btn" data-store="${s.slug}" data-date="${date}" data-storename="${escapeHtml(
                s.name
              )}">納品明細書を印刷</button>`
            : '';
          const submittedLabel = showActions
            ? ''
            : `<span class="recent-submitted">発注日時: ${formatDateTimeJp(r.updated_at)}</span>`;
          return `<li><span class="recent-store">${escapeHtml(
            s.name
          )}</span>${submittedLabel}<span class="recent-body">${escapeHtml(r.content).replace(
            /\n/g,
            '<br>'
          )}</span>${status} ${printBtn}</li>`;
        })
        .filter(Boolean)
        .join('');
      if (!storeItems) return '';
      return `<div class="date-group"><h3 class="date-heading">${formatDateJp(
        date
      )}</h3><ul class="recent-list">${storeItems}</ul></div>`;
    })
    .filter(Boolean)
    .join('');

  return `
    <div class="card">
      <h2>注文内容一覧</h2>
      ${dateGroups || '<p class="hint">注文内容はありません。</p>'}
    </div>`;
}

function renderOysterSummary(rows, stores, options = {}) {
  const showPrint = options.showPrint === true;
  const dates = [...new Set(rows.map((r) => r.order_date))].sort();
  if (!dates.length) return '<div class="card"><p class="hint">この期間の発注はありません。</p></div>';
  const byKey = {};
  rows.forEach((r) => {
    byKey[`${r.order_date}__${r.store_slug}`] = r;
  });

  // 宅配便発送の店舗(例: 美人罠)は配送トラックには載らないため、積み込み量の目安になる
  // 「日別合計」「期間合計」からは分けて、宅配発送分として別枠で表示する。
  // (配送店舗・宅配発送店舗が混在するリストが渡された場合のみ分ける。katakuchi専用の
  // 宅配発送セクションのように、渡された店舗が全て宅配発送の場合はここでは分けない)
  const hasCourierStore = stores.some((st) => st.shipping === 'courier');
  const hasDeliveryStore = stores.some((st) => st.shipping !== 'courier');
  const splitMode = hasCourierStore && hasDeliveryStore;
  const deliveryStores = splitMode ? stores.filter((st) => st.shipping !== 'courier') : stores;
  const courierStores = splitMode ? stores.filter((st) => st.shipping === 'courier') : [];

  const sumStores = (date, targetStores) => {
    let mixed = 0;
    let s = 0;
    let m = 0;
    targetStores.forEach((st) => {
      const r = byKey[`${date}__${st.slug}`];
      if (!r) return;
      mixed += Number(r.mixed_boxes) || 0;
      s += Number(r.s_boxes) || 0;
      m += Number(r.m_boxes) || 0;
    });
    return { mixed, s, m };
  };

  const grandTotal = { mixed: 0, s: 0, m: 0 };
  const courierGrandTotal = { mixed: 0, s: 0, m: 0 };
  const dailyTotalItems = dates
    .map((date) => {
      const { mixed, s, m } = sumStores(date, deliveryStores);
      grandTotal.mixed += mixed;
      grandTotal.s += s;
      grandTotal.m += m;
      const total = mixed + s + m;
      let line = `<li><span class="recent-date">${formatDateJp(
        date
      )}</span><span class="oyster-qty">混 ${mixed} / S ${s} / M ${m}</span><span class="recent-submitted">合計${total}CS(${
        total * 15
      }kg)</span></li>`;
      if (splitMode) {
        const c = sumStores(date, courierStores);
        courierGrandTotal.mixed += c.mixed;
        courierGrandTotal.s += c.s;
        courierGrandTotal.m += c.m;
        const cTotal = c.mixed + c.s + c.m;
        if (cTotal > 0) {
          line += `<li class="courier-total"><span class="recent-date">└宅配発送分</span><span class="oyster-qty">混 ${c.mixed} / S ${c.s} / M ${c.m}</span><span class="recent-submitted">合計${cTotal}CS(${cTotal * 15}kg)</span></li>`;
        }
      }
      return line;
    })
    .join('');
  const grandTotalCases = grandTotal.mixed + grandTotal.s + grandTotal.m;
  const courierGrandTotalCases = courierGrandTotal.mixed + courierGrandTotal.s + courierGrandTotal.m;
  const grandHeadingLabel = splitMode ? '期間合計・配送分' : hasCourierStore ? '期間合計(宅配発送分)' : '期間合計';
  const grandTotalCard =
    dates.length > 1
      ? `<div class="card grand-total-card">
          <h2>${grandHeadingLabel}(${formatDateJp(dates[0])}〜${formatDateJp(dates[dates.length - 1])})</h2>
          <span class="oyster-qty">混 ${grandTotal.mixed} / S ${grandTotal.s} / M ${grandTotal.m}</span>
          <span class="recent-submitted">合計${grandTotalCases}CS(${grandTotalCases * 15}kg)</span>
          ${
            splitMode && courierGrandTotalCases > 0
              ? `<p class="hint">宅配発送分(配送トラックには含まれません): 混 ${courierGrandTotal.mixed} / S ${courierGrandTotal.s} / M ${courierGrandTotal.m}(合計${courierGrandTotalCases}CS/${courierGrandTotalCases * 15}kg)</p>`
              : ''
          }
        </div>`
      : '';

  const detailGroups = dates
    .map((date) => {
      const storeItems = stores
        .map((st) => {
          const r = byKey[`${date}__${st.slug}`];
          if (!r) return '';
          const total = (Number(r.mixed_boxes) || 0) + (Number(r.s_boxes) || 0) + (Number(r.m_boxes) || 0);
          if (!r.no_order && total === 0) return '';
          const bodyClass = r.no_order ? 'recent-body' : 'oyster-qty';
          const body = r.no_order ? '発注なし' : `混 ${r.mixed_boxes} / S ${r.s_boxes} / M ${r.m_boxes}`;
          const courierTag = splitMode && st.shipping === 'courier' ? '<span class="courier-tag">宅配発送</span>' : '';
          const status = showPrint
            ? r.confirmed_at
              ? `<span class="confirm-badge confirmed">✓ 確認済み(${formatDateTimeJp(
                  r.confirmed_at
                )})</span> <button class="unconfirm-btn-oyster" data-store="${st.slug}" data-date="${date}">未確認に戻す</button>`
              : `<button class="confirm-btn-oyster" data-store="${st.slug}" data-date="${date}">確認済みにする</button>`
            : '';
          const printBtn = showPrint
            ? `<button class="print-btn" data-store="${st.slug}" data-date="${date}" data-storename="${escapeHtml(
                st.name
              )}">納品明細書を印刷</button>`
            : '';
          return `<li><span class="recent-store">${escapeHtml(
            st.name
          )}${courierTag}</span><span class="recent-submitted">発注日時: ${formatDateTimeJp(
            r.updated_at
          )}</span><span class="${bodyClass}">${body}</span>${status} ${printBtn}</li>`;
        })
        .filter(Boolean)
        .join('');
      if (!storeItems) return '';
      return `<div class="date-group"><h3 class="date-heading">${formatDateJp(
        date
      )}</h3><ul class="recent-list">${storeItems}</ul></div>`;
    })
    .filter(Boolean)
    .join('');

  const dailyHeadingLabel = splitMode ? '日別合計・配送分' : hasCourierStore ? '日別合計(宅配発送分)' : '日別合計';
  return `
    ${grandTotalCard}
    <div class="card">
      <h2>${dailyHeadingLabel}(1ケース=15kg)</h2>
      ${splitMode ? '<p class="hint">宅配発送分(美人罠など)は含みません。配送トラックへの積み込み量の目安にご利用ください。</p>' : ''}
      <ul class="recent-list">${dailyTotalItems}</ul>
    </div>
    <div class="card">
      <h2>注文内容一覧</h2>
      ${detailGroups || '<p class="hint">注文内容はありません。</p>'}
    </div>`;
}

function renderOysterTable(rows, stores, options = {}) {
  const showTools = options.showPrint === true;
  const dates = [...new Set(rows.map((r) => r.order_date))].sort();
  if (!dates.length) return '<div class="card"><p class="hint">この期間の発注はありません。</p></div>';
  const byKey = {};
  rows.forEach((r) => {
    byKey[`${r.order_date}__${r.store_slug}`] = r;
  });

  const matrix = dates.map((date) =>
    stores.map((st) => {
      const r = byKey[`${date}__${st.slug}`];
      if (!r || r.no_order) return null;
      const mixed = Number(r.mixed_boxes) || 0;
      const s = Number(r.s_boxes) || 0;
      const m = Number(r.m_boxes) || 0;
      return { mixed, s, m, subtotal: mixed + s + m };
    })
  );

  const storeTotals = stores.map((st, si) => {
    let mixed = 0;
    let s = 0;
    let m = 0;
    matrix.forEach((row) => {
      const cell = row[si];
      if (cell) {
        mixed += cell.mixed;
        s += cell.s;
        m += cell.m;
      }
    });
    return { mixed, s, m, subtotal: mixed + s + m };
  });
  const rowTotals = matrix.map((row) => row.reduce((sum, cell) => sum + (cell ? cell.subtotal : 0), 0));
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0);

  const bodyRows = dates
    .map((date, di) => {
      const cells = stores
        .map((st, si) => {
          const cell = matrix[di][si];
          if (!cell) {
            return '<td class="cell-empty">-</td><td class="cell-empty">-</td><td class="cell-empty">-</td><td class="cell-empty">-</td>';
          }
          return `<td>${cell.mixed}</td><td>${cell.s}</td><td>${cell.m}</td><td class="subtotal">${cell.subtotal}</td>`;
        })
        .join('');
      return `<tr><td class="row-label">${formatDateJp(date)}</td>${cells}<td class="grand">${rowTotals[di]}</td></tr>`;
    })
    .join('');

  const footerCells = storeTotals
    .map((t) => `<td>${t.mixed}</td><td>${t.s}</td><td>${t.m}</td><td class="subtotal">${t.subtotal}</td>`)
    .join('');

  const headerRow1 = stores.map((s) => `<th colspan="4">${escapeHtml(s.name)}</th>`).join('');
  const headerRow2 = stores.map(() => `<th>混</th><th>S</th><th>M</th><th>小計</th>`).join('');
  const periodLabel = dates.length > 1 ? `${formatDateJp(dates[0])}〜${formatDateJp(dates[dates.length - 1])}` : formatDateJp(dates[0]);

  let toolButtons = '';
  if (showTools) {
    const xlsxBinary = buildOysterXlsx(dates, stores, matrix, storeTotals, rowTotals, grandTotal);
    const xlsxDataAttr = encodeURIComponent(xlsxBinary);
    const filename = `牡蠣受注集計_${dates[0]}_${dates[dates.length - 1]}.xlsx`;
    toolButtons = `
      <div class="table-tools">
        <button type="button" class="print-table-btn" data-period="${escapeHtml(periodLabel)}">この表を印刷</button>
        <button type="button" class="excel-export-btn" data-xlsx="${xlsxDataAttr}" data-filename="${escapeHtml(filename)}">Excel形式でダウンロード</button>
      </div>`;
  }

  return `
    <div class="card">
      <h2>店舗別集計(1ケース=15kg)</h2>
      ${toolButtons}
      <div class="table-scroll">
        <table class="agg-table">
          <thead>
            <tr><th rowspan="2">日付</th>${headerRow1}<th rowspan="2">全体合計</th></tr>
            <tr>${headerRow2}</tr>
          </thead>
          <tbody>${bodyRows}</tbody>
          <tfoot>
            <tr><td class="row-label">合計</td>${footerCells}<td class="grand">${grandTotal}</td></tr>
          </tfoot>
        </table>
      </div>
      <p class="hint">数値は箱数(ケース)。1ケース=15kg。「小計」は店舗ごとのサイズ合計、右端は全店舗合計。「-」は未発注/発注なし。</p>
    </div>`;
}

function xmlEscape(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[c]));
}

function colLetter(n) {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function xlsxCellStr(col, row, text, styleId) {
  return `<c r="${col}${row}" t="inlineStr" s="${styleId}"><is><t>${xmlEscape(text)}</t></is></c>`;
}

function xlsxCellNum(col, row, value, styleId) {
  return `<c r="${col}${row}" s="${styleId}"><v>${value}</v></c>`;
}

function buildOysterWorksheetXml(dates, stores, matrix, storeTotals, rowTotals, grandTotal) {
  const merges = [];
  const rowsXml = [];

  let col = 0;
  const r1cells = [xlsxCellStr(colLetter(col), 1, '日付', 1)];
  merges.push(`${colLetter(col)}1:${colLetter(col)}2`);
  col++;
  stores.forEach((st) => {
    const startCol = col;
    r1cells.push(xlsxCellStr(colLetter(col), 1, st.name, 1));
    merges.push(`${colLetter(startCol)}1:${colLetter(startCol + 3)}1`);
    col += 4;
  });
  r1cells.push(xlsxCellStr(colLetter(col), 1, '全体合計', 1));
  merges.push(`${colLetter(col)}1:${colLetter(col)}2`);
  rowsXml.push(`<row r="1">${r1cells.join('')}</row>`);

  col = 1;
  const r2cells = [];
  stores.forEach(() => {
    r2cells.push(xlsxCellStr(colLetter(col), 2, '混', 1));
    col++;
    r2cells.push(xlsxCellStr(colLetter(col), 2, 'S', 1));
    col++;
    r2cells.push(xlsxCellStr(colLetter(col), 2, 'M', 1));
    col++;
    r2cells.push(xlsxCellStr(colLetter(col), 2, '小計', 1));
    col++;
  });
  rowsXml.push(`<row r="2">${r2cells.join('')}</row>`);

  dates.forEach((date, di) => {
    const rNum = di + 3;
    const cells = [];
    let c = 0;
    cells.push(xlsxCellStr(colLetter(c), rNum, formatDateJp(date), 2));
    c++;
    stores.forEach((st, si) => {
      const cell = matrix[di][si];
      if (!cell) {
        cells.push(xlsxCellStr(colLetter(c), rNum, '-', 0));
        c++;
        cells.push(xlsxCellStr(colLetter(c), rNum, '-', 0));
        c++;
        cells.push(xlsxCellStr(colLetter(c), rNum, '-', 0));
        c++;
        cells.push(xlsxCellStr(colLetter(c), rNum, '-', 0));
        c++;
      } else {
        cells.push(xlsxCellNum(colLetter(c), rNum, cell.mixed, 0));
        c++;
        cells.push(xlsxCellNum(colLetter(c), rNum, cell.s, 0));
        c++;
        cells.push(xlsxCellNum(colLetter(c), rNum, cell.m, 0));
        c++;
        cells.push(xlsxCellNum(colLetter(c), rNum, cell.subtotal, 2));
        c++;
      }
    });
    cells.push(xlsxCellNum(colLetter(c), rNum, rowTotals[di], 2));
    rowsXml.push(`<row r="${rNum}">${cells.join('')}</row>`);
  });

  const footerRowNum = dates.length + 3;
  const fcells = [];
  let fc = 0;
  fcells.push(xlsxCellStr(colLetter(fc), footerRowNum, '合計', 1));
  fc++;
  storeTotals.forEach((t) => {
    fcells.push(xlsxCellNum(colLetter(fc), footerRowNum, t.mixed, 1));
    fc++;
    fcells.push(xlsxCellNum(colLetter(fc), footerRowNum, t.s, 1));
    fc++;
    fcells.push(xlsxCellNum(colLetter(fc), footerRowNum, t.m, 1));
    fc++;
    fcells.push(xlsxCellNum(colLetter(fc), footerRowNum, t.subtotal, 1));
    fc++;
  });
  fcells.push(xlsxCellNum(colLetter(fc), footerRowNum, grandTotal, 1));
  rowsXml.push(`<row r="${footerRowNum}">${fcells.join('')}</row>`);

  const mergeCellsXml = merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml.join(
    ''
  )}</sheetData><mergeCells count="${merges.length}">${mergeCellsXml}</mergeCells></worksheet>`;
}

const XLSX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const XLSX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const XLSX_WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="牡蠣受注集計" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const XLSX_WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const XLSX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F0EC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs></styleSheet>`;

function crc32(bytes) {
  if (!crc32.table) {
    const table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crc32.table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bytesToBinaryString(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function buildZipBinaryString(files) {
  const encoder = new TextEncoder();
  let localSection = '';
  const centralParts = [];
  let offset = 0;

  files.forEach(({ name, content }) => {
    const nameBytes = encoder.encode(name);
    const contentBytes = encoder.encode(content);
    const crc = crc32(contentBytes);
    const size = contentBytes.length;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localSection += bytesToBinaryString(localHeader) + bytesToBinaryString(contentBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(bytesToBinaryString(centralHeader));
    offset += localHeader.length + contentBytes.length;
  });

  const centralSection = centralParts.join('');
  const centralOffset = offset;
  const centralSize = centralSection.length;

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);

  return localSection + centralSection + bytesToBinaryString(end);
}

function buildOysterXlsx(dates, stores, matrix, storeTotals, rowTotals, grandTotal) {
  const sheetXml = buildOysterWorksheetXml(dates, stores, matrix, storeTotals, rowTotals, grandTotal);
  return buildZipBinaryString([
    { name: '[Content_Types].xml', content: XLSX_CONTENT_TYPES },
    { name: '_rels/.rels', content: XLSX_RELS },
    { name: 'xl/workbook.xml', content: XLSX_WORKBOOK },
    { name: 'xl/_rels/workbook.xml.rels', content: XLSX_WORKBOOK_RELS },
    { name: 'xl/styles.xml', content: XLSX_STYLES },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml },
  ]);
}

function downloadXlsx(binaryStr, filename) {
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i) & 0xff;
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function bindPrintTableButtons(container) {
  container.querySelectorAll('.print-table-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const table = btn.closest('.card').querySelector('.agg-table');
      if (table) printAggregateTable(table, btn.dataset.period || '');
    });
  });
  container.querySelectorAll('.excel-export-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const xlsxBinary = decodeURIComponent(btn.dataset.xlsx || '');
      downloadXlsx(xlsxBinary, btn.dataset.filename || 'export.xlsx');
    });
  });
}

function printAggregateTable(tableEl, periodLabel) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    alert('ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。');
    return;
  }
  win.document.write(`<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>牡蠣受注集計表</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif; color: #1a1a1a; background: #fff; padding: 0; }
  h1 { font-size: 18px; margin: 0 0 2mm; }
  .subtitle { font-size: 12px; color: #555; margin: 0 0 6mm; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  th, td { border: 1px solid #999; padding: 3px 5px; text-align: center; white-space: nowrap; }
  thead th { background: #eee; font-weight: 700; }
  tfoot td { background: #eee; font-weight: 700; }
  .row-label { text-align: left; font-weight: 700; }
  .subtotal, .grand { font-weight: 700; }
</style></head>
<body>
  <h1>牡蠣受注集計表</h1>
  <p class="subtitle">対象期間: ${escapeHtml(periodLabel)} / 発行日: ${formatDateJp(todayStr())}</p>
  ${tableEl.outerHTML}
</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function printDeliverySlip(storeName, date, content) {
  const win = window.open('', '_blank', 'width=650,height=800');
  if (!win) {
    alert('ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。');
    return;
  }
  const bodyHtml = escapeHtml(content).replace(/\n/g, '<br>');
  win.document.write(`<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>納品明細書 ${escapeHtml(storeName)} ${escapeHtml(date)}</title>
<style>
  @page { size: A5 landscape; margin: 10mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif; padding: 6mm 10mm; color: #1a1a1a; background: #fff; }
  h1 { font-size: 20px; text-align: center; margin: 0 0 4mm; letter-spacing: 6px; }
  .to { font-size: 18px; font-weight: 700; margin: 0 0 4mm; border-bottom: 2px solid #333; padding-bottom: 3mm; }
  .row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4mm; color: #444; }
  .content { font-size: 15px; line-height: 1.7; white-space: pre-wrap; border: 1px solid #ccc; border-radius: 6px; padding: 4mm 6mm; min-height: 40mm; }
  .footer { margin-top: 4mm; font-size: 12px; text-align: right; color: #555; }
</style></head>
<body>
  <h1>納品明細書</h1>
  <div class="to">${escapeHtml(storeName)} 御中</div>
  <div class="row"><span>発注日: ${formatDateJp(date)}</span><span>発行日: ${formatDateJp(todayStr())}</span></div>
  <div class="content">${bodyHtml}</div>
  <div class="footer">カタクチ商店</div>
</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

route();
