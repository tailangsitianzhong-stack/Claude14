/**
 * 友達対戦の通信クライアント（部屋の Durable Object に WebSocket でつなぐ）
 *
 *   const net = ShiritoriNet.create({ endpoint, code, cid, onState, onRejected, onError, onStatus });
 *   net.send({ t: "move", reading, english });
 *   net.remainingMs(state)   … 部屋(サーバー)の時計で数えた、制限時間のこり
 *   net.close()
 *
 * ・切れたら自動で再接続する（同じ cid なので、席はそのまま戻れる）
 * ・"ping" を一定間隔で送って、接続を保つ
 * ・部屋が無い/満員/開始済みは onError で知らせて、再接続しない
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShiritoriNet = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PING_MS = 25000;
  const RETRY_MS = [800, 1600, 3200, 5000, 5000, 5000];
  const GRACE_MS = 1500;   // 部屋が制限時間に足している「おまけ」(worker/room-logic.mjs と同じ値)

  function wsUrl(endpoint, code, cid) {
    return endpoint.replace(/\/+$/, "").replace(/^http/, "ws") + "/room/" + code + "?cid=" + encodeURIComponent(cid);
  }

  /** 端末ごとの識別子（再接続で同じ席に戻るために保存する） */
  function makeCid(storage) {
    const KEY = "minigames.shiritori.cid";
    try {
      const saved = storage && storage.getItem(KEY);
      if (saved && /^[A-Za-z0-9_-]{8,48}$/.test(saved)) return saved;
    } catch (_) {}
    const bytes = new Uint8Array(12);
    (typeof crypto !== "undefined" ? crypto : { getRandomValues: (a) => a.forEach((_, i) => { a[i] = Math.random() * 256; }) }).getRandomValues(bytes);
    const cid = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
    try { storage && storage.setItem(KEY, cid); } catch (_) {}
    return cid;
  }

  function create(o) {
    const WS = o.WebSocketImpl || (typeof WebSocket !== "undefined" ? WebSocket : null);
    const handlers = {
      onState: o.onState || (() => {}), onRejected: o.onRejected || (() => {}),
      onError: o.onError || (() => {}), onStatus: o.onStatus || (() => {})
    };
    let ws = null, pingTimer = null, retryTimer = null;
    let tries = 0, everOpened = false, closedByUs = false, fatal = false;
    let offset = 0;                      // サーバー時計 - 端末時計

    function status(s) { handlers.onStatus(s); }

    function connect() {
      status(everOpened ? "reconnecting" : "connecting");
      try { ws = new WS(wsUrl(o.endpoint, o.code, o.cid)); } catch (_) { return failed(); }

      ws.onopen = () => {
        everOpened = true; tries = 0;
        status("open");
        clearInterval(pingTimer);
        pingTimer = setInterval(() => { try { ws.send("ping"); } catch (_) {} }, PING_MS);
      };
      ws.onmessage = (e) => {
        if (e.data === "pong") return;
        let m;
        try { m = JSON.parse(e.data); } catch (_) { return; }
        if (m.t === "state") {
          offset = m.now - Date.now();
          handlers.onState(m.state, m.events || [], m.now);
        } else if (m.t === "rejected") handlers.onRejected(m);
        else if (m.t === "error") { fatal = true; handlers.onError(m.error); }
      };
      ws.onclose = () => { clearInterval(pingTimer); if (!closedByUs && !fatal) failed(); };
      ws.onerror = () => {};
    }

    function failed() {
      if (closedByUs || fatal) return;
      // 一度もつながらないまま失敗 = 部屋が無い / 通信できない
      if (!everOpened && tries >= 1) { fatal = true; handlers.onError("no_room"); status("closed"); return; }
      if (tries >= RETRY_MS.length) { fatal = true; handlers.onError("lost"); status("closed"); return; }
      status("reconnecting");
      retryTimer = setTimeout(connect, RETRY_MS[tries++]);
    }

    connect();

    return {
      send(obj) { try { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; } } catch (_) {} return false; },
      serverNow() { return Date.now() + offset; },
      /** 制限時間のこり(ms)。部屋が足している「おまけ」は引いて見せる */
      remainingMs(state) {
        if (!state || !state.turnEndsAt) return 0;
        // 確認中(pausedAt あり)は、止まった時点の残りのまま動かさない
        const now = state.pausedAt ? state.pausedAt : Date.now() + offset;
        return Math.max(0, state.turnEndsAt - now - GRACE_MS);
      },
      close() {
        closedByUs = true;
        clearInterval(pingTimer); clearTimeout(retryTimer);
        try { ws && ws.close(); } catch (_) {}
      }
    };
  }

  return { create, makeCid, wsUrl, GRACE_MS };
});
