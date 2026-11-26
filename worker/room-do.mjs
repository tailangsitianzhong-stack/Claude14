/**
 * 友達対戦の「部屋」(Cloudflare Durable Object)。部屋コード1つにつき1つ立つ。
 *
 * ・WebSocket Hibernation API を使うので、誰も操作していない間は休止して無料枠をほとんど使わない
 * ・状態は毎回 storage から読み書きする（休止から目覚めても続きができる）
 * ・進行のルールは room-logic.mjs（テスト済み）。ここは通信と保存だけ
 *
 * 端末 → 部屋:  {t:"settings",settings} {t:"start"} {t:"rematch"}  と、生存確認の "ping"
 *               しりとり: {t:"move",reading,english} {t:"miss",reason,correct} {t:"hint"}
 *                         {t:"judging"}(Geminiで確認中=時間を止める) {t:"resume"}(確認が終わった)
 *               漢字検定: {t:"answer",reading} / {t:"answer",choice}（部屋が出題・採点する。答えは端末に送らない）
 *               地理クイズ: {t:"choose",i} {t:"lock",id} {t:"press"} {t:"answer",text}（辞書に合わない答えは AI に確認する）
 *               ミニネプリーグ: {t:"answer",word} {t:"hint"}（お題・導火線・採点は部屋が持つ。答えの一覧は端末に送らない）
 * 部屋 → 端末:  {t:"state",state,events,now}   {t:"rejected",for,error,reason}   {t:"error",error}
 */
import { DurableObject } from "cloudflare:workers";
import * as L from "./room-logic.mjs";
import * as K from "./kanken-room.mjs";
import * as N from "./nep-room.mjs";
import * as G from "./geo-room.mjs";
import * as C from "./chem-room.mjs";
import * as D from "./duo-room.mjs";
import * as LD from "./ladder-room.mjs";
import { judge as geoJudge } from "./geo-judge.mjs";
import { judge as chemJudge } from "./chem-judge.mjs";
import { judge as ladderJudge } from "./ladder-judge.mjs";

const MAX_MESSAGE = 2000;

/** 次にアラームを鳴らす時刻(生の値)。ミニネプリーグは導火線/次のラウンドの時刻、ほかは制限時間 */
const rawAlarmOf = (st, now) => (st.game === "ladder" ? LD.nextAlarm(st, now) : st.game === "duo" ? D.nextAlarm(st, now) : st.game === "nep" ? N.nextAlarm(st, now) : st.game === "geo" ? G.nextAlarm(st, now) : st.game === "chem" ? C.nextAlarm(st, now) : L.nextAlarm(st, now));
const nextAlarmOf = (st, now) => L.safeAlarm(st, now, rawAlarmOf(st, now));

/** ゲーム中に通信が切れた / 戻ったときの進め方(待たずに進める。戻ってもその問題の解答権はない) */
const onLeft = (st, id, now) => (st.game === "ladder" ? LD.left(st, id, now) : st.game === "duo" ? D.left(st, id, now) : st.game === "chem" ? C.left(st, id, now) : st.game === "geo" ? G.left(st, id, now) : st.game === "nep" ? N.left(st, id, now) : st.game === "kanken" ? K.left(st, id, now) : L.left(st, id, now));
const onReturned = (st, id, now) => (st.game === "ladder" ? LD.returned(st, id, now) : st.game === "duo" ? D.returned(st, id, now) : st.game === "chem" ? C.returned(st, id, now) : st.game === "geo" ? G.returned(st, id, now) : st.game === "nep" ? N.returned(st, id, now) : st.game === "kanken" ? K.returned(st, id, now) : L.returned(st, id, now));

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // "ping" には部屋を起こさずに "pong" を返す（接続を保つだけで無料枠を使わない）
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async load() {
    const st = (await this.ctx.storage.get("state")) || null;
    if (st && st.game === "nep" && N.migrate(st)) await this.ctx.storage.put("state", st);   // 古い形式の部屋は、ロビーに戻す
    return st;
  }

  async save(st) {
    await this.ctx.storage.put("state", st);
    await this.ctx.storage.setAlarm(nextAlarmOf(st, Date.now()));
  }

  broadcast(st, events) {
    // 漢字検定・ネプリーグの部屋は、答えを取り除いた状態だけを端末に送る
    const view = st.game === "ladder" ? LD.publicState(st) : st.game === "duo" ? D.publicState(st) : st.game === "kanken" ? K.publicState(st) : st.game === "nep" ? N.publicState(st) : st.game === "geo" ? G.publicState(st) : st.game === "chem" ? C.publicState(st) : st;
    const msg = JSON.stringify({ t: "state", state: view, events: events || [], now: Date.now() });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch (_) { /* 切れかけの接続は無視 */ }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    // 新しい部屋コードの確保（すでに使われていたら失敗を返す）
    if (request.method === "POST" && url.pathname === "/claim") {
      if (await this.load()) return Response.json({ ok: false });
      const code = url.searchParams.get("code") || "";
      const game = url.searchParams.get("game");
      const room = game === "ladder" ? LD.createRoom(code, Date.now()) : game === "duo" ? D.createRoom(code, Date.now()) : game === "kanken" ? K.createRoom(code, Date.now()) : game === "nep" ? N.createRoom(code, Date.now()) : game === "geo" ? G.createRoom(code, Date.now()) : game === "chem" ? C.createRoom(code, Date.now()) : L.createRoom(code, Date.now());
      await this.save(room);
      return Response.json({ ok: true });
    }

    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const st = await this.load();
    if (!st) return new Response("no_room", { status: 404 });
    const cid = url.searchParams.get("cid") || "";
    if (!/^[A-Za-z0-9_-]{8,48}$/.test(cid)) return new Response("bad_cid", { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [cid]);

    const res = L.join(st, cid, Date.now());
    if (!res.ok) {                          // 満員・開始済み: 理由を伝えて閉じる
      server.send(JSON.stringify({ t: "error", error: res.error }));
      server.close(1000, res.error);
      return new Response(null, { status: 101, webSocket: client });
    }
    const events = res.events.slice();
    if (events.some((e) => e.kind === "reconnected")) {            // ゲーム中に戻ってきた
      const back = onReturned(st, cid, Date.now());
      if (back.ok) events.push(...back.events);
    }
    await this.save(st);
    this.broadcast(st, events);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > MAX_MESSAGE) return;
    let m;
    try { m = JSON.parse(message); } catch (_) { return; }
    if (!m || typeof m.t !== "string") return;

    const id = this.ctx.getTags(ws)[0];
    const st = await this.load();
    if (!st || !id) return;
    const now = Date.now();

    let res;
    if (st.game === "ladder") {
      switch (m.t) {
        case "settings": res = LD.setSettings(st, id, m.settings, now); break;
        case "start":    res = LD.start(st, id, now); break;
        case "propose":  res = LD.propose(st, id, m, now); break;
        case "hint":     res = LD.hint(st, id, now); break;
        case "undo":     res = LD.undo(st, id, now); break;
        case "rematch":  res = LD.rematch(st, id, now); break;
        default: return;
      }
    } else if (st.game === "duo") {
      switch (m.t) {
        case "settings": res = D.setSettings(st, id, m.settings, now); break;
        case "start":    res = D.start(st, id, now); break;
        case "choose":   res = D.choose(st, id, m, now); break;
        case "rematch":  res = D.rematch(st, id, now); break;
        default: return;
      }
    } else if (st.game === "chem") {
      switch (m.t) {
        case "settings": res = C.setSettings(st, id, m.settings, now); break;
        case "start":    res = C.start(st, id, now); break;
        case "choose":   res = C.choose(st, id, m, now); break;
        case "calc":     res = C.calc(st, id, m, now); break;
        case "press":    res = C.press(st, id, now); break;
        case "answer":   res = C.answer(st, id, m, now); break;
        case "rematch":  res = C.rematch(st, id, now); break;
        default: return;
      }
    } else if (st.game === "geo") {
      switch (m.t) {
        case "settings": res = G.setSettings(st, id, m.settings, now); break;
        case "start":    res = G.start(st, id, now); break;
        case "choose":   res = G.choose(st, id, m, now); break;
        case "lock":     res = G.lock(st, id, m, now); break;
        case "press":    res = G.press(st, id, now); break;
        case "answer":   res = G.answer(st, id, m, now); break;
        case "rematch":  res = G.rematch(st, id, now); break;
        default: return;
      }
    } else if (st.game === "nep") {
      switch (m.t) {
        case "settings": res = N.setSettings(st, id, m.settings, now); break;
        case "start":    res = N.start(st, id, now); break;
        case "answer":   res = N.answer(st, id, m, now); break;
        case "hint":     res = N.hint(st, id, now); break;
        case "rematch":  res = N.rematch(st, id, now); break;
        default: return;
      }
    } else if (st.game === "kanken") {
      switch (m.t) {
        case "settings": res = K.setSettings(st, id, m.settings, now); break;
        case "start":    res = K.start(st, id, now); break;
        case "answer":   res = K.answer(st, id, m, now); break;
        case "rematch":  res = K.rematch(st, id, now); break;
        default: return;
      }
    } else {
      switch (m.t) {
        case "settings": res = L.setSettings(st, id, m.settings, now); break;
        case "start":    res = L.start(st, id, now); break;
        case "move":     res = L.move(st, id, m, now); break;
        case "miss":     res = L.miss(st, id, m, now); break;
        case "hint":     res = L.hint(st, id, now); break;
        case "judging":  res = L.judging(st, id, now); break;     // Geminiで確認中: 時間を止める
        case "resume":   res = L.resume(st, id, now); break;
        case "rematch":  res = L.rematch(st, id, now); break;
        default: return;
      }
    }
    if (!res.ok) {
      ws.send(JSON.stringify({ t: "rejected", for: m.t, error: res.error || null, reason: res.reason || null, base: res.base || null, word: res.word || null }));
      return;
    }
    await this.save(st);
    this.broadcast(st, res.events);
    if (res.judge) await (st.game === "ladder" ? this.judgeLadder(res.judge) : st.game === "chem" ? this.judgeChem(res.judge) : this.judgeGeo(res.judge));        // 早押しの答えを AI に確認する(確認中は時間が止まっている)
  }

  /** 地理クイズ: 辞書に合わなかった答えを AI に聞き、結果を反映する。待っている間に状態が変わっていたら無視される */
  async judgeGeo(j) {
    let ok = false;
    try { ok = (await geoJudge(this.env, { question: j.question, answer: j.answer, yomi: j.yomi, input: j.input })).ok === true; } catch (_) { ok = false; }
    const st = await this.load();
    if (!st || st.game !== "geo") return;
    const r = G.judged(st, j.pid, ok, Date.now());
    if (!r.ok) return;
    await this.save(st);
    this.broadcast(st, r.events);
  }

  /** 英単語トランスミッション: 辞書にない単語を AI に聞き、結果(認める/認めない/確認できなかった)を反映する。確認できなかったときは、ギアを減らさない */
  async judgeLadder(j) {
    let r = null;
    try { r = await ladderJudge(this.env, { word: j.word }); } catch (_) { r = null; }
    const st = await this.load();
    if (!st || st.game !== "ladder") return;
    const res = LD.judged(st, r && r.ok === true ? true : r && r.ok === false ? false : null, r, Date.now());
    if (!res.ok) return;
    await this.save(st);
    this.broadcast(st, res.events);
  }

  /** 化学クイズ: 辞書に合わなかった答えを AI に聞き、結果を反映する */
  async judgeChem(j) {
    let ok = false;
    try { ok = (await chemJudge(this.env, { question: j.question, answer: j.answer, yomi: j.yomi, forms: j.forms, input: j.input })).ok === true; } catch (_) { ok = false; }
    const st = await this.load();
    if (!st || st.game !== "chem") return;
    const r = C.judged(st, j.pid, ok, Date.now());
    if (!r.ok) return;
    await this.save(st);
    this.broadcast(st, r.events);
  }

  async webSocketClose(ws) { await this.dropped(ws); }
  async webSocketError(ws) { await this.dropped(ws); }

  async dropped(ws) {
    try { ws.close(1000, "bye"); } catch (_) {}
    const id = this.ctx.getTags(ws)[0];
    if (!id) return;
    // 同じ人が再接続していて別の接続が残っているなら、切断扱いにしない
    if (this.ctx.getWebSockets(id).some((s) => s !== ws && s.readyState === 1)) return;
    const st = await this.load();
    if (!st) return;
    const res = L.disconnect(st, id, Date.now());
    const events = res.events.slice();
    const gone = onLeft(st, id, Date.now());                       // 待たずに進める
    if (gone.ok) events.push(...gone.events);
    await this.save(st);
    this.broadcast(st, events);
  }

  /** 制限時間の判定と、使われなくなった部屋の片づけ */
  async alarm() {
    const st = await this.load();
    if (!st) return;
    const now = Date.now();
    if (st.phase === "playing") {
      const r = st.game === "ladder" ? LD.timeout(st, now) : st.game === "duo" ? D.timeout(st, now) : st.game === "kanken" ? K.timeout(st, now) : st.game === "nep" ? N.timeout(st, now) : st.game === "geo" ? G.timeout(st, now) : st.game === "chem" ? C.timeout(st, now) : L.timeout(st, now);
      if (r.ok) { await this.save(st); this.broadcast(st, r.events); }
      else if (L.abandoned(st, now)) {                       // だれも戻らないまま長く経った部屋は片づける
        for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, "expired"); } catch (_) {} }
        await this.ctx.storage.deleteAll();
      } else await this.ctx.storage.setAlarm(nextAlarmOf(st, now));
      return;
    }
    if (L.expired(st, now)) {
      for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, "expired"); } catch (_) {} }
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.setAlarm(nextAlarmOf(st, now));
  }
}
