/**
 * 地理クイズ・友達対戦の「部屋」の進行ロジック（通信・保存に依存しない純粋な関数）
 *
 * ・進行(出題・採点・制限時間・早押し・地図・資料選択)は js/games/geo/core.js をひとり用と共通で使う
 * ・出題・正解・時間はサーバー(部屋)が持つ。端末へは、答え(priv)と他の人の答えの中身を、ラウンドが終わるまで送らない(publicState)
 * ・早押しで辞書に合わない答えは AI に確認する。answer() が judge(確認に必要な内容)を返すので、呼び出し側(room-do.mjs)が
 *   worker/geo-judge.mjs で確認して judged() に結果を渡す(確認中は時間が止まる。待ちすぎたら core.js がまちがい扱いにする)
 * ・入室・退室・ホスト・席などは room-logic.mjs と共通。st.phase は lobby / playing / over、ゲーム中の段階は st.g.phase
 */
import "./shim-window.mjs";
import "../data/geo.js";
import Questions from "../js/games/geo/questions.js";
import Core from "../js/games/geo/core.js";
import * as L from "./room-logic.mjs";

export { join, disconnect, expired, MAX_PLAYERS, MIN_PLAYERS, GRACE_MS } from "./room-logic.mjs";

export const MODES = Core.MODES;
export const DIFFICULTIES = Core.DIFFICULTIES;
export const ROUNDS = Core.ROUNDS;
export const SCOPES = Questions.SCOPES;
export const GRADES = Questions.GRADES;
const MAX_TEXT = 40;

let engine = null;
const E = () => engine || (engine = Core.create(Questions.create(globalThis.GEO_DATA)));

export function createRoom(code, now) {
  const st = L.createRoom(code, now);
  Object.assign(st, { game: "geo", settings: { mode: "choice", difficulty: "normal", scope: "both", grade: "all", rounds: 10 }, g: null });
  delete st.turnId; delete st.required; delete st.used; delete st.history; delete st.turnEndsAt; delete st.seconds;
  return st;
}

export function setSettings(st, id, patch, now) {
  if (id !== st.hostId) return { ok: false, error: "not_host", events: [] };
  if (st.phase !== "lobby") return { ok: false, error: "bad_phase", events: [] };
  const s = st.settings;
  if (patch) {
    if (MODES.includes(patch.mode)) s.mode = patch.mode;
    if (DIFFICULTIES.includes(patch.difficulty)) s.difficulty = patch.difficulty;
    if (SCOPES.includes(patch.scope)) s.scope = patch.scope;
    if (GRADES.includes(patch.grade)) s.grade = patch.grade;
    if (ROUNDS.includes(patch.rounds)) s.rounds = patch.rounds;
  }
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
  const s = st.settings;
  st.g = E().newGame({
    players: st.players.map((p) => ({ id: p.id, name: p.avatar, avatar: p.avatar })),
    mode: s.mode, difficulty: s.difficulty, scope: s.scope, grade: s.grade, rounds: s.rounds, now, rng: rng || Math.random
  });
  st.phase = "playing";
  st.ranking = [];
  st.updatedAt = now;
  return { ok: true, events: [{ kind: "started" }] };
}

/** ゲームが終わっていたら部屋も終了にして、順位を入れる */
function sync(st, events) {
  if (st.g && st.g.phase === "over" && st.phase !== "over") {
    st.phase = "over";
    st.ranking = st.g.result.ranking.map((r) => r.id);
  }
  return events.map((e) => Object.assign({ kind: e.type }, e));
}
const bad = (r) => ({ ok: false, error: r.reason, reason: r.reason, events: [] });
/** 進行中の部屋か。古い形式の状態(切れた人の記録がない)なら、空の記録を足す */
const playing = (st) => {
  if (st.phase !== "playing" || !st.g) return false;
  if (!st.g.away) Object.assign(st.g, { away: [], sit: [], frozenAt: 0 });
  return true;
};

export function choose(st, id, m, now) {
  if (!playing(st)) return { ok: false, error: "bad_phase", events: [] };
  const r = E().choose(st.g, id, m && m.i, now);
  if (!r.ok) return bad(r);
  st.updatedAt = now;
  return { ok: true, events: sync(st, r.events) };
}

export function lock(st, id, m, now) {
  if (!playing(st)) return { ok: false, error: "bad_phase", events: [] };
  const r = E().lock(st.g, id, m && m.id, now);
  if (!r.ok) return bad(r);
  st.updatedAt = now;
  return { ok: true, events: sync(st, r.events) };
}

export function press(st, id, now) {
  if (!playing(st)) return { ok: false, error: "bad_phase", events: [] };
  const r = E().press(st.g, id, now);
  if (!r.ok) return bad(r);
  st.updatedAt = now;
  return { ok: true, events: sync(st, r.events) };
}

/** 早押しの答え {text}。辞書に合わなければ judge(AIに聞く内容)を返す */
export function answer(st, id, m, now) {
  if (!playing(st)) return { ok: false, error: "bad_phase", events: [] };
  if (!m || typeof m.text !== "string" || m.text.length > MAX_TEXT) return { ok: false, error: "bad_message", events: [] };
  const r = E().answer(st.g, id, m.text, now);
  if (!r.ok) {
    // 時間切れで状態が変わった場合は、そのまま反映する
    if (r.reason === "timeout" && r.events.length) { st.updatedAt = now; return { ok: true, events: sync(st, r.events) }; }
    return bad(r);
  }
  st.updatedAt = now;
  const out = { ok: true, events: sync(st, r.events) };
  if (r.verdict === "unsure") out.judge = { question: st.g.q.text, answer: st.g.priv.ans, yomi: st.g.priv.yomi, input: r.text, pid: id };
  return out;
}

/** AI の判定結果(ok=true で正解)。確認中でなければ無視する */
export function judged(st, id, ok, now) {
  if (!playing(st)) return { ok: false, error: "bad_phase", events: [] };
  const r = E().judged(st.g, id, ok, now);
  if (!r.ok) return bad(r);
  st.updatedAt = now;
  return { ok: true, events: sync(st, r.events) };
}

/** アラームから: 時間が来ていれば進める。まだなら ok:false */
export function timeout(st, now, rng) {
  if (!playing(st)) return { ok: false, events: [] };
  const ev = E().tick(st.g, now, rng || Math.random);
  if (!ev.length) return { ok: false, events: [] };
  st.updatedAt = now;
  return { ok: true, events: sync(st, ev) };
}

/** 通信が切れた(ゲーム中)。待たずに進める。戻ってもいまの問題は答えられない */
export function left(st, id, now) {
  if (!playing(st)) return { ok: false, events: [] };
  const ev = E().leave(st.g, id, now);
  st.updatedAt = now;
  return { ok: true, events: sync(st, ev) };
}

/** 戻った(ゲーム中) */
export function returned(st, id, now) {
  if (!playing(st)) return { ok: false, events: [] };
  const ev = E().back(st.g, id, now);
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
  if (playing(st)) { const d = E().nextDeadline(st.g); if (d) return d; }
  return L.nextAlarm(Object.assign({}, st, { phase: st.phase === "playing" ? "over" : st.phase }), now);
}

/** 端末に送る状態。正解(priv)・他の人の答えの中身(ラウンドが終わるまで)は含めない */
export function publicState(st) {
  const copy = JSON.parse(JSON.stringify({ code: st.code, phase: st.phase, hostId: st.hostId, settings: st.settings, ranking: st.ranking, players: st.players, game: st.game }));
  if (st.g) {
    const g = E().view(st.g);
    const byId = new Map(g.players.map((p) => [p.id, p]));
    copy.players = copy.players.map((p) => Object.assign(p, byId.get(p.id) || {}, { avatar: p.avatar }));
    delete g.players;
    copy.g = JSON.parse(JSON.stringify(g));
  } else copy.g = null;
  return copy;
}
