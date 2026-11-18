/**
 * しりとり判定 Worker（Cloudflare Workers）
 *
 * ブラウザ → この Worker → Gemini API。APIキーはここ(Secret)にだけ置き、ブラウザには出さない。
 * 辞書にない「(読み, 英語)」だけをブラウザから受け取り、Gemini に判定させて結果を返す。
 *
 *   POST /judge   {"reading":"ぬいぐるみ","english":"plush"}
 *     → {"ok":true|false|null, "reason":"none|spelling|wrong_english|unavailable|config",
 *        "suggestion":"..."|null, "cached":true|false}
 *   POST /room/new[?game=kanken] → {"code":"12345"}   友達対戦の部屋を作る(5桁)。game 省略=しりとり
 *   GET  /room/12345?cid=…  (WebSocket)     部屋に入る。進行は room-do.mjs
 *   GET  /health  → {"ok":true,"keySet":true,"model":"...","kv":true}（Origin不要。設定の確認用）
 *
 * ok:null は「判定できなかった」（無料枠の上限・通信エラー等）。ブラウザ側は辞書の結果に戻す。
 *
 * 環境変数 / バインディング（wrangler.jsonc と wrangler secret）:
 *   GEMINI_API_KEY   (Secret) Gemini APIキー
 *   GEMINI_MODEL     (var)    既定 gemini-3.5-flash-lite
 *   ALLOWED_ORIGINS  (var)    許可するオリジン(カンマ区切り)。"*" で全許可
 *   CACHE            (KV)     判定結果のキャッシュ（なくても動く）
 */

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const CACHE_TTL_SEC = 60 * 60 * 24 * 180; // 判定結果は半年保存
const GEMINI_TIMEOUT_MS = 8000;
const MAX_BODY_CHARS = 1000;

/* ---------- 入力の検証 ---------- */

/** カタカナ→ひらがな。ひらがな・長音のみ2〜12字なら返す */
export function cleanReading(input) {
  if (typeof input !== "string") return null;
  const s = input.trim().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  return /^[ぁ-ゖー]{2,12}$/.test(s) && s[0] !== "ー" ? s : null;
}

export function cleanEnglish(input) {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  return /^[a-z]{2,30}$/.test(s) ? s : null;
}

/* ---------- Gemini ---------- */

export function buildPrompt(reading, english) {
  return [
    "You are the judge for a Japanese word game for children and teenagers (ages 7-18) called English Shiritori.",
    "A player says a Japanese word by its hiragana reading, and types the English spelling of that word.",
    "",
    `Japanese reading (hiragana): ${reading}`,
    `Typed English: ${english}`,
    "",
    "Accept the answer (ok = true) only if the typed English is a correctly spelled, standard English",
    "(US or UK spelling) common noun that is a natural translation of a Japanese word read as the reading above.",
    "Do NOT accept: proper nouns, plurals or other inflected forms, abbreviations, slang, offensive words,",
    "or words that merely sound similar.",
    "",
    "If you reject it:",
    '- reason "spelling": the typed English is a misspelling of the English word that matches the reading.',
    "  Put the correct spelling in suggestion.",
    '- reason "wrong_english": the typed English does not correspond to the reading (or is not acceptable).',
    "  Put one correct English word for the reading in suggestion, or null if you are not sure.",
    "",
    "Reply with ONLY one JSON object, no markdown and no explanation:",
    '{"ok": true or false, "reason": "none" | "spelling" | "wrong_english", "suggestion": "<lowercase single English word>" or null}',
    'When ok is true, reason is "none" and suggestion is null.'
  ].join("\n");
}

/** Geminiの返答から判定JSONを取り出す（```json で囲まれていても可）。不正なら null */
export function parseVerdict(text) {
  if (typeof text !== "string") return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj;
  try { obj = JSON.parse(m[0]); } catch (_) { return null; }
  if (typeof obj.ok !== "boolean") return null;

  const sug = typeof obj.suggestion === "string" ? obj.suggestion.trim().toLowerCase() : null;
  const suggestion = sug && /^[a-z]{2,30}$/.test(sug) ? sug : null;
  if (obj.ok) return { ok: true, reason: "none", suggestion: null };
  const reason = obj.reason === "spelling" && suggestion ? "spelling" : "wrong_english";
  return { ok: false, reason, suggestion };
}

/** Geminiのエラー本文から、人が読めるメッセージだけを取り出す（キー等は含まれない） */
function errorMessage(body) {
  try {
    const m = JSON.parse(body);
    return String((m.error && m.error.message) || "").slice(0, 160).replace(/\s+/g, " ");
  } catch (_) {
    return body.slice(0, 80).replace(/\s+/g, " ");
  }
}

async function askGemini(env, reading, english, doFetch) {
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await doFetch(`${GEMINI_BASE}${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(reading, english) }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 200 }
      }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      // 400/403: キーやモデル名の設定ミス。429/5xx: 無料枠の上限や一時的な障害
      const cfg = res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404;
      const body = (await res.text().catch(() => "")).slice(0, 300);
      console.error(`gemini ${res.status}`, body);
      return { unavailable: cfg ? "config" : "unavailable", detail: `gemini ${res.status}: ${errorMessage(body)}` };
    }
    const data = await res.json();
    const text = (data.candidates || [])
      .flatMap((c) => (c.content && c.content.parts) || [])
      .map((p) => p.text || "")
      .join("");
    const verdict = parseVerdict(text);
    if (!verdict) {
      console.error("gemini unparsable:", text.slice(0, 200));
      return { unavailable: "unavailable", detail: "gemini unparsable: " + text.slice(0, 80).replace(/\s+/g, " ") };
    }
    return { verdict };
  } catch (e) {
    console.error("gemini error:", e && e.message);
    return { unavailable: "unavailable", detail: "fetch failed: " + ((e && e.name) || "error") };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- HTTP ---------- */

function originAllowed(env, origin) {
  const list = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes("*")) return true;
  return !!origin && list.includes(origin);
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin"
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, corsHeaders(origin))
  });
}

/** 5桁の部屋コードを新しく作る（使われていないコードが見つかるまで数回試す） */
async function newRoom(env, origin, game) {
  if (!env.ROOMS) return json({ error: "rooms_unavailable" }, 501, origin);
  for (let i = 0; i < 10; i++) {
    const code = String(10000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90000));
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const res = await stub.fetch(`https://room/claim?code=${code}&game=${game}`, { method: "POST" });
    if ((await res.json()).ok) return json({ code }, 200, origin);
  }
  return json({ error: "busy" }, 503, origin);
}

export async function handle(request, env, deps) {
  const doFetch = (deps && deps.fetch) || fetch;
  const url = new URL(request.url);
  const origin = request.headers.get("origin");

  // 動作確認用(ブラウザでURLを直接開ける)。キーの有無だけを返し、中身は返さない
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, keySet: !!env.GEMINI_API_KEY, model: env.GEMINI_MODEL || DEFAULT_MODEL, kv: !!env.CACHE }, 200, origin);
  }

  if (!originAllowed(env, origin)) {
    return json({ ok: null, reason: "forbidden_origin" }, 403, null);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  // ---- 友達対戦の部屋 ----
  if (request.method === "POST" && url.pathname === "/room/new") {
    const game = url.searchParams.get("game") === "kanken" ? "kanken" : "shiritori";   // 知らない値はしりとり
    return newRoom(env, origin, game);
  }
  const roomMatch = url.pathname.match(/^\/room\/(\d{5})$/);
  if (roomMatch && request.headers.get("Upgrade") === "websocket") {
    if (!env.ROOMS) return json({ error: "rooms_unavailable" }, 501, origin);
    return env.ROOMS.get(env.ROOMS.idFromName(roomMatch[1])).fetch(request);   // 部屋へつなぐ
  }

  if (request.method !== "POST" || url.pathname !== "/judge") {
    return json({ error: "not_found" }, 404, origin);
  }

  let payload;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return json({ error: "too_large" }, 413, origin);
    payload = JSON.parse(raw);
  } catch (_) {
    return json({ error: "bad_json" }, 400, origin);
  }
  const reading = cleanReading(payload && payload.reading);
  const english = cleanEnglish(payload && payload.english);
  if (!reading || !english) return json({ error: "invalid_input" }, 400, origin);

  const key = `v1:${reading}|${english}`;
  if (env.CACHE) {
    try {
      const hit = await env.CACHE.get(key, "json");
      if (hit) return json(Object.assign({}, hit, { cached: true }), 200, origin);
    } catch (e) { console.error("kv get failed:", e && e.message); }
  }

  if (!env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set");
    return json({ ok: null, reason: "config", suggestion: null }, 200, origin);
  }

  const r = await askGemini(env, reading, english, doFetch);
  if (r.unavailable) {
    return json({ ok: null, reason: r.unavailable, suggestion: null, detail: r.detail || null }, 200, origin);
  }

  const body = { ok: r.verdict.ok, reason: r.verdict.reason, suggestion: r.verdict.suggestion };
  if (env.CACHE) {
    try { await env.CACHE.put(key, JSON.stringify(body), { expirationTtl: CACHE_TTL_SEC }); }
    catch (e) { console.error("kv put failed:", e && e.message); }
  }
  return json(Object.assign({}, body, { cached: false }), 200, origin);
}

export default {
  fetch(request, env) {
    return handle(request, env);
  }
};
