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

function orderDeadline(dateStr, category) {
  const def = PRODUCT_DEFS[category];
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  if (def.skipNonBusinessDays) {
    while (!isBusinessDay(d)) {
      d.setDate(d.getDate() - 1);
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

// 商品カテゴリごとの入力欄・保存/取得ロジックの定義。pizzaは自由記述のcontent、oysterはケース数の3項目。
const PRODUCT_DEFS = {
  pizza: {
    label: 'ピザ',
    deadlineHour: 12,
    skipNonBusinessDays: true,
    deadlineLabel: '前営業日(土日祝を除く) 12:00',
    fieldsHtml: (id) => `
      <div class="field">
        <label for="${id}-content">注文内容(商品名・個数・キロ数など自由に記入)</label>
        <textarea id="${id}-content" rows="6" placeholder="例) マルゲリータ 3枚&#10;シーフード 2枚"></textarea>
      </div>`,
    readValue: (id) => ({ content: document.getElementById(`${id}-content`).value.trim() }),
    fillValue: (id, row) => {
      document.getElementById(`${id}-content`).value = row ? row.content : '';
    },
    clearValue: (id) => {
      document.getElementById(`${id}-content`).value = '';
    },
    hasValue: (row) => !!(row && row.content && row.content.trim()),
    recentText: (row) => escapeHtml(row.content).replace(/\n/g, '<br>'),
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
          <input type="number" id="${id}-mixed" min="0" step="1" value="0">
        </div>
        <div class="field">
          <label for="${id}-s">Sサイズ(ケース)</label>
          <input type="number" id="${id}-s" min="0" step="1" value="0">
        </div>
        <div class="field">
          <label for="${id}-m">Mサイズ(ケース)</label>
          <input type="number" id="${id}-m" min="0" step="1" value="0">
        </div>
      </div>`,
    readValue: (id) => {
      const noOrder = document.getElementById(`${id}-noOrder`).checked;
      return {
        mixedBoxes: noOrder ? 0 : Number(document.getElementById(`${id}-mixed`).value) || 0,
        sBoxes: noOrder ? 0 : Number(document.getElementById(`${id}-s`).value) || 0,
        mBoxes: noOrder ? 0 : Number(document.getElementById(`${id}-m`).value) || 0,
        noOrder,
      };
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
      if (!document.getElementById(`${id}-noOrder`).checked) return;
      ['mixed', 's', 'm'].forEach((k) => {
        const el = document.getElementById(`${id}-${k}`);
        el.disabled = true;
        el.value = 0;
      });
    },
    hasValue: (row) => !!row,
    recentText: (row) =>
      row.no_order ? '発注なし' : `混合${row.mixed_boxes}ケース / S${row.s_boxes}ケース / M${row.m_boxes}ケース`,
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
  if (storeSlug) return renderOrderPage(storeSlug);
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

function mountProductSection(container, store, category) {
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
        <input type="date" id="${id}-date" value="${todayStr()}">
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

  function applyLockState() {
    fieldsEl.querySelectorAll('input, textarea').forEach((el) => {
      el.disabled = locked;
    });
    if (def.applyExtraFieldState) def.applyExtraFieldState(id);
    submitBtn.disabled = locked;
    cancelBtn.style.display = hasExisting && !locked ? '' : 'none';
    if (locked) {
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

  async function loadForDate() {
    msgEl.textContent = '';
    msgEl.className = 'msg';
    const date = dateInput.value;
    if (!date) return;
    locked = isPastDeadline(date, category);
    try {
      const row = await def.fetchOne(store.slug, date);
      def.fillValue(id, row);
      hasExisting = def.hasValue(row);
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
            )}</span><span class="recent-body">${def.recentText(r)}</span></li>`
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
    if (isPastDeadline(date, category)) {
      msgEl.textContent = `締切(${formatDeadlineJp(date, category)})を過ぎているため発注できません。`;
      msgEl.className = 'msg msg-error';
      return;
    }
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
    if (!date || !hasExisting || isPastDeadline(date, category)) return;
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
    <div class="page">
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
      const sections = await Promise.all(
        shop.categories.map(async (category) => {
          const def = PRODUCT_DEFS[category];
          const stores = STORES_BY_CATEGORY[category];
          const rows = await def.fetchRange(from, to);
          const heading = shop.categories.length > 1 ? `<h2 class="section-title">${def.label}</h2>` : '';
          const body = category === 'oyster' ? renderOysterSummary(rows, stores) : renderTextOrderSummary(rows, stores);
          return heading + body;
        })
      );
      summaryEl.innerHTML = sections.join('');
    } catch (e) {
      console.error(e);
      summaryEl.innerHTML = '<p class="msg-error">読み込みに失敗しました。</p>';
    }
  }

  load();
}

function renderTextOrderSummary(rows, stores) {
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
        return `<li><span class="recent-date">${formatDateJp(date)} <span class="recent-store">${escapeHtml(
          s.name
        )}</span></span><span class="recent-body">${escapeHtml(r.content).replace(/\n/g, '<br>')}</span></li>`;
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
      )}</span><span class="recent-body">混合${mixed}ケース / Sサイズ${s}ケース / Mサイズ${m}ケース / 合計${total}ケース(${
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
        const body = r.no_order
          ? '発注なし'
          : `混合${r.mixed_boxes}ケース / S${r.s_boxes}ケース / M${r.m_boxes}ケース(${total * 15}kg)`;
        return `<li><span class="recent-date">${formatDateJp(date)} <span class="recent-store">${escapeHtml(
          st.name
        )}</span></span><span class="recent-body">${body}</span></li>`;
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

route();
