// 英単語トランスミッション・友達対戦(協力)の部屋ロジック
const test = require("node:test");
const assert = require("node:assert/strict");

let R, L;
test.before(async () => { R = await import("../worker/ladder-room.mjs"); L = await import("../worker/room-logic.mjs"); });

const T0 = 9_500_000;
const seeded = (seed) => { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); };
function lobby(n = 2) {
  const st = R.createRoom("12345", T0);
  for (let i = 0; i < n; i++) assert.ok(R.join(st, "p" + (i + 1) + "xxxxxxx", T0).ok);
  return st;
}
const ids = (st) => st.players.map((p) => p.id);
function playing(level = 1, n = 2) {
  const st = lobby(n);
  assert.ok(R.setSettings(st, st.hostId, { level }, T0).ok);
  assert.ok(R.start(st, st.hostId, T0, seeded(4)).ok);
  return st;
}

test("部屋: 作成・設定(難しさ)・開始条件", () => {
  const st = lobby(3);
  assert.equal(st.game, "ladder"); assert.deepEqual(st.settings, { level: 1 });
  assert.equal(R.setSettings(st, ids(st)[1], { level: 2 }, T0).error, "not_host");
  R.setSettings(st, st.hostId, { level: 3 }, T0); assert.equal(st.settings.level, 3);
  R.setSettings(st, st.hostId, { level: 9 }, T0); assert.equal(st.settings.level, 3);        // 不正な値は無視
  assert.equal(R.start(lobby(1), "p1xxxxxxx", T0).error, "need_players");
  const g = playing(2).g;
  assert.equal(g.len, 4); assert.equal(g.chain.length, 1); assert.equal(g.turnSec, 50); assert.equal(g.lives, 3);
});

test("部屋: 順番に1語ずつつなぐ。手番でない人・規則に合わない語は断る。ゴールでクリアして部屋も終了", () => {
  const st = playing(1);
  const g = () => st.g, [a, b] = ids(st);
  const Dict = require("../js/games/ladder/dict.js").create(globalThis.LADDER_DATA);
  const way = Dict.path(g().start, g().goal);
  assert.equal(R.propose(st, b, { word: way[1] }, T0 + 1).error, "not_your_turn");
  assert.equal(R.propose(st, a, { word: g().start }, T0 + 1).error, "same");
  assert.equal(R.propose(st, a, { word: "x".repeat(9) }, T0 + 1).error, "bad_message");
  const order = [a, b];
  for (let i = 1; i < way.length; i++) {
    const who = order[(i - 1) % 2];
    const r = R.propose(st, who, { word: way[i] }, T0 + 1000 * i);
    assert.ok(r.ok, way[i]); assert.ok(r.events.some((e) => e.kind === "word"));
  }
  assert.equal(st.phase, "over"); assert.ok(st.g.result.win); assert.equal(st.ranking.length, 2);
  assert.deepEqual(R.publicState(st).g.result.chain, way);
  assert.equal(R.rematch(st, b, T0).error, "not_host"); assert.ok(R.rematch(st, st.hostId, T0).ok); assert.equal(st.phase, "lobby");
});

test("部屋: 辞書にない語はAIに確認する(確認中は時間が止まる)。不可ならギアが減る。確認できなければギアは減らない", () => {
  const st = playing(2);
  const [a, b] = ids(st), cur = st.g.chain[0];
  assert.equal(a, ids(st)[0]);
  const unknown = "q" + cur.slice(1);                          // 辞書にまずない語(先頭を q に)
  const r = R.propose(st, a, { word: unknown }, T0 + 1000);
  assert.ok(r.ok && r.judge); assert.deepEqual(r.judge, { word: unknown, pid: a });
  assert.equal(R.propose(st, b, { word: cur.slice(1) + "x" }, T0 + 1100).error, "judging");
  const bad = R.judged(st, false, null, T0 + 3000);
  assert.ok(bad.ok); assert.equal(st.g.lives, 2); assert.equal(st.g.turn, 1);
  const r2 = R.propose(st, b, { word: "z" + cur.slice(1) }, T0 + 4000);
  const none = R.judged(st, null, null, T0 + 5000);
  assert.ok(none.events.some((e) => e.kind === "ai_unavailable")); assert.equal(st.g.lives, 2); assert.equal(st.g.turn, 1);
  assert.ok(r2.judge);
  assert.equal(R.judged(st, true, { pos: "名詞", ja: "x" }, T0 + 6000).error, "not_judging");           // 確認中でなければ無視
});

test("部屋: ヒント・1手戻す・時間切れ。ギアが0で失敗して部屋も終了", () => {
  const st = playing(1);
  const [a, b] = ids(st);
  const h = R.hint(st, a, T0 + 100); assert.ok(h.ok); assert.equal(h.events[0].kind, "hint"); assert.equal(st.g.hints, 2);
  R.timeout(st, T0 + 61000);                                          // a の時間切れ
  assert.equal(st.g.lives, 2); assert.equal(st.g.turn, 1);
  assert.equal(R.undo(st, b, T0 + 62000).error, "nothing");
  R.timeout(st, T0 + 61000 + 61000); R.timeout(st, T0 + 61000 + 61000 + 61000);
  assert.equal(st.phase, "over"); assert.equal(st.g.result.win, false); assert.equal(st.g.result.why, "gear");
});

test("部屋: 通信が切れた人の手番は飛ばす。全員切れたらアラームは先送り(鳴り続けない)", () => {
  const st = playing(1, 3);
  const [a, b, c] = ids(st);
  R.left(st, a, T0 + 1000);
  assert.equal(st.g.turn, 1);
  R.returned(st, a, T0 + 2000);
  for (const id of ids(st)) { L.disconnect(st, id, T0 + 4000); R.left(st, id, T0 + 4000); }
  let now = T0 + 4000, fires = 0, alarm = L.safeAlarm(st, now, R.nextAlarm(st, now));
  while (fires < 1000) {
    now = Math.max(now, alarm); if (now > T0 + 3 * 3600e3) break; fires++;
    if (L.abandoned(st, now)) break;
    R.timeout(st, now); alarm = L.safeAlarm(st, now, R.nextAlarm(st, now));
  }
  assert.ok(fires <= 3, "回数 " + fires);
  assert.ok(b && c);
});
