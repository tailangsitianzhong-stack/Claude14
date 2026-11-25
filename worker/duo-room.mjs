/**
 * 二択クイズ・友達対戦の「部屋」の進行ロジック（通信・保存に依存しない純粋な関数）
 *
 * ・進行(出題・採点・制限時間・サバイバル)は js/games/duo/core.js をひとり用と共通で使う
 * ・出題・正解・時間はサーバー(部屋)が持つ。端末へは、答え(priv)と他の人の答えの中身を、答え合わせまで送らない(publicState)
 * ・2〜4人。モードは 10・20・30問 とサバイバル(全員のライフがなくなるまで)
 * ・st.phase は lobby / playing / over、ゲーム中の段階は st.g.phase
 */
import "./shim-window.mjs";
import "../data/duo.js";
import "../data/chem.js";
import "../data/geo.js";
import Questions from "../js/games/duo/questions.js";
import Core from "../js/games/duo/core.js";
import * as L from "./room-logic.mjs";

export { join, disconnect, expired, MAX_PLAYERS, MIN_PLAYERS, GRACE_MS } from "./room-logic.mjs";

export const MODES = Core.MODES;
export const DIFFICULTIES = Core.DIFFICULTIES;
export const SUBJECTS = Core.SUBJECTS;
export const ROUNDS = Core.ROUNDS;

let engine = null;
const E = () => engine || (engine = Core.create(Questions.create({ duo: globalThis.DUO_DATA, chem: globalThis.CHEM_DATA, geo: globalThis.GEO_DATA })));

export function createRoom(code, now) {
  const st = L.createRoom(code, now);
  Object.assign(st, { game: "duo", settings: { mode: "fixed", rounds: 10, difficulty: "normal", subjects: SUBJECTS.slice() }, g: null });
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
    if (ROUNDS.includes(patch.rounds)) s.rounds = patch.rounds;
    if (Array.isArray(patch.subjects)) {
      const subs = SUBJECTS.filter((x) => patch.subjects.includes(x));
      if (subs.length) s.subjects = subs;
    }
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
    mode: s.mode, rounds: s.rounds, difficulty: s.difficulty, subjects: s.subjects, now, rng: rng || Math.random
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
const playing = (st) => {
  if (st.phase !== "playing" || !st.g) return false;
  if (!st.g.away) Object.assign(st.g, { away: [], sit: [], frozenAt: 0 });
  return true;
};

/** 二択のどちらか {i: 0|1} */
export function choose(st, id, m, now) {
  if (!playing(st)) return { ok: false, error: "bad_phase", events: [] };
  const r = E().choose(st.g, id, m && m.i, now);
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

/** 端末に送る状態。正解(priv)・他の人の答えの中身(答え合わせまで)は含めない */
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
