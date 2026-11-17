/**
 * 友達対戦の「部屋」(Cloudflare Durable Object)。部屋コード1つにつき1つ立つ。
 *
 * ・WebSocket Hibernation API を使うので、誰も操作していない間は休止して無料枠をほとんど使わない
 * ・状態は毎回 storage から読み書きする（休止から目覚めても続きができる）
 * ・進行のルールは room-logic.mjs（テスト済み）。ここは通信と保存だけ
 *
 * 端末 → 部屋:  {t:"settings",settings} {t:"start"} {t:"move",reading,english}
 *               {t:"miss",reason,correct} {t:"hint"} {t:"rematch"}  と、生存確認の "ping"
 * 部屋 → 端末:  {t:"state",state,events,now}   {t:"rejected",for,error,reason}   {t:"error",error}
 */
import { DurableObject } from "cloudflare:workers";
import * as L from "./room-logic.mjs";

const MAX_MESSAGE = 2000;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // "ping" には部屋を起こさずに "pong" を返す（接続を保つだけで無料枠を使わない）
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async load() { return (await this.ctx.storage.get("state")) || null; }

  async save(st) {
    await this.ctx.storage.put("state", st);
    await this.ctx.storage.setAlarm(L.nextAlarm(st, Date.now()));
  }

  broadcast(st, events) {
    const msg = JSON.stringify({ t: "state", state: st, events: events || [], now: Date.now() });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch (_) { /* 切れかけの接続は無視 */ }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    // 新しい部屋コードの確保（すでに使われていたら失敗を返す）
    if (request.method === "POST" && url.pathname === "/claim") {
      if (await this.load()) return Response.json({ ok: false });
      await this.save(L.createRoom(url.searchParams.get("code") || "", Date.now()));
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
    await this.save(st);
    this.broadcast(st, res.events);
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
    switch (m.t) {
      case "settings": res = L.setSettings(st, id, m.settings, now); break;
      case "start":    res = L.start(st, id, now); break;
      case "move":     res = L.move(st, id, m, now); break;
      case "miss":     res = L.miss(st, id, m, now); break;
      case "hint":     res = L.hint(st, id, now); break;
      case "rematch":  res = L.rematch(st, id, now); break;
      default: return;
    }
    if (!res.ok) {
      ws.send(JSON.stringify({ t: "rejected", for: m.t, error: res.error || null, reason: res.reason || null }));
      return;
    }
    await this.save(st);
    this.broadcast(st, res.events);
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
    await this.save(st);
    this.broadcast(st, res.events);
  }

  /** 制限時間の判定と、使われなくなった部屋の片づけ */
  async alarm() {
    const st = await this.load();
    if (!st) return;
    const now = Date.now();
    if (st.phase === "playing") {
      const r = L.timeout(st, now);
      if (r.ok) { await this.save(st); this.broadcast(st, r.events); }
      else await this.ctx.storage.setAlarm(L.nextAlarm(st, now));
      return;
    }
    if (L.expired(st, now)) {
      for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, "expired"); } catch (_) {} }
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.setAlarm(L.nextAlarm(st, now));
  }
}
