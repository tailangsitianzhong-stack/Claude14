const test = require("node:test");
const assert = require("node:assert/strict");

let W;
test.before(async () => { W = await import("../worker/index.mjs"); });

const ORIGIN = "https://game.example";
const baseEnv = (over) => Object.assign(
  { GEMINI_API_KEY: "test-key", ALLOWED_ORIGINS: ORIGIN + ",null", GEMINI_MODEL: "gemini-test" }, over);

function fakeKV() {
  const m = new Map();
  return {
    puts: [],
    async get(k, type) { const v = m.get(k); return v == null ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v, opts) { this.puts.push([k, opts]); m.set(k, v); }
  };
}
const geminiReply = (text, status = 200) => async () =>
  new Response(status === 200 ? JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) : "err", { status });

const post = (body, origin = ORIGIN, path = "/judge") =>
  new Request("https://w.example" + path, {
    method: "POST", headers: origin ? { origin, "content-type": "application/json" } : {},
    body: typeof body === "string" ? body : JSON.stringify(body)
  });

test("入力の検証: 読みはひらがなに直し、英語は小文字1語", () => {
  assert.equal(W.cleanReading("ヌイグルミ"), "ぬいぐるみ");
  assert.equal(W.cleanReading("ー"), null);
  assert.equal(W.cleanReading("apple"), null);
  assert.equal(W.cleanReading("あ"), null);
  assert.equal(W.cleanEnglish(" Plush "), "plush");
  assert.equal(W.cleanEnglish("two words"), null);
  assert.equal(W.cleanEnglish("x".repeat(31)), null);
});

test("parseVerdict: JSON/コードフェンス/不正な値", () => {
  assert.deepEqual(W.parseVerdict('{"ok":true,"reason":"none","suggestion":null}'), { ok: true, reason: "none", suggestion: null });
  assert.deepEqual(W.parseVerdict('```json\n{"ok":false,"reason":"spelling","suggestion":"Apple"}\n```'),
    { ok: false, reason: "spelling", suggestion: "apple" });
  // spelling なのに正解が無い → wrong_english に丸める
  assert.deepEqual(W.parseVerdict('{"ok":false,"reason":"spelling","suggestion":null}'),
    { ok: false, reason: "wrong_english", suggestion: null });
  // 提案に変な文字が混ざっていたら捨てる
  assert.equal(W.parseVerdict('{"ok":false,"reason":"wrong_english","suggestion":"ap ple!"}').suggestion, null);
  assert.equal(W.parseVerdict('{"ok":"yes"}'), null);
  assert.equal(W.parseVerdict("sorry"), null);
  assert.equal(W.parseVerdict(undefined), null);
});

test("許可されていないオリジンは403、許可済みのOPTIONSは204", async () => {
  let r = await W.handle(post({ reading: "ぬいぐるみ", english: "plush" }, "https://evil.example"), baseEnv(), { fetch: geminiReply("{}") });
  assert.equal(r.status, 403);
  r = await W.handle(post({ reading: "ぬいぐるみ", english: "plush" }, null), baseEnv(), { fetch: geminiReply("{}") });
  assert.equal(r.status, 403);                                   // Originなし(curl等)も拒否

  r = await W.handle(new Request("https://w.example/judge", { method: "OPTIONS", headers: { origin: ORIGIN } }), baseEnv());
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);

  r = await W.handle(post({ reading: "ぬいぐるみ", english: "plush" }, "null"), baseEnv(), {
    fetch: geminiReply('{"ok":true,"reason":"none","suggestion":null}') });
  assert.equal(r.status, 200);                                   // file:// (Origin: null)

  r = await W.handle(post({ reading: "ぬいぐるみ", english: "plush" }, "https://any.example"),
    baseEnv({ ALLOWED_ORIGINS: "*" }), { fetch: geminiReply('{"ok":true,"reason":"none","suggestion":null}') });
  assert.equal(r.status, 200);
});

test("不正な入力は400/404/413", async () => {
  const f = { fetch: geminiReply("{}") };
  assert.equal((await W.handle(post("not json"), baseEnv(), f)).status, 400);
  assert.equal((await W.handle(post({ reading: "apple", english: "apple" }), baseEnv(), f)).status, 400);
  assert.equal((await W.handle(post({ reading: "ぬいぐるみ", english: "two words" }), baseEnv(), f)).status, 400);
  assert.equal((await W.handle(post({}, ORIGIN, "/other"), baseEnv(), f)).status, 404);
  assert.equal((await W.handle(post("x".repeat(2000)), baseEnv(), f)).status, 413);
  // /health は Origin なしでも開ける(スマホのブラウザで確認するため)。キーの中身は返さない
  const health = await W.handle(new Request("https://w.example/health"), baseEnv());
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, keySet: true, model: "gemini-test", kv: false });
  const noKey = await W.handle(new Request("https://w.example/health"), baseEnv({ GEMINI_API_KEY: undefined }));
  assert.equal((await noKey.json()).keySet, false);
});

test("Geminiへのリクエスト: モデル名・APIキー・プロンプト", async () => {
  let seen;
  const f = async (url, init) => { seen = { url, init }; return geminiReply('{"ok":true,"reason":"none","suggestion":null}')(); };
  await W.handle(post({ reading: "ヌイグルミ", english: "Plush" }), baseEnv(), { fetch: f });
  assert.match(seen.url, /\/v1beta\/models\/gemini-test:generateContent$/);
  assert.equal(seen.init.headers["x-goog-api-key"], "test-key");
  const body = JSON.parse(seen.init.body);
  const prompt = body.contents[0].parts[0].text;
  assert.ok(prompt.includes("ぬいぐるみ") && prompt.includes("plush"));
  assert.equal(body.generationConfig.temperature, 0);
});

test("判定結果はKVに保存され、2回目はGeminiを呼ばない", async () => {
  const CACHE = fakeKV();
  let calls = 0;
  const f = async () => { calls++; return geminiReply('{"ok":false,"reason":"spelling","suggestion":"plush"}')(); };
  const env = baseEnv({ CACHE });

  let r = await (await W.handle(post({ reading: "ぬいぐるみ", english: "plsh" }), env, { fetch: f })).json();
  assert.deepEqual(r, { ok: false, reason: "spelling", suggestion: "plush", cached: false });
  assert.equal(CACHE.puts.length, 1);
  assert.equal(CACHE.puts[0][0], "v2:ぬいぐるみ|plsh");

  r = await (await W.handle(post({ reading: "ぬいぐるみ", english: "plsh" }), env, { fetch: f })).json();
  assert.equal(r.cached, true);
  assert.equal(r.suggestion, "plush");
  assert.equal(calls, 1);
});

test("無料枠の上限(429)・通信失敗・変な返答は ok:null で、保存しない", async () => {
  const CACHE = fakeKV();
  const env = baseEnv({ CACHE });
  const run = async (f) => (await W.handle(post({ reading: "ぬいぐるみ", english: "plush" }), env, { fetch: f })).json();

  let r = await run(geminiReply("x", 429));
  assert.deepEqual([r.ok, r.reason, r.suggestion], [null, "unavailable", null]);
  assert.match(r.detail, /^gemini 429/);
  r = await run(geminiReply("x", 503));
  assert.deepEqual([r.ok, r.reason], [null, "unavailable"]);
  r = await run(async () => { throw new Error("network"); });
  assert.deepEqual([r.ok, r.reason], [null, "unavailable"]);
  assert.match(r.detail, /^fetch failed/);
  r = await run(geminiReply("すみません、わかりません"));
  assert.deepEqual([r.ok, r.reason], [null, "unavailable"]);
  assert.match(r.detail, /^gemini unparsable/);

  // Geminiのエラー本文のメッセージが detail に入る
  r = await run(async () => new Response(JSON.stringify({ error: { code: 429, message: "Quota exceeded for model" } }), { status: 429 }));
  assert.equal(r.detail, "gemini 429: Quota exceeded for model");
  assert.equal(CACHE.puts.length, 0);

  // キー/モデルの設定ミスは reason: config
  assert.equal((await run(geminiReply("x", 403))).reason, "config");
  assert.equal((await run(geminiReply("x", 404))).reason, "config");
});

test("APIキー未設定は ok:null / reason:config、KVが壊れていても動く", async () => {
  const r = await (await W.handle(post({ reading: "ぬいぐるみ", english: "plush" }),
    baseEnv({ GEMINI_API_KEY: undefined }), { fetch: geminiReply("{}") })).json();
  assert.deepEqual(r, { ok: null, reason: "config", suggestion: null });

  const brokenKV = { async get() { throw new Error("kv down"); }, async put() { throw new Error("kv down"); } };
  const r2 = await (await W.handle(post({ reading: "ぬいぐるみ", english: "plush" }),
    baseEnv({ CACHE: brokenKV }), { fetch: geminiReply('{"ok":true,"reason":"none","suggestion":null}') })).json();
  assert.equal(r2.ok, true);
});

test("友達対戦: 部屋の作成(5桁)・使用済みコードの再試行・未対応環境", async () => {
  const taken = new Set(["10000"]);
  let tries = 0;
  const ROOMS = {
    idFromName: (n) => n,
    get: (name) => ({ fetch: async () => { tries++; const ok = !taken.has(name) && tries > 1; if (ok) taken.add(name); return Response.json({ ok }); } })
  };
  const r = await W.handle(post({}, ORIGIN, "/room/new"), baseEnv({ ROOMS }));
  assert.equal(r.status, 200);
  const { code } = await r.json();
  assert.match(code, /^[1-9]\d{4}$/);
  assert.ok(tries >= 2);                                       // 1回目は使用済み扱い → 2回目で確保

  const none = await W.handle(post({}, ORIGIN, "/room/new"), baseEnv());
  assert.equal(none.status, 501);
  const bad = await W.handle(post({}, "https://evil.example", "/room/new"), baseEnv({ ROOMS }));
  assert.equal(bad.status, 403);                               // 許可されていないオリジンは作れない
});

test("友達対戦: WebSocketは部屋コード5桁のときだけ部屋へ中継する", async () => {
  const seen = [];
  const ROOMS = { idFromName: (n) => n, get: (name) => ({ fetch: async (req) => { seen.push([name, new URL(req.url).search]); return new Response("ok"); } }) };
  const ws = (path, origin = ORIGIN) => new Request("https://w.example" + path, { headers: { origin, upgrade: "websocket" } });
  assert.equal((await W.handle(ws("/room/12345?cid=abcdefgh"), baseEnv({ ROOMS }))).status, 200);
  assert.deepEqual(seen, [["12345", "?cid=abcdefgh"]]);
  assert.equal((await W.handle(ws("/room/1234"), baseEnv({ ROOMS }))).status, 404);        // 4桁は不可
  assert.equal((await W.handle(ws("/room/abcde"), baseEnv({ ROOMS }))).status, 404);
  assert.equal((await W.handle(ws("/room/12345", "https://evil.example"), baseEnv({ ROOMS }))).status, 403);
  assert.equal((await W.handle(ws("/room/12345"), baseEnv())).status, 501);
});

test("友達対戦: 部屋を作る時に game(しりとり/漢字検定)を部屋へ伝える。知らない値はしりとり", async () => {
  const seen = [];
  const ROOMS = { idFromName: (n) => n, get: () => ({ fetch: async (url) => { seen.push(new URL(url).searchParams.get("game")); return Response.json({ ok: true }); } }) };
  const mk = (q) => W.handle(post({}, ORIGIN, "/room/new" + q), baseEnv({ ROOMS }));
  assert.equal((await mk("")).status, 200);
  assert.equal((await mk("?game=kanken")).status, 200);
  assert.equal((await mk("?game=hack")).status, 200);
  assert.deepEqual(seen, ["shiritori", "kanken", "shiritori"]);
});

test("Geminiへの指示: 地名・月・曜日などは正解にし、人名・ブランド名・ふつうの複数形は不可", () => {
  const p = W.buildPrompt("ぱり", "paris");
  assert.ok(p.includes("ぱり") && p.includes("paris"));
  assert.match(p, /ACCEPT these too: names of countries, cities/);
  assert.match(p, /months, days of the week/);
  assert.match(p, /scissors/);                                    // 複数形でしか使わない名詞は可
  assert.match(p, /Do NOT accept: names of ordinary people, company or brand names/);
  assert.ok(!/Do NOT accept: proper nouns/.test(p));              // 以前の「固有名詞は全部不可」ではなくなった
});

test("部屋を作れないとき: 部屋の機能が例外を投げても、理由つきのJSON(CORSつき)で返す", async () => {
  const ROOMS = { idFromName: (n) => n, get: () => ({ fetch: async () => { throw new Error("storage exploded"); } }) };
  const r = await W.handle(post({}, ORIGIN, "/room/new?game=chem"), baseEnv({ ROOMS }));
  assert.equal(r.status, 500);
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
  const j = await r.json();
  assert.equal(j.error, "room_failed");
  assert.match(j.detail, /storage exploded/);
});
