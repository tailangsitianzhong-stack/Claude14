const test = require("node:test");
const assert = require("node:assert/strict");

let L;
test.before(async () => { L = await import("../worker/room-logic.mjs"); });

const T0 = 1_000_000;
const seq = (n) => { let i = 0; return () => (i++ % n) / n; };   // 先頭から順に選ぶ乱数
function lobby(n = 2) {
  const st = L.createRoom("12345", T0);
  for (let i = 0; i < n; i++) L.join(st, "p" + (i + 1), T0);
  return st;
}
function playing(n = 2, settings) {
  const st = lobby(n);
  if (settings) L.setSettings(st, "p1", settings, T0);
  const r = L.start(st, "p1", T0, () => 0);           // 先攻は p1
  assert.ok(r.ok);
  return st;
}

test("入室: 最大4人・アバターは席ごと・最初の人がホスト・5人目は満員", () => {
  const st = lobby(4);
  assert.deepEqual(st.players.map((p) => p.avatar), ["🐶", "🐱", "🐰", "🐻"]);
  assert.equal(st.hostId, "p1");
  assert.equal(L.join(st, "p5", T0).error, "full");
  assert.equal(L.join(st, "p2", T0).ok, true);        // 再接続はOK
  assert.equal(st.players.length, 4);
});

test("ロビーを出ると席が空き、ホストは次の人へ。ゲーム中の参加はできない", () => {
  const st = lobby(3);
  const r = L.disconnect(st, "p1", T0);
  assert.equal(st.players.length, 2);
  assert.equal(st.hostId, "p2");
  assert.ok(r.events.some((e) => e.kind === "host"));
  L.join(st, "p9", T0);                                // 空いた席に入れる
  assert.equal(st.players.find((p) => p.id === "p9").slot, 0);

  const g = playing(2);
  assert.equal(L.join(g, "late", T0).error, "started");
});

test("開始: ホストだけ・2人以上・設定どおりのライフと時間", () => {
  const st = lobby(1);
  assert.equal(L.start(st, "p1", T0).error, "need_players");
  L.join(st, "p2", T0);
  assert.equal(L.start(st, "p2", T0).error, "not_host");
  assert.equal(L.setSettings(st, "p2", { difficulty: "hard" }, T0).error, "not_host");
  L.setSettings(st, "p1", { difficulty: "hard", ignoreDakuten: true }, T0);
  assert.ok(L.start(st, "p1", T0, () => 0).ok);
  assert.deepEqual([st.phase, st.required, st.seconds, st.turnId], ["playing", "り", 20, "p1"]);
  assert.ok(st.players.every((p) => p.lives === 3));
  assert.equal(st.turnEndsAt, T0 + 20_000 + L.GRACE_MS);
  assert.equal(L.setSettings(st, "p1", { difficulty: "easy" }, T0).error, "bad_phase");
});

test("正しい手: 得点・使用済み・次の人へ・つなぎ文字が更新される", () => {
  const st = playing(2);
  const r = L.move(st, "p1", { reading: "りんご", english: "apple" }, T0 + 5000);
  assert.ok(r.ok);
  assert.equal(st.turnId, "p2");
  assert.equal(st.required, "ご");
  assert.deepEqual(st.used, ["apple"]);
  assert.ok(st.players[0].score > 0);
  assert.equal(st.history.length, 1);
  assert.equal(st.turnEndsAt, T0 + 5000 + 30_000 + L.GRACE_MS);   // 次の人の時間はリセット
  assert.deepEqual(r.events.map((e) => e.kind), ["moved", "turn"]);
});

test("手の不正: 順番違い・つながっていない・重複・形式", () => {
  const st = playing(2);
  assert.equal(L.move(st, "p2", { reading: "りんご", english: "apple" }, T0).error, "not_your_turn");
  assert.equal(L.move(st, "p1", { reading: "ねこ", english: "cat" }, T0).reason, "not_connected");
  assert.equal(L.move(st, "p1", { reading: "りんご", english: "ap ple" }, T0).reason, "invalid_english");
  assert.equal(L.move(st, "p1", null, T0).error, "bad_message");
  L.move(st, "p1", { reading: "りんご", english: "apple" }, T0);
  L.move(st, "p2", { reading: "ごりら", english: "gorilla" }, T0);
  assert.equal(L.move(st, "p1", { reading: "らいおん", english: "gorilla" }, T0).reason, "duplicate");
  // 失敗した手では何も変わらない
  assert.equal(st.turnId, "p1");
  assert.equal(st.used.length, 2);
});

test("間違い報告: ライフ-1・次の人へ・正解の綴りだけを通す", () => {
  const st = playing(3);
  const r = L.miss(st, "p1", { reason: "spelling", correct: "apple" }, T0 + 1000);
  assert.ok(r.ok);
  assert.equal(st.players[0].lives, 2);
  assert.equal(st.turnId, "p2");
  assert.equal(st.required, "り");                      // つなぎ文字は変わらない
  const ev = r.events.find((e) => e.kind === "miss");
  assert.equal(ev.correct, "apple");
  const r2 = L.miss(st, "p2", { reason: "x", correct: "<script>" }, T0 + 2000);
  assert.equal(r2.events.find((e) => e.kind === "miss").correct, null);
  assert.equal(L.miss(st, "p1", {}, T0).error, "not_your_turn");
});

test("時間切れ: 制限時間(おまけ込み)を過ぎたらライフ-1。早すぎるアラームは無視", () => {
  const st = playing(2);
  assert.equal(L.timeout(st, T0 + 1000).ok, false);
  const r = L.timeout(st, st.turnEndsAt);
  assert.ok(r.ok);
  assert.equal(st.players[0].lives, 2);
  assert.equal(st.turnId, "p2");
  assert.equal(r.events.find((e) => e.kind === "miss").reason, "timeout");
});

test("ライフ0で脱落、残り1人でゲーム終了。順位は生き残り→あとに脱落→得点", () => {
  const st = playing(3);
  L.move(st, "p1", { reading: "りんご", english: "apple" }, T0 + 1000);
  // p1 は つながる語で続け、p2 と p3 は毎回ミスして脱落していく
  const chain = [["ごりら", "gorilla"], ["らくだ", "camel"], ["だちょう", "ostrich"], ["うま", "horse"], ["まくら", "pillow"], ["らっぱ", "trumpet"]];
  let now = T0 + 2000, k = 0;
  for (let i = 0; i < 40 && st.phase === "playing"; i++, now += 1000) {
    const id = st.turnId;
    if (id === "p1") {
      const [r, e] = chain[k++];
      assert.ok(L.move(st, "p1", { reading: r, english: e }, now).ok, `${r}=${e}`);
    } else {
      L.miss(st, id, { reason: "wrong" }, now);
    }
  }
  assert.equal(st.phase, "over");
  assert.equal(st.overReason, "last_one");
  assert.equal(st.ranking[0], "p1");
  assert.deepEqual(new Set(st.ranking), new Set(["p1", "p2", "p3"]));
  // あとに脱落した人のほうが上位
  const out = (id) => st.players.find((p) => p.id === id).out;
  const later = out("p2") > out("p3") ? "p2" : "p3";
  const earlier = later === "p2" ? "p3" : "p2";
  assert.ok(st.ranking.indexOf(later) < st.ranking.indexOf(earlier));
});

test("「ん」で終わったらその人は脱落", () => {
  const st = playing(3);
  const r = L.move(st, "p1", { reading: "りかん", english: "bank" }, T0);   // 読みの語尾が「ん」
  assert.ok(r.ok);
  assert.equal(st.players[0].alive, false);
  assert.ok(r.events.some((e) => e.kind === "n_out"));
  assert.equal(st.phase, "playing");                    // 3人なので続く
  assert.equal(st.turnId, "p2");
  assert.equal(st.required, "り");                      // 「ん」にはならず、脱落した人と同じ文字から
  assert.ok(st.used.includes("bank"));                  // 脱落した語は使用済みのまま
  // 続けて、次の人が「り」から普通に答えられる
  assert.ok(L.move(st, "p2", { reading: "りんご", english: "apple" }, T0).ok);
  assert.equal(st.required, "ご");
  // 2人対戦なら、相手が残って終了
  const g = playing(2);
  L.move(g, "p1", { reading: "りかん", english: "bank" }, T0);
  assert.equal(g.phase, "over");
  assert.equal(g.ranking[0], "p2");
});

test("脱落した人は順番に回ってこない(4人)", () => {
  const st = playing(4);
  L.timeout(st, st.turnEndsAt);                         // p1 ミス(ライフ2)→p2
  for (let i = 0; i < 3; i++) L.miss(st, st.turnId, {}, T0);   // p2,p3,p4 ミス → p1
  L.miss(st, "p1", {}, T0); L.miss(st, "p2", {}, T0); L.miss(st, "p3", {}, T0); L.miss(st, "p4", {}, T0);
  L.miss(st, "p1", {}, T0);                             // p1 ライフ0で脱落
  assert.equal(st.players[0].alive, false);
  assert.notEqual(st.turnId, "p1");
});

test("ヒント: 得点-5(0未満にならない)。自分の番だけ", () => {
  const st = playing(2);
  assert.equal(L.hint(st, "p2", T0).ok, false);
  L.hint(st, "p1", T0);
  assert.equal(st.players[0].score, 0);
  L.move(st, "p1", { reading: "りんご", english: "apple" }, T0);
  const s = st.players[0].score;
  L.timeout(st, st.turnEndsAt);                         // p2 ミス → p1 の番
  L.hint(st, "p1", T0);
  assert.equal(st.players[0].score, s - L.HINT_COST);
});

test("ゲーム中に切断しても席は残り、再接続できる", () => {
  const st = playing(2);
  L.disconnect(st, "p2", T0);
  assert.equal(st.players.length, 2);
  assert.equal(st.players[1].connected, false);
  L.join(st, "p2", T0 + 1000);
  assert.equal(st.players[1].connected, true);
});

test("もう一度: ホストだけ・終了後のみ・つながっている人でロビーへ", () => {
  const st = playing(2);
  L.move(st, "p1", { reading: "りかん", english: "bank" }, T0);   // p1 脱落で終了
  assert.equal(st.phase, "over");
  assert.equal(L.rematch(st, "p2", T0).error, "not_host");
  L.disconnect(st, "p2", T0);
  assert.ok(L.rematch(st, "p1", T0).ok);
  assert.equal(st.phase, "lobby");
  assert.equal(st.players.length, 1);
  assert.deepEqual([st.used.length, st.history.length], [0, 0]);
});

test("アラームの時刻と片づけ", () => {
  const st = playing(2);
  assert.equal(L.nextAlarm(st, T0), st.turnEndsAt);
  assert.equal(L.expired(st, T0 + 999999999), false);   // ゲーム中は片づけない
  const lb = lobby(1);
  L.disconnect(lb, "p1", T0);
  assert.equal(L.expired(lb, T0 + 9 * 60 * 1000), false);
  assert.equal(L.expired(lb, T0 + 10 * 60 * 1000), true);
});

test("「ん」で脱落した直後でも、ゲームが続けば次の人は答えられる(「ん」から始まる状態にならない)", () => {
  const st = playing(3);
  L.move(st, "p1", { reading: "りんご", english: "apple" }, T0);          // 要求: ご
  const r = L.move(st, "p2", { reading: "ごはん", english: "rice" }, T0);  // p2 が「ん」で脱落
  assert.ok(r.events.some((e) => e.kind === "n_out"));
  assert.equal(st.required, "ご");                                         // p2 が答えるはずだった「ご」に戻る
  assert.equal(st.turnId, "p3");
  assert.ok(L.move(st, "p3", { reading: "ごりら", english: "gorilla" }, T0).ok);
});
