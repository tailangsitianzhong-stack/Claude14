/**
 * 友達対戦の「部屋」の進行ロジック（通信・保存に依存しない純粋な関数。テストしやすいよう分けてある）
 *
 * 状態(state)を受け取って書き換え、起きたこと(events)の配列を返す。
 * ・つなぎ方のルール(つながり・重複・「ん」)はサーバーでも確認する（rules.js を共用）
 * ・つづりの正しさは「答える人の端末」が辞書/Geminiで判定し、通った手だけを送ってくる（友達同士なので信頼する）
 * ・制限時間は部屋(サーバー)が持つので、端末の時計をごまかせない
 */
import Rules from "../js/games/shiritori/rules.js";
import Core from "../js/games/shiritori/game-core.js";

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;
export const AVATARS = ["🐶", "🐱", "🐰", "🐻"];
export const GRACE_MS = 1500;          // 通信のおくれを見こした、制限時間の「おまけ」
export const HINT_COST = Core.HINT_COST;
export const PAUSE_MAX_MS = 10000;      // Geminiで確認している間の「時間ストップ」の上限(1つの番につき1回)

const DIFFS = Core.DIFFICULTIES;

export function createRoom(code, now) {
  return {
    code, phase: "lobby", hostId: null,
    settings: { difficulty: "normal", ignoreDakuten: false },
    players: [],
    turnId: null, required: null, used: [], history: [],
    turnEndsAt: null, seconds: DIFFS.normal.seconds,
    outCount: 0, ranking: [], overReason: null,
    createdAt: now, updatedAt: now
  };
}

const player = (st, id) => st.players.find((p) => p.id === id);
const alive = (st) => st.players.filter((p) => p.alive);

/** 入室 / 再接続。途中参加はできない（再接続だけOK） */
export function join(st, id, now) {
  const existing = player(st, id);
  if (existing) {
    existing.connected = true;
    st.updatedAt = now;
    return { ok: true, events: [{ kind: "reconnected", playerId: id }] };
  }
  if (st.phase !== "lobby") return { ok: false, error: "started", events: [] };
  if (st.players.length >= MAX_PLAYERS) return { ok: false, error: "full", events: [] };
  const used = new Set(st.players.map((p) => p.slot));
  const slot = [0, 1, 2, 3].find((s) => !used.has(s));
  st.players.push({
    id, slot, avatar: AVATARS[slot], connected: true,
    lives: 0, score: 0, streak: 0, words: 0, alive: true, out: null
  });
  if (!st.hostId) st.hostId = id;
  st.updatedAt = now;
  return { ok: true, events: [{ kind: "joined", playerId: id }] };
}

/** 接続が切れた。ロビーなら席を空け、ゲーム中なら席は残す(再接続できる) */
export function disconnect(st, id, now) {
  const p = player(st, id);
  if (!p) return { events: [] };
  p.connected = false;
  st.updatedAt = now;
  const events = [{ kind: "left", playerId: id }];
  if (st.phase === "lobby") {
    st.players = st.players.filter((x) => x.id !== id);
  }
  if (st.hostId === id) {
    const next = st.players.find((x) => x.connected) || st.players[0];
    st.hostId = next ? next.id : null;
    if (next) events.push({ kind: "host", playerId: next.id });
  }
  return { events };
}

export function setSettings(st, id, patch, now) {
  if (id !== st.hostId) return { ok: false, error: "not_host", events: [] };
  if (st.phase !== "lobby") return { ok: false, error: "bad_phase", events: [] };
  if (patch && DIFFS[patch.difficulty]) st.settings.difficulty = patch.difficulty;
  if (patch && typeof patch.ignoreDakuten === "boolean") st.settings.ignoreDakuten = patch.ignoreDakuten;
  st.updatedAt = now;
  return { ok: true, events: [] };
}

export function start(st, id, now, rng) {
  if (id !== st.hostId) return { ok: false, error: "not_host", events: [] };
  if (st.phase !== "lobby") return { ok: false, error: "bad_phase", events: [] };
  if (st.players.filter((p) => p.connected).length < MIN_PLAYERS) return { ok: false, error: "need_players", events: [] };

  const d = DIFFS[st.settings.difficulty];
  st.players = st.players.filter((p) => p.connected);
  st.players.forEach((p) => Object.assign(p, { lives: d.lives, score: 0, streak: 0, words: 0, alive: true, out: null }));
  st.phase = "playing";
  st.seconds = d.seconds;
  st.required = Core.START_KANA;
  st.used = []; st.history = []; st.ranking = []; st.overReason = null; st.outCount = 0;
  const first = st.players[Math.floor((rng || Math.random)() * st.players.length)];
  setTurn(st, first.id, now);
  st.updatedAt = now;
  return { ok: true, events: [{ kind: "started", playerId: first.id }] };
}

function setTurn(st, id, now) {
  st.turnId = id;
  st.turnEndsAt = now + st.seconds * 1000 + GRACE_MS;
  st.pausedAt = null;                   // 確認中の時間ストップは、番が変わったら解除
  st.pausedOnce = false;
}

/** 確認中の時間ストップを解く。止めていた分だけ、制限時間を延ばす */
function unpause(st, now) {
  if (st.pausedAt) {
    st.turnEndsAt += Math.max(0, now - st.pausedAt);
    st.pausedAt = null;
  }
}

/**
 * 答える人が、辞書にない語をGeminiに確認し始めた。確認が終わるまで時間を止める(全員の画面で止まる)。
 * 1つの番につき1回・最大 PAUSE_MAX_MS まで。手(move/miss)が届くか resume で再開する
 */
export function judging(st, id, now) {
  if (st.phase !== "playing" || id !== st.turnId) return { ok: false, error: "not_your_turn", events: [] };
  if (st.pausedAt || st.pausedOnce) return { ok: false, error: "already_paused", events: [] };
  st.pausedAt = now;
  st.pausedOnce = true;
  st.updatedAt = now;
  return { ok: true, events: [{ kind: "judging", playerId: id }] };
}

/** 確認が終わったが、手を送らない場合(入力のやり直しなど)の再開 */
export function resume(st, id, now) {
  if (st.phase !== "playing" || id !== st.turnId) return { ok: false, error: "not_your_turn", events: [] };
  if (!st.pausedAt) return { ok: false, error: "not_paused", events: [] };
  unpause(st, now);
  st.updatedAt = now;
  return { ok: true, events: [{ kind: "resumed", playerId: id }] };
}

/** 次に答える人(生きている人の中で、いまの人の次)へ。1人だけになったら終了 */
function advance(st, fromId, now, events) {
  const living = alive(st);
  if (living.length <= 1) return finish(st, living.length ? "last_one" : "all_out", events);
  const order = st.players;
  let i = order.findIndex((p) => p.id === fromId);
  for (let n = 0; n < order.length; n++) {            // 通信が切れている人の番は、待たずに飛ばす
    i = (i + 1) % order.length;
    if (order[i].alive && order[i].connected) { setTurn(st, order[i].id, now); events.push({ kind: "turn", playerId: order[i].id }); return; }
  }
  // 生きている人が全員、通信が切れている: だれかが戻るまで、番も時計も止める
  st.turnId = null; st.turnEndsAt = null; st.pausedAt = null;
  events.push({ kind: "waiting" });
}

function finish(st, reason, events) {
  st.phase = "over";
  st.overReason = reason;
  st.turnId = null; st.turnEndsAt = null;
  // 順位: 生き残り → あとに脱落した人 → 同じなら得点が高い人
  st.ranking = st.players.slice().sort((a, b) =>
    (b.alive - a.alive) || ((b.out || 0) - (a.out || 0)) || (b.score - a.score)).map((p) => p.id);
  events.push({ kind: "over", reason, ranking: st.ranking.slice() });
}

function eliminate(st, p, events) {
  p.lives = 0; p.alive = false; p.out = ++st.outCount;
  events.push({ kind: "out", playerId: p.id });
}

/** 答える人が、辞書などで通した手を送ってきた */
export function move(st, id, m, now) {
  if (st.phase !== "playing") return { ok: false, error: "bad_phase", events: [] };
  if (id !== st.turnId) return { ok: false, error: "not_your_turn", events: [] };
  if (typeof m !== "object" || m === null) return { ok: false, error: "bad_message", events: [] };
  unpause(st, now);                      // 確認中だった場合は、ここで時間を再開(止めていた分は延長される)

  const r = Rules.checkMove(
    { reading: m.reading, english: m.english, requiredKana: st.required, usedEnglish: st.used },
    { ignoreDakuten: st.settings.ignoreDakuten });
  if (!r.ok) return { ok: false, error: "rejected", reason: r.reason, events: [] };

  const p = player(st, id);
  const events = [];
  const prevRequired = st.required;                 // この手を答える前の「始める文字」
  const remaining = Math.max(0, Math.min(st.seconds, (st.turnEndsAt - GRACE_MS - now) / 1000));
  p.streak++; p.words++;
  const points = Core.pointsFor({
    length: r.english.length, remaining, seconds: st.seconds, streak: p.streak, mult: DIFFS[st.settings.difficulty].mult
  });
  p.score += points;
  st.used.push(r.english);
  st.history.push({ playerId: id, reading: r.reading, english: r.english, points });
  if (st.history.length > 200) st.history.shift();
  st.required = r.tail;
  events.push({ kind: "moved", playerId: id, reading: r.reading, english: r.english, points });

  if (r.endsWithN) {                       // 「ん」で終わったら、その人は脱落
    eliminate(st, p, events);
    events.push({ kind: "n_out", playerId: id });
    // 「ん」から始まる言葉は無いので、次の人は脱落した人と同じ文字(直前の語のつなぎ文字)から始める
    st.required = prevRequired;
  }
  advance(st, id, now, events);
  st.updatedAt = now;
  return { ok: true, events };
}

/** 答える人が、間違い(つづりミスなど)を報告してきた。ライフ-1、次の人へ */
export function miss(st, id, info, now) {
  if (st.phase !== "playing") return { ok: false, error: "bad_phase", events: [] };
  if (id !== st.turnId) return { ok: false, error: "not_your_turn", events: [] };
  unpause(st, now);
  return { ok: true, events: applyMiss(st, id, (info && info.reason) || "wrong", info, now) };
}

function applyMiss(st, id, reason, info, now) {
  const p = player(st, id);
  const events = [];
  p.lives--; p.streak = 0;
  const clean = (v) => (typeof v === "string" && /^[a-z]{2,30}$/.test(v) ? v : null);
  events.push({ kind: "miss", playerId: id, reason: String(reason).slice(0, 20), correct: clean(info && info.correct) });
  if (p.lives <= 0) eliminate(st, p, events);
  advance(st, id, now, events);
  st.updatedAt = now;
  return events;
}

/** 時間切れ(アラームから呼ぶ)。まだなら何もしない */
export function timeout(st, now) {
  if (st.phase !== "playing" || st.turnEndsAt == null) return { ok: false, events: [] };
  if (st.pausedAt) {
    // 確認中は時間が止まっている。上限(10秒)を過ぎても手が届かなければ、自動で再開する
    if (now < st.pausedAt + PAUSE_MAX_MS) return { ok: false, events: [] };
    unpause(st, now);
    st.updatedAt = now;
    return { ok: true, events: [{ kind: "resumed", playerId: st.turnId }] };
  }
  if (now < st.turnEndsAt - 50) return { ok: false, events: [] };
  return { ok: true, events: applyMiss(st, st.turnId, "timeout", null, now) };
}

export function hint(st, id, now) {
  const p = player(st, id);
  if (st.phase !== "playing" || id !== st.turnId || !p) return { ok: false, events: [] };
  p.score = Math.max(0, p.score - HINT_COST);
  st.updatedAt = now;
  return { ok: true, events: [] };
}

/** 通信が切れた(ゲーム中)。その人の番なら、待たずに次の人へ(ライフは減らさない) */
export function left(st, id, now) {
  if (st.phase !== "playing" || st.turnId !== id) return { ok: false, events: [] };
  const events = [{ kind: "skipped", playerId: id }];
  advance(st, id, now, events);
  st.updatedAt = now;
  return { ok: true, events };
}

/** 戻った(ゲーム中)。みんなが切れていて止まっていたなら、その人から再開する */
export function returned(st, id, now) {
  const p = player(st, id);
  if (st.phase !== "playing" || st.turnId !== null || !p || !p.alive) return { ok: false, events: [] };
  setTurn(st, id, now);
  st.updatedAt = now;
  return { ok: true, events: [{ kind: "turn", playerId: id }] };
}

/** ゲーム中なのに、だれも戻らないまま長く(30分)たった部屋 */
export function abandoned(st, now) {
  return st.phase === "playing" && !st.players.some((p) => p.connected) && now >= st.updatedAt + ABANDON_MS;
}

/** ゲーム終了後に、同じメンバーでもう一度(ロビーへ戻る) */
export function rematch(st, id, now) {
  if (id !== st.hostId) return { ok: false, error: "not_host", events: [] };
  if (st.phase !== "over") return { ok: false, error: "bad_phase", events: [] };
  st.players = st.players.filter((p) => p.connected);
  st.players.forEach((p) => Object.assign(p, { lives: 0, score: 0, streak: 0, words: 0, alive: true, out: null }));
  Object.assign(st, { phase: "lobby", turnId: null, turnEndsAt: null, required: null, used: [], history: [], ranking: [], overReason: null });
  st.updatedAt = now;
  return { ok: true, events: [{ kind: "rematch" }] };
}

/** 次にアラームを鳴らす時刻(ms)。ゲーム中は制限時間、それ以外は片づけ */
export function nextAlarm(st, now) {
  if (st.phase === "playing" && st.pausedAt) return st.pausedAt + PAUSE_MAX_MS;
  if (st.phase === "playing" && st.turnEndsAt != null) return st.turnEndsAt;
  const anyone = st.players.some((p) => p.connected);
  return st.updatedAt + (anyone ? 2 * 60 * 60 * 1000 : 10 * 60 * 1000);
}

export const ABANDON_MS = 30 * 60 * 1000;      // abandoned() と同じ
export const MIN_ALARM_GAP_MS = 5000;           // アラームの最短の間隔

/**
 * 実際にセットするアラーム時刻。
 * ・ゲーム中にだれも接続していない(時計が止まっている)部屋は、片づける時刻まで鳴らさない。
 *   以前は、止まった時計の「期限」が過去のまま返り、アラームが即座に鳴り続けて(30分間)、
 *   Durable Objects の無料枠(1日のリクエスト数)を使い切る原因になった。
 * ・期限が過去のまま(進めない状態)でも、すぐには鳴らさない(安全装置)。
 */
export function safeAlarm(st, now, raw) {
  if (st.phase === "playing" && !st.players.some((p) => p.connected)) return st.updatedAt + ABANDON_MS;
  return raw > now ? raw : now + MIN_ALARM_GAP_MS;
}

/** 部屋を片づけてよいか(アラーム時) */
export function expired(st, now) {
  return st.phase !== "playing" && now >= nextAlarm(st, now);
}
