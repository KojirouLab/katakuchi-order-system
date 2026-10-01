// 発注が「送信」された直後に、対応する店舗宛のDiscordチャンネルへ通知する。
// 締切リマインダー(check-deadlines)とは別物で、こちらは「発注が入った」ことを知らせる通知。
// 対象は2種類:
//   - 牡蠣の発注(category='oyster'、既定): discord_notification_targetsにcategory='oyster_placed'で
//     登録された店舗だけ(今のところちょい飲みたかはし)。
//   - 卸先の発注(category='wholesale'): category='wholesale_placed'で登録された取引先だけ。
// 未登録の店舗・取引先は何もしない。
//
// クライアント(app.js)から発注保存の直後に直接呼ばれる想定。Webhook URL自体は
// クライアントに渡さずサーバー側(このFunction)だけが知っている状態にするため、
// public repoのapp.jsに直書きしない。
//
// 通知内容は毎回DBの現在の値を読み直して組み立てる(クライアントから送られた値を
// そのまま信用しない)ので、呼び出し元が内容を偽装することはできない。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STORE_NAMES: Record<string, string> = {
  "choinomi-takahashi": "ちょい飲みたかはし",
};

const TIME_SLOT_SUFFIX = (slot: string | null) => (slot ? `(${slot})` : "");

// ブラウザ(app.js)から直接fetchで呼ぶため、CORSプリフライト(OPTIONS)に応答する必要がある。
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  let body: { storeSlug?: string; date?: string; category?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400, headers: CORS_HEADERS });
  }
  const storeSlug = body.storeSlug;
  const date = body.date;
  if (!storeSlug || !date) {
    return new Response("bad request", { status: 400, headers: CORS_HEADERS });
  }

  const isWholesale = body.category === "wholesale";
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: target, error: targetError } = await supabase
    .from("discord_notification_targets")
    .select("webhook_url, mention_role_id")
    .eq("store_slug", storeSlug)
    .eq("category", isWholesale ? "wholesale_placed" : "oyster_placed")
    .maybeSingle();
  if (targetError) {
    console.error(targetError);
    return new Response("error", { status: 500, headers: CORS_HEADERS });
  }
  if (!target) {
    // この店舗向けの通知先が未登録なら何もしない
    return new Response(JSON.stringify({ skipped: true }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (isWholesale) {
    return await notifyWholesale(supabase, target, storeSlug, date);
  }

  const { data: order, error: orderError } = await supabase
    .from("oyster_orders")
    .select("mixed_boxes, s_boxes, m_boxes, no_order, desired_time_slot, ship_to")
    .eq("store_slug", storeSlug)
    .eq("order_date", date)
    .maybeSingle();
  if (orderError) {
    console.error(orderError);
    return new Response("error", { status: 500, headers: CORS_HEADERS });
  }
  if (!order || order.no_order) {
    // 発注なし、またはすでに削除された後なら通知しない
    return new Response(JSON.stringify({ skipped: true }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const storeName = STORE_NAMES[storeSlug] ?? storeSlug;
  const dateLabel = date.slice(5).replace("-", "/");
  const mention = target.mention_role_id ? `<@&${target.mention_role_id}> ` : "";
  const shipToLine = order.ship_to ? `\n送付先: ${order.ship_to}` : "";
  const text =
    `${mention}**${storeName}**から発注が入りました(着希望日 ${dateLabel}${TIME_SLOT_SUFFIX(order.desired_time_slot)})${shipToLine}\n` +
    `混合:${order.mixed_boxes} / S:${order.s_boxes} / M:${order.m_boxes}`;

  const res = await fetch(target.webhook_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text }),
  });
  if (!res.ok) {
    console.error("Discord push failed", res.status, await res.text());
    return new Response("error", { status: 502, headers: CORS_HEADERS });
  }

  return new Response(JSON.stringify({ notified: true }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});

// 卸先の発注通知。内容はwholesale_ordersに保存済みの整形文字列(content)をそのまま使う。
async function notifyWholesale(
  supabase: ReturnType<typeof createClient>,
  target: { webhook_url: string; mention_role_id: string | null },
  storeSlug: string,
  date: string,
) {
  const { data: order, error } = await supabase
    .from("wholesale_orders")
    .select("store_name, content")
    .eq("store_slug", storeSlug)
    .eq("order_date", date)
    .maybeSingle();
  if (error) {
    console.error(error);
    return new Response("error", { status: 500, headers: CORS_HEADERS });
  }
  if (!order || !order.content) {
    // すでに削除された後なら通知しない
    return new Response(JSON.stringify({ skipped: true }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const dateLabel = date.slice(5).replace("-", "/");
  const mention = target.mention_role_id ? `<@&${target.mention_role_id}> ` : "";
  const text = `${mention}**${order.store_name} 様**(卸先)から発注が入りました(配送希望日 ${dateLabel})\n${order.content}`;

  const res = await fetch(target.webhook_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text }),
  });
  if (!res.ok) {
    console.error("Discord push failed", res.status, await res.text());
    return new Response("error", { status: 502, headers: CORS_HEADERS });
  }
  return new Response(JSON.stringify({ notified: true }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
