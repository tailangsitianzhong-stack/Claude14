/**
 * ミニ漢字検定・友達対戦の「部屋」の進行ロジック（通信・保存に依存しない純粋な関数）
 *
 * ・順番に1問ずつ。**同じ問題を全員の画面に出し、答えられるのは順番の人だけ**
 * ・出題・採点・時間管理は部屋(サーバー)が行う。答えは誰の端末にも送らない(publicState で取り除く)
 * ・モード: exam(最大60問・ライフ5・時間切れもライフ-1) / survival(ライフ3・時間切れは即脱落・問題数は無制限)
 * ・勝者は「ポイント」で決める。終了条件: 60問 / 全員脱落 / 1人だけ残っていて、その人が最高得点
 * ・入室・退室・ホスト・席などは room-logic.mjs と共通
 */
import "./shim-window.mjs";
import "../data/kanji.js";
import Q from "../js/games/kanken/question.js";
import * as L from "./room-logic.mjs";

export { join, disconnect, nextAlarm, expired, MAX_PLAYERS, MIN_PLAYERS, GRACE_MS } from "./room-logic.mjs";

export const EXAM_QUESTIONS = 60;
export const LIVES = { exam: 5, survival: 3 };
export const LIMIT = { read: 30, write: 12 };      // 1問の制限時間(秒)。単独プレイ(core.js)と同じ
const MODES = ["exam", "survival"];
const USED_MAX = 400;

let bank = null;
const getBank = () => bank || (bank = Q.createBank(globalThis.KANKEN_DATA));

export function createRoom(code, now) {
  const st = L.createRoom(code, now);
  Object.assign(st, {
    game: "kanken",
    settings: { mode: "exam", level: 1 },
    q: null, asked: 0, askedAt: 0, usedIds: [], last: null
  });
  return st;
}

const player = (st, id) => st.players.find((p) => p.id === id);
const alive = (st) => st.players.filter((p) => p.alive);

export function setSettings(st, id, patch, now) {
  if (id !== st.hostId) return { ok: false, error: "not_host", events: [] };
  if (st.phase !== "lobby") return { ok: false, error: "bad_phase", events: [] };
  if (patch && MODES.includes(patch.mode)) st.settings.mode = patch.mode;
  if (patch && Number.isInteger(patch.level) && patch.level >= 1 && patch.level <= Q.LEVELS.length) st.settings.level = patch.level;
  st.updatedAt = now;
  return { ok: true, events: [] };
}

export function start(st, id, now, rng) {
  if (id !== st.hostId) return { ok: false, error: "not_host", events: [] };
  if (st.phase !== "lobby") return { ok: false, error: "bad_phase", events: [] };
  if (st.players.filter((p) => p.connected).length < L.MIN_PLAYERS) return { ok: false, error: "need_players", events: [] };

  st.players = st.players.filter((p) => p.connected);
  st.players.forEach((p) => Object.assign(p, { lives: LIVES[st.settings.mode], score: 0, streak: 0, words: 0, wrong: 0, alive: true, out: null }));
  Object.assign(st, { phase: "playing", asked: 0, usedIds: [], last: null, q: null, ranking: [], overReason: null, outCount: 0 });
  const first = st.players[Math.floor((rng || Math.random)() * st.players.length)];
  const events = [{ kind: "started", playerId: first.id }];
  ask(st, first.id, now, events, rng);
  st.updatedAt = now;
  return { ok: true, events };
}

/** 次の問題を出して、その人の番にする。60問に達していたら終了 */
function ask(st, playerId, now, events, rng) {
  if (st.settings.mode === "exam" && st.asked >= EXAM_QUESTIONS) return finish(st, "done", events);
  const q = getBank().next({ level: st.settings.level, rng: rng || Math.random, used: new Set(st.usedIds) });
  if (!q) return finish(st, "done", events);
  st.usedIds.push(q.id);
  if (st.usedIds.length > USED_MAX) st.usedIds.shift();
  st.q = q; st.asked++;
  st.turnId = playerId;
  st.seconds = LIMIT[q.type];
  st.askedAt = now;
  st.turnEndsAt = now + st.seconds * 1000 + L.GRACE_MS;
  events.push({ kind: "turn", playerId });
}

function finish(st, reason, events) {
  st.phase = "over"; st.overReason = reason;
  st.turnId = null; st.turnEndsAt = null; st.q = null;
  // 順位: ポイントが高い順。同点は正解数、それも同じなら生き残り
  st.ranking = st.players.slice().sort((a, b) => (b.score - a.score) || (b.words - a.words) || (b.alive - a.alive)).map((p) => p.id);
  events.push({ kind: "over", reason, ranking: st.ranking.slice() });
}

/** 次に答える人(生きている人の中で、いまの人の次) */
function nextPlayer(st, fromId) {
  const order = st.players;
  let i = order.findIndex((p) => p.id === fromId);
  for (let n = 0; n < order.length; n++) {
    i = (i + 1) % order.length;
    if (order[i].alive && order[i].connected) return order[i].id;      // 通信が切れている人の番は、待たずに飛ばす
  }
  return null;
}

/** 終了条件: 全員脱落 / 1人だけ残っていて、その人が最高得点(これ以上競う相手がいない) */
function shouldEnd(st) {
  const live = alive(st);
  if (live.length === 0) return "all_out";
  if (live.length === 1 && st.players.length > 1) {
    const top = Math.max(...st.players.filter((p) => p.id !== live[0].id).map((p) => p.score));
    if (live[0].score > top) return "last_one";
  }
  return null;
}

/** 1問の結果を反映して、次の人・次の問題へ */
function settle(st, p, result, now, events, rng) {
  const q = st.q;
  st.last = {
    playerId: p.id, correct: result.correct, timeout: !!result.timeout, points: result.points || 0,
    type: q.type, word: q.type === "write" ? q.full : q.text,
    reading: q.type === "write" ? q.reading : q.answer, answer: q.answer
  };
  events.push({ kind: "answered", ...st.last });
  if (!result.correct) {
    p.wrong++; p.streak = 0;
    if (st.settings.mode === "survival" && result.timeout) p.lives = 0;     // サバイバル: 時間切れは即脱落
    else p.lives--;
    if (p.lives <= 0) { p.lives = 0; p.alive = false; p.out = ++st.outCount; events.push({ kind: "out", playerId: p.id }); }
  }
  const end = shouldEnd(st);
  if (end) { st.q = null; return finish(st, end, events); }
  if (!alive(st).length) { st.q = null; return finish(st, "all_out", events); }
  const nxt = nextPlayer(st, p.id);
  if (!nxt) return wait(st, events);
  ask(st, nxt, now, events, rng);
}

/** 生きている人が全員、通信が切れている: だれかが戻るまで、番も時計も止める */
function wait(st, events) {
  st.q = null; st.turnId = null; st.turnEndsAt = null;
  events.push({ kind: "waiting" });
}

/** 通信が切れた(ゲーム中)。その人の番なら、待たずに次の人へ(出題を1つ取り消す) */
export function left(st, id, now, rng) {
  if (st.phase !== "playing" || !st.q || st.turnId !== id) return { ok: false, events: [] };
  const events = [{ kind: "skipped", playerId: id }];
  st.asked = Math.max(0, st.asked - 1);
  const nxt = nextPlayer(st, id);
  if (!nxt) wait(st, events); else ask(st, nxt, now, events, rng);
  st.updatedAt = now;
  return { ok: true, events };
}

/** 戻った(ゲーム中)。みんなが切れていて止まっていたなら、その人から再開する */
export function returned(st, id, now, rng) {
  const p = player(st, id);
  if (st.phase !== "playing" || st.q || st.turnId !== null || !p || !p.alive) return { ok: false, events: [] };
  const events = [];
  ask(st, id, now, events, rng);
  st.updatedAt = now;
  return { ok: true, events };
}

/** 順番の人の答え。{reading:"…"} か {choice:0〜3} */
export function answer(st, id, resp, now, rng) {
  if (st.phase !== "playing" || !st.q) return { ok: false, error: "bad_phase", events: [] };
  if (id !== st.turnId) return { ok: false, error: "not_your_turn", events: [] };
  if (!resp || typeof resp !== "object") return { ok: false, error: "bad_message", events: [] };
  const q = st.q;
  const p = player(st, id);

  let correct;
  if (q.type === "read") {
    if (typeof resp.reading !== "string" || resp.reading.length > 40) return { ok: false, error: "bad_message", events: [] };
    correct = Q.checkReading(resp.reading, q);
  } else {
    if (!Number.isInteger(resp.choice) || resp.choice < 0 || resp.choice > 3) return { ok: false, error: "bad_message", events: [] };
    correct = Q.checkChoice(resp.choice, q);
  }
  const events = [];
  let points = 0;
  if (correct) {
    const elapsed = Math.max(0, Math.min(st.seconds, (now - st.askedAt) / 1000));
    p.streak++; p.words++;
    points = Q.pointsFor({ level: q.level, type: q.type, elapsed, limit: st.seconds, streak: p.streak });
    p.score += points;
  }
  settle(st, p, { correct, points }, now, events, rng);
  st.updatedAt = now;
  return { ok: true, events };
}

/** 制限時間切れ(アラームから)。まだなら何もしない */
export function timeout(st, now, rng) {
  if (st.phase !== "playing" || !st.q || st.turnEndsAt == null || now < st.turnEndsAt - 50) return { ok: false, events: [] };
  const events = [];
  settle(st, player(st, st.turnId), { correct: false, timeout: true }, now, events, rng);
  st.updatedAt = now;
  return { ok: true, events };
}

export function rematch(st, id, now) {
  if (id !== st.hostId) return { ok: false, error: "not_host", events: [] };
  if (st.phase !== "over") return { ok: false, error: "bad_phase", events: [] };
  st.players = st.players.filter((p) => p.connected);
  st.players.forEach((p) => Object.assign(p, { lives: 0, score: 0, streak: 0, words: 0, wrong: 0, alive: true, out: null }));
  Object.assign(st, { phase: "lobby", turnId: null, turnEndsAt: null, q: null, asked: 0, usedIds: [], last: null, ranking: [], overReason: null });
  st.updatedAt = now;
  return { ok: true, events: [{ kind: "rematch" }] };
}

/** 端末に送る状態。答え(answer / answerIndex / full)と出題済みリストは取り除く */
export function publicState(st) {
  const copy = JSON.parse(JSON.stringify(st));
  delete copy.usedIds;
  if (copy.q) {
    const q = copy.q;
    copy.q = q.type === "read"
      ? Object.assign({ type: "read", id: q.id, level: q.level, text: q.text }, q.okuri ? { kanji: q.kanji, okuri: q.okuri } : {})   // 送りがな付きは、漢字の部分と送りがなを見せる(答えは含めない)
      : { type: "write", id: q.id, level: q.level, text: q.text, reading: q.reading, choices: q.choices };
  }
  return copy;
}
