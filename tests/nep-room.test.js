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
function playing(n = 2, difficulty = "normal", mode = "coop") {
  const st = lobby(n);
  N.setSettings(st, st.hostId, { difficulty, mode }, T0);
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
  assert.equal(st.settings.mode, "coop");                       // 既定はみんなで協力
  assert.ok(N.setSettings(st, st.hostId, { mode: "vs" }, T0).ok);
  assert.equal(st.settings.mode, "vs");
  assert.ok(N.setSettings(st, st.hostId, { mode: "solo" }, T0).ok);
  assert.equal(st.settings.mode, "vs", "知らないモードは無視");
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
    assert.equal(typeof p.team, "number");
    assert.equal(typeof p.score, "number");
    assert.ok(p.avatar && "connected" in p);
  }
  assert.equal(pub.g.teams.length, 1);                          // 協力は1チーム(ライフはチームのもの)
  assert.equal(pub.g.teams[0].lives, 5);
  assert.equal(pub.g.players, undefined);
  assert.equal(pub.phase, "playing");
});

test("導火線: 猶予の間は答えが通り、過ぎると爆弾を持っていた人のチームだけライフ-1(2対2)", () => {
  const st = playing(4, "normal", "vs");
  N.timeout(st, st.g.nextAt, seeded(2));
  const end = st.g.fuseEndsAt;
  const holder = st.g.holder;
  const team = N.publicState(st).players.find((p) => p.id === holder).team;
  assert.equal(N.timeout(st, end + 1000).ok, false);
  const r = N.timeout(st, end + 1600);
  assert.ok(r.ok);
  assert.equal(r.events[0].kind, "explode");
  assert.equal(r.events[0].pid, holder);
  assert.equal(r.events[0].team, team);
  const pub = N.publicState(st);
  assert.equal(pub.g.teams[team].lives, 3);
  assert.equal(pub.g.teams[1 - team].lives, 4);
  assert.equal(st.g.phase, "between");
  assert.equal(N.nextAlarm(st, end), st.g.nextAt);
  // 遅れて届いた答えは、導火線が切れたあとなので通らない(爆発もすでに起きている)
  assert.equal(N.answer(st, holder, { word: "apple" }, end + 2000).ok, false);
});

test("2対2: 席(slot)の順に 赤青赤青。ちょうど4人でないと始められない。協力は2〜4人", () => {
  const three = lobby(3);
  N.setSettings(three, three.hostId, { mode: "vs" }, T0);
  assert.equal(N.start(three, three.hostId, T0).error, "need_four");
  assert.equal(N.canStart({ mode: "vs" }, 3), false);
  assert.equal(N.canStart({ mode: "vs" }, 4), true);
  assert.equal(N.canStart({ mode: "coop" }, 1), false);
  assert.equal(N.canStart({ mode: "coop" }, 2), true);
  const st = lobby(4);
  N.setSettings(st, st.hostId, { mode: "vs", difficulty: "easy" }, T0);
  assert.ok(N.start(st, st.hostId, T0, seeded(1)).ok);
  const pub = N.publicState(st);
  assert.deepEqual(pub.g.teams.map((t) => t.key), ["red", "blue"]);
  assert.deepEqual(pub.players.map((p) => p.slot), [0, 1, 2, 3]);       // 席の順
  assert.deepEqual(pub.players.map((p) => p.team), [0, 1, 0, 1]);       // 赤青赤青
  // 途中で席が空いて別の人が入っても、席の順で並ぶ(slot 順)
  const room = lobby(4);
  N.disconnect(room, ids(room)[1], T0 + 1);                            // slot1 の人が抜ける(ロビーなので席が空く)
  assert.ok(N.join(room, "newcomerxx", T0 + 2).ok);
  N.setSettings(room, room.hostId, { mode: "vs" }, T0);
  assert.ok(N.start(room, room.hostId, T0 + 3, seeded(1)).ok);
  assert.deepEqual(room.players.map((p) => p.slot), [0, 1, 2, 3]);
  assert.equal(room.players[1].id, "newcomerxx");
});

test("ゲーム終了(2対2): 相手チームのライフが0で勝ち。順位が入り、部屋も終了。再戦でロビーへ", () => {
  const st = playing(4, "normal", "vs");
  let now = st.g.nextAt;
  N.timeout(st, now, seeded(3));
  let guard = 0;
  while (st.phase === "playing" && guard++ < 60) {
    if (st.g.phase === "between") { now = st.g.nextAt; N.timeout(st, now, seeded(guard)); continue; }
    now = st.g.fuseEndsAt + 1600;
    N.timeout(st, now);
  }
  assert.equal(st.phase, "over");
  assert.equal(st.ranking.length, 4);
  assert.ok(["team_out", "rounds"].includes(st.g.result.reason));
  assert.equal(N.answer(st, ids(st)[0], { word: "apple" }, now + 1).error, "bad_phase");
  assert.equal(N.rematch(st, ids(st).find((i) => i !== st.hostId), now).error, "not_host");
  assert.ok(N.rematch(st, st.hostId, now).ok);
  assert.equal(st.phase, "lobby");
  assert.equal(st.g, null);
  assert.equal(N.publicState(st).g, null);
});

test("ゲーム終了(協力): ライフがなくなると失敗。クリアなら成功", () => {
  const st = playing(3, "normal", "coop");
  let now = st.g.nextAt;
  N.timeout(st, now, seeded(3));
  let guard = 0;
  while (st.phase === "playing" && guard++ < 60) {
    if (st.g.phase === "between") { now = st.g.nextAt; N.timeout(st, now, seeded(guard)); continue; }
    now = st.g.fuseEndsAt + 1600;
    N.timeout(st, now);
  }
  assert.equal(st.phase, "over");
  assert.equal(st.g.result.reason, "coop_fail");
  assert.equal(st.g.result.cleared, false);
  assert.equal(N.publicState(st).g.result.mode, "coop");
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

test("publicState: 熟語の意味(prompt.sub)は送るが、答えの一覧は送らない", () => {
  const st = playing(2);
  N.timeout(st, st.g.nextAt, seeded(2));
  st.g.topic = { kind: "phrase", key: "p", need: 2, steps: [{ prompt: "salt and ___", answers: ["pepper"], ja: "塩{しお}とこしょう" }, { prompt: "Break a ___", answers: ["leg"], ja: "がんばって！" }] };
  st.g.need = 2; st.g.count = 0; st.g.used = []; st.g.last = null;
  st.g.prompt = { kind: "phrase", title: "t", big: "salt and ___", sub: "意味{いみ}：塩{しお}とこしょう" };
  const json = JSON.stringify(N.publicState(st));
  assert.ok(json.includes("塩{しお}とこしょう"));
  assert.equal(json.includes("pepper"), false);
});

test("ヒント: 部屋でも持っている人だけ・1回・全員の画面に出る。答えそのものは送らない", () => {
  const st = playing(3);
  N.timeout(st, st.g.nextAt, seeded(2));
  const holder = st.g.holder;
  const other = ids(st).find((i) => i !== holder);
  assert.equal(N.hint(st, other, st.g.nextAt + 1000).error, "not_your_turn");
  const r = N.hint(st, holder, st.g.nextAt + 1000);
  assert.ok(r.ok);
  assert.equal(r.events[0].kind, "hint");
  const pub = N.publicState(st);
  assert.equal(pub.g.hint.pid, holder);
  assert.match(pub.g.hint.text, /^[A-Z]( _)*$/);
  assert.deepEqual(pub.g.hintUsed, [holder]);
  assert.equal(JSON.stringify(pub).includes('"answers"'), false);
  assert.equal(N.hint(st, holder, st.g.nextAt + 2000).error, "hint_used");
  assert.equal(N.hint(lobby(2), "x", T0).error, "bad_phase");
});

test("古い形式の部屋(チーム戦になる前)は、ロビーに戻して安全に使える", () => {
  const st = playing(2);
  delete st.g.teams;                       // 古い形式を再現
  delete st.settings.mode;
  assert.equal(N.migrate(st), true);
  assert.equal(st.phase, "lobby");
  assert.equal(st.g, null);
  assert.equal(st.settings.mode, "coop");
  assert.equal(N.migrate(st), false);      // 新しい形式なら何もしない
  assert.equal(N.migrate(lobby(2)), false);
});
