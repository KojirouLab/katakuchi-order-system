// LINEからのメッセージ/友だち追加/グループ参加イベントを受け取り、
// 個人のユーザーIDまたはグループのIDを本人・グループに返信するだけのWebhook。
// 通知の登録先(notification_recipients)に誰(何)のIDを追加すればよいか
// 確認するための用途。

const CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;

async function reply(replyToken: string, text: string) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  let body: { events?: Array<Record<string, unknown>> };
  try {
    body = await req.json();
  } catch {
    return new Response("OK", { status: 200 });
  }

  const events = body.events ?? [];

  for (const event of events) {
    const type = event.type as string;
    const replyToken = event.replyToken as string | undefined;
    const source = event.source as
      | { type?: string; userId?: string; groupId?: string; roomId?: string }
      | undefined;
    if (!replyToken || !source) continue;

    const groupOrRoomId = source.groupId ?? source.roomId;

    if (type === "join" && groupOrRoomId) {
      // ボットがグループ/トークルームに追加された
      await reply(
        replyToken,
        `このグループのIDです。担当者に伝えてください:\n${groupOrRoomId}`
      );
    } else if (type === "follow" && source.userId) {
      await reply(
        replyToken,
        `友だち追加ありがとうございます。\nあなたのユーザーIDです。担当者に伝えてください:\n${source.userId}`
      );
    }
    // "message"イベントには反応しない(通知専用Botのため、グループ内の通常のやり取りには応答しない)
  }

  return new Response("OK", { status: 200 });
});
