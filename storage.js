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
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'store_slug,order_date' }
  );
  if (error) throw error;
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

async function saveOysterOrder({ storeSlug, storeName, date, mixedBoxes, sBoxes, mBoxes }) {
  assertClient();
  const { error } = await sb.from('oyster_orders').upsert(
    {
      store_slug: storeSlug,
      store_name: storeName,
      order_date: date,
      mixed_boxes: mixedBoxes,
      s_boxes: sBoxes,
      m_boxes: mBoxes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'store_slug,order_date' }
  );
  if (error) throw error;
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

// ---- つぶ貝受注 ----

async function fetchWhelkOrder(storeSlug, date) {
  assertClient();
  const { data, error } = await sb
    .from('whelk_orders')
    .select('*')
    .eq('store_slug', storeSlug)
    .eq('order_date', date)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function saveWhelkOrder({ storeSlug, storeName, date, content }) {
  assertClient();
  const { error } = await sb.from('whelk_orders').upsert(
    {
      store_slug: storeSlug,
      store_name: storeName,
      order_date: date,
      content,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'store_slug,order_date' }
  );
  if (error) throw error;
}

async function deleteWhelkOrder(storeSlug, date) {
  assertClient();
  const { data, error } = await sb.from('whelk_orders').delete().eq('store_slug', storeSlug).eq('order_date', date).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('削除できませんでした(権限設定が反映されていない可能性があります)');
}

async function fetchWhelkOrdersByStore(storeSlug, limit) {
  assertClient();
  const { data, error } = await sb
    .from('whelk_orders')
    .select('*')
    .eq('store_slug', storeSlug)
    .order('order_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function fetchWhelkOrdersRange(from, to) {
  assertClient();
  const { data, error } = await sb
    .from('whelk_orders')
    .select('*')
    .gte('order_date', from)
    .lte('order_date', to)
    .order('order_date', { ascending: false });
  if (error) throw error;
  return data || [];
}
