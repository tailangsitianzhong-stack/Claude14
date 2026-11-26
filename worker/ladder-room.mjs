/**
 * 英単語トランスミッション・友達対戦(協力)の「部屋」の進行ロジック（通信・保存に依存しない純粋な関数）
 *
 * ・進行(手番・ギア・ヒント・辞書での判定)は js/games/ladder/core.js をひとり用と共通で使う
 * ・2〜4人が、順番に1語ずつ出して、スタートからゴールまでつなぐ。手番には制限時間がある
 * ・辞書にない単語は AI に確認する。propose() が judge(確認に必要な内容)を返すので、呼び出し側(room-do.mjs)が
 *   worker/ladder-judge.mjs で確認して judged() に結果を渡す(確認中は時間が止まる。待ちすぎたら core.js が「確認できなかった」にする)
 * ・st.phase は lobby / playing / over、ゲーム中の段階は st.g.phase
 */
import "./shim-window.mjs";
import "../data/ladder.js";
import Dict from "../js/games/ladder/dict.js";
import Core from "../js/games/ladder/core.js";
import * as L from "./room-logic.mjs";

export { join, disconnect, expired, MAX_PLAYERS, MIN_PLAYERS, GRACE_MS } from "./room-logic.mjs";

export const LEVELS = Core.LEVELS;
const MAX_WORD = 6;

let tools = null;
const T = () => tools || (tools = (() => { const d = Dict.create(globalThis.LADDER_DATA); return { d, E: Core.create(d) }; })());

export function createRoom(code, now) {
  const st = L.createRoom(code, now);
  Object.assign(st, { game: "ladder", settings: { level: 1 }, g: null, usedPuzzles: [] });
  delete st.turnId; delete st.required; delete st.used; delete st.history; delete st.turnEndsAt; delete st.seconds;
  return st;
}

export function setSettings(st, id, patch, now) {
  if (id !== st.hostId) return { ok: false, error: "not_host", events: [] };
  if (st.phase !== "lobby") return { ok: false, error: "bad_phase", events: [] };
  if (patch && LEVELS.includes(patch.level)) st.settings.level = patch.level;
  st.updatedAt = now;
  return { ok: true, events: [] };
}

/** 開始できる人数: 2〜4人(席の順に並ぶ) */
export function canStart(connected) { return connected >= L.MIN_PLAYERS && connected <= L.MAX_PLAYERS; }

export function start(st, id, now, rng) {
  if (id !== st.hostId) return { ok: false, error: "not_host", events: [] };
  if (st.phase !== "lobby") return { ok: false, error: "bad_phase", events: [] };
  const here = st.players.filter((p) => p.connected);
  if (!canStart(here.length)) return { ok: false, error: "need_players", events: [] };
  st.players = here.sort((a, b) => a.slot - b.slot);
  const level = st.settings.level;
  const puzzle = Core.pickPuzzle(globalThis.LADDER_DATA, level, rng || Math.random, st.usedPuzzles || []);
  if (!puzzle) return { ok: false, error: "no_puzzle", events: [] };
  st.usedPuzzles = (st.usedPuzzles || []).concat(puzzle.id).slice(-40);
  st.g = T().E.newGame({ players: st.players.map((p) => ({ id: p.id, name: p.avatar, avatar: p.avatar })), puzzle, turnSec: Core.TURN_SEC[level], now });
  st.phase = "playing";
  st.ranking = [];
  st.updatedAt = now;
  return { ok: true, events: [{ kind: "started" }] };
}

/** ゲームが終わっていたら部屋も終了にして、順位(手数の多い人から)を入れる */
function sync(st, events) {
  if (st.g && st.g.phase === "over" && st.phase !== "over") {
    st.phase = "over";
    st.ranking = st.g.result.contributions.slice().sort((a, b) => b.moves - a.moves).map((c) => c.id);
  }
  return events.map((e) => Object.assign({ kind: e.type }, e));
}
const bad = (r) => ({ ok: false, error: r.reason, reason: r.reason, events: [] });
const playing = (st) => {
  if (st.phase !== "playing" || !st.g) return false;
  if (!st.g.away) Object.assign(st.g, { away: [], frozenAt: 0 });
  return true;
};

/** 次の単語を出す {word}。辞書にない単語は judge を返す(room-do が AI に確認して judged() を呼ぶ) */
export function propose(st, id, m, now) {
  if (!playing(st)) return { ok: false, error: "bad_phase", events: [] };
  if (!m || typeof m.word !== "string" || m.word.length > MAX_WORD) return { ok: false, error: "bad_message", events: [] };
  const r = T().E.propose(st.g, id, m.word, now);
  if (!r.ok || r.verdict === "rejected") return { ok: false, error: r.reason, reason: r.reason, events: [] };
  st.updatedAt = now;
  const out = { ok: true, events: sync(st, r.events) };
  if (r.verdict === "unsure") out.judge = { word: r.word, pid: id };
  return out;
}

/** AI の判定結果(ok=true/false/null)。確認中でなければ無視する */
export function judged(st, ok, info, now) {
  if (!playing(st)) return { ok: false, error: "bad_phase", events: [] };
  const r = T().E.judged(st.g, ok, info, now);
  if (!r.ok) return bad(r);
  st.updatedAt = now;
  return { ok: true, events: sync(st, r.events) };
}

export function hint(st, id, now) {
  if (!playing(st)) return { ok: false, error: "bad_phase", events: [] };
  const r = T().E.hint(st.g, id, now);
  if (!r.ok) return bad(r);
  st.updatedAt = now;
  return { ok: true, events: sync(st, r.events) };
}

export function undo(st, id, now) {
  if (!playing(st)) return { ok: false, error: "bad_phase", events: [] };
  const r = T().E.undo(st.g, id, now);
  if (!r.ok) return bad(r);
  st.updatedAt = now;
  return { ok: true, events: sync(st, r.events) };
}

/** アラームから: 時間が来ていれば進める。まだなら ok:false */
export function timeout(st, now) {
  if (!playing(st)) return { ok: false, events: [] };
  const ev = T().E.tick(st.g, now);
  if (!ev.length) return { ok: false, events: [] };
  st.updatedAt = now;
  return { ok: true, events: sync(st, ev) };
}

/** 通信が切れた(ゲーム中)。手番なら飛ばす */
export function left(st, id, now) {
  if (!playing(st)) return { ok: false, events: [] };
  const ev = T().E.leave(st.g, id, now);
  st.updatedAt = now;
  return { ok: true, events: sync(st, ev) };
}

export function returned(st, id, now) {
  if (!playing(st)) return { ok: false, events: [] };
  const ev = T().E.back(st.g, id, now);
  st.updatedAt = now;
  return { ok: true, events: sync(st, ev) };
}

export function rematch(st, id, now) {
  if (id !== st.hostId) return { ok: false, error: "not_host", events: [] };
  if (st.phase !== "over") return { ok: false, error: "bad_phase", events: [] };
  st.players = st.players.filter((p) => p.connected);
  st.g = null; st.phase = "lobby"; st.ranking = [];
  st.updatedAt = now;
  return { ok: true, events: [{ kind: "rematch" }] };
}

export function nextAlarm(st, now) {
  if (playing(st)) { const d = T().E.nextDeadline(st.g); if (d) return d; }
  return L.nextAlarm(Object.assign({}, st, { phase: st.phase === "playing" ? "over" : st.phase }), now);
}

/** 端末に送る状態(隠す情報はない。協力ゲームなので、みんなが同じ盤面を見る) */
export function publicState(st) {
  const copy = JSON.parse(JSON.stringify({ code: st.code, phase: st.phase, hostId: st.hostId, settings: st.settings, ranking: st.ranking, players: st.players, game: st.game }));
  if (st.g) {
    const g = T().E.view(st.g);
    const byId = new Map(g.players.map((p) => [p.id, p]));
    copy.players = copy.players.map((p) => Object.assign(p, byId.get(p.id) || {}, { avatar: p.avatar }));
    delete g.players;
    copy.g = g;
  } else copy.g = null;
  return copy;
}
