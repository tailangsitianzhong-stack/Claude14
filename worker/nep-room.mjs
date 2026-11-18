/**
 * ミニネプリーグ(英語)・友達対戦の「部屋」の進行ロジック（通信・保存に依存しない純粋な関数）
 *
 * ・ゲームの進行(爆弾・お題・ライフ・解除/爆発)は js/games/nep/core.js をひとり用と共通で使う
 * ・出題・採点・導火線の時間は部屋(サーバー)が持つ。答えの一覧(topic)は端末に送らない(publicState)
 * ・入室・退室・ホスト・席などは room-logic.mjs と共通
 * ・st.phase は lobby / playing / over。ゲーム中の細かい段階は st.g.phase(between=次のラウンド待ち / play / over)
 */
import "./shim-window.mjs";
import "../data/nep.js";
import Words from "../js/games/nep/words.js";
import Topics from "../js/games/nep/topics.js";
import Core from "../js/games/nep/core.js";
import * as L from "./room-logic.mjs";

export { join, disconnect, expired, MAX_PLAYERS, MIN_PLAYERS, GRACE_MS } from "./room-logic.mjs";

export const DIFFICULTIES = Core.DIFFICULTIES;
const MAX_WORD = 40;

let engine = null;
const E = () => engine || (engine = Core.create(Topics.create(Words.create(globalThis.NEP_DATA), globalThis.NEP_DATA)));

export function createRoom(code, now) {
  const st = L.createRoom(code, now);
  Object.assign(st, { game: "nep", settings: { difficulty: "normal" }, g: null });
  delete st.turnId; delete st.required; delete st.used; delete st.history; delete st.turnEndsAt; delete st.seconds;
  return st;
}

export function setSettings(st, id, patch, now) {
  if (id !== st.hostId) return { ok: false, error: "not_host", events: [] };
  if (st.phase !== "lobby") return { ok: false, error: "bad_phase", events: [] };
  if (patch && DIFFICULTIES.includes(patch.difficulty)) st.settings.difficulty = patch.difficulty;
  st.updatedAt = now;
  return { ok: true, events: [] };
}

export function start(st, id, now, rng) {
  if (id !== st.hostId) return { ok: false, error: "not_host", events: [] };
  if (st.phase !== "lobby") return { ok: false, error: "bad_phase", events: [] };
  if (st.players.filter((p) => p.connected).length < L.MIN_PLAYERS) return { ok: false, error: "need_players", events: [] };
  st.players = st.players.filter((p) => p.connected);
  st.g = E().newGame({
    players: st.players.map((p) => ({ id: p.id, name: p.avatar, avatar: p.avatar })),
    difficulty: st.settings.difficulty, now, rng: rng || Math.random
  });
  st.phase = "playing";
  st.ranking = [];
  st.updatedAt = now;
  return { ok: true, events: [{ kind: "started", playerId: st.g.starterId }] };
}

/** ゲームが終わっていたら部屋も終了にして、順位を入れる */
function sync(st, events) {
  if (st.g && st.g.phase === "over" && st.phase !== "over") {
    st.phase = "over";
    st.ranking = st.g.result.ranking.map((r) => r.id);
  }
  return events.map((e) => Object.assign({ kind: e.type }, e));
}

/** 持っている人の答え {word} */
export function answer(st, id, m, now, rng) {
  if (st.phase !== "playing" || !st.g) return { ok: false, error: "bad_phase", events: [] };
  if (!m || typeof m.word !== "string" || m.word.length > MAX_WORD) return { ok: false, error: "bad_message", events: [] };
  const r = E().answer(st.g, id, m.word, now, rng || Math.random);
  if (!r.ok) {
    // 時間切れで爆発した場合は状態が変わっている。それ以外(まちがい)は本人にだけ理由を返す
    if (r.reason === "timeout" && r.events.length) { st.updatedAt = now; return { ok: true, events: sync(st, r.events) }; }
    return { ok: false, error: r.reason, reason: r.reason, base: r.base || null, word: r.word || null, events: [] };
  }
  st.updatedAt = now;
  return { ok: true, events: sync(st, r.events) };
}

/** アラームから: 導火線が切れた / 次のラウンドの時間。まだなら ok:false */
export function timeout(st, now, rng) {
  if (st.phase !== "playing" || !st.g) return { ok: false, events: [] };
  const ev = E().tick(st.g, now, rng || Math.random);
  if (!ev.length) return { ok: false, events: [] };
  st.updatedAt = now;
  return { ok: true, events: sync(st, ev) };
}

export function rematch(st, id, now) {
  if (id !== st.hostId) return { ok: false, error: "not_host", events: [] };
  if (st.phase !== "over") return { ok: false, error: "bad_phase", events: [] };
  st.players = st.players.filter((p) => p.connected);
  st.g = null;
  st.phase = "lobby";
  st.ranking = [];
  st.updatedAt = now;
  return { ok: true, events: [{ kind: "rematch" }] };
}

/** 次にアラームを鳴らす時刻(ms)。ゲーム中は導火線/次のラウンド、それ以外は片づけ */
export function nextAlarm(st, now) {
  if (st.phase === "playing" && st.g) {
    const d = E().nextDeadline(st.g);
    if (d) return d;
  }
  return L.nextAlarm(Object.assign({}, st, { phase: st.phase === "playing" ? "over" : st.phase }), now);
}

/** 端末に送る状態。お題の答えの一覧(topic)は取り除き、今の問題(prompt)だけを送る */
export function publicState(st) {
  const copy = JSON.parse(JSON.stringify({ code: st.code, phase: st.phase, hostId: st.hostId, settings: st.settings, ranking: st.ranking, players: st.players, game: st.game }));
  if (st.g) {
    const g = E().view(st.g);
    const byId = new Map(g.players.map((p) => [p.id, p]));
    copy.players = copy.players.map((p) => Object.assign(p, byId.get(p.id) || {}, { avatar: p.avatar }));
    delete g.players;
    copy.g = JSON.parse(JSON.stringify(g));
  } else {
    copy.g = null;
  }
  return copy;
}
