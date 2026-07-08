const PIZZA_STORES = [
  { slug: 'bansui', name: '晩翠通り店' },
  { slug: 'pizzarokko', name: 'ピザろっこ' },
  { slug: 'asakusa', name: '浅草店' },
];

const OYSTER_STORES = [
  { slug: 'kaki-rokko', name: '牡蠣小屋ろっこ' },
  { slug: 'kaki-mouikko', name: '牡蠣小屋もういっこ' },
  { slug: 'kaki-higashiichi', name: '牡蠣小屋東一店' },
  { slug: 'kai-hakko', name: '貝小屋はっこ' },
];

const ADMIN_SHOPS = {
  katakuchi: { type: 'pizza', name: 'カタクチ商店' },
  'kaki-juchu': { type: 'oyster', name: '牡蠣受注店' },
  'haiso-juchu': { type: 'all', name: '配送受注店' },
};

function findStore(slug) {
  const p = PIZZA_STORES.find((s) => s.slug === slug);
  if (p) return { ...p, type: 'pizza' };
  const o = OYSTER_STORES.find((s) => s.slug === slug);
  if (o) return { ...o, type: 'oyster' };
  return null;
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
  const pizzaLinks = PIZZA_STORES.map((s) => `<li><a href="?store=${s.slug}">${escapeHtml(s.name)}</a></li>`).join('');
  const oysterLinks = OYSTER_STORES.map((s) => `<li><a href="?store=${s.slug}">${escapeHtml(s.name)}</a></li>`).join('');
  app.innerHTML = `
    <div class="page">
      <h1>カタクチ商店 受発注システム</h1>
      <p class="hint">このページのリンクを各店舗・受注担当者に共有してください。URLを知っている人だけがアクセスできる運用です。</p>
      <div class="card">
        <h2>ピザ発注(各店舗)</h2>
        <ul class="home-links">${pizzaLinks}</ul>
      </div>
      <div class="card">
        <h2>牡蠣発注(各店舗)</h2>
        <ul class="home-links">${oysterLinks}</ul>
      </div>
      <div class="card">
        <h2>受注集計</h2>
        <ul class="home-links">
          <li><a href="?shop=katakuchi">カタクチ商店(ピザ集計)</a></li>
          <li><a href="?shop=kaki-juchu">牡蠣受注店(牡蠣集計)</a></li>
          <li><a href="?shop=haiso-juchu">配送受注店(ピザ・牡蠣 全集計)</a></li>
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
  const isPizza = store.type === 'pizza';

  app.innerHTML = `
    <div class="page">
      <h1>${escapeHtml(store.name)}</h1>
      <p class="hint">${isPizza ? 'ピザの発注' : '牡蠣の発注'}</p>
      <div class="card">
        <div class="field">
          <label for="orderDate">発注日</label>
          <input type="date" id="orderDate" value="${todayStr()}">
        </div>
        ${
          isPizza
            ? `
          <div class="field">
            <label for="pizzaContent">注文内容(商品名・個数・キロ数など自由に記入)</label>
            <textarea id="pizzaContent" rows="6" placeholder="例) マルゲリータ 3枚&#10;シーフード 2枚"></textarea>
          </div>`
            : `
          <div class="field-row">
            <div class="field">
              <label for="mixedBoxes">混合(箱・15kg/箱)</label>
              <input type="number" id="mixedBoxes" min="0" step="1" value="0">
            </div>
            <div class="field">
              <label for="sBoxes">Sサイズ(箱)</label>
              <input type="number" id="sBoxes" min="0" step="1" value="0">
            </div>
            <div class="field">
              <label for="mBoxes">Mサイズ(箱)</label>
              <input type="number" id="mBoxes" min="0" step="1" value="0">
            </div>
          </div>`
        }
        <button id="submitBtn" class="primary">この内容で発注する</button>
        <button id="cancelBtn" class="secondary" style="display:none">この日の発注をキャンセルする</button>
        <p id="orderMsg" class="msg"></p>
      </div>
      <div class="card">
        <h2>これまでの発注(直近10件・タップで選択)</h2>
        <div id="recentList">読み込み中…</div>
      </div>
    </div>`;

  const dateInput = document.getElementById('orderDate');
  const msgEl = document.getElementById('orderMsg');
  const cancelBtn = document.getElementById('cancelBtn');
  let hasExisting = false;

  async function loadForDate() {
    msgEl.textContent = '';
    msgEl.className = 'msg';
    const date = dateInput.value;
    if (!date) return;
    try {
      if (isPizza) {
        const row = await fetchPizzaOrder(store.slug, date);
        document.getElementById('pizzaContent').value = row ? row.content : '';
        hasExisting = !!row;
      } else {
        const row = await fetchOysterOrder(store.slug, date);
        document.getElementById('mixedBoxes').value = row ? row.mixed_boxes : 0;
        document.getElementById('sBoxes').value = row ? row.s_boxes : 0;
        document.getElementById('mBoxes').value = row ? row.m_boxes : 0;
        hasExisting = !!row;
      }
      cancelBtn.style.display = hasExisting ? '' : 'none';
    } catch (e) {
      console.error(e);
      msgEl.textContent = '読み込みに失敗しました。通信状況を確認してください。';
      msgEl.className = 'msg msg-error';
    }
  }

  async function loadRecent() {
    const listEl = document.getElementById('recentList');
    try {
      const rows = isPizza
        ? await fetchPizzaOrdersByStore(store.slug, 10)
        : await fetchOysterOrdersByStore(store.slug, 10);
      if (!rows.length) {
        listEl.innerHTML = '<p class="hint">まだ発注履歴がありません。</p>';
        return;
      }
      listEl.innerHTML = `<ul class="recent-list">${rows
        .map((r) => {
          if (isPizza) {
            return `<li class="clickable" data-date="${r.order_date}"><span class="recent-date">${formatDateJp(
              r.order_date
            )}</span><span class="recent-body">${escapeHtml(r.content).replace(/\n/g, '<br>')}</span></li>`;
          }
          return `<li class="clickable" data-date="${r.order_date}"><span class="recent-date">${formatDateJp(
            r.order_date
          )}</span><span class="recent-body">混合${r.mixed_boxes} / S${r.s_boxes} / M${r.m_boxes}</span></li>`;
        })
        .join('')}</ul>`;
      listEl.querySelectorAll('li[data-date]').forEach((li) => {
        li.addEventListener('click', () => {
          dateInput.value = li.dataset.date;
          loadForDate();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
    } catch (e) {
      console.error(e);
      listEl.innerHTML = '<p class="msg-error">履歴の読み込みに失敗しました。</p>';
    }
  }

  dateInput.addEventListener('change', loadForDate);

  document.getElementById('submitBtn').addEventListener('click', async () => {
    const date = dateInput.value;
    if (!date) {
      msgEl.textContent = '発注日を選択してください。';
      msgEl.className = 'msg msg-error';
      return;
    }
    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    msgEl.textContent = '送信中…';
    msgEl.className = 'msg';
    try {
      if (isPizza) {
        const content = document.getElementById('pizzaContent').value.trim();
        await savePizzaOrder({ storeSlug: store.slug, storeName: store.name, date, content });
      } else {
        const mixedBoxes = Number(document.getElementById('mixedBoxes').value) || 0;
        const sBoxes = Number(document.getElementById('sBoxes').value) || 0;
        const mBoxes = Number(document.getElementById('mBoxes').value) || 0;
        await saveOysterOrder({ storeSlug: store.slug, storeName: store.name, date, mixedBoxes, sBoxes, mBoxes });
      }
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
      btn.disabled = false;
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
      if (isPizza) {
        await deletePizzaOrder(store.slug, date);
        document.getElementById('pizzaContent').value = '';
      } else {
        await deleteOysterOrder(store.slug, date);
        document.getElementById('mixedBoxes').value = 0;
        document.getElementById('sBoxes').value = 0;
        document.getElementById('mBoxes').value = 0;
      }
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
  const subtitle = { pizza: 'ピザ受注集計', oyster: '牡蠣受注集計', all: 'ピザ・牡蠣 全受注集計' }[shop.type];
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
      if (shop.type === 'pizza') {
        const rows = await fetchPizzaOrdersRange(from, to);
        summaryEl.innerHTML = renderPizzaSummary(rows, PIZZA_STORES);
      } else if (shop.type === 'oyster') {
        const rows = await fetchOysterOrdersRange(from, to);
        summaryEl.innerHTML = renderOysterSummary(rows, OYSTER_STORES);
      } else {
        const [pizzaRows, oysterRows] = await Promise.all([
          fetchPizzaOrdersRange(from, to),
          fetchOysterOrdersRange(from, to),
        ]);
        summaryEl.innerHTML = `
          <h2 class="section-title">ピザ</h2>
          ${renderPizzaSummary(pizzaRows, PIZZA_STORES)}
          <h2 class="section-title">牡蠣</h2>
          ${renderOysterSummary(oysterRows, OYSTER_STORES)}`;
      }
    } catch (e) {
      console.error(e);
      summaryEl.innerHTML = '<p class="msg-error">読み込みに失敗しました。</p>';
    }
  }

  load();
}

function renderPizzaSummary(rows, stores) {
  const dates = [...new Set(rows.map((r) => r.order_date))].sort().reverse();
  if (!dates.length) return '<div class="card"><p class="hint">この期間の発注はありません。</p></div>';
  const byKey = {};
  rows.forEach((r) => {
    byKey[`${r.order_date}__${r.store_slug}`] = r;
  });

  const tableRows = dates
    .map((date) => {
      const cells = stores
        .map((s) => {
          const r = byKey[`${date}__${s.slug}`];
          const has = r && r.content && r.content.trim().length > 0;
          return `<td class="${has ? 'badge-yes' : 'badge-no'}">${has ? 1 : 0}</td>`;
        })
        .join('');
      return `<tr><td>${formatDateJp(date)}</td>${cells}</tr>`;
    })
    .join('');

  const detailItems = dates
    .flatMap((date) =>
      stores.map((s) => {
        const r = byKey[`${date}__${s.slug}`];
        if (!r || !r.content || !r.content.trim()) return '';
        return `<li><span class="recent-date">${formatDateJp(date)} ${escapeHtml(s.name)}</span><span class="recent-body">${escapeHtml(
          r.content
        ).replace(/\n/g, '<br>')}</span></li>`;
      })
    )
    .filter(Boolean)
    .join('');

  return `
    <div class="card">
      <h2>発注有無(1=発注あり / 0=発注なし)</h2>
      <table class="agg">
        <thead><tr><th>日付</th>${stores.map((s) => `<th>${escapeHtml(s.name)}</th>`).join('')}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>注文内容一覧</h2>
      <ul class="recent-list">${detailItems || '<li class="hint">注文内容はありません。</li>'}</ul>
    </div>`;
}

function renderOysterSummary(rows, stores) {
  const dates = [...new Set(rows.map((r) => r.order_date))].sort().reverse();
  if (!dates.length) return '<div class="card"><p class="hint">この期間の発注はありません。</p></div>';
  const byKey = {};
  rows.forEach((r) => {
    byKey[`${r.order_date}__${r.store_slug}`] = r;
  });

  let totalMixed = 0;
  let totalS = 0;
  let totalM = 0;
  rows.forEach((r) => {
    totalMixed += Number(r.mixed_boxes) || 0;
    totalS += Number(r.s_boxes) || 0;
    totalM += Number(r.m_boxes) || 0;
  });

  const tableRows = dates
    .map((date) => {
      const cells = stores
        .map((s) => {
          const r = byKey[`${date}__${s.slug}`];
          if (!r) return '<td>-</td>';
          return `<td>混合${r.mixed_boxes}/S${r.s_boxes}/M${r.m_boxes}</td>`;
        })
        .join('');
      return `<tr><td>${formatDateJp(date)}</td>${cells}</tr>`;
    })
    .join('');

  return `
    <div class="card">
      <h2>期間合計(15kg/箱)</h2>
      <p>混合 ${totalMixed}箱 / Sサイズ ${totalS}箱 / Mサイズ ${totalM}箱 / 合計 ${totalMixed + totalS + totalM}箱</p>
    </div>
    <div class="card">
      <h2>店舗別・日別の発注箱数</h2>
      <table class="agg">
        <thead><tr><th>日付</th>${stores.map((s) => `<th>${escapeHtml(s.name)}</th>`).join('')}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;
}

route();
