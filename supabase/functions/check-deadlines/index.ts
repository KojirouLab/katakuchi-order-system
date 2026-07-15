// 締切1時間前になっても未発注の店舗を検知し、対応するLINEグループへ
// まとめてpush通知する。pg_cronから15分おきに叩かれる想定。
//
// 締切計算ロジック(JP_HOLIDAYS・PRODUCT_DEFS・営業日計算)はapp.jsのものを
// そのまま複製している。app.js側を変更した場合はこちらも合わせて直すこと。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const CRON_SECRET = Deno.env.get("CHECK_DEADLINES_SECRET")!;

const REMINDER_WINDOW_MS = 60 * 60 * 1000; // 締切のこの時間前以内なら通知対象
const LOOKAHEAD_DAYS = 5; // 何日先の発注日まで候補として調べるか

type Category = "pizza" | "oyster";

const STORES: { slug: string; name: string; categories: Category[] }[] = [
  { slug: "bansui", name: "晩翠通り店", categories: ["pizza"] },
  { slug: "pizzarokko", name: "ピザろっこ", categories: ["pizza"] },
  { slug: "asakusa", name: "浅草店", categories: ["pizza"] },
  { slug: "kaki-rokko", name: "牡蠣小屋ろっこ", categories: ["oyster", "pizza"] },
  { slug: "kaki-mouikko", name: "牡蠣小屋もういっこ", categories: ["oyster"] },
  { slug: "kaki-higashiichi", name: "牡蠣小屋東一店", categories: ["oyster"] },
  { slug: "kai-hakko", name: "貝小屋はっこ", categories: ["oyster"] },
];

// app.jsのJP_HOLIDAYSと同じ内容(更新する場合は両方直すこと)
const JP_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29",
  "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06", "2026-07-20", "2026-08-11",
  "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
  "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22",
  "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05", "2027-07-19", "2027-08-11",
  "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23",
]);

const PRODUCT_DEFS: Record<
  Category,
  { label: string; deadlineHour: number; deadlineDaysBefore: number; skipNonBusinessDays: boolean }
> = {
  pizza: { label: "ピザ", deadlineHour: 12, deadlineDaysBefore: 2, skipNonBusinessDays: true },
  oyster: { label: "牡蠣", deadlineHour: 6, deadlineDaysBefore: 2, skipNonBusinessDays: false },
};

function isBusinessDay(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return false;
  return !JP_HOLIDAYS.has(dateStr);
}

function addDaysStr(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// 発注日(JST calendar date)+カテゴリから、締切の実時刻(UTC instant)を返す
function orderDeadline(orderDateStr: string, category: Category): Date {
  const def = PRODUCT_DEFS[category];
  let cur = orderDateStr;
  let remaining = def.deadlineDaysBefore;
  while (remaining > 0) {
    cur = addDaysStr(cur, -1);
    if (!def.skipNonBusinessDays || isBusinessDay(cur)) remaining--;
  }
  const hh = String(def.deadlineHour).padStart(2, "0");
  return new Date(`${cur}T${hh}:00:00+09:00`);
}

function todayJstStr(): string {
  // JSTのYYYY-MM-DDを得る(サーバーはUTCで動くため+9hしてUTC表記を借用する)
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function pushMessage(groupId: string, text: string) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to: groupId, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) {
    console.error("LINE push failed", groupId, res.status, await res.text());
  }
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = new Date();
  const today = todayJstStr();

  const { data: targets, error: targetsError } = await supabase
    .from("notification_targets")
    .select("store_slug, category, group_id");
  if (targetsError) {
    console.error(targetsError);
    return new Response("error", { status: 500 });
  }
  const targetMap = new Map<string, string>();
  for (const t of targets ?? []) {
    targetMap.set(`${t.store_slug}:${t.category}`, t.group_id);
  }

  // { groupId: [ "◯◯店(ピザ)", ... ] }
  const toNotify = new Map<string, string[]>();
  const sentKeys: { store_slug: string; category: Category; order_date: string }[] = [];

  for (const store of STORES) {
    for (const category of store.categories) {
      const groupId = targetMap.get(`${store.slug}:${category}`);
      if (!groupId) continue; // 通知先未登録の店舗+カテゴリはスキップ

      for (let offset = 0; offset <= LOOKAHEAD_DAYS; offset++) {
        const orderDate = addDaysStr(today, offset);
        const deadline = orderDeadline(orderDate, category);
        const diff = deadline.getTime() - now.getTime();
        if (diff <= 0 || diff > REMINDER_WINDOW_MS) continue;

        const { data: existingSent } = await supabase
          .from("deadline_reminders_sent")
          .select("id")
          .eq("store_slug", store.slug)
          .eq("category", category)
          .eq("order_date", orderDate)
          .maybeSingle();
        if (existingSent) continue; // 送信済み

        const table = category === "pizza" ? "pizza_orders" : "oyster_orders";
        const { data: orderRow } = await supabase
          .from(table)
          .select(category === "pizza" ? "content" : "id")
          .eq("store_slug", store.slug)
          .eq("order_date", orderDate)
          .maybeSingle();

        const hasOrdered =
          category === "pizza"
            ? !!(orderRow && (orderRow as { content?: string }).content?.trim())
            : !!orderRow;
        if (hasOrdered) continue;

        const label = PRODUCT_DEFS[category].label;
        const list = toNotify.get(groupId) ?? [];
        list.push(`${store.name}(${label} ${orderDate.slice(5).replace("-", "/")}締切分)`);
        toNotify.set(groupId, list);
        sentKeys.push({ store_slug: store.slug, category, order_date: orderDate });
      }
    }
  }

  for (const [groupId, items] of toNotify) {
    const text = `【発注リマインド】まもなく締切です。まだ発注が確認できていません。\n${items.join("\n")}`;
    await pushMessage(groupId, text);
  }

  if (sentKeys.length > 0) {
    await supabase.from("deadline_reminders_sent").insert(
      sentKeys.map((k) => ({
        store_slug: k.store_slug,
        category: k.category,
        order_date: k.order_date,
      }))
    );
  }

  return new Response(JSON.stringify({ notified: sentKeys.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
