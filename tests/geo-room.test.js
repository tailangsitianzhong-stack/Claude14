// 地理クイズ・友達対戦の部屋ロジック
const test = require("node:test");
const assert = require("node:assert/strict");

let R, Core, Text;
test.before(async () => {
  R = await import("../worker/geo-room.mjs");
  Core = require("../js/games/geo/core.js");
  Text = require("../js/games/geo/text.js");
});

const T0 = 9_000_000;
function seeded(seed) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }
function lobby(n = 2) {
  const st = R.createRoom("12345", T0);
  for (let i = 0; i < n; i++) assert.ok(R.join(st, "p" + (i + 1) + "xxxxxxx", T0).ok);
  return st;
}
const ids = (st) => st.players.map((p) => p.id);
function playing(mode, n = 2, o = {}) {
  const st = lobby(n);
  assert.ok(R.setSettings(st, st.hostId, Object.assign({ mode, rounds: 5 }, o), T0).ok);
  assert.ok(R.start(st, st.hostId, T0, seeded(4)).ok);
  R.timeout(st, st.g.nextAt, seeded(2));         // 最初のラウンドを開始
  return st;
}
const now0 = (st) => st.g.startedAt;

test("部屋: 作成・設定(ホストだけ・値の検査)・開始条件(2〜4人)", () => {
  const st = lobby(3);
  assert.equal(st.game, "geo");
  assert.deepEqual(st.settings, { mode: "choice", difficulty: "normal", scope: "both", rounds: 10 });
  assert.equal(R.setSettings(st, ids(st)[1], { mode: "map" }, T0).error, "not_host");
  assert.ok(R.setSettings(st, st.hostId, { mode: "map", scope: "japan", difficulty: "hard", rounds: 5 }, T0).ok);
  assert.deepEqual(st.settings, { mode: "map", difficulty: "hard", scope: "japan", rounds: 5 });
  R.setSettings(st, st.hostId, { mode: "bogus", scope: "mars", difficulty: "x", rounds: 7 }, T0);
  assert.deepEqual(st.settings, { mode: "map", difficulty: "hard", scope: "japan", rounds: 5 });
  assert.equal(R.canStart(1), false); assert.equal(R.canStart(2), true); assert.equal(R.canStart(4), true); assert.equal(R.canStart(5), false);
  const one = lobby(1);
  assert.equal(R.start(one, one.hostId, T0).error, "need_players");
  assert.equal(R.start(st, ids(st)[1], T0).error, "not_host");
});

test("publicState: 正解(priv)・読み・他の人の答えの中身は、ラウンドが終わるまで送らない(3形式)", () => {
  for (const mode of ["choice", "map", "buzz"]) {
    const st = playing(mode, 3);
    const t = now0(st);
    const pub = JSON.stringify(R.publicState(st));
    assert.equal(pub.includes('"priv"'), false, mode);
    assert.equal(pub.includes('"yomi"'), false, mode);
    assert.equal(pub.includes('"usedIds"'), false, mode);
    if (mode === "map") assert.equal(pub.includes(`"target"`), false, "地図の正解を送らない");
    if (mode === "buzz") assert.equal(pub.includes(`"ans"`), false);
    assert.equal(R.publicState(st).g.q.id, st.g.q.id);
    if (mode === "choice") {
      R.choose(st, ids(st)[0], { i: 2 }, t + 1000);
      const v = R.publicState(st);
      assert.deepEqual(v.g.answers[ids(st)[0]], { done: true, at: t + 1000 });
      assert.equal(JSON.stringify(v).includes('"i":2'), false, "他の人の選択は見えない");
    }
  }
});

test("資料選択: 全員が選ぶと開示。開示後は正解と全員の選択が見える", () => {
  const st = playing("choice", 3); const t = now0(st);
  assert.equal(R.choose(st, ids(st)[0], { i: 9 }, t + 100).error, "bad_answer");
  const a = st.g.priv.a;
  R.choose(st, ids(st)[0], { i: a }, t + 1000);
  R.choose(st, ids(st)[1], { i: (a + 1) % 4 }, t + 2000);
  assert.equal(st.g.phase, "play");
  const r = R.choose(st, ids(st)[2], { i: a }, t + 3000);
  assert.ok(r.ok);
  assert.equal(r.events.at(-1).kind, "reveal");
  const v = R.publicState(st);
  assert.equal(v.g.reveal.a, a);
  assert.equal(v.g.reveal.picks[ids(st)[1]], (a + 1) % 4);
  assert.equal(JSON.stringify(v).includes('"priv"'), false);
});

test("地図: 決定は1回・正しい場所だけ。時間切れで一斉に開示", () => {
  const st = playing("map", 2, { scope: "world" }); const t = now0(st);
  assert.equal(R.lock(st, ids(st)[0], { id: "XXX" }, t + 100).error, "bad_answer");
  assert.ok(R.lock(st, ids(st)[0], { id: st.g.priv.target }, t + 500).ok);
  assert.equal(R.lock(st, ids(st)[0], { id: "FRA" }, t + 600).error, "already");
  assert.equal(R.timeout(st, t + 1000).ok, false);
  const r = R.timeout(st, st.g.endsAt + 1);
  assert.ok(r.ok);
  assert.equal(r.events[0].kind, "reveal");
  assert.equal(R.publicState(st).g.reveal.target, st.g.priv.target);
  assert.equal(R.nextAlarm(st, T0), st.g.nextAt);
});

test("早押し: 押した人だけ答える。読みが合えば正解。合わなければ judge を返し、AI の結果で正解/まちがい", () => {
  const st = playing("buzz", 2); const t = now0(st);
  const [a, b] = ids(st);
  assert.ok(R.press(st, a, t + 3000).ok);
  assert.equal(R.press(st, b, t + 3100).error, "taken");
  assert.equal(R.answer(st, b, { text: "あ" }, t + 3200).error, "not_your_turn");
  assert.equal(R.answer(st, a, { text: 5 }, t + 3200).error, "bad_message");
  const r = R.answer(st, a, { text: "べつのなまえ" }, t + 4000);
  assert.ok(r.ok);
  assert.equal(r.judge.pid, a);
  assert.equal(r.judge.answer, st.g.priv.ans);
  assert.deepEqual(r.judge.yomi, st.g.priv.yomi);
  assert.equal(r.events[0].kind, "judging");
  assert.equal(R.publicState(st).g.buzz.judging.text, "べつのなまえ");       // 確認中の入力は見える(他の人にも)
  assert.equal(JSON.stringify(R.publicState(st)).includes('"yomi"'), false);
  const w = R.judged(st, a, false, t + 5000);
  assert.equal(w.events[0].kind, "wrong");
  assert.equal(st.g.buzz.by, null);
  assert.deepEqual(st.g.buzz.lockedOut, [a]);
  assert.equal(R.press(st, a, t + 5100).error, "locked_out");
  assert.equal(R.judged(st, a, true, t + 5200).error, "not_judging");
  // b が押して、辞書どおりの読みで正解
  assert.ok(R.press(st, b, t + 6000).ok);
  const c = R.answer(st, b, { text: st.g.priv.yomi[0] }, t + 7000);
  assert.equal(c.judge, undefined);
  assert.equal(c.events[0].kind, "correct");
  assert.equal(R.publicState(st).g.reveal.ans, st.g.priv.ans);
});

test("早押し: 誰も押さずに文が終わると開示。AI 判定が来ない時は、アラームでまちがい扱い", () => {
  const st = playing("buzz", 2); const t = now0(st);
  assert.equal(R.nextAlarm(st, T0), t + Text.totalMs(st.g.q.at) + Text.GRACE_MS + 1);
  R.press(st, ids(st)[0], t + 2000);
  R.answer(st, ids(st)[0], { text: "ふめい" }, t + 3000);
  assert.equal(R.nextAlarm(st, T0), t + 3000 + Core.AI_WAIT_MS + 1);
  const r = R.timeout(st, t + 3000 + Core.AI_WAIT_MS + 5);
  assert.equal(r.events[0].kind, "wrong");
  const st2 = playing("buzz", 2); const t2 = now0(st2);
  const r2 = R.timeout(st2, t2 + Text.totalMs(st2.g.q.at) + Text.GRACE_MS + 10);
  assert.equal(r2.events[0].kind, "reveal");
});

test("ゲーム終了: 順位が入り、部屋も終了。再戦でロビーへ(ホストだけ)", () => {
  const st = playing("choice", 2);
  st.settings.rounds = 5;
  let guard = 0, now = st.g.startedAt;
  while (st.phase === "playing" && guard++ < 30) {
    if (st.g.phase === "play") { now = st.g.endsAt + 1; R.timeout(st, now); }
    else { now = st.g.nextAt; R.timeout(st, now); }
  }
  assert.equal(st.phase, "over");
  assert.equal(st.ranking.length, 2);
  assert.equal(R.choose(st, ids(st)[0], { i: 0 }, now + 1).error, "bad_phase");
  assert.equal(R.rematch(st, ids(st).find((i) => i !== st.hostId), now).error, "not_host");
  assert.ok(R.rematch(st, st.hostId, now).ok);
  assert.equal(st.phase, "lobby");
  assert.equal(R.publicState(st).g, null);
});

test("入室: ゲーム中の途中参加は断るが、再接続はできる。席の順(slot)で並ぶ", () => {
  const st = playing("choice", 3);
  assert.equal(R.join(st, "newcomerxx", T0 + 1).error, "started");
  const id = ids(st)[1];
  R.disconnect(st, id, T0 + 2);
  assert.ok(R.join(st, id, T0 + 3).ok);
  assert.deepEqual(st.players.map((p) => p.slot), [0, 1, 2]);
});
