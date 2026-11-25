// 化学クイズ・友達対戦の部屋ロジック
const test = require("node:test");
const assert = require("node:assert/strict");

let C, L;
test.before(async () => { C = await import("../worker/chem-room.mjs"); L = await import("../worker/room-logic.mjs"); });

const T0 = 9_500_000;
const seeded = (seed) => { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); };
function lobby(n = 2) {
  const st = C.createRoom("12345", T0);
  for (let i = 0; i < n; i++) assert.ok(C.join(st, "p" + (i + 1) + "xxxxxxx", T0).ok);
  return st;
}
const ids = (st) => st.players.map((p) => p.id);
function playing(mode, n = 2, o = {}) {
  const st = lobby(n);
  assert.ok(C.setSettings(st, st.hostId, Object.assign({ mode, rounds: 5 }, o), T0).ok);
  assert.ok(C.start(st, st.hostId, T0, seeded(4)).ok);
  C.timeout(st, st.g.nextAt, seeded(2));
  return st;
}

test("部屋: 作成・設定(学年・単元・形式の検査)・開始条件", () => {
  const st = lobby(3);
  assert.equal(st.game, "chem");
  assert.deepEqual(st.settings, { mode: "mix", difficulty: "normal", grade: "high", units: [], rounds: 10 });
  assert.equal(C.setSettings(st, ids(st)[1], { mode: "calc" }, T0).error, "not_host");
  assert.ok(C.setSettings(st, st.hostId, { mode: "calc", grade: "exam", units: ["u13", "u12", "zzz"], rounds: 30, difficulty: "hard" }, T0).ok);
  assert.deepEqual(st.settings, { mode: "calc", difficulty: "hard", grade: "exam", units: ["u12", "u13"], rounds: 30 });
  C.setSettings(st, st.hostId, { mode: "bogus", grade: "junior", rounds: 7, units: "u1" }, T0);
  assert.deepEqual(st.settings, { mode: "calc", difficulty: "hard", grade: "exam", units: ["u12", "u13"], rounds: 30 });
  assert.equal(C.start(lobby(1), "p1xxxxxxx", T0).error, "need_players");
});

test("部屋: 計算は、サーバーが問題・正解を持ち、端末へは正解と途中式を送らない。全員答えたらすぐ答え合わせ", () => {
  const st = playing("calc", 3, { units: ["u13"] });
  assert.equal(st.g.rmode, "calc"); assert.equal(st.g.q.u, "u13");
  const pub = JSON.stringify(C.publicState(st));
  assert.ok(!/"priv"|"steps"|"ansText"/.test(pub));
  const [a, b, c] = ids(st), t = st.g.startedAt;
  assert.equal(C.calc(st, a, { text: "zzz" }, t + 100).error, "bad_answer");
  assert.ok(C.calc(st, a, { text: String(st.g.priv.ans) }, t + 1000).ok);
  assert.equal(C.calc(st, a, { text: "1" }, t + 1100).error, "already");
  assert.ok(C.calc(st, b, { text: "99999" }, t + 1500).ok);
  assert.equal(st.g.phase, "play");
  assert.ok(C.calc(st, c, { text: "1" }, t + 2000).ok);
  assert.equal(st.g.phase, "between");
  assert.ok(C.publicState(st).g.reveal.steps.length >= 1);
});

test("部屋: 早押しは、化学式を答えても正解(大文字小文字を区別)。辞書に合わなければAI用の内容(judge)を返す", () => {
  const st = playing("buzz", 2, { units: ["u16"] });
  const [a] = ids(st), t = st.g.startedAt;
  assert.ok(C.press(st, a, t + 5000).ok);
  const r = C.answer(st, a, { text: "ぜんぜんちがう" }, t + 6000);
  assert.ok(r.ok && r.judge && Array.isArray(r.judge.forms));
  assert.equal(r.judge.input, "ぜんぜんちがう");
});

test("部屋: 抜けた人を待たない。戻っても、その問題は答えられない", () => {
  const st = playing("calc", 3, { units: ["u13"] });
  const [a, b, c] = ids(st), t = st.g.startedAt;
  L.disconnect(st, c, t + 100); C.left(st, c, t + 100);
  assert.ok(C.calc(st, a, { text: "1" }, t + 500).ok); assert.ok(C.calc(st, b, { text: "2" }, t + 800).ok);
  assert.equal(st.g.phase, "between");
  L.join(st, c, t + 900); C.returned(st, c, t + 900);
  C.timeout(st, st.g.nextAt, seeded(2));
  L.disconnect(st, c, st.g.startedAt + 10); C.left(st, c, st.g.startedAt + 10);
  L.join(st, c, st.g.startedAt + 20); C.returned(st, c, st.g.startedAt + 20);
  assert.equal(C.calc(st, c, { text: "1" }, st.g.startedAt + 30).error, "sit_out");
});
