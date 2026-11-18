const test = require("node:test");
const assert = require("node:assert/strict");
const Net = require("../js/games/shiritori/net.js");

/** 偽の WebSocket。テストから接続・受信・切断を操作できる */
function fakeWS() {
  const all = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; all.push(this); }
    send(d) { this.sent.push(d); }
    close() { this.readyState = 3; this.onclose && this.onclose({}); }
    // --- テスト用 ---
    open() { this.readyState = 1; this.onopen && this.onopen(); }
    recv(obj) { this.onmessage && this.onmessage({ data: typeof obj === "string" ? obj : JSON.stringify(obj) }); }
    drop() { this.readyState = 3; this.onclose && this.onclose({}); }
  }
  return { FakeWS, all };
}

test("URLは http→ws、https→wss。cid は付く", () => {
  assert.equal(Net.wsUrl("https://w.example/", "12345", "abc"), "wss://w.example/room/12345?cid=abc");
  assert.equal(Net.wsUrl("http://127.0.0.1:8787", "12345", "a b"), "ws://127.0.0.1:8787/room/12345?cid=a%20b");
});

test("端末ID: 保存して、次回も同じものを使う", () => {
  const mem = {};
  const st = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  const a = Net.makeCid(st);
  assert.match(a, /^[A-Za-z0-9_-]{8,48}$/);
  assert.equal(Net.makeCid(st), a);
  assert.match(Net.makeCid(null), /^[A-Za-z0-9_-]{8,48}$/);          // 保存先が使えなくても動く
});

test("受信: state を通知し、サーバー時計との差から残り時間を出す", () => {
  const { FakeWS, all } = fakeWS();
  const got = []; const status = [];
  const net = Net.create({ endpoint: "https://w.example", code: "12345", cid: "cid-12345", WebSocketImpl: FakeWS,
    onState: (s, ev) => got.push([s, ev]), onStatus: (s) => status.push(s) });
  const ws = all[0];
  ws.open();
  assert.deepEqual(status, ["connecting", "open"]);
  const serverNow = Date.now() + 5000;                                   // サーバーの時計は端末より5秒進んでいる
  ws.recv({ t: "state", state: { turnEndsAt: serverNow + 10_000 }, events: [{ kind: "x" }], now: serverNow });
  assert.equal(got.length, 1);
  assert.deepEqual(got[0][1], [{ kind: "x" }]);
  const rem = net.remainingMs({ turnEndsAt: serverNow + 10_000 });
  assert.ok(rem > 8000 && rem <= 10_000 - Net.GRACE_MS + 50, `remaining ${rem}`);   // おまけ分を引いた表示
  assert.equal(net.remainingMs(null), 0);
  ws.recv("pong");                                                        // pong は無視
  assert.equal(got.length, 1);
  net.close();
});

test("送信: つながっている時だけ送れる", () => {
  const { FakeWS, all } = fakeWS();
  const net = Net.create({ endpoint: "https://w.example", code: "12345", cid: "cid-12345", WebSocketImpl: FakeWS });
  assert.equal(net.send({ t: "start" }), false);                          // まだ接続中
  all[0].open();
  assert.equal(net.send({ t: "start" }), true);
  assert.deepEqual(JSON.parse(all[0].sent[0]), { t: "start" });
  net.close();
});

test("rejected / error の通知。満員などは再接続しない", () => {
  const { FakeWS, all } = fakeWS();
  const rej = [], errs = [];
  Net.create({ endpoint: "https://w.example", code: "12345", cid: "cid-12345", WebSocketImpl: FakeWS,
    onRejected: (m) => rej.push(m), onError: (e) => errs.push(e) });
  all[0].open();
  all[0].recv({ t: "rejected", for: "move", error: "not_your_turn" });
  assert.equal(rej[0].error, "not_your_turn");
  all[0].recv({ t: "error", error: "full" });
  all[0].drop();
  assert.deepEqual(errs, ["full"]);
  assert.equal(all.length, 1);                                            // 再接続していない
});

test("接続が切れたら自動で再接続する。一度もつながらなければ「部屋なし」", async () => {
  const { FakeWS, all } = fakeWS();
  const status = [], errs = [];
  const net = Net.create({ endpoint: "https://w.example", code: "12345", cid: "cid-12345", WebSocketImpl: FakeWS,
    onStatus: (s) => status.push(s), onError: (e) => errs.push(e) });
  all[0].open();
  all[0].drop();                                                          // 途中で切れた
  assert.equal(status.at(-1), "reconnecting");
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(all.length, 2);                                            // 再接続した
  all[1].open();
  assert.equal(status.at(-1), "open");
  net.close();

  // 一度もつながらないケース(部屋が無い等)
  const f = fakeWS();
  const errs2 = [];
  Net.create({ endpoint: "https://w.example", code: "99999", cid: "cid-12345", WebSocketImpl: f.FakeWS, onError: (e) => errs2.push(e) });
  f.all[0].drop();                                                        // 1回目: 再試行
  await new Promise((r) => setTimeout(r, 900));
  f.all[1].drop();                                                        // 2回目も失敗 → 部屋なし
  assert.deepEqual(errs2, ["no_room"]);
});

test("自分で閉じたら再接続しない", async () => {
  const { FakeWS, all } = fakeWS();
  const net = Net.create({ endpoint: "https://w.example", code: "12345", cid: "cid-12345", WebSocketImpl: FakeWS });
  all[0].open();
  net.close();
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(all.length, 1);
});

test("確認中(pausedAt)は、残り時間が止まった時点のまま動かない", () => {
  const { FakeWS, all } = fakeWS();
  const net = Net.create({ endpoint: "https://w.example", code: "12345", cid: "cid-12345", WebSocketImpl: FakeWS });
  all[0].open();
  const now = Date.now();
  all[0].recv({ t: "state", state: { turnEndsAt: now + 20_000 }, events: [], now });
  const running = net.remainingMs({ turnEndsAt: now + 20_000 });
  const frozen = net.remainingMs({ turnEndsAt: now + 20_000, pausedAt: now + 0 });
  assert.ok(running <= 20_000 - Net.GRACE_MS && running > 17_000);
  assert.equal(frozen, 20_000 - Net.GRACE_MS);                              // 止まった時刻(now)を基準にするので減らない
  const later = net.remainingMs({ turnEndsAt: now + 20_000, pausedAt: now });
  assert.equal(later, frozen);
  net.close();
});
