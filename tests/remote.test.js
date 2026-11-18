const test = require("node:test");
const assert = require("node:assert/strict");
const Remote = require("../js/games/shiritori/remote.js");
const Judge = require("../js/games/shiritori/judge.js");
const Dict = require("../js/games/shiritori/dictionary.js");

global.window = {};
require("../data/words.js");
const DATA = window.SHIRITORI_WORDS;

const memStorage = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, m }; };
const reply = (obj, status = 200) => async () => new Response(JSON.stringify(obj), { status });

test("endpoint が空なら null（Geminiを使わない）", () => {
  assert.equal(Remote.create({ endpoint: "" }), null);
  assert.equal(Remote.create({}), null);
});

test("結果を返し、同じ組は2回目から通信しない（端末にも保存）", async () => {
  const storage = memStorage();
  let calls = 0, seen;
  const fetchFn = async (url, init) => { calls++; seen = { url, init }; return reply({ ok: true, reason: "none" })(); };
  const remote = Remote.create({ endpoint: "https://w.example/", fetch: fetchFn, storage });

  assert.deepEqual(await remote({ reading: "ぬいぐるみ", english: "plush" }), { ok: true });
  assert.equal(seen.url, "https://w.example/judge");
  assert.deepEqual(JSON.parse(seen.init.body), { reading: "ぬいぐるみ", english: "plush" });
  assert.deepEqual(await remote({ reading: "ぬいぐるみ", english: "plush" }), { ok: true });
  assert.equal(calls, 1);

  // 別のインスタンス(ページ再読込)でも保存分を使う
  const remote2 = Remote.create({ endpoint: "https://w.example", fetch: fetchFn, storage });
  await remote2({ reading: "ぬいぐるみ", english: "plush" });
  assert.equal(calls, 1);
});

test("不合格の結果(正解つき)を返す", async () => {
  const remote = Remote.create({ endpoint: "https://w.example", storage: null,
    fetch: reply({ ok: false, reason: "spelling", suggestion: "plush" }) });
  assert.deepEqual(await remote({ reading: "ぬいぐるみ", english: "plsh" }),
    { ok: false, reason: "spelling", suggestion: "plush" });
});

test("ok:null・HTTPエラー・通信失敗・壊れた応答は null で、保存しない", async () => {
  const storage = memStorage();
  for (const fetchFn of [
    reply({ ok: null, reason: "unavailable" }),
    reply({}, 500),
    async () => { throw new Error("offline"); },
    async () => new Response("not json", { status: 200 })
  ]) {
    const remote = Remote.create({ endpoint: "https://w.example", fetch: fetchFn, storage });
    assert.equal(await remote({ reading: "ぬいぐるみ", english: "plush" }), null);
  }
  assert.equal(storage.getItem("minigames.shiritori.remoteCache.v2"), null);
});

test("保存データが壊れていても動く", async () => {
  const storage = memStorage();
  storage.setItem("minigames.shiritori.remoteCache.v2", "{broken");
  const remote = Remote.create({ endpoint: "https://w.example", storage, fetch: reply({ ok: true }) });
  assert.deepEqual(await remote({ reading: "ぬいぐるみ", english: "plush" }), { ok: true });
});

test("judge: 近いつづりはGeminiに聞かず、辞書にない語だけ聞く", async () => {
  const dict = Dict.create(DATA);
  const asked = [];
  const remote = async (p) => { asked.push(p.english); return { ok: true }; };
  const judge = Judge.create({ dict, remote });

  let r = await judge.judge({ reading: "りんご", english: "appel", usedEnglish: [] });
  assert.deepEqual([r.ok, r.reason, r.suggestion], [false, "spelling", "apple"]);
  assert.deepEqual(asked, []);                                   // 聞いていない

  r = await judge.judge({ reading: "りんご", english: "apple", usedEnglish: [] });
  assert.equal(r.source, "dictionary");
  assert.deepEqual(asked, []);

  r = await judge.judge({ reading: "ぬいぐるみ", english: "plushie", usedEnglish: [] });
  assert.deepEqual([r.ok, r.source], [true, "remote"]);
  assert.deepEqual(asked, ["plushie"]);
});

test("judge: remote が null(判定できず)なら辞書の結果にもどる", async () => {
  const dict = Dict.create(DATA);
  const judge = Judge.create({ dict, remote: async () => null });
  const r = await judge.judge({ reading: "ぬいぐるみ", english: "plushie", usedEnglish: [] });
  assert.equal(r.ok, false);
  assert.equal(r.source, "dictionary");
});

test("judge: remote の不合格(正解つき)をそのまま返す", async () => {
  const dict = Dict.create(DATA);
  const judge = Judge.create({ dict, remote: async () => ({ ok: false, reason: "wrong_english", suggestion: "plush" }) });
  const r = await judge.judge({ reading: "ぬいぐるみ", english: "dog", usedEnglish: [] });
  assert.deepEqual([r.ok, r.reason, r.suggestion, r.source], [false, "wrong_english", "plush", "remote"]);
});
