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
  const health = await W.handle(new Request("https://w.example/health", { headers: { origin: ORIGIN } }), baseEnv());
  assert.deepEqual(await health.json(), { ok: true });
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
  assert.equal(CACHE.puts[0][0], "v1:ぬいぐるみ|plsh");

  r = await (await W.handle(post({ reading: "ぬいぐるみ", english: "plsh" }), env, { fetch: f })).json();
  assert.equal(r.cached, true);
  assert.equal(r.suggestion, "plush");
  assert.equal(calls, 1);
});

test("無料枠の上限(429)・通信失敗・変な返答は ok:null で、保存しない", async () => {
  const CACHE = fakeKV();
  const env = baseEnv({ CACHE });
  const run = async (f) => (await W.handle(post({ reading: "ぬいぐるみ", english: "plush" }), env, { fetch: f })).json();

  assert.deepEqual(await run(geminiReply("x", 429)), { ok: null, reason: "unavailable", suggestion: null });
  assert.deepEqual(await run(geminiReply("x", 503)), { ok: null, reason: "unavailable", suggestion: null });
  assert.deepEqual(await run(async () => { throw new Error("network"); }), { ok: null, reason: "unavailable", suggestion: null });
  assert.deepEqual(await run(geminiReply("すみません、わかりません")), { ok: null, reason: "unavailable", suggestion: null });
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
