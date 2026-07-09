const STORES = [
  { slug: 'bansui', name: '晩翠通り店', categories: ['pizza'] },
  { slug: 'pizzarokko', name: 'ピザろっこ', categories: ['pizza'] },
  { slug: 'asakusa', name: '浅草店', categories: ['pizza'] },
  { slug: 'kaki-rokko', name: '牡蠣小屋ろっこ', categories: ['oyster', 'pizza'] },
  { slug: 'kaki-mouikko', name: '牡蠣小屋もういっこ', categories: ['oyster'] },
  { slug: 'kaki-higashiichi', name: '牡蠣小屋東一店', categories: ['oyster', 'whelk'] },
  { slug: 'kai-hakko', name: '貝小屋はっこ', categories: ['oyster'] },
];

const PIZZA_STORES = STORES.filter((s) => s.categories.includes('pizza'));
const OYSTER_STORES = STORES.filter((s) => s.categories.includes('oyster'));
const WHELK_STORES = STORES.filter((s) => s.categories.includes('whelk'));
const STORES_BY_CATEGORY = { pizza: PIZZA_STORES, oyster: OYSTER_STORES, whelk: WHELK_STORES };

const ADMIN_SHOPS = {
  katakuchi: { name: 'カタクチ商店', categories: ['pizza'] },
  'kaki-juchu': { name: '牡蠣受注店', categories: ['oyster', 'whelk'] },
  'haiso-juchu': { name: '配送受注店', categories: ['pizza', 'oyster', 'whelk'] },
};

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

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function formatDateJp(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`;
}

// 商品カテゴリごとの入力欄・保存/取得ロジックの定義。
// pizza / whelk は自由記述のcontent、oysterは箱数の3項目。
const PRODUCT_DEFS = {
  pizza: {
    label: 'ピザ',
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
    fieldsHtml: (id) => `
      <div class="field-row">
        <div class="field">
          <label for="${id}-mixed">混合(箱・15kg/箱)</label>
          <input type="number" id="${id}-mixed" min="0" step="1" value="0">
        </div>
        <div class="field">
          <label for="${id}-s">Sサイズ(箱)</label>
          <input type="number" id="${id}-s" min="0" step="1" value="0">
        </div>
        <div class="field">
          <label for="${id}-m">Mサイズ(箱)</label>
          <input type="number" id="${id}-m" min="0" step="1" value="0">
        </div>
      </div>`,
    readValue: (id) => ({
      mixedBoxes: Number(document.getElementById(`${id}-mixed`).value) || 0,
      sBoxes: Number(document.getElementById(`${id}-s`).value) || 0,
      mBoxes: Number(document.getElementById(`${id}-m`).value) || 0,
    }),
    fillValue: (id, row) => {
      document.getElementById(`${id}-mixed`).value = row ? row.mixed_boxes : 0;
      document.getElementById(`${id}-s`).value = row ? row.s_boxes : 0;
      document.getElementById(`${id}-m`).value = row ? row.m_boxes : 0;
    },
    clearValue: (id) => {
      document.getElementById(`${id}-mixed`).value = 0;
      document.getElementById(`${id}-s`).value = 0;
      document.getElementById(`${id}-m`).value = 0;
    },
    hasValue: (row) => !!row,
    recentText: (row) => `混合${row.mixed_boxes} / S${row.s_boxes} / M${row.m_boxes}`,
    fetchOne: fetchOysterOrder,
    save: (base, values) => saveOysterOrder({ ...base, ...values }),
    fetchRecent: fetchOysterOrdersByStore,
    fetchRange: fetchOysterOrdersRange,
    del: deleteOysterOrder,
  },
  whelk: {
    label: 'つぶ貝',
    fieldsHtml: (id) => `
      <div class="field">
        <label for="${id}-content">注文内容(商品名・個数・キロ数など自由に記入)</label>
        <textarea id="${id}-content" rows="6" placeholder="例) つぶ貝 5キロ"></textarea>
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
    fetchOne: fetchWhelkOrder,
    save: (base, values) => saveWhelkOrder({ ...base, ...values }),
    fetchRecent: fetchWhelkOrdersByStore,
    fetchRange: fetchWhelkOrdersRange,
    del: deleteWhelkOrder,
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
      <div class="card">
        <h2>各店舗の発注</h2>
        <ul class="home-links">${storeLinks}</ul>
      </div>
      <div class="card">
        <h2>受注集計</h2>
        <ul class="home-links">
          <li><a href="?shop=katakuchi">カタクチ商店(ピザ集計)</a></li>
          <li><a href="?shop=kaki-juchu">牡蠣受注店(牡蠣・つぶ貝集計)</a></li>
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
      <div class="field">
        <label for="${id}-date">発注日</label>
        <input type="date" id="${id}-date" value="${todayStr()}">
      </div>
      ${def.fieldsHtml(id)}
      <button id="${id}-submitBtn" class="primary">この内容で発注する</button>
      <button id="${id}-cancelBtn" class="secondary" style="display:none">この日の発注をキャンセルする</button>
      <p id="${id}-msg" class="msg"></p>
      <h3 style="margin:20px 0 12px;font-size:14px;">これまでの発注(直近10件・タップで選択)</h3>
      <div id="${id}-recent">読み込み中…</div>
    </div>`
  );

  const dateInput = document.getElementById(`${id}-date`);
  const msgEl = document.getElementById(`${id}-msg`);
  const cancelBtn = document.getElementById(`${id}-cancelBtn`);
  const submitBtn = document.getElementById(`${id}-submitBtn`);
  const recentEl = document.getElementById(`${id}-recent`);
  let hasExisting = false;

  async function loadForDate() {
    msgEl.textContent = '';
    msgEl.className = 'msg';
    const date = dateInput.value;
    if (!date) return;
    try {
      const row = await def.fetchOne(store.slug, date);
      def.fillValue(id, row);
      hasExisting = def.hasValue(row);
      cancelBtn.style.display = hasExisting ? '' : 'none';
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
    submitBtn.disabled = true;
    msgEl.textContent = '送信中…';
    msgEl.className = 'msg';
    try {
      const values = def.readValue(id);
      await def.save({ storeSlug: store.slug, storeName: store.name, date }, values);
      msgEl.textContent = `${formatDateJp(date)}の発注を保存しました。`;
      msgEl.className = 'msg msg-success';
      hasExisting = true;
      cancelBtn.style.display = '';
      loadRecent();
    } catch (e) {
      console.error(e);
      msgEl.textContent = '保存に失敗しました。通信状況を確認してもう一度お試しください。';
      msgEl.className = 'msg msg-error';
    } finally {
      submitBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener('click', async () => {
    const date = dateInput.value;
    if (!date || !hasExisting) return;
    if (!confirm(`${formatDateJp(date)}の発注をキャンセルします。よろしいですか？`)) return;
    cancelBtn.disabled = true;
    msgEl.textContent = 'キャンセル中…';
    msgEl.className = 'msg';
    try {
      await def.del(store.slug, date);
      def.clearValue(id);
      hasExisting = false;
      cancelBtn.style.display = 'none';
      msgEl.textContent = `${formatDateJp(date)}の発注をキャンセルしました。`;
      msgEl.className = 'msg msg-success';
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
  const defaultFrom = addDays(todayStr(), -13);
  const defaultTo = todayStr();

  app.innerHTML = `
    <div class="page">
      <h1>${escapeHtml(shop.name)}</h1>
      <p class="hint">${subtitle}</p>
      <div class="card">
        <div class="field-row">
          <div class="field">
            <label for="fromDate">開始日</label>
            <input type="date" id="fromDate" value="${defaultFrom}">
          </div>
          <div class="field">
            <label for="toDate">終了日</label>
            <input type="date" id="toDate" value="${defaultTo}">
          </div>
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
      return `<li><span class="recent-date">${formatDateJp(
        date
      )}</span><span class="recent-body">混合${mixed} / Sサイズ${s} / Mサイズ${m} / 合計${mixed + s + m}箱</span></li>`;
    })
    .join('');

  const detailItems = dates
    .flatMap((date) =>
      stores.map((st) => {
        const r = byKey[`${date}__${st.slug}`];
        if (!r) return '';
        const total = (Number(r.mixed_boxes) || 0) + (Number(r.s_boxes) || 0) + (Number(r.m_boxes) || 0);
        if (total === 0) return '';
        return `<li><span class="recent-date">${formatDateJp(date)} <span class="recent-store">${escapeHtml(
          st.name
        )}</span></span><span class="recent-body">混合${r.mixed_boxes} / S${r.s_boxes} / M${r.m_boxes}</span></li>`;
      })
    )
    .filter(Boolean)
    .join('');

  return `
    <div class="card">
      <h2>日別合計(15kg/箱)</h2>
      <ul class="recent-list">${dailyTotalItems}</ul>
    </div>
    <div class="card">
      <h2>注文内容一覧</h2>
      <ul class="recent-list">${detailItems || '<li class="hint">注文内容はありません。</li>'}</ul>
    </div>`;
}

route();
