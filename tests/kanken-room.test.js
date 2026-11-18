const test = require("node:test");
const assert = require("node:assert/strict");

let K, Q;
test.before(async () => {
  K = await import("../worker/kanken-room.mjs");
  Q = require("../js/games/kanken/question.js");
});

const T0 = 1_000_000;
function seeded(seed) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }

function lobby(n = 2, settings) {
  const st = K.createRoom("12345", T0);
  for (let i = 0; i < n; i++) K.join(st, "p" + (i + 1), T0);
  if (settings) K.setSettings(st, "p1", settings, T0);
  return st;
}
/** p1 先攻で開始 */
function playing(n = 2, settings, seed = 1) {
  const st = lobby(n, settings);
  const rng = seeded(seed);
  const r = K.start(st, "p1", T0, () => 0);
  assert.ok(r.ok);
  return { st, rng };
}
/** いま出ている問題に正解/不正解で答える */
function reply(st, id, ok, now, rng) {
  const q = st.q;
  const resp = q.type === "read" ? { reading: ok ? q.answer : "ぬぬぬ" } : { choice: ok ? q.answerIndex : (q.answerIndex + 1) % 4 };
  return K.answer(st, id, resp, now, rng);
}

test("設定: ホストだけ・ロビーだけ。モードとレベルは範囲内のみ", () => {
  const st = lobby(2);
  assert.equal(K.setSettings(st, "p2", { mode: "survival" }, T0).error, "not_host");
  assert.ok(K.setSettings(st, "p1", { mode: "survival", level: 4 }, T0).ok);
  assert.deepEqual(st.settings, { mode: "survival", level: 4 });
  K.setSettings(st, "p1", { mode: "hack", level: 9 }, T0);
  assert.deepEqual(st.settings, { mode: "survival", level: 4 });          // 不正な値は無視
  K.setSettings(st, "p1", { level: 2.5 }, T0);
  assert.equal(st.settings.level, 4);
});

test("開始: 2人以上・ホストのみ。ライフはモード別。最初の問題が出て先攻の番", () => {
  const st = lobby(1);
  assert.equal(K.start(st, "p1", T0).error, "need_players");
  K.join(st, "p2", T0);
  assert.equal(K.start(st, "p2", T0).error, "not_host");
  K.setSettings(st, "p1", { mode: "exam", level: 2 }, T0);
  const r = K.start(st, "p1", T0, () => 0);
  assert.ok(r.ok);
  assert.deepEqual([st.phase, st.turnId, st.asked, st.q.level <= 2], ["playing", "p1", 1, true]);
  assert.ok(st.players.every((p) => p.lives === 5));
  assert.equal(st.turnEndsAt, T0 + st.seconds * 1000 + K.GRACE_MS);
  const sv = lobby(2, { mode: "survival" });
  K.start(sv, "p1", T0, () => 0);
  assert.ok(sv.players.every((p) => p.lives === 3));
});

test("順番に1問ずつ。答えられるのは順番の人だけ。形式で制限時間が変わる", () => {
  const { st, rng } = playing(3, { level: 2 });
  assert.equal(reply(st, "p2", true, T0 + 1000, rng).error, "not_your_turn");
  const q1 = st.q;
  assert.equal(st.seconds, q1.type === "read" ? 30 : 12);
  assert.ok(reply(st, "p1", true, T0 + 2000, rng).ok);
  assert.equal(st.turnId, "p2");                                           // 次の人へ
  assert.notEqual(st.q.id, q1.id);                                         // 新しい問題
  assert.equal(st.asked, 2);
  reply(st, "p2", true, T0 + 3000, rng);
  assert.equal(st.turnId, "p3");
  reply(st, "p3", false, T0 + 4000, rng);
  assert.equal(st.turnId, "p1");                                           // 3人で一巡
});

test("採点: 正解で加点(レベル×形式×はやさ×連続)・不正解でライフ-1と連続リセット", () => {
  const { st, rng } = playing(2, { level: 3 }, 2);
  const q = st.q;
  const r = reply(st, "p1", true, T0 + 1000, rng);
  const expect = Q.pointsFor({ level: q.level, type: q.type, elapsed: 1, limit: q.type === "read" ? 30 : 12, streak: 1 });
  assert.equal(st.players[0].score, expect);
  assert.equal(r.events.find((e) => e.kind === "answered").points, expect);
  assert.equal(st.players[0].words, 1);
  reply(st, "p2", false, T0 + 2000, rng);
  assert.deepEqual([st.players[1].lives, st.players[1].streak, st.players[1].wrong, st.players[1].score], [4, 0, 1, 0]);
  // 連続正解で点が増える
  reply(st, "p1", true, T0 + 3000, rng);
  assert.ok(st.players[0].streak === 2);
});

test("不正な答え: 形式違い・範囲外は受け付けず、状態は変わらない", () => {
  const { st, rng } = playing(2);
  const before = JSON.stringify(st);
  assert.equal(K.answer(st, "p1", null, T0, rng).error, "bad_message");
  if (st.q.type === "read") {
    assert.equal(K.answer(st, "p1", { choice: 1 }, T0, rng).error, "bad_message");
    assert.equal(K.answer(st, "p1", { reading: "あ".repeat(50) }, T0, rng).error, "bad_message");
  } else {
    assert.equal(K.answer(st, "p1", { reading: "あ" }, T0, rng).error, "bad_message");
    assert.equal(K.answer(st, "p1", { choice: 4 }, T0, rng).error, "bad_message");
    assert.equal(K.answer(st, "p1", { choice: "1" }, T0, rng).error, "bad_message");
  }
  assert.equal(JSON.stringify(st), before);
});

test("ミニ検定: 時間切れもライフ-1。ライフ0で脱落し、順番は脱落した人を飛ばす", () => {
  const { st, rng } = playing(3, { mode: "exam" });
  // p1 は毎回間違える。5回目で脱落。p2・p3 は正解し続ける
  let now = T0;
  for (let round = 0; round < 5; round++) {
    now += 1000; reply(st, "p1", false, now, rng);
    now += 1000; reply(st, "p2", true, now, rng);
    now += 1000; reply(st, "p3", true, now, rng);
  }
  assert.equal(st.players[0].alive, false);
  assert.equal(st.players[0].lives, 0);
  assert.equal(st.phase, "playing");
  assert.equal(st.turnId, "p2");                                           // p1 を飛ばして p2 から
  const r = K.timeout(st, st.turnEndsAt, rng);
  assert.ok(r.ok);
  assert.equal(st.players[1].lives, 4);                                    // 時間切れ=ライフ-1
  assert.equal(st.turnId, "p3");
  assert.equal(K.timeout(st, T0, rng).ok, false);                          // 早すぎるアラームは無視
});

test("サバイバル: 時間切れは1回で即脱落。間違いはライフ-1", () => {
  const { st, rng } = playing(3, { mode: "survival" });
  reply(st, "p1", false, T0 + 1000, rng);
  assert.deepEqual([st.players[0].lives, st.players[0].alive], [2, true]);
  reply(st, "p2", true, T0 + 2000, rng);
  const t = K.timeout(st, st.turnEndsAt, rng);                             // p3 が時間切れ
  assert.ok(t.ok);
  assert.deepEqual([st.players[2].lives, st.players[2].alive], [0, false]);
  assert.ok(t.events.some((e) => e.kind === "out" && e.playerId === "p3"));
  assert.equal(st.phase, "playing");                                       // p1,p2 が残っているので続く
});

test("終了: 60問 / 全員脱落 / 1人だけ残って最高得点。勝者はポイントで決まる", () => {
  // 60問: 全員ずっと正解し続け、60問目の答えで終了
  const a = playing(2, { mode: "exam", level: 1 }, 3);
  let now = T0, n = 0;
  while (a.st.phase === "playing" && n < 100) { now += 1000; n++; reply(a.st, a.st.turnId, true, now, a.rng); }
  assert.equal(n, 60);
  assert.equal(a.st.overReason, "done");
  assert.equal(a.st.asked, 60);
  assert.deepEqual(a.st.ranking.length, 2);
  const [w, l] = a.st.ranking.map((id) => a.st.players.find((p) => p.id === id));
  assert.ok(w.score >= l.score);

  // 1人だけ残り、その人が最高得点なら終了(サバイバル)
  const b = playing(2, { mode: "survival", level: 1 }, 4);
  reply(b.st, "p1", true, T0 + 1000, b.rng);                               // p1: 得点あり
  let t = T0 + 2000;
  K.timeout(b.st, b.st.turnEndsAt, b.rng);                                 // p2 時間切れ → 脱落
  assert.equal(b.st.phase, "over");
  assert.equal(b.st.overReason, "last_one");
  assert.equal(b.st.ranking[0], "p1");

  // 残った1人が得点で負けているなら、まだ続く(追いつくチャンス)
  const c = playing(2, { mode: "survival", level: 1 }, 5);
  reply(c.st, "p1", false, T0 + 500, c.rng);                               // p1 ミス(0点)
  reply(c.st, "p2", true, T0 + 1000, c.rng);                               // p2 得点
  K.timeout(c.st, c.st.turnEndsAt, c.rng);                                 // p1 時間切れ → 脱落(0点)
  assert.equal(c.st.players[0].alive, false);
  assert.equal(c.st.phase, "over");                                        // p2 が最高得点なので終了
  assert.equal(c.st.ranking[0], "p2");

  const d = playing(2, { mode: "survival", level: 1 }, 6);
  reply(d.st, "p1", true, T0 + 500, d.rng);                                // p1 得点
  reply(d.st, "p2", false, T0 + 800, d.rng);
  reply(d.st, "p1", true, T0 + 900, d.rng);
  K.timeout(d.st, d.st.turnEndsAt, d.rng);                                 // p2 時間切れで脱落
  assert.equal(d.st.overReason, "last_one");

  // 全員脱落
  const e = playing(2, { mode: "survival" }, 7);
  K.timeout(e.st, e.st.turnEndsAt, e.rng);
  assert.equal(e.st.players[0].alive, false);
  if (e.st.phase === "playing") K.timeout(e.st, e.st.turnEndsAt, e.rng);
  assert.equal(e.st.phase, "over");
  assert.ok(["all_out", "last_one"].includes(e.st.overReason));
});

test("同点の順位: ポイント → 正解数 → 生き残り", () => {
  const { st, rng } = playing(2, { mode: "survival" }, 8);
  st.players[0].score = 100; st.players[1].score = 100;
  st.players[0].words = 3; st.players[1].words = 5;
  K.timeout(st, st.turnEndsAt, rng);                                       // p1 脱落
  K.timeout(st, st.turnEndsAt, rng);                                       // p2 脱落(全員脱落で終了)
  assert.equal(st.phase, "over");
  assert.equal(st.ranking[0], "p2");                                       // 同点なら正解数が多い人
});

test("公開する状態: 答え・出題済みリストは含まれない。元の状態は壊さない", () => {
  const { st } = playing(2, { level: 4 }, 9);
  const raw = JSON.stringify(st);
  const pub = K.publicState(st);
  assert.equal(JSON.stringify(st), raw);
  const text = JSON.stringify(pub);
  assert.ok(!("usedIds" in pub));
  assert.ok(!("answer" in pub.q) && !("answerIndex" in pub.q) && !("full" in pub.q));
  if (st.q.type === "write") {
    assert.equal(pub.q.choices.length, 4);
    assert.ok(pub.q.reading);
  } else {
    assert.equal(Object.keys(pub.q).sort().join(), "id,level,text,type");
    assert.ok(!text.includes(`"${st.q.answer}"`) || st.q.answer === st.q.text);
  }
  // 結果(last)には、直前の問題の正解が含まれる(みんなで見て覚えるため)
  const rng = seeded(1);
  reply(st, "p1", false, T0 + 1000, rng);
  const pub2 = K.publicState(st);
  assert.equal(pub2.last.correct, false);
  assert.ok(pub2.last.answer && pub2.last.word);
});

test("もう一度: ホストだけ・終了後のみ。得点とライフを戻してロビーへ", () => {
  const { st, rng } = playing(2, { mode: "survival" }, 10);
  K.timeout(st, st.turnEndsAt, rng); if (st.phase === "playing") K.timeout(st, st.turnEndsAt, rng);
  assert.equal(st.phase, "over");
  assert.equal(K.rematch(st, "p2", T0).error, "not_host");
  assert.ok(K.rematch(st, "p1", T0).ok);
  assert.equal(st.phase, "lobby");
  assert.ok(st.players.every((p) => p.score === 0 && p.alive));
  assert.deepEqual([st.asked, st.q, st.last], [0, null, null]);
  assert.equal(K.rematch(st, "p1", T0).error, "bad_phase");
});

test("切断: ゲーム中も席は残る。切断した人の番は時間切れで進む", () => {
  const { st, rng } = playing(2, { mode: "exam" }, 11);
  K.disconnect(st, "p1", T0);
  assert.equal(st.players.length, 2);
  assert.equal(st.turnId, "p1");
  K.timeout(st, st.turnEndsAt, rng);
  assert.equal(st.turnId, "p2");
  K.join(st, "p1", T0 + 1000);
  assert.equal(st.players[0].connected, true);
});
