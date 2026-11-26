// 英単語トランスミッション: AI判定(Worker側)
const test = require("node:test");
const assert = require("node:assert/strict");

let J;
test.before(async () => { J = await import("../worker/ladder-judge.mjs"); });

const kv = () => { const m = new Map(); return { puts: [], async get(k, t) { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, async put(k, v) { this.puts.push(k); m.set(k, v); } }; };
const reply = (text, status = 200) => async () => new Response(status === 200 ? JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) : "err", { status });

test("入力の検証: 3〜5文字の英小文字だけ。大文字はそろえる", () => {
  assert.deepEqual(J.cleanPayload({ word: "Jock" }), { word: "jock" });
  for (const w of ["ab", "toolong", "jo ck", "jock!", "", 5, null]) assert.equal(J.cleanPayload({ word: w }), null, String(w));
  assert.equal(J.cleanPayload(null), null);
  assert.match(J.buildPrompt({ word: "jock" }), /Word \(written in lowercase\): jock/);
});

test("返答の読みとり: 有効なら品詞・意味・活用。意味のない有効は不正。不可は valid=false", () => {
  assert.deepEqual(J.parseVerdict('{"valid": true, "pos": "名詞", "ja": "運動選手（うんどうせんしゅ）", "form": ""}'), { valid: true, pos: "名詞", ja: "運動選手（うんどうせんしゅ）", form: "" });
  assert.deepEqual(J.parseVerdict('```json\n{"valid": true, "pos": "xx", "ja": "岩（いわ）", "form": "複数形・三単現"}\n```'), { valid: true, pos: "", ja: "岩（いわ）", form: "複数形・三単現" });
  assert.deepEqual(J.parseVerdict('{"valid": false}'), { valid: false });
  assert.equal(J.parseVerdict('{"valid": true, "ja": ""}'), null);
  assert.equal(J.parseVerdict("たぶん"), null);
  assert.equal(J.parseVerdict('{"valid": "yes"}'), null);
});

test("判定: AIの結果をキャッシュする。不可もキャッシュ。確認できないときは null でキャッシュしない。不適切語はAIに聞かない", async () => {
  const CACHE = kv(); let calls = 0;
  const ask = (text) => async (...a) => { calls++; return reply(text)(...a); };
  const env = { GEMINI_API_KEY: "k", CACHE };
  const r1 = await J.judge(env, { word: "jock" }, ask('{"valid": true, "pos": "名詞", "ja": "運動選手（うんどうせんしゅ）", "form": ""}'));
  assert.equal(r1.ok, true); assert.equal(r1.ja, "運動選手（うんどうせんしゅ）"); assert.equal(r1.cached, false);
  const r2 = await J.judge(env, { word: "JOCK" }, ask("x"));
  assert.equal(r2.ok, true); assert.equal(r2.cached, true); assert.equal(calls, 1);
  const r3 = await J.judge(env, { word: "rork" }, ask('{"valid": false}'));
  assert.equal(r3.ok, false); assert.equal(r3.reason, "notword"); assert.equal(CACHE.puts.length, 2);
  assert.ok(CACHE.puts.every((k) => k.startsWith("ladder2:")));
  const r4 = await J.judge(env, { word: "zork" }, reply("", 429));
  assert.equal(r4.ok, null); assert.equal(r4.reason, "unavailable"); assert.equal(CACHE.puts.length, 2);
  assert.equal((await J.judge({ CACHE: kv() }, { word: "zork" }, reply("{}"))).reason, "config");
  const before = calls;
  const bad = await J.judge(env, { word: "porn" }, ask('{"valid": true, "ja": "x"}'));
  assert.equal(bad.ok, false); assert.equal(calls, before);
  assert.equal((await J.judge(env, { word: "a" }, reply("{}"))).reason, "invalid_input");
});
