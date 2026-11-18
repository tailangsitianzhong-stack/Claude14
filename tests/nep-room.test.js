// ミニネプリーグ(英語)・友達対戦の部屋ロジック
const test = require("node:test");
const assert = require("node:assert/strict");

let N, W, T;
test.before(async () => {
  N = await import("../worker/nep-room.mjs");
  const Words = require("../js/games/nep/words.js");
  const Topics = require("../js/games/nep/topics.js");
  W = Words.create(globalThis.NEP_DATA);
  T = Topics.create(W, globalThis.NEP_DATA);
});

const T0 = 5_000_000;
function seeded(seed) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }
function lobby(n = 2) {
  const st = N.createRoom("12345", T0);
  for (let i = 0; i < n; i++) assert.ok(N.join(st, "p" + (i + 1) + "xxxxxxx", T0).ok);
  return st;
}
const ids = (st) => st.players.map((p) => p.id);
function playing(n = 2, difficulty = "normal") {
  const st = lobby(n);
  N.setSettings(st, st.hostId, { difficulty }, T0);
  const r = N.start(st, st.hostId, T0, seeded(4));
  assert.ok(r.ok);
  return st;
}
const best = (st) => T.candidates(st.g.topic, st.g.count, st.g.last, st.g.used)[0];

test("部屋: 作成と設定。ホストだけが難しさを変えられる", () => {
  const st = lobby(3);
  assert.equal(st.game, "nep");
  assert.equal(st.phase, "lobby");
  assert.equal(N.setSettings(st, ids(st)[1], { difficulty: "hard" }, T0).error, "not_host");
  assert.ok(N.setSettings(st, st.hostId, { difficulty: "hard" }, T0).ok);
  assert.equal(st.settings.difficulty, "hard");
  assert.ok(N.setSettings(st, st.hostId, { difficulty: "bogus" }, T0).ok);
  assert.equal(st.settings.difficulty, "hard");
});

test("開始: 2人以上・ホストだけ。最初は「よーい」でお題はまだ出ない", () => {
  const one = lobby(1);
  assert.equal(N.start(one, one.hostId, T0).error, "need_players");
  const st = lobby(2);
  assert.equal(N.start(st, ids(st)[1], T0).error, "not_host");
  assert.ok(N.start(st, st.hostId, T0, seeded(1)).ok);
  assert.equal(st.phase, "playing");
  assert.equal(st.g.phase, "between");
  assert.equal(st.g.topic, null);
  assert.equal(N.nextAlarm(st, T0), st.g.nextAt);
  assert.equal(N.start(st, st.hostId, T0).error, "bad_phase");
});

test("アラームで最初のラウンドが始まり、導火線は30秒", () => {
  const st = playing(3);
  assert.equal(N.timeout(st, T0 + 100).ok, false);
  const r = N.timeout(st, st.g.nextAt, seeded(2));
  assert.ok(r.ok);
  assert.equal(r.events[0].kind, "round");
  assert.equal(st.g.phase, "play");
  assert.equal(st.g.fuseEndsAt, st.g.nextAt + 30000);
  assert.equal(N.nextAlarm(st, T0), st.g.fuseEndsAt + 1500 + 1);
});

test("答え: 持っている人だけ。正解で爆弾が次の人へ。まちがいは本人にだけ理由を返す", () => {
  const st = playing(3);
  N.timeout(st, st.g.nextAt, seeded(2));
  const holder = st.g.holder;
  const other = ids(st).find((i) => i !== holder);
  assert.equal(N.answer(st, other, { word: best(st) }, st.g.nextAt + 2000).error, "not_your_turn");
  const bad = N.answer(st, holder, { word: "zzqqxx" }, st.g.nextAt + 2000);
  assert.equal(bad.ok, false);
  assert.ok(["wrong", "unknown", "inflected"].includes(bad.reason));
  assert.equal(st.g.holder, holder);
  assert.equal(N.answer(st, holder, { word: 123 }, st.g.nextAt + 2000).error, "bad_message");
  assert.equal(N.answer(st, holder, { word: "x".repeat(60) }, st.g.nextAt + 2000).error, "bad_message");
  const ok = N.answer(st, holder, { word: best(st) }, st.g.nextAt + 3000);
  assert.ok(ok.ok);
  assert.equal(ok.events[0].kind, "accept");
  assert.notEqual(st.g.holder, holder);
});

test("変化形は「原形で」と理由つきで断る(base が返る)", () => {
  const st = playing(2);
  N.timeout(st, st.g.nextAt, seeded(2));
  // 頭文字のお題に差し替えて確認
  st.g.topic = { kind: "letter", key: "letter:d", need: 5, c: "d" };
  st.g.need = 5; st.g.count = 0; st.g.used = []; st.g.last = null;
  const r = N.answer(st, st.g.holder, { word: "dogs" }, st.g.nextAt + 1000);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "inflected");
  assert.equal(r.base, "dog");
});

test("publicState: お題の答えの一覧・内部のお題(topic)は端末に送らない", () => {
  const st = playing(3);
  N.timeout(st, st.g.nextAt, seeded(2));
  const holder = st.g.holder;
  N.answer(st, holder, { word: best(st) }, st.g.nextAt + 2000);
  const pub = N.publicState(st);
  const json = JSON.stringify(pub);
  assert.equal(pub.g.topic, undefined);
  assert.equal(pub.g.usedKeys, undefined);
  assert.equal(json.includes('"answers"'), false);
  assert.equal(json.includes('"steps"'), false);
  assert.ok(pub.g.prompt && pub.g.prompt.title);
  assert.equal(pub.g.used.length, 1);
  assert.equal(pub.players.length, 3);
  for (const p of pub.players) {
    assert.equal(typeof p.lives, "number");
    assert.ok(p.avatar && "connected" in p);
  }
  assert.equal(pub.g.players, undefined);
  assert.equal(pub.phase, "playing");
});

test("導火線: 猶予の間は答えが通り、過ぎると持っていた人だけライフ-1", () => {
  const st = playing(3);
  N.timeout(st, st.g.nextAt, seeded(2));
  const end = st.g.fuseEndsAt;
  const holder = st.g.holder;
  assert.equal(N.timeout(st, end + 1000).ok, false);
  const r = N.timeout(st, end + 1600);
  assert.ok(r.ok);
  assert.equal(r.events[0].kind, "explode");
  assert.equal(r.events[0].pid, holder);
  const pub = N.publicState(st);
  assert.equal(pub.players.find((p) => p.id === holder).lives, 2);
  assert.equal(pub.players.filter((p) => p.lives === 3).length, 2);
  assert.equal(st.g.phase, "between");
  assert.equal(N.nextAlarm(st, end), st.g.nextAt);
  // 遅れて届いた答えは、導火線が切れたあとなので通らない(爆発もすでに起きている)
  assert.equal(N.answer(st, holder, { word: "apple" }, end + 2000).ok, false);
});

test("ゲーム終了: 最後の1人が勝ち。順位が入り、部屋も終了。再戦でロビーへ", () => {
  const st = playing(2);
  let now = st.g.nextAt;
  N.timeout(st, now, seeded(3));
  let guard = 0;
  while (st.phase === "playing" && guard++ < 40) {
    if (st.g.phase === "between") { now = st.g.nextAt; N.timeout(st, now, seeded(guard)); continue; }
    now = st.g.fuseEndsAt + 1600;
    N.timeout(st, now);
  }
  assert.equal(st.phase, "over");
  assert.equal(st.ranking.length, 2);
  assert.equal(st.g.result.reason, "last");
  const winner = st.g.result.winnerId;
  assert.equal(st.ranking[0], winner);
  assert.equal(N.answer(st, winner, { word: "apple" }, now + 1).error, "bad_phase");
  assert.equal(N.rematch(st, ids(st).find((i) => i !== st.hostId), now).error, "not_host");
  assert.ok(N.rematch(st, st.hostId, now).ok);
  assert.equal(st.phase, "lobby");
  assert.equal(st.g, null);
  assert.equal(N.publicState(st).g, null);
});

test("解除: 全員で目標数に届くと、爆発せず次のラウンドへ(部屋のアラームも次のラウンド)", () => {
  const st = playing(2, "easy");
  let now = st.g.nextAt;
  N.timeout(st, now, seeded(8));
  let guard = 0;
  while (st.g.phase === "play" && guard++ < 30) {
    const r = N.answer(st, st.g.holder, { word: best(st) }, (now += 800));
    assert.ok(r.ok, "答え " + guard);
  }
  assert.equal(st.g.outcome.type, "defuse");
  assert.equal(st.phase, "playing");
  assert.equal(N.nextAlarm(st, now), st.g.nextAt);
  assert.ok(N.timeout(st, st.g.nextAt, seeded(9)).ok);
  assert.equal(st.g.round, 2);
});

test("入室: ゲーム中の途中参加は断るが、再接続はできる", () => {
  const st = playing(2);
  assert.equal(N.join(st, "newcomerxx", T0 + 1).error, "started");
  const id = ids(st)[1];
  N.disconnect(st, id, T0 + 2);
  assert.equal(st.players.find((p) => p.id === id).connected, false);
  assert.ok(N.join(st, id, T0 + 3).ok);
  assert.equal(st.players.find((p) => p.id === id).connected, true);
});
