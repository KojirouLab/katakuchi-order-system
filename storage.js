// ここに Supabase の Project URL と anon key を貼り付けてください。
// (Supabase ダッシュボード > Project Settings > API で確認できます。anon key は
// 公開されても問題ない設計です。アクセス制御はURLを知っている人だけに限定する運用で行っています。)
const SUPABASE_URL = 'https://krdwyfemepbbyrteyoeb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ouoTLzgoCxmyMf7D_kWdzQ_YTEXc2tk';

let sb = null;
try {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.error('Supabase client init failed', e);
}

function assertClient() {
  if (!sb) throw new Error('Supabase未設定です。storage.js の SUPABASE_URL / SUPABASE_ANON_KEY を設定してください。');
}

// ---- ピザ受注 ----

async function fetchPizzaOrder(storeSlug, date) {
  assertClient();
  const { data, error } = await sb
    .from('pizza_orders')
    .select('*')
    .eq('store_slug', storeSlug)
    .eq('order_date', date)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function savePizzaOrder({ storeSlug, storeName, date, content }) {
  assertClient();
  const { error } = await sb.from('pizza_orders').upsert(
    {
      store_slug: storeSlug,
      store_name: storeName,
      order_date: date,
      content,
      confirmed_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'store_slug,order_date' }
  );
  if (error) throw error;
}

async function confirmPizzaOrder(storeSlug, date) {
  assertClient();
  const { data, error } = await sb
    .from('pizza_orders')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('store_slug', storeSlug)
    .eq('order_date', date)
    .select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('更新できませんでした(権限設定が反映されていない可能性があります)');
}

async function unconfirmPizzaOrder(storeSlug, date) {
  assertClient();
  const { data, error } = await sb
    .from('pizza_orders')
    .update({ confirmed_at: null })
    .eq('store_slug', storeSlug)
    .eq('order_date', date)
    .select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('更新できませんでした(権限設定が反映されていない可能性があります)');
}

async function deletePizzaOrder(storeSlug, date) {
  assertClient();
  const { data, error } = await sb.from('pizza_orders').delete().eq('store_slug', storeSlug).eq('order_date', date).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('削除できませんでした(権限設定が反映されていない可能性があります)');
}

async function fetchPizzaOrdersByStore(storeSlug, limit) {
  assertClient();
  const { data, error } = await sb
    .from('pizza_orders')
    .select('*')
    .eq('store_slug', storeSlug)
    .order('order_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function fetchPizzaOrdersRange(from, to) {
  assertClient();
  const { data, error } = await sb
    .from('pizza_orders')
    .select('*')
    .gte('order_date', from)
    .lte('order_date', to)
    .order('order_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ---- 牡蠣受注 ----

async function fetchOysterOrder(storeSlug, date) {
  assertClient();
  const { data, error } = await sb
    .from('oyster_orders')
    .select('*')
    .eq('store_slug', storeSlug)
    .eq('order_date', date)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function saveOysterOrder({ storeSlug, storeName, date, mixedBoxes, sBoxes, mBoxes, noOrder }) {
  assertClient();
  const { error } = await sb.from('oyster_orders').upsert(
    {
      store_slug: storeSlug,
      store_name: storeName,
      order_date: date,
      mixed_boxes: mixedBoxes,
      s_boxes: sBoxes,
      m_boxes: mBoxes,
      no_order: !!noOrder,
      confirmed_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'store_slug,order_date' }
  );
  if (error) throw error;
}

async function confirmOysterOrder(storeSlug, date) {
  assertClient();
  const { data, error } = await sb
    .from('oyster_orders')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('store_slug', storeSlug)
    .eq('order_date', date)
    .select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('更新できませんでした(権限設定が反映されていない可能性があります)');
}

async function unconfirmOysterOrder(storeSlug, date) {
  assertClient();
  const { data, error } = await sb
    .from('oyster_orders')
    .update({ confirmed_at: null })
    .eq('store_slug', storeSlug)
    .eq('order_date', date)
    .select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('更新できませんでした(権限設定が反映されていない可能性があります)');
}

async function deleteOysterOrder(storeSlug, date) {
  assertClient();
  const { data, error } = await sb.from('oyster_orders').delete().eq('store_slug', storeSlug).eq('order_date', date).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('削除できませんでした(権限設定が反映されていない可能性があります)');
}

async function fetchOysterOrdersByStore(storeSlug, limit) {
  assertClient();
  const { data, error } = await sb
    .from('oyster_orders')
    .select('*')
    .eq('store_slug', storeSlug)
    .order('order_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function fetchOysterOrdersRange(from, to) {
  assertClient();
  const { data, error } = await sb
    .from('oyster_orders')
    .select('*')
    .gte('order_date', from)
    .lte('order_date', to)
    .order('order_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ---- 牡蠣在庫(入庫) ----

async function fetchStockInAll() {
  assertClient();
  const { data, error } = await sb.from('kaki_stock_in').select('*').order('in_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function saveStockIn({ inDate, mixedBoxes, sBoxes, mBoxes, note, registeredBy }) {
  assertClient();
  const { error } = await sb.from('kaki_stock_in').insert({
    in_date: inDate,
    mixed_boxes: mixedBoxes,
    s_boxes: sBoxes,
    m_boxes: mBoxes,
    note: note || '',
    registered_by: registeredBy || null,
  });
  if (error) throw error;
}

async function deleteStockIn(id) {
  assertClient();
  const { data, error } = await sb.from('kaki_stock_in').delete().eq('id', id).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('削除できませんでした(権限設定が反映されていない可能性があります)');
}

// ---- 牡蠣在庫(自社使用による出庫) ----

async function fetchStockOutInternalAll() {
  assertClient();
  const { data, error } = await sb.from('kaki_stock_out_internal').select('*').order('out_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function saveStockOutInternal({ outDate, mixedBoxes, sBoxes, mBoxes, supplier, purpose, note, registeredBy }) {
  assertClient();
  const { error } = await sb.from('kaki_stock_out_internal').insert({
    out_date: outDate,
    mixed_boxes: mixedBoxes,
    s_boxes: sBoxes,
    m_boxes: mBoxes,
    supplier: supplier || '',
    purpose: purpose || 'self',
    note: note || '',
    registered_by: registeredBy || null,
  });
  if (error) throw error;
}

async function updateStockOutInternal(id, { outDate, mixedBoxes, sBoxes, mBoxes, supplier, purpose, note, registeredBy }) {
  assertClient();
  const { data, error } = await sb
    .from('kaki_stock_out_internal')
    .update({
      out_date: outDate,
      mixed_boxes: mixedBoxes,
      s_boxes: sBoxes,
      m_boxes: mBoxes,
      supplier: supplier || '',
      purpose: purpose || 'self',
      note: note || '',
      registered_by: registeredBy || null,
    })
    .eq('id', id)
    .select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('更新できませんでした(権限設定が反映されていない可能性があります)');
}

async function deleteStockOutInternal(id) {
  assertClient();
  const { data, error } = await sb.from('kaki_stock_out_internal').delete().eq('id', id).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('削除できませんでした(権限設定が反映されていない可能性があります)');
}

// ---- 牡蠣在庫の変更履歴(監査ログ) ----
// kaki_stock_in / kaki_stock_out_internal / oyster_orders への変更をDBトリガーが自動記録したもの。
// 指定した日付範囲(changed_atの日付)で絞り込んで取得する。

async function fetchStockAuditLog({ from, to }) {
  assertClient();
  const { data, error } = await sb
    .from('kaki_stock_audit_log')
    .select('*')
    .gte('changed_at', `${from}T00:00:00+09:00`)
    .lt('changed_at', `${to}T23:59:59.999+09:00`)
    .order('changed_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
