const test = require("node:test");
const assert = require("node:assert/strict");
const Sfx = require("../js/sfx.js");

/** 偽の AudioContext: 作られた発振器(音)を数える */
function fakeAudio() {
  const log = { oscillators: 0, started: 0, contexts: 0, resumed: 0, suspended: 0 };
  class Ctx {
    constructor() { log.contexts++; this.state = "running"; this.currentTime = 0; this.destination = {}; }
    resume() { this.state = "running"; log.resumed++; return Promise.resolve(); }
    suspend() { this.state = "suspended"; log.suspended++; return Promise.resolve(); }
    createOscillator() {
      log.oscillators++;
      return { type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() { log.started++; }, stop() {} };
    }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }
  return { Ctx, log };
}
const memStorage = (init) => { const m = { ...(init || {}) }; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; }, m }; };

test("音を鳴らすと発振器が作られる。全ての音の名前が鳴らせる", () => {
  const { Ctx, log } = fakeAudio();
  const s = Sfx.create({ AudioContext: Ctx, storage: memStorage(), navigator: null });
  for (const name of s.names) assert.equal(s.play(name), true, name);
  assert.ok(log.oscillators >= s.names.length);
  assert.equal(log.started, log.oscillators);
  assert.equal(s.play("nope"), false);                       // 知らない名前は何もしない
});

test("設定で「音」をオフにすると鳴らない。音量0も鳴らない", () => {
  const { Ctx, log } = fakeAudio();
  const s = Sfx.create({ AudioContext: Ctx, storage: memStorage(), navigator: null });
  s.set({ sound: false });
  assert.equal(s.play("ok"), false);
  assert.equal(log.oscillators, 0);
  assert.equal(log.contexts, 0);                              // 音を出さないなら、準備もしない
  s.set({ sound: true, volume: 0 });
  assert.equal(s.play("ok"), false);
  s.set({ volume: 0.5 });
  assert.equal(s.play("ok"), true);
});

test("設定は保存され、次回も同じ。ほかの設定項目は壊さない。壊れた保存でも動く", () => {
  const st = memStorage({ "minigames.settings": JSON.stringify({ other: 1 }) });
  const a = Sfx.create({ AudioContext: fakeAudio().Ctx, storage: st, navigator: null });
  assert.deepEqual(a.get(), { sound: true, volume: 0.7, vibrate: true });
  a.set({ sound: false, volume: 1.7, vibrate: false });
  assert.deepEqual(a.get(), { sound: false, volume: 1, vibrate: false });     // 音量は0〜1に丸める
  const b = Sfx.create({ AudioContext: fakeAudio().Ctx, storage: st, navigator: null });
  assert.deepEqual(b.get(), { sound: false, volume: 1, vibrate: false });
  assert.equal(JSON.parse(st.m["minigames.settings"]).other, 1);
  const broken = Sfx.create({ storage: memStorage({ "minigames.settings": "{oops" }), navigator: null });
  assert.equal(broken.get().sound, true);
  const none = Sfx.create({ storage: null, navigator: null });
  none.set({ sound: false });
  assert.equal(none.get().sound, false);
});

test("音が出せない環境(AudioContext無し・作成に失敗)でも落ちない", () => {
  const s = Sfx.create({ AudioContext: null, storage: memStorage(), navigator: null });
  assert.doesNotThrow(() => s.play("ok"));
  const bad = Sfx.create({ AudioContext: class { constructor() { throw new Error("no audio"); } }, storage: memStorage(), navigator: null });
  assert.equal(bad.play("ok"), false);
});

test("最初の鳴らしで音の準備をし、使い回す", () => {
  const { Ctx, log } = fakeAudio();
  const s = Sfx.create({ AudioContext: Ctx, storage: memStorage(), navigator: null, idleMs: 100000 });
  s.play("tap"); s.play("tap");
  assert.equal(log.contexts, 1);                              // 使い回す
  assert.equal(log.suspended, 0);                             // 鳴らした直後は止めない
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("省電力: 無音が続いたら音の準備を止め、次に鳴らす時に再開する。鳴らし続ける間は止めない", async () => {
  const { Ctx, log } = fakeAudio();
  const s = Sfx.create({ AudioContext: Ctx, storage: memStorage(), navigator: null, idleMs: 40 });
  s.play("ok");
  await wait(20); s.play("ok");                               // 鳴らすたびに延長される
  await wait(25); assert.equal(log.suspended, 0);
  await wait(60);
  assert.equal(log.suspended, 1);                             // 無音が続いたので止まった
  const before = log.resumed;
  assert.equal(s.play("ok"), true);                           // 次に鳴らす時は再開して鳴る
  assert.equal(log.resumed, before + 1);
  assert.equal(log.contexts, 1);                              // 作り直さない
  await wait(70);
  assert.equal(log.suspended, 2);                             // また無音が続けば止まる
});

test("省電力: 画面が隠れたら(アプリが裏に回ったら)すぐ止める。タップでも準備が延長される", async () => {
  const { Ctx, log } = fakeAudio();
  const s = Sfx.create({ AudioContext: Ctx, storage: memStorage(), navigator: null, idleMs: 100000 });
  const handlers = {};
  const doc = { hidden: false, addEventListener: (t, fn) => { handlers[t] = fn; } };
  s.attach(doc);
  s.play("tap");
  assert.equal(log.suspended, 0);
  doc.hidden = true; handlers.visibilitychange();
  assert.equal(log.suspended, 1);
  doc.hidden = false; handlers.visibilitychange();            // 戻っても勝手には再開しない(次に鳴らす時に再開)
  assert.equal(log.suspended, 1);
  s.play("tap");
  assert.ok(log.resumed >= 1);
  s.suspendNow(); s.suspendNow();                              // 二重に呼んでも安全
  assert.equal(log.suspended, 2);
});

test("バイブ: 失敗・間違い・勝ちだけ。設定でオフにできる。対応しない端末でも落ちない", () => {
  const calls = [];
  const nav = { vibrate: (p) => calls.push(p) };
  const s = Sfx.create({ AudioContext: fakeAudio().Ctx, storage: memStorage(), navigator: nav });
  s.play("ok"); s.play("tap");
  assert.deepEqual(calls, []);
  s.play("ng"); s.play("win");
  assert.equal(calls.length, 2);
  s.set({ vibrate: false });
  s.play("ng");
  assert.equal(calls.length, 2);
  s.set({ sound: false, vibrate: true });
  s.play("lose");                                              // 音がオフでもバイブは設定どおり
  assert.equal(calls.length, 3);
  assert.doesNotThrow(() => Sfx.create({ storage: memStorage(), navigator: {} }).play("ng"));
});

test("画面全体のボタン音: キーボードは小さい音、4択は鳴らさない、無効なボタンは鳴らさない", () => {
  const { Ctx, log } = fakeAudio();
  const s = Sfx.create({ AudioContext: Ctx, storage: memStorage(), navigator: null });
  let handler;
  s.attach({ addEventListener: (type, fn) => { if (type === "pointerdown") handler = fn; } });
  const btn = (cls, disabled) => ({ target: { closest: () => ({ classList: { contains: (c) => cls.includes(c) }, disabled: !!disabled }) } });
  handler(btn(["btn"])); const afterTap = log.oscillators;
  assert.ok(afterTap >= 1);
  handler(btn(["kb-key"])); assert.ok(log.oscillators > afterTap);
  const afterKey = log.oscillators;
  handler(btn(["kk-choice"])); assert.equal(log.oscillators, afterKey);
  handler(btn(["btn"], true)); assert.equal(log.oscillators, afterKey);
  handler({ target: { closest: () => null } }); assert.equal(log.oscillators, afterKey);
});
