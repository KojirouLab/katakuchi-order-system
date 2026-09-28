// 会社共用メール(shopify@catakuchi6.co.jp)を10分おきにチェックし、
// 新着メールをClaudeに読ませて重要そうなら管理者へDiscord DMで通知する。
// pg_cronから supabase/mail_alert.sql の trigger_mail_alert_check() 経由で叩かれる想定。
//
// メールはIMAPS(暗号化された生TCP接続)で直接取得している。npmのIMAPライブラリは使わず、
// 必要なIMAPコマンド(LOGIN/SELECT/UID SEARCH/UID FETCH/LOGOUT)だけを自前で喋っている。
// BODY.PEEK[]を使っているので、既読/未読フラグは変更しない(人間が見た時の未読状態を壊さない)。
//
// 認証: リクエストの x-cron-secret ヘッダを、DBの mail_alert_settings.secret と照合する。
// デプロイ時は --no-verify-jwt が必要(呼び出し元はSupabaseのJWTを持たないため)。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("MAIL_ALERT_SECRET") ?? "";

const IMAP_HOST = Deno.env.get("MAIL_IMAP_HOST") ?? "sv958.xbiz.ne.jp";
const IMAP_PORT = Number(Deno.env.get("MAIL_IMAP_PORT") ?? "993");
const IMAP_USER = Deno.env.get("MAIL_IMAP_USER") ?? "shopify@catakuchi6.co.jp";
const IMAP_PASSWORD = Deno.env.get("MAIL_IMAP_PASSWORD") ?? "";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MAIL_CLASSIFY_MODEL = "claude-haiku-4-5-20251001";

const DISCORD_BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const MAIL_ALERT_DISCORD_USER_ID = Deno.env.get("MAIL_ALERT_DISCORD_USER_ID") ?? "1002066248961630271";
const DISCORD_API = "https://discord.com/api/v10";

const MAX_MAILS_PER_RUN = 8; // 1回の実行で処理する新着メールの上限(暴走防止)
const BODY_PEEK_BYTES = 4000; // 本文取得の上限バイト数(巨大な添付ファイル対策)

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ============ IMAP: 低レベルの読み書き ============

class ImapConn {
  #conn: Deno.TlsConn;
  #buf: Uint8Array = new Uint8Array(0);

  constructor(conn: Deno.TlsConn) {
    this.#conn = conn;
  }

  async #fill(): Promise<boolean> {
    const chunk = new Uint8Array(65536);
    const n = await this.#conn.read(chunk);
    if (n === null) return false;
    const merged = new Uint8Array(this.#buf.length + n);
    merged.set(this.#buf);
    merged.set(chunk.subarray(0, n), this.#buf.length);
    this.#buf = merged;
    return true;
  }

  async readLine(): Promise<string> {
    while (true) {
      const idx = this.#indexOfCRLF();
      if (idx >= 0) {
        const line = this.#buf.subarray(0, idx);
        this.#buf = this.#buf.subarray(idx + 2);
        return new TextDecoder().decode(line);
      }
      if (!(await this.#fill())) throw new Error("IMAP接続が予期せず切断されました");
    }
  }

  #indexOfCRLF(): number {
    for (let i = 0; i < this.#buf.length - 1; i++) {
      if (this.#buf[i] === 13 && this.#buf[i + 1] === 10) return i;
    }
    return -1;
  }

  async readExact(n: number): Promise<Uint8Array> {
    while (this.#buf.length < n) {
      if (!(await this.#fill())) throw new Error("IMAP接続が予期せず切断されました");
    }
    const data = this.#buf.subarray(0, n);
    this.#buf = this.#buf.subarray(n);
    return data;
  }

  async write(s: string) {
    await this.#conn.write(new TextEncoder().encode(s));
  }

  close() {
    try {
      this.#conn.close();
    } catch {
      // 既に閉じていても無視
    }
  }
}

function quoteImapString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// リテラル({N}で始まる)を含まない単純なコマンド。全ての未タグ行を集めて返す。
async function imapSimpleCommand(c: ImapConn, tag: string, cmd: string): Promise<string[]> {
  await c.write(`${tag} ${cmd}\r\n`);
  const lines: string[] = [];
  while (true) {
    const line = await c.readLine();
    if (line.startsWith(tag + " ")) {
      if (!/^\S+\s+OK/i.test(line)) throw new Error(`IMAPコマンド失敗: ${cmd} -> ${line}`);
      break;
    }
    lines.push(line);
  }
  return lines;
}

// UID FETCHで単一のBODY[...]リテラルを取り出す(1コマンド1セクションのみ想定)。
async function imapFetchLiteral(c: ImapConn, tag: string, uid: number, section: string): Promise<string> {
  await c.write(`${tag} UID FETCH ${uid} ${section}\r\n`);
  const firstLine = await c.readLine();
  const m = firstLine.match(/\{(\d+)\}\s*$/);
  let text = "";
  if (m) {
    const n = parseInt(m[1], 10);
    const bytes = await c.readExact(n);
    text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  // リテラルの後に続く行(閉じ括弧など)と、タグ付き完了応答を読み捨てる
  let line = await c.readLine();
  while (!line.startsWith(tag + " ")) line = await c.readLine();
  return text;
}

// ============ MIMEデコード ============

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/[^A-Za-z0-9+/=]/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function quotedPrintableToBytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "=" && (s[i + 1] === "\r" || s[i + 1] === "\n")) {
      while (s[i + 1] === "\r" || s[i + 1] === "\n") i++;
    } else if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) {
      out.push(parseInt(s.substr(i + 1, 2), 16));
      i += 2;
    } else {
      out.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const label = (charset || "utf-8").toLowerCase().trim();
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return new TextDecoder("latin1").decode(bytes);
    }
  }
}

// RFC2047のエンコード語(=?charset?B/Q?...?=)を含むヘッダ値を人が読める形に戻す
function decodeMimeWord(input: string): string {
  return input.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_all, charset, enc, text) => {
    try {
      const bytes =
        enc.toUpperCase() === "B" ? base64ToBytes(text) : quotedPrintableToBytes(text.replace(/_/g, " "));
      return decodeBytes(bytes, charset);
    } catch {
      return text;
    }
  });
}

function parseHeaderFields(raw: string): Record<string, string> {
  // ヘッダの折り返し(継続行=行頭が空白)を1行に結合してからパースする
  const unfolded = raw.replace(/\r\n[ \t]+/g, " ");
  const out: Record<string, string> = {};
  for (const line of unfolded.split(/\r\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function extractBoundary(contentType: string): string | null {
  const m = contentType.match(/boundary="?([^";]+)"?/i);
  return m ? m[1] : null;
}

function decodePart(bodyText: string, transferEncoding: string, charset: string): string {
  const enc = (transferEncoding || "").toLowerCase().trim();
  if (enc === "base64") return decodeBytes(base64ToBytes(bodyText), charset);
  if (enc === "quoted-printable") return decodeBytes(quotedPrintableToBytes(bodyText), charset);
  return bodyText;
}

// BODY.PEEK[TEXT]の生テキストから、本文の抜粋(プレーンテキスト優先)を取り出す。
// ネストしたmultipartには対応していない簡易実装(それで十分な精度が出るため)。
function extractBodySnippet(rawText: string, topContentType: string, topCharset: string): string {
  const boundary = extractBoundary(topContentType);
  if (!boundary || !topContentType.toLowerCase().includes("multipart/")) {
    const enc = topContentType.toLowerCase().includes("html") ? rawText.replace(/<[^>]+>/g, " ") : rawText;
    return enc.slice(0, 1500);
  }
  const parts = rawText.split(`--${boundary}`);
  let candidate: { text: string; isPlain: boolean } | null = null;
  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headerRaw = part.slice(0, headerEnd);
    const body = part.slice(headerEnd + 4);
    const headers = parseHeaderFields(headerRaw);
    const ct = headers["content-type"] ?? "text/plain";
    const cte = headers["content-transfer-encoding"] ?? "7bit";
    const charsetMatch = ct.match(/charset="?([^";]+)"?/i);
    const charset = charsetMatch ? charsetMatch[1] : topCharset;
    if (ct.toLowerCase().includes("multipart/")) continue; // ネストは追わない
    const isPlain = ct.toLowerCase().includes("text/plain");
    const isHtml = ct.toLowerCase().includes("text/html");
    if (!isPlain && !isHtml) continue;
    const decoded = decodePart(body, cte, charset);
    const text = isHtml ? decoded.replace(/<[^>]+>/g, " ") : decoded;
    if (isPlain) {
      candidate = { text, isPlain: true };
      break; // text/plainが見つかったら優先して即採用
    }
    if (!candidate) candidate = { text, isPlain: false };
  }
  return (candidate?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 1500);
}

// ============ メール取得本体 ============

type MailInfo = { uid: number; from: string; subject: string; snippet: string };

async function fetchNewMails(sinceUid: number): Promise<{ mails: MailInfo[]; maxUid: number }> {
  const raw = await Deno.connectTls({ hostname: IMAP_HOST, port: IMAP_PORT });
  const c = new ImapConn(raw);
  try {
    await c.readLine(); // greeting
    await imapSimpleCommand(c, "a1", `LOGIN ${quoteImapString(IMAP_USER)} ${quoteImapString(IMAP_PASSWORD)}`);
    await imapSimpleCommand(c, "a2", "SELECT INBOX");

    const searchLines = await imapSimpleCommand(c, "a3", `UID SEARCH UID ${sinceUid + 1}:*`);
    const uidSet = new Set<number>();
    for (const line of searchLines) {
      const m = line.match(/^\*\s+SEARCH\s*(.*)$/i);
      if (!m) continue;
      for (const tok of m[1].trim().split(/\s+/)) {
        const n = parseInt(tok, 10);
        if (Number.isFinite(n) && n > 0) uidSet.add(n);
      }
    }
    // sinceUid=0(初回実行)の場合、"UID 1:*"は既存メール全件を返してしまう。
    // その場合は通知せず、最大UIDだけ記録して次回以降の基準にする。
    const isFirstRun = sinceUid === 0;
    const uids = [...uidSet].sort((x, y) => x - y);
    const maxUid = uids.length > 0 ? uids[uids.length - 1] : sinceUid;

    if (isFirstRun || uids.length === 0) {
      await imapSimpleCommand(c, "a9", "LOGOUT").catch(() => {});
      return { mails: [], maxUid };
    }

    const targetUids = uids.slice(-MAX_MAILS_PER_RUN);
    const mails: MailInfo[] = [];
    let tagN = 4;
    for (const uid of targetUids) {
      try {
        const headerRaw = await imapFetchLiteral(
          c,
          `a${tagN++}`,
          uid,
          "BODY.PEEK[HEADER.FIELDS (FROM SUBJECT CONTENT-TYPE CONTENT-TRANSFER-ENCODING)]"
        );
        const headers = parseHeaderFields(headerRaw);
        const from = decodeMimeWord(headers["from"] ?? "(不明な送信元)");
        const subject = decodeMimeWord(headers["subject"] ?? "(件名なし)");
        const topContentType = headers["content-type"] ?? "text/plain";
        const topCharsetMatch = topContentType.match(/charset="?([^";]+)"?/i);
        const topCharset = topCharsetMatch ? topCharsetMatch[1] : "utf-8";

        const bodyRaw = await imapFetchLiteral(
          c,
          `a${tagN++}`,
          uid,
          `BODY.PEEK[TEXT]<0.${BODY_PEEK_BYTES}>`
        );
        const snippet = extractBodySnippet(bodyRaw, topContentType, topCharset);
        mails.push({ uid, from, subject, snippet });
      } catch (e) {
        console.error(`UID ${uid} の取得に失敗`, e);
      }
    }

    await imapSimpleCommand(c, `a${tagN++}`, "LOGOUT").catch(() => {});
    return { mails, maxUid };
  } finally {
    c.close();
  }
}

// ============ Claudeによる重要度判定 ============

async function classifyImportance(mail: MailInfo): Promise<{ important: boolean; reason: string }> {
  if (!ANTHROPIC_API_KEY) return { important: false, reason: "ANTHROPIC_API_KEY未設定" };
  const prompt =
    `以下はカタクチ商店の共用受信箱に届いたメールです。緊急対応や見落とすと困る重要な連絡` +
    `(発注・クレーム・支払い・契約・システム障害・重要な問い合わせなど)かどうかを判定してください。` +
    `広告・メルマガ・自動配信の通知・スパムなどは重要ではないと判定してください。\n\n` +
    `送信元: ${mail.from}\n件名: ${mail.subject}\n本文(抜粋):\n${mail.snippet}\n\n` +
    `次のJSON形式のみで回答してください(他の文章は不要): {"important": true または false, "reason": "30文字程度の理由"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MAIL_CLASSIFY_MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    console.error("Claude API失敗", res.status, await res.text());
    return { important: false, reason: "判定APIエラー" };
  }
  const data = await res.json();
  const text: string = (data.content ?? []).map((b: { text?: string }) => b.text ?? "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { important: false, reason: "判定結果の解析に失敗" };
  try {
    const parsed = JSON.parse(m[0]);
    return { important: !!parsed.important, reason: String(parsed.reason ?? "") };
  } catch {
    return { important: false, reason: "判定結果の解析に失敗" };
  }
}

// ============ Discord DM送信 ============

async function discord(path: string, method: string, body: unknown, attempt = 0): Promise<Response> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (mail-alert-check, 1.0)",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 429 && attempt < 2) {
    const j = await res.json().catch(() => ({ retry_after: 1 }));
    await new Promise((r) => setTimeout(r, Math.min(5, Number(j.retry_after ?? 1)) * 1000 + 100));
    return discord(path, method, body, attempt + 1);
  }
  return res;
}

async function getDmChannelId(): Promise<string> {
  const { data } = await supabase.from("mail_alert_state").select("value").eq("key", "dm_channel_id").maybeSingle();
  if (data?.value) return data.value;
  const res = await discord("/users/@me/channels", "POST", { recipient_id: MAIL_ALERT_DISCORD_USER_ID });
  if (!res.ok) throw new Error(`DMを開けませんでした(${res.status}): ${await res.text()}`);
  const ch = await res.json();
  await supabase.from("mail_alert_state").upsert({ key: "dm_channel_id", value: ch.id });
  return ch.id as string;
}

async function sendDiscordAlert(mail: MailInfo, reason: string): Promise<void> {
  if (!DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN が設定されていません");
  const embed = {
    title: "重要そうなメールが届きました",
    color: 0xc0392b,
    fields: [
      { name: "送信元", value: mail.from || "(不明)" },
      { name: "件名", value: mail.subject || "(件名なし)" },
      { name: "判定理由", value: reason || "-" },
      { name: "本文抜粋", value: (mail.snippet || "(本文なし)").slice(0, 400) },
    ],
  };
  let channelId = await getDmChannelId();
  let res = await discord(`/channels/${channelId}/messages`, "POST", { embeds: [embed] });
  if (res.status === 404) {
    await supabase.from("mail_alert_state").delete().eq("key", "dm_channel_id");
    channelId = await getDmChannelId();
    res = await discord(`/channels/${channelId}/messages`, "POST", { embeds: [embed] });
  }
  if (!res.ok) throw new Error(`DM送信に失敗(${res.status}): ${await res.text()}`);
}

// ============ エントリポイント ============

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET || !CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  if (!IMAP_PASSWORD) {
    return new Response("MAIL_IMAP_PASSWORD未設定", { status: 500 });
  }

  const { data: stateRow } = await supabase
    .from("mail_alert_state")
    .select("value")
    .eq("key", "last_uid")
    .maybeSingle();
  const lastUid = parseInt(stateRow?.value ?? "0", 10) || 0;

  let mails: MailInfo[] = [];
  let maxUid = lastUid;
  try {
    const result = await fetchNewMails(lastUid);
    mails = result.mails;
    maxUid = result.maxUid;
  } catch (e) {
    console.error("IMAP取得エラー", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }

  let notified = 0;
  for (const mail of mails) {
    try {
      const { important, reason } = await classifyImportance(mail);
      if (important) {
        await sendDiscordAlert(mail, reason);
        notified++;
      }
    } catch (e) {
      console.error(`UID ${mail.uid} の通知処理に失敗`, e);
    }
  }

  if (maxUid > lastUid) {
    await supabase.from("mail_alert_state").upsert({ key: "last_uid", value: String(maxUid) });
  }

  return new Response(JSON.stringify({ checked: mails.length, notified, lastUid: maxUid }), {
    headers: { "Content-Type": "application/json" },
  });
});
