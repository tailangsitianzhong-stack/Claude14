// 二択クイズ・友達対戦の部屋ロジック
const test = require("node:test");
const assert = require("node:assert/strict");

let D, L;
test.before(async () => { D = await import("../worker/duo-room.mjs"); L = await import("../worker/room-logic.mjs"); });

const T0 = 9_500_000;
const seeded = (seed) => { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); };
function lobby(n = 2) {
  const st = D.createRoom("12345", T0);
  for (let i = 0; i < n; i++) assert.ok(D.join(st, "p" + (i + 1) + "xxxxxxx", T0).ok);
  return st;
}
const ids = (st) => st.players.map((p) => p.id);
function playing(o = {}, n = 2) {
  const st = lobby(n);
  assert.ok(D.setSettings(st, st.hostId, Object.assign({ rounds: 10 }, o), T0).ok);
  assert.ok(D.start(st, st.hostId, T0, seeded(4)).ok);
  D.timeout(st, st.g.nextAt, seeded(2));
  return st;
}

test("部屋: 作成・設定の検査(モード・科目・難しさ・問題数)・開始条件", () => {
  const st = lobby(3);
  assert.equal(st.game, "duo");
  assert.deepEqual(st.settings, { mode: "fixed", rounds: 10, difficulty: "normal", subjects: ["en", "chem", "phys", "geo"] });
  assert.equal(D.setSettings(st, ids(st)[1], { mode: "survival" }, T0).error, "not_host");
  assert.ok(D.setSettings(st, st.hostId, { mode: "survival", rounds: 20, difficulty: "hard", subjects: ["phys", "zzz", "en"] }, T0).ok);
  assert.deepEqual(st.settings, { mode: "survival", rounds: 20, difficulty: "hard", subjects: ["en", "phys"] });
  D.setSettings(st, st.hostId, { mode: "bogus", rounds: 7, difficulty: "x", subjects: [] }, T0);
  assert.deepEqual(st.settings, { mode: "survival", rounds: 20, difficulty: "hard", subjects: ["en", "phys"] });     // 不正な値・空の科目は無視
  assert.equal(D.start(lobby(1), "p1xxxxxxx", T0).error, "need_players");
});

test("部屋: 全員が同時に答える。正解(priv)は端末に送らず、答え合わせで初めて正解の側と解説が出る", () => {
  const st = playing({ subjects: ["phys"] }, 3);
  assert.equal(st.g.phase, "play"); assert.equal(st.g.q.s, "phys");
  const pub = JSON.stringify(D.publicState(st));
  assert.ok(!/"priv"|"explain"/.test(pub));
  const [a, b, c] = ids(st), t = st.g.startedAt, right = st.g.priv.a;
  assert.equal(D.choose(st, a, { i: 5 }, t + 100).error, "bad_answer");
  assert.ok(D.choose(st, a, { i: right }, t + 400).ok);
  assert.equal(D.choose(st, a, { i: 0 }, t + 500).error, "already");
  const mid = D.publicState(st).g;
  assert.deepEqual(mid.answers[a] && Object.keys(mid.answers[a]).sort(), ["at", "done"]);        // 選んだ側は見えない
  assert.ok(D.choose(st, b, { i: 1 - right }, t + 900).ok);
  assert.equal(st.g.phase, "play");
  assert.ok(D.choose(st, c, { i: right }, t + 1500).ok);
  assert.equal(st.g.phase, "between");
  const rv = D.publicState(st).g.reveal;
  assert.equal(rv.a, right); assert.ok(rv.gains[a] > 0 && rv.gains[b] === 0); assert.ok(typeof rv.explain === "string");
  assert.ok(rv.gains[a] > rv.gains[c] - 1);                                                         // 早く答えたほうが、同じかそれ以上
});

test("部屋: 時間切れで締め切り。サバイバルは全員のライフがなくなると終わり、順位が入る", () => {
  const st = playing({ mode: "survival" }, 2);
  const [a, b] = ids(st);
  for (let n = 0; n < 3 && st.phase === "playing"; n++) {
    const r = st.g.priv.a;
    D.choose(st, a, { i: 1 - r }, st.g.startedAt + 100); D.choose(st, b, { i: 1 - r }, st.g.startedAt + 200);
    D.timeout(st, st.g.nextAt, seeded(60 + n));
  }
  assert.equal(st.phase, "over"); assert.equal(st.ranking.length, 2);
  assert.equal(D.rematch(st, ids(st)[1], T0).error, "not_host");
  assert.ok(D.rematch(st, st.hostId, T0).ok); assert.equal(st.phase, "lobby");
});

test("部屋: 通信が切れた人は待たない。戻っても、その問題は答えられない", () => {
  const st = playing({}, 3);
  const [a, b, c] = ids(st), t = st.g.startedAt;
  D.choose(st, a, { i: 0 }, t + 400); D.choose(st, b, { i: 1 }, t + 500);
  assert.equal(st.g.phase, "play");
  D.left(st, c, t + 900);
  assert.equal(st.g.phase, "between");
  D.returned(st, c, t + 1500);
  D.timeout(st, st.g.nextAt, seeded(9));
  assert.ok(D.choose(st, c, { i: 0 }, st.g.startedAt + 100).ok);
});

test("アラーム: ゲーム中に全員の通信が切れても、アラームが鳴り続けない", () => {
  const st = playing({ mode: "survival" }, 2);
  for (const id of ids(st)) { L.disconnect(st, id, T0 + 4000); D.left(st, id, T0 + 4000); }
  let now = T0 + 4000, fires = 0, alarm = L.safeAlarm(st, now, D.nextAlarm(st, now));
  while (fires < 1000) {
    now = Math.max(now, alarm); if (now > T0 + 3 * 3600e3) break; fires++;
    if (L.abandoned(st, now)) break;
    const r = D.timeout(st, now, seeded(fires));
    alarm = L.safeAlarm(st, now, D.nextAlarm(st, now));
    if (!r.ok && !L.abandoned(st, now) && alarm <= now) assert.fail("すぐに鳴り直す");
  }
  assert.ok(fires <= 3, "回数 " + fires);
});
