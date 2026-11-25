// 友達対戦: 通信が切れた人は待たない。戻ってもその問題の解答権はない(全ゲーム共通の方針)
const test = require("node:test");
const assert = require("node:assert/strict");

let L, K, N, G, T;
test.before(async () => {
  L = await import("../worker/room-logic.mjs");
  K = await import("../worker/kanken-room.mjs");
  N = await import("../worker/nep-room.mjs");
  G = await import("../worker/geo-room.mjs");
  const Words = require("../js/games/nep/words.js"), Topics = require("../js/games/nep/topics.js");
  T = Topics.create(Words.create(globalThis.NEP_DATA), globalThis.NEP_DATA);
});

const T0 = 7_000_000;
const seeded = (seed) => { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); };

/* ---------- しりとり ---------- */
function shiri(n) {
  const st = L.createRoom("12345", T0);
  for (let i = 0; i < n; i++) L.join(st, "p" + (i + 1), T0);
  assert.ok(L.start(st, "p1", T0, () => 0).ok);
  return st;
}

test("しりとり: 番の人が抜けたら、待たずに次の人へ(ライフは減らない)。抜けた人の番は飛ばす", () => {
  const st = shiri(3);
  assert.equal(st.turnId, "p1");
  L.disconnect(st, "p1", T0 + 100);
  const r = L.left(st, "p1", T0 + 100);
  assert.ok(r.ok); assert.equal(st.turnId, "p2");
  assert.equal(st.players[0].lives, st.players[1].lives);                 // p1 のライフはそのまま
  assert.ok(r.events.some((e) => e.kind === "skipped"));
  // 番でない人が抜けても何も変わらない
  L.disconnect(st, "p3", T0 + 200);
  assert.equal(L.left(st, "p3", T0 + 200).ok, false);
  assert.equal(st.turnId, "p2");
  // p2 が答えると、抜けている p3・p1 は飛ばして p2 に戻る
  const mv = L.move(st, "p2", { reading: "りんご", english: "apple" }, T0 + 300);
  assert.ok(mv.ok, JSON.stringify(mv));
  assert.equal(st.turnId, "p2");
});

test("しりとり: 全員が抜けたら番と時計を止め、だれかが戻ったらその人から再開。長く戻らなければ片づける", () => {
  const st = shiri(2);
  L.disconnect(st, "p1", T0 + 10); L.left(st, "p1", T0 + 10);
  assert.equal(st.turnId, "p2");
  L.disconnect(st, "p2", T0 + 20);
  const r = L.left(st, "p2", T0 + 20);
  assert.ok(r.events.some((e) => e.kind === "waiting"));
  assert.equal(st.turnId, null); assert.equal(st.turnEndsAt, null);
  assert.equal(L.timeout(st, T0 + 999999).ok, false);                     // 時間切れで減点されない
  assert.equal(L.abandoned(st, T0 + 20 + 29 * 60 * 1000), false);
  assert.equal(L.abandoned(st, T0 + 20 + 31 * 60 * 1000), true);
  L.join(st, "p1", T0 + 5000);
  const back = L.returned(st, "p1", T0 + 5000);
  assert.ok(back.ok); assert.equal(st.turnId, "p1");
  assert.ok(st.turnEndsAt > T0 + 5000);
  // 他の人の番のときに戻っても、何も変わらない
  L.join(st, "p2", T0 + 6000);
  assert.equal(L.returned(st, "p2", T0 + 6000).ok, false);
  assert.equal(st.turnId, "p1");
});

/* ---------- 漢字検定 ---------- */
function kk(n) {
  const st = K.createRoom("12345", T0);
  for (let i = 0; i < n; i++) K.join(st, "p" + (i + 1), T0);
  assert.ok(K.start(st, "p1", T0, () => 0).ok);
  return st;
}

test("漢字検定: 番の人が抜けたら、待たずに次の人へ新しい問題。全員が抜けたら止まり、戻ったらその人から", () => {
  const st = kk(3);
  const asked = st.asked, first = st.q.id;
  L.disconnect(st, "p1", T0 + 100);
  const r = K.left(st, "p1", T0 + 100, seeded(3));
  assert.ok(r.ok); assert.equal(st.turnId, "p2"); assert.equal(st.asked, asked);   // 出題数は増えない
  assert.notEqual(st.q.id, first);
  assert.equal(st.players[0].lives, st.players[1].lives);
  L.disconnect(st, "p2", T0 + 200); K.left(st, "p2", T0 + 200, seeded(3));
  assert.equal(st.turnId, "p3");
  L.disconnect(st, "p3", T0 + 300);
  const w = K.left(st, "p3", T0 + 300, seeded(3));
  assert.ok(w.events.some((e) => e.kind === "waiting"));
  assert.equal(st.q, null); assert.equal(st.turnEndsAt, null);
  assert.equal(K.timeout(st, T0 + 99999999).ok, false);
  L.join(st, "p2", T0 + 400);
  const b = K.returned(st, "p2", T0 + 400, seeded(5));
  assert.ok(b.ok); assert.equal(st.turnId, "p2"); assert.ok(st.q);
});

/* ---------- ネプリーグ ---------- */
function nep(n, mode = "coop") {
  const st = N.createRoom("12345", T0);
  for (let i = 0; i < n; i++) N.join(st, "p" + (i + 1) + "xxxxxxx", T0);
  N.setSettings(st, st.hostId, { difficulty: "normal", mode }, T0);
  assert.ok(N.start(st, st.hostId, T0, seeded(4)).ok);
  N.timeout(st, st.g.nextAt, seeded(2));                       // 最初のラウンドを開始
  return st;
}
const best = (st) => T.candidates(st.g.topic, st.g.count, st.g.last, st.g.used)[0];

test("ネプリーグ: 爆弾を持った人が抜けたら、爆発も減点もなしで次の人へ渡る。戻ってもその問題では受けとれない", () => {
  const st = nep(3);
  const h = st.g.holder, lives = st.g.teams[0].lives;
  L.disconnect(st, h, st.g.startedAt + 1000);
  const r = N.left(st, h, st.g.startedAt + 1000);
  assert.ok(r.ok);
  assert.notEqual(st.g.holder, h);
  assert.equal(st.g.teams[0].lives, lives);
  assert.ok(r.events.some((e) => e.kind === "pass"));
  // 戻っても、このラウンドは sit のまま(爆弾は回ってこない)
  L.join(st, h, st.g.startedAt + 2000);
  assert.ok(N.returned(st, h, st.g.startedAt + 2000).ok);
  assert.ok(st.g.sit.includes(h));
  const seen = new Set();
  for (let i = 0; i < 6 && st.g.phase === "play"; i++) {
    const cur = st.g.holder; seen.add(cur);
    const a = N.answer(st, cur, { word: best(st) }, st.g.startedAt + 3000 + i, seeded(1));
    if (!a.ok) break;
  }
  assert.equal(seen.has(h), false);
});

test("ネプリーグ: 全員が抜けたら導火線も止まり、戻ったら続きから(止まっていた分は数えない)", () => {
  const st = nep(2);
  const t = st.g.startedAt, fuse = st.g.fuseEndsAt;
  const [a, b] = st.players.map((p) => p.id);
  L.disconnect(st, a, t + 1000); N.left(st, a, t + 1000);
  L.disconnect(st, b, t + 2000); N.left(st, b, t + 2000);
  assert.ok(st.g.frozenAt);
  assert.equal(N.timeout(st, fuse + 99999, seeded(1)).ok, false);        // 爆発しない
  L.join(st, a, t + 60000);
  N.returned(st, a, t + 60000);
  assert.equal(st.g.frozenAt, 0);
  assert.equal(st.g.fuseEndsAt, fuse + (60000 - 2000));
  assert.equal(st.g.holder === a || st.g.holder === b, true);
  assert.ok(!st.g.sit.includes(a));                                       // 最初に戻った人から続ける
});

/* ---------- 地理クイズ ---------- */
function geo(mode, n = 3) {
  const st = G.createRoom("12345", T0);
  for (let i = 0; i < n; i++) L.join(st, "p" + (i + 1) + "xxxxxxx", T0);
  assert.ok(G.setSettings(st, st.hostId, { mode, rounds: 5 }, T0).ok);
  assert.ok(G.start(st, st.hostId, T0, seeded(4)).ok);
  G.timeout(st, st.g.nextAt, seeded(2));
  return st;
}
const gid = (st) => st.players.map((p) => p.id);

test("地理(資料選択): 抜けた人は待たない。残りが全員答えたらすぐ答え合わせ。戻ってもその問題は答えられず、次の問題から参加できる", () => {
  const st = geo("choice");
  const [a, b, c] = gid(st), t = st.g.startedAt;
  L.disconnect(st, c, t + 500);
  assert.ok(G.left(st, c, t + 500).ok);
  assert.ok(G.choose(st, a, { i: 0 }, t + 1000).ok);
  assert.equal(st.g.phase, "play");
  const r = G.choose(st, b, { i: 1 }, t + 1500);
  assert.ok(r.ok);
  assert.equal(st.g.phase, "between");                                   // c を待たずに終わる
  assert.ok(st.g.reveal.reason === "all");
  // 戻った → 次の問題から参加。途中で戻った場合は解答権なし
  L.join(st, c, t + 1600); G.returned(st, c, t + 1600);
  G.timeout(st, st.g.nextAt, seeded(2));
  assert.equal(st.g.phase, "play");
  assert.ok(!st.g.sit.includes(c));                                      // 次の問題は参加できる
  L.disconnect(st, c, st.g.startedAt + 100); G.left(st, c, st.g.startedAt + 100);
  L.join(st, c, st.g.startedAt + 200); G.returned(st, c, st.g.startedAt + 200);
  assert.ok(st.g.sit.includes(c));
  const rej = G.choose(st, c, { i: 0 }, st.g.startedAt + 300);
  assert.equal(rej.ok, false); assert.equal(rej.error, "sit_out");
});

test("地理(地図): 抜けた人を待たず、戻っても同じ問題は決定できない", () => {
  const st = geo("map", 2);
  const [a, b] = gid(st), t = st.g.startedAt;
  L.disconnect(st, b, t + 100); G.left(st, b, t + 100);
  const target = st.g.q.map === "japan" ? "JP-13" : "JPN";
  assert.ok(G.lock(st, a, { id: target }, t + 500).ok);
  assert.equal(st.g.phase, "between");                                    // b を待たずに終わる
  G.timeout(st, st.g.nextAt, seeded(2));
  L.disconnect(st, a, st.g.startedAt + 10);
  G.left(st, a, st.g.startedAt + 10);                                     // b は切れたまま: 全員切れ → 止まる
  assert.ok(st.g.frozenAt);
  assert.equal(G.timeout(st, st.g.endsAt + 99999, seeded(1)).ok, false);
  const ends = st.g.endsAt;
  L.join(st, b, st.g.startedAt + 70000); G.returned(st, b, st.g.startedAt + 70000);
  assert.equal(st.g.frozenAt, 0);
  assert.equal(st.g.endsAt, ends + 70000 - 10);
  assert.ok(!st.g.sit.includes(b)); assert.ok(st.g.sit.includes(a));      // 最初に戻った人から。まだ戻らない人は解答権なし
});

test("地理(早押し): 答えている人が抜けたら、減点なしで解答権だけなくして続ける。戻っても押せない。全員いなければ終わる", () => {
  const st = geo("buzz");
  const [a, b, c] = gid(st), t = st.g.startedAt;
  assert.ok(G.press(st, a, t + 2000).ok);
  const score = st.g.players.find((p) => p.id === a).score;
  L.disconnect(st, a, t + 2500);
  const r = G.left(st, a, t + 2500);
  assert.ok(r.ok);
  assert.equal(st.g.buzz.by, null);                                       // 待たずに、問題文はつづきから流れる
  assert.ok(st.g.buzz.lockedOut.includes(a));
  assert.equal(st.g.buzz.wrong[a] || 0, 0);                               // 減点なし
  assert.equal(st.g.players.find((p) => p.id === a).score, score);
  L.join(st, a, t + 3000); G.returned(st, a, t + 3000);
  const pr = G.press(st, a, t + 3100);
  assert.equal(pr.ok, false); assert.equal(pr.error, "sit_out");           // 戻っても、この問題は押せない
  // b・c が押して、答えをまちがえる → 解答権のある人がいなくなったので終わる(a は戻っていても権利なし)
  for (const [x, at] of [[b, 3200], [c, 3600]]) {
    assert.ok(G.press(st, x, t + at).ok);
    const w = G.answer(st, x, { text: "ぬぬぬぬぬ" }, t + at + 50);
    assert.ok(w.ok);
    if (w.judge) G.judged(st, x, false, t + at + 100);                      // AI も不正解
  }
  assert.equal(st.g.phase, "between");
  assert.equal(st.g.reveal.reason, "allwrong");
});

test("地理: 全員が抜けても、時計は止まり、部屋は進まない", () => {
  const st = geo("choice", 2);
  const [a, b] = gid(st), t = st.g.startedAt;
  for (const x of [a, b]) { L.disconnect(st, x, t + 100); G.left(st, x, t + 100); }
  assert.ok(st.g.frozenAt);
  assert.equal(G.timeout(st, t + 10 * 60 * 1000, seeded(1)).ok, false);
  assert.equal(st.g.phase, "play");
  assert.equal(L.abandoned(st, t + 100 + 31 * 60 * 1000), true);
});
