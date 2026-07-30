const STORES = [
  { slug: 'bansui', name: '晩翠通り店', categories: ['pizza'] },
  { slug: 'pizzarokko', name: 'ピザろっこ', categories: ['pizza'] },
  { slug: 'asakusa', name: '浅草店', categories: ['pizza'] },
  { slug: 'kaki-rokko', name: '牡蠣小屋ろっこ', categories: ['oyster', 'pizza'] },
  { slug: 'kaki-mouikko', name: '牡蠣小屋もういっこ', categories: ['oyster'] },
  { slug: 'kaki-higashiichi', name: '牡蠣小屋東一店', categories: ['oyster'] },
  { slug: 'kai-hakko', name: '貝小屋はっこ', categories: ['oyster'] },
];

const PIZZA_STORES = STORES.filter((s) => s.categories.includes('pizza'));
const OYSTER_STORES = STORES.filter((s) => s.categories.includes('oyster'));
const STORES_BY_CATEGORY = { pizza: PIZZA_STORES, oyster: OYSTER_STORES };

const ADMIN_SHOPS = {
  katakuchi: { name: 'カタクチ商店', categories: ['pizza'] },
  'kaki-juchu': { name: '牡蠣受注店', categories: ['oyster'] },
  'haiso-juchu': { name: '配送受注店', categories: ['pizza', 'oyster'] },
};

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

function qtyOptionsHtml() {
  let html = '';
  for (let i = 0; i <= 10; i++) {
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
      ['mixed', 's', 'm'].forEach((k) => {
        const el = document.getElementById(`${id}-${k}`);
        if (noOrder) {
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
        : `混合${row.mixed_boxes}ケース / S${row.s_boxes}ケース / M${row.m_boxes}ケース<span class="recent-kg">混合${
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
  if (isParent) return renderParentOrderPage();
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
  const defaultFrom = todayStr();
  const defaultTo = todayStr();

  app.innerHTML = `
    <div class="page wide">
      <h1>${escapeHtml(shop.name)}</h1>
      <p class="hint">${subtitle}</p>
      <div class="card">
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
    const summaryEl = document.getElementById('summary');
    summaryEl.innerHTML = '<p class="hint">読み込み中…</p>';
    try {
      const pizzaRowsByKey = {};
      const sections = await Promise.all(
        shop.categories.map(async (category) => {
          const def = PRODUCT_DEFS[category];
          const stores = STORES_BY_CATEGORY[category];
          const rows = await def.fetchRange(from, to);
          if (category === 'pizza') {
            rows.forEach((r) => {
              pizzaRowsByKey[`${r.order_date}__${r.store_slug}`] = r;
            });
          }
          const heading = shop.categories.length > 1 ? `<h2 class="section-title">${def.label}</h2>` : '';
          const body =
            category === 'oyster'
              ? renderOysterSummary(rows, stores)
              : renderTextOrderSummary(rows, stores, { showActions: slug === 'katakuchi' });
          return heading + body;
        })
      );
      summaryEl.innerHTML = sections.join('');
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
      summaryEl.querySelectorAll('.print-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = pizzaRowsByKey[`${btn.dataset.date}__${btn.dataset.store}`];
          if (row) printDeliverySlip(btn.dataset.storename, btn.dataset.date, row.content);
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

function renderTextOrderSummary(rows, stores, options = {}) {
  const showActions = options.showActions !== false;
  const dates = [...new Set(rows.map((r) => r.order_date))].sort();
  if (!dates.length) return '<div class="card"><p class="hint">この期間の発注はありません。</p></div>';
  const byKey = {};
  rows.forEach((r) => {
    byKey[`${r.order_date}__${r.store_slug}`] = r;
  });

  const detailItems = dates
    .flatMap((date) =>
      stores.map((s) => {
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
        const storeLabel = showActions
          ? `<span class="recent-store">${escapeHtml(s.name)}</span>`
          : `<span class="recent-store">${escapeHtml(s.name)}</span><span class="recent-submitted">発注日時: ${formatDateTimeJp(
              r.updated_at
            )}</span>`;
        return `<li><span class="recent-date">${formatDateJp(
          date
        )} ${storeLabel}</span><span class="recent-body">${escapeHtml(r.content).replace(
          /\n/g,
          '<br>'
        )}</span>${status} ${printBtn}</li>`;
      })
    )
    .filter(Boolean)
    .join('');

  return `
    <div class="card">
      <h2>注文内容一覧</h2>
      <ul class="recent-list">${detailItems || '<li class="hint">注文内容はありません。</li>'}</ul>
    </div>`;
}

function renderOysterSummary(rows, stores) {
  const dates = [...new Set(rows.map((r) => r.order_date))].sort();
  if (!dates.length) return '<div class="card"><p class="hint">この期間の発注はありません。</p></div>';
  const byKey = {};
  rows.forEach((r) => {
    byKey[`${r.order_date}__${r.store_slug}`] = r;
  });

  const dailyTotalItems = dates
    .map((date) => {
      let mixed = 0;
      let s = 0;
      let m = 0;
      stores.forEach((st) => {
        const r = byKey[`${date}__${st.slug}`];
        if (!r) return;
        mixed += Number(r.mixed_boxes) || 0;
        s += Number(r.s_boxes) || 0;
        m += Number(r.m_boxes) || 0;
      });
      const total = mixed + s + m;
      return `<li><span class="recent-date">${formatDateJp(
        date
      )}</span><span class="oyster-qty">混合 ${mixed} / S ${s} / M ${m}</span><span class="recent-submitted">合計${total}CS(${
        total * 15
      }kg)</span></li>`;
    })
    .join('');

  const detailItems = dates
    .flatMap((date) =>
      stores.map((st) => {
        const r = byKey[`${date}__${st.slug}`];
        if (!r) return '';
        const total = (Number(r.mixed_boxes) || 0) + (Number(r.s_boxes) || 0) + (Number(r.m_boxes) || 0);
        if (!r.no_order && total === 0) return '';
        const bodyClass = r.no_order ? 'recent-body' : 'oyster-qty';
        const body = r.no_order ? '発注なし' : `混合 ${r.mixed_boxes} / S ${r.s_boxes} / M ${r.m_boxes}`;
        return `<li><span class="recent-date">${formatDateJp(date)} <span class="recent-store">${escapeHtml(
          st.name
        )}</span><span class="recent-submitted">発注日時: ${formatDateTimeJp(
          r.updated_at
        )}</span></span><span class="${bodyClass}">${body}</span></li>`;
      })
    )
    .filter(Boolean)
    .join('');

  return `
    <div class="card">
      <h2>日別合計(1ケース=15kg)</h2>
      <ul class="recent-list">${dailyTotalItems}</ul>
    </div>
    <div class="card">
      <h2>注文内容一覧</h2>
      <ul class="recent-list">${detailItems || '<li class="hint">注文内容はありません。</li>'}</ul>
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
  const headerRow2 = stores.map(() => `<th>混合</th><th>S</th><th>M</th><th>小計</th>`).join('');
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
    r2cells.push(xlsxCellStr(colLetter(col), 2, '混合', 1));
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
