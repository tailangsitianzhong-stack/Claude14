/**
 * 友達対戦の画面（最大4人・5桁の部屋番号・QRコードで参加）
 *
 *   const online = ShiritoriOnline.create(ctx);
 *   online.showFriends();        // 「部屋を作る / 部屋に入る」
 *   online.enter("12345");       // その部屋に直接入る(QRコード・リンクから来た時)
 *   online.teardown();
 *
 * ctx: { view, endpoint, store, getJudge(), goMenu(), setPlaying(bool) }
 *   game  : "shiritori"(既定) | "kanken"。部屋を作る時にサーバーへ伝える
 *   hooks : 他のゲーム(漢字検定)が、ロビーの設定欄・対戦画面・結果画面を差し替えるための関数(js/games/kanken/online.js)
 *   help  : 入口画面の説明文(「漢字{よみ}」の書き方で、ふりがな付き)
 * 判定(辞書/Gemini)は「答える人の端末」で行い、通った手だけを部屋(サーバー)へ送る。
 * 順番・制限時間・ライフ・得点は部屋が管理する（worker/room-logic.mjs）。
 */
(function (root) {
  "use strict";

  const Rules = root.ShiritoriRules;
  const Input = root.ShiritoriInput;
  const Romaji = root.ShiritoriRomaji;
  const Keyboard = root.ShiritoriKeyboard;
  const Net = root.ShiritoriNet;
  const Core = root.ShiritoriGameCore;
  const Ruby = root.Ruby;

  const MAX = { reading: 12, english: 30 };
  const DIFFS = Core.DIFFICULTIES;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const FORMAT_MESSAGES = {
    invalid_reading: "読{よ}みはひらがな・カタカナで2文字{もじ}以上{いじょう}入{い}れてね",
    invalid_english: "英語{えいご}はアルファベットだけ（2〜30文字{もじ}）で入{い}れてね",
    unknown_word: "辞書{じしょ}にのっていない言葉{ことば}だよ。別{べつ}の言葉{ことば}で試{ため}してね"
  };
  const ERROR_MESSAGES = {
    no_room: "部屋{へや}が見{み}つからないか、つながらないよ",
    full: "この部屋{へや}は満員{まんいん}だよ（最大{さいだい}4人{にん}）",
    started: "この部屋{へや}はもうゲームが始{はじ}まっているよ",
    lost: "通信{つうしん}が切{き}れちゃった。もう一度{いちど}入{はい}ってね"
  };

  function create(ctx) {
    const view = ctx.view;
    const game = ctx.game || "shiritori";
    const hooks = ctx.hooks || null;
    let hookTeardown = null;
    let storage = null;
    try { storage = localStorage; } catch (_) {}
    const cid = Net.makeCid(storage);

    let net = null;          // 部屋への接続
    let state = null;        // 部屋から届いた最新の状態
    let code = null;
    let play = null;         // プレイ画面の部品(キーボード・タイマー)
    let qrCache = null;      // [url, svg]
    const banner = document.createElement("div");
    banner.className = "net-banner";
    banner.hidden = true;
    banner.innerHTML = Ruby.html("再接続{さいせつぞく}中{ちゅう}…");
    view.insertAdjacentElement("beforebegin", banner);

    const render = (html) => { view.innerHTML = html; Ruby.apply(view); };
    const me = () => state && state.players.find((p) => p.id === cid);
    const player = (id) => state && state.players.find((p) => p.id === id);
    const avatarOf = (id) => (player(id) ? player(id).avatar : "👤");
    const nameOf = (id) => avatarOf(id) + (id === cid ? "（あなた）" : "");
    const isHost = () => !!state && state.hostId === cid;

    /* ============ 入口: 部屋を作る / 入る ============ */
    function showFriends(note) {
      leaveRoom(false);
      ctx.setPlaying(false);
      render(`
        <div class="panel shiri-menu">
          <h3 class="menu-title">友達{ともだち}と遊{あそ}ぶ</h3>
          <ul class="howto">
            <li>部屋{へや}を作{つく}ると、5桁{けた}の番号{ばんごう}とQRコードが出{で}るよ</li>
            <li>友達{ともだち}は、QRコードを読{よ}み取{と}るか、番号{ばんごう}を入{い}れて入{はい}れるよ（最大{さいだい}4人{にん}）</li>
            ${(ctx.help || ["順番{じゅんばん}に答{こた}えて、最後{さいご}まで残{のこ}った人{ひと}の勝{か}ち！"]).map((h) => `<li>${h}</li>`).join("")}
          </ul>
          ${!ctx.endpoint ? '<p class="note">この機能{きのう}は、まだ使{つか}えません（判定{はんてい}サーバーが未設定{みせってい}）</p>' : ""}
          ${note ? `<p class="note note-ng">${note}</p>` : ""}
          <div class="menu-actions">
            <button type="button" class="btn btn-primary" id="mp-create" ${ctx.endpoint ? "" : "disabled"}>部屋{へや}を作{つく}る</button>
            <button type="button" class="btn" id="mp-join" ${ctx.endpoint ? "" : "disabled"}>部屋{へや}に入{はい}る</button>
          </div>
          <div class="menu-actions"><button type="button" class="btn btn-small" id="mp-back">戻{もど}る</button></div>
        </div>`);
      view.querySelector("#mp-create").addEventListener("click", createRoom);
      view.querySelector("#mp-join").addEventListener("click", () => showJoin(""));
      view.querySelector("#mp-back").addEventListener("click", () => { teardown(); ctx.goMenu(); });
    }

    /** 番号を入力する画面(専用のテンキー。標準キーボードは出さない) */
    function showJoin(value, note) {
      let digits = value || "";
      const draw = () => {
        const boxes = view.querySelectorAll(".code-box");
        boxes.forEach((b, i) => { b.textContent = digits[i] || ""; b.classList.toggle("is-on", i === digits.length); });
        view.querySelector("#mp-go").disabled = digits.length !== 5;
      };
      render(`
        <div class="panel shiri-menu">
          <h3 class="menu-title">部屋{へや}に入{はい}る</h3>
          <p class="note">5桁{けた}の番号{ばんごう}を入{い}れてね</p>
          ${note ? `<p class="note note-ng">${note}</p>` : ""}
          <div class="code-boxes" aria-live="polite">${'<span class="code-box"></span>'.repeat(5)}</div>
          <div class="keypad">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" class="kb-key" data-d="${n}">${n}</button>`).join("")}
            <button type="button" class="kb-key kb-del" data-d="del" aria-label="ひとつ消す">⌫</button>
            <button type="button" class="kb-key" data-d="0">0</button>
            <button type="button" class="kb-key kb-enter" id="mp-go" disabled>入{はい}る</button>
          </div>
          <div class="menu-actions"><button type="button" class="btn btn-small" id="mp-cancel">戻{もど}る</button></div>
        </div>`);
      view.querySelectorAll(".keypad [data-d]").forEach((b) => b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const d = b.dataset.d;
        if (d === "del") digits = digits.slice(0, -1);
        else if (digits.length < 5) digits += d;
        draw();
      }));
      view.querySelector("#mp-go").addEventListener("click", () => { if (digits.length === 5) enter(digits); });
      view.querySelector("#mp-cancel").addEventListener("click", () => showFriends());
      draw();
    }

    async function createRoom() {
      render(`<div class="panel shiri-menu"><p class="note">${Ruby.html("部屋{へや}を作{つく}っています…")}</p></div>`);
      try {
        const res = await fetch(ctx.endpoint.replace(/\/+$/, "") + "/room/new" + (game === "shiritori" ? "" : "?game=" + game), { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data.code) throw new Error("create failed");
        enter(data.code);
      } catch (_) {
        showFriends(Ruby.html("部屋{へや}を作{つく}れませんでした。あとでもう一度{いちど}試{ため}してね"));
      }
    }

    /* ============ 部屋に入る(接続) ============ */
    function enter(roomCode) {
      leaveRoom(false);
      code = roomCode;
      state = null;
      setUrlRoom(code);
      render(`<div class="panel shiri-menu"><p class="note">${Ruby.html("部屋{へや}につなぎ中{ちゅう}…")}</p>
        <div class="menu-actions"><button type="button" class="btn btn-small" id="mp-cancel">戻{もど}る</button></div></div>`);
      view.querySelector("#mp-cancel").addEventListener("click", () => showFriends());

      net = Net.create({
        endpoint: ctx.endpoint, code, cid,
        onState: onState,
        onRejected: onRejected,
        onError: (err) => { leaveRoom(false); setUrlRoom(null); showFriends(Ruby.html(ERROR_MESSAGES[err] || ERROR_MESSAGES.lost)); },
        onStatus: (s) => { banner.hidden = s !== "reconnecting"; }
      });
    }

    function leaveRoom(clearUrl) {
      stopPlay();
      if (net) net.close();
      net = null; state = null;
      banner.hidden = true;
      if (clearUrl !== false) setUrlRoom(null);
    }

    function setUrlRoom(c) {
      try {
        const u = new URL(location.href);
        if (c) u.searchParams.set("room", c); else u.searchParams.delete("room");
        if (c && game !== "shiritori") u.searchParams.set("game", game); else u.searchParams.delete("game");
        history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
      } catch (_) {}
    }

    function joinUrl() {
      const u = new URL(location.href);
      u.search = ""; u.hash = "";
      u.searchParams.set("room", code);
      if (game !== "shiritori") u.searchParams.set("game", game);
      return u.toString();
    }

    function qrSvg(url) {
      if (qrCache && qrCache[0] === url) return qrCache[1];
      let svg = "";
      try {
        const qr = root.qrcode(0, "M");
        qr.addData(url);
        qr.make();
        svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: "部屋のQRコード" });
      } catch (_) {}
      qrCache = [url, svg];
      return svg;
    }

    /* ============ 状態の受信 ============ */
    function onState(st, events) {
      const prev = state;
      state = st;
      if (st.phase === "lobby") {
        stopPlay(); showLobby();
        if ((events || []).some((e) => (e.kind === "joined" || e.kind === "left") && e.playerId !== cid)) Sfx.play("pop");
      }
      else if (st.phase === "playing") {
        if (hooks) hooks.play(shell, events, prev);
        else { if (!play) buildPlay(); updatePlay(events, prev); }
      }
      else if (st.phase === "over") { stopPlay(); if (hooks) hooks.over(shell); else showOver(); }
    }

    function onRejected(m) {
      if (hooks) return hooks.onRejected && hooks.onRejected(shell, m);
      if (!play) return;
      const MSG = {
        not_connected: `「${esc(state.required)}」から始{はじ}まってないよ！`,
        duplicate: "その英語{えいご}はもう使{つか}われているよ！",
        not_your_turn: "もう時間切{じかんぎ}れだったよ",
        invalid_reading: FORMAT_MESSAGES.invalid_reading,
        invalid_english: FORMAT_MESSAGES.invalid_english
      };
      play.say(MSG[m.reason] || MSG[m.error] || "うまくいかなかったよ", "ng");
      if (m.error !== "not_your_turn") play.busy = false;
    }

    /* ============ ロビー ============ */
    function showLobby() {
      ctx.setPlaying(false);
      const url = joinUrl();
      const connected = state.players.filter((p) => p.connected).length;
      const d = DIFFS[state.settings.difficulty];
      const slots = [0, 1, 2, 3].map((s) => {
        const p = state.players.find((x) => x.slot === s);
        if (!p) return `<li class="slot empty"><span class="av">・</span><span>待{ま}っています…</span></li>`;
        return `<li class="slot"><span class="av">${p.avatar}</span>
          <span>${p.id === cid ? "あなた" : "友達{ともだち}"}</span>
          ${p.id === state.hostId ? '<span class="tag">ホスト</span>' : ""}
          ${p.connected ? "" : '<span class="tag tag-off">接続{せつぞく}中{ちゅう}…</span>'}</li>`;
      }).join("");

      const startBlock = isHost() ? `
        <div class="menu-actions">
          <button type="button" class="btn btn-primary" id="mp-start" ${connected >= 2 ? "" : "disabled"}>スタート！</button>
        </div>
        ${connected < 2 ? '<p class="note">友達{ともだち}が入{はい}るまで待{ま}ってね（2人{ふたり}から遊{あそ}べるよ）</p>' : ""}`
        : '<p class="note">ホストがスタートするのを待{ま}ってね…</p>';
      const settings = hooks ? hooks.lobbySettings(state, isHost()) + startBlock : isHost() ? `
        <h4 class="menu-sub">難{むずか}しさ</h4>
        <div class="diff-row">
          ${Object.values(DIFFS).map((x) => `
            <button type="button" class="diff-btn${x.key === state.settings.difficulty ? " is-on" : ""}" data-diff="${x.key}">
              <b>${x.label}</b><small>${x.seconds}秒{びょう} ・ ♥${x.lives}</small></button>`).join("")}
        </div>
        <label class="setting small"><input type="checkbox" id="mp-dakuten" ${state.settings.ignoreDakuten ? "checked" : ""}>
          <span>「てんてん」を区別{くべつ}しない</span></label>
        <div class="menu-actions">
          <button type="button" class="btn btn-primary" id="mp-start" ${connected >= 2 ? "" : "disabled"}>スタート！</button>
        </div>
        ${connected < 2 ? '<p class="note">友達{ともだち}が入{はい}るまで待{ま}ってね（2人{ふたり}から遊{あそ}べるよ）</p>' : ""}`
        : `<p class="note">難{むずか}しさ: ${d.label}（${d.seconds}秒{びょう}・♥${d.lives}）<br>ホストがスタートするのを待{ま}ってね…</p>`;

      render(`
        <div class="panel shiri-lobby">
          <h3 class="menu-title">部屋{へや}の番号{ばんごう}</h3>
          <div class="room-code" aria-label="部屋の番号 ${esc(code)}">${esc(code)}</div>
          <div class="qr">${qrSvg(url)}</div>
          <p class="note">友達{ともだち}は、QRコードをスマホのカメラで読{よ}み取{と}るか、「部屋{へや}に入{はい}る」で番号{ばんごう}を入{い}れてね</p>
          <div class="share-row">
            <button type="button" class="btn btn-small" id="mp-copy">🔗 リンクをコピー</button>
            ${navigator.share ? '<button type="button" class="btn btn-small" id="mp-share">📤 送{おく}る</button>' : ""}
          </div>
          <p class="note" id="mp-copied" aria-live="polite"></p>
          <h4 class="menu-sub">メンバー（${connected}/4）</h4>
          <ul class="room-players">${slots}</ul>
          ${settings}
          <div class="menu-actions"><button type="button" class="btn btn-small" id="mp-leave">部屋{へや}を出{で}る</button></div>
        </div>`);

      view.querySelector("#mp-copy").addEventListener("click", async () => {
        const note = view.querySelector("#mp-copied");
        try { await navigator.clipboard.writeText(url); note.innerHTML = Ruby.html("コピーしたよ！友達{ともだち}に送{おく}ってね"); }
        catch (_) { note.textContent = url; }
      });
      const share = view.querySelector("#mp-share");
      if (share) share.addEventListener("click", () => navigator.share({ title: "英単語しりとり", text: "いっしょに遊ぼう！", url }).catch(() => {}));
      view.querySelector("#mp-leave").addEventListener("click", () => showFriends());
      view.querySelectorAll(".diff-btn").forEach((b) => b.addEventListener("click", () =>
        net.send({ t: "settings", settings: { difficulty: b.dataset.diff } })));
      const dak = view.querySelector("#mp-dakuten");
      if (dak) dak.addEventListener("change", () => net.send({ t: "settings", settings: { ignoreDakuten: dak.checked } }));
      const start = view.querySelector("#mp-start");
      if (start) start.addEventListener("click", () => net.send({ t: "start" }));
      if (hooks && hooks.bindLobby) hooks.bindLobby(view, (o) => net.send(o));
    }

    /* ============ 対戦 ============ */
    function stopPlay() {
      if (hookTeardown) { hookTeardown(); hookTeardown = null; }
      if (play) play.teardown();
      play = null;
      ctx.setPlaying(false);
    }

    function buildPlay() {
      ctx.setPlaying(true);
      render(`
        <div class="mp-players" id="mp-players"></div>
        <div class="shiri-timer" role="timer" aria-live="off">
          <div class="shiri-timer-bar" id="timer-bar"></div>
          <span class="shiri-timer-num" id="timer-num"></span>
        </div>
        <div class="shiri-bubble" id="bubble"></div>
        <div class="shiri-status" id="status"></div>
        <div class="shiri-fields">
          <button type="button" class="shiri-field is-active" data-field="reading">
            <span class="shiri-label">日本語{にほんご}（読{よ}み）</span>
            <span class="shiri-text" data-text="reading"></span>
          </button>
          <button type="button" class="shiri-field" data-field="english">
            <span class="shiri-label">英語{えいご}</span>
            <span class="shiri-text shiri-en" data-text="english"></span>
          </button>
        </div>
        <div class="shiri-message" id="message" role="status" aria-live="polite"></div>
        <div class="shiri-actions">
          <button type="button" class="btn btn-small" id="btn-hint">💡 ヒント（-5点{てん}）</button>
          <button type="button" class="btn btn-small" id="btn-quit">やめる</button>
        </div>
        <div id="shiri-kb"></div>
        <ol class="shiri-history" id="history" reversed></ol>`);

      const $ = (s) => view.querySelector(s);
      const p = play = {
        text: { reading: "", english: "" }, pending: "", active: "reading",
        busy: true, lastTurn: null, timerId: null, lastShown: -1,
        say(msg, kind) { const m = $("#message"); m.innerHTML = Ruby.html(msg || ""); m.dataset.kind = kind || ""; },
        bubble(msg) { $("#bubble").innerHTML = Ruby.html(msg || ""); },
        teardown() { clearInterval(p.timerId); p.detach && p.detach(); p.kb && p.kb.destroy(); banner.hidden = true; }
      };

      p.kb = Keyboard.create($("#shiri-kb"), { onAction });
      p.detach = Keyboard.attachPhysicalKeys(() => p.kb.getMode(), onAction, () => p.kb.getKanaMethod());

      function setActive(name) {
        p.active = name;
        p.kb.setMode(name === "reading" ? "kana" : "en");
        view.querySelectorAll(".shiri-field").forEach((f) => f.classList.toggle("is-active", f.dataset.field === name));
      }
      p.setActive = setActive;

      function drawFields() {
        view.querySelectorAll("[data-text]").forEach((t) => {
          const name = t.dataset.text;
          t.innerHTML = esc(p.text[name]) + (name === "reading" && p.pending ? `<span class="pending">${esc(p.pending)}</span>` : "");
        });
      }
      p.drawFields = drawFields;

      function setBusy(b) {
        p.busy = b;
        $("#shiri-kb").classList.toggle("kb-off", b);
        view.querySelectorAll(".shiri-field").forEach((f) => f.classList.toggle("is-waiting", b));
      }
      p.setBusy = setBusy;

      function onAction(action) {
        if (p.busy) return;
        if (action.type === "submit") return submit();
        if (p.active === "reading") {
          const r = Romaji.applyReading({ text: p.text.reading, pending: p.pending }, action, { maxLength: MAX.reading });
          p.text.reading = r.text; p.pending = r.pending;
        } else {
          p.text.english = Input.applyAction(p.text.english, action, { maxLength: MAX.english });
        }
        drawFields();
        if ($("#message").dataset.kind === "ng") p.say("");
      }

      async function submit() {
        if (p.busy) return;
        if (p.active === "reading") {
          const fixed = Romaji.flush({ text: p.text.reading, pending: p.pending });
          p.text.reading = fixed.text; p.pending = "";
          drawFields();
          if (!Rules.normalizeReading(p.text.reading)) return p.say(FORMAT_MESSAGES.invalid_reading, "ng");
          p.say("");
          return setActive("english");
        }
        const tools = ctx.getJudge();
        if (!tools) return p.say("辞書{じしょ}を読{よ}み込{こ}み中{ちゅう}…もう少{すこ}し待{ま}ってね", "ng");
        setBusy(true);
        let stopped = false;                           // Geminiで確認する間は、部屋に知らせて全員の時間を止める
        const r = await tools.judge.judge({
          reading: p.text.reading, english: p.text.english,
          requiredKana: state.required, usedEnglish: new Set(state.used)
        }, { ignoreDakuten: state.settings.ignoreDakuten }, {
          onRemoteStart: () => {
            stopped = net.send({ t: "judging" });
            p.say("🔍 確認中{かくにんちゅう}…（時間{じかん}はストップ中{ちゅう}）", "hint");
          }
        });
        if (!play || play !== p || !state || state.phase !== "playing") return;

        if (r.ok) {                                   // 通った手を部屋へ。結果(次の人の番)は部屋から届く
          p.say("");
          if (!net.send({ t: "move", reading: r.reading, english: r.english })) {
            p.say("通信{つうしん}できなかったよ。もう一度{いちど}ためしてね", "ng"); setBusy(false);
          }
          return;
        }
        if (r.reason === "invalid_reading" || r.reason === "invalid_english" || r.reason === "unknown_word") {
          p.say(FORMAT_MESSAGES[r.reason], "ng");     // 形式ミス・未知の語はライフを減らさず、やり直し
          if (r.reason === "invalid_reading") setActive("reading");
          if (stopped) net.send({ t: "resume" });     // 手は送らないので、止めていた時間を再開してもらう
          return setBusy(false);
        }
        // まちがい: 部屋に報告する(ライフ-1・次の人へ)。つづりミスは復習リストにも入れる
        let correct = null;
        if (r.reason === "spelling" || r.reason === "wrong_english") {
          correct = r.suggestion || (tools.dict.englishFor(r.reading)[0] || null);
          if (correct) ctx.store.review.add({ reading: r.reading, typed: r.english, correct });
        }
        net.send({ t: "miss", reason: r.reason, correct });
      }

      $("#btn-hint").addEventListener("click", () => {
        if (p.busy) return;
        const tools = ctx.getJudge();
        const h = tools && tools.dict.pickCpu({
          requiredKana: state.required, used: new Set(state.used),
          maxLevel: DIFFS[state.settings.difficulty].maxLevel, ignoreDakuten: state.settings.ignoreDakuten
        });
        if (!h) return p.say("ヒントが見{み}つからなかったよ", "ng");
        net.send({ t: "hint" });
        p.say(`💡 「${h.reading}」 ＝ ${h.english[0].toUpperCase()}${" _".repeat(h.english.length - 1)}（${h.english.length}文字{もじ}） -${Core.HINT_COST}点{てん}`, "hint");
      });
      $("#btn-quit").addEventListener("click", () => {
        if (confirm("ゲームをやめて部屋を出ますか？")) showFriends();
      });
      view.querySelectorAll(".shiri-field").forEach((f) =>
        f.addEventListener("click", () => { if (!p.busy) setActive(f.dataset.field); }));

      // タイマーは「部屋の時計」で数える（端末の時計をいじってもズルできない）
      p.timerId = setInterval(() => {
        if (!state || state.phase !== "playing") return;
        const rem = net.remainingMs(state);
        const total = state.seconds * 1000;
        $("#timer-bar").style.width = Math.min(100, rem / total * 100) + "%";
        $("#timer-bar").classList.toggle("is-low", rem <= 5000);
        const shown = Math.ceil(rem / 1000);
        if (shown !== p.lastShown) { p.lastShown = shown; $("#timer-num").textContent = shown; if (shown > 0 && shown <= 3 && state.turnId === cid) Sfx.play("tick"); }
      }, 100);

      setBusy(true);
    }

    function eventText(ev) {
      const who = nameOf(ev.playerId);
      switch (ev.kind) {
        case "moved": return `${who} 「${ev.reading}」 ＝ ${ev.english}  +${ev.points}点{てん}`;
        case "miss":
          return ev.reason === "timeout" ? `${who} は時間切{じかんぎ}れ！`
            : `${who} は間違{まちが}えた！` + (ev.correct ? ` 正解{せいかい}は「${ev.correct}」` : "");
        case "n_out": return `${who} は「ん」で終{お}わった！`;
        case "out": return `${who} は脱落{だつらく}…`;
        case "joined": return `${who} が入{はい}ったよ`;
        case "left": return `${who} が抜{ぬ}けたよ`;
        default: return null;
      }
    }

    function updatePlay(events) {
      const p = play;
      const $ = (s) => view.querySelector(s);
      const s = state;
      const myTurn = s.turnId === cid;

      // 参加者(ライフ・得点・いま誰の番か)
      $("#mp-players").innerHTML = s.players.map((x) => `
        <div class="mp-chip${x.id === s.turnId ? " is-turn" : ""}${x.alive ? "" : " is-out"}${x.connected ? "" : " is-off"}">
          <span class="av">${x.avatar}</span>
          <span class="who">${x.id === cid ? "あなた" : ""}</span>
          <span class="lv">${x.alive ? "♥".repeat(Math.max(0, x.lives)) : "✕"}</span>
          <span class="sc">${x.score}</span>
        </div>`).join("");
      Ruby.apply($("#mp-players"));

      $("#status").innerHTML = (myTurn
        ? Ruby.html("あなたの番{ばん}！「") + `<b>${esc(s.required)}</b>` + Ruby.html("」から始{はじ}まる言葉{ことば}")
        : Ruby.html(`${avatarOf(s.turnId)} の番{ばん}…「`) + `<b>${esc(s.required)}</b>` + Ruby.html("」から"));

      $("#history").innerHTML = s.history.slice().reverse().slice(0, 30).map((h) =>
        `<li class="${h.playerId === cid ? "me" : "other"}"><span class="who">${avatarOf(h.playerId)}</span>
          <b>${esc(h.reading)}</b> ＝ ${esc(h.english)} <em>+${h.points}</em></li>`).join("");

      // 起きたことを、ふきだしに出す
      const texts = (events || []).map(eventText).filter(Boolean);
      if (texts.length) p.bubble(texts.join("　"));
      else if (p.lastTurn === null) p.bubble(`🎮 ${avatarOf(s.turnId)} からスタート！「しりとり」→「り」`);
      if ((events || []).some((e) => e.kind === "miss" && e.playerId === cid)) p.say("♥が1つ減{へ}ったよ", "ng");
      // 誰かがGeminiで確認している間は、時間が止まる(全員の画面で)
      $(".shiri-timer").classList.toggle("is-paused", !!s.pausedAt);
      if (s.pausedAt) p.bubble(`🔍 ${avatarOf(s.turnId)} が確認中{かくにんちゅう}…（時間{じかん}はストップ中{ちゅう}）`);
      // 効果音: 自分の正解=ok / 相手の正解=pop / 間違い=ng / 脱落=heart / 自分の番=turn
      (events || []).forEach((ev) => {
        if (ev.kind === "moved") { Sfx.play(ev.playerId === cid ? "ok" : "pop"); if (ev.playerId === cid) Fx.floatText($("#mp-players"), "+" + ev.points); }
        else if (ev.kind === "miss") { Sfx.play("ng"); Fx.shake($("#mp-players")); }
        else if (ev.kind === "out" || ev.kind === "n_out") Sfx.play("heart");
      });
      if ((events || []).some((e) => e.kind === "turn" && e.playerId === cid)) setTimeout(() => Sfx.play("turn"), 380);

      // 手番が変わったら入力をリセットし、自分の番だけ入力できるようにする
      if (p.lastTurn !== s.turnId || (events || []).some((e) => e.kind === "turn" || e.kind === "started")) {
        p.lastTurn = s.turnId;
        p.text = { reading: "", english: "" }; p.pending = "";
        p.drawFields();
        p.setActive("reading");
        p.setBusy(!myTurn);
        if (myTurn) { p.say(""); }
      }
    }

    /* ============ 結果 ============ */
    function showOver() {
      ctx.setPlaying(false);
      const rank = state.ranking.map((id) => player(id)).filter(Boolean);
      const winner = rank[0];
      const iWon = winner && winner.id === cid;
      Sfx.play(iWon ? "win" : "lose");
      if (iWon) Fx.confetti();
      render(`
        <div class="panel shiri-result">
          <div class="result-icon">${iWon ? "🎉" : "🏁"}</div>
          <h3 class="menu-title">${winner ? (iWon ? "あなたの勝{か}ち！" : `${winner.avatar} の勝{か}ち！`) : "おしまい"}</h3>
          <ol class="rank-list">
            ${rank.map((p, i) => `<li><span class="no">${i + 1}位{い}</span><span class="av">${p.avatar}</span>
              <span>${p.id === cid ? "あなた" : ""}</span><span class="sc">${p.score}点{てん}</span>
              <span class="wd">${p.words}語{ご}</span></li>`).join("")}
          </ol>
          <div class="menu-actions">
            ${isHost() ? '<button type="button" class="btn btn-primary" id="mp-again">もう一度{いちど}</button>'
              : '<p class="note">ホストが「もう一度{いちど}」を押{お}すのを待{ま}ってね</p>'}
            <button type="button" class="btn" id="mp-menu">メニューへ</button>
          </div>
        </div>`);
      const again = view.querySelector("#mp-again");
      if (again) again.addEventListener("click", () => net.send({ t: "rematch" }));
      view.querySelector("#mp-menu").addEventListener("click", () => { teardown(); ctx.goMenu(); });
    }

    /** 他のゲームの画面(hooks)が、部屋の状態や通信を使うための口 */
    const shell = {
      view,
      get state() { return state; },
      cid,
      render,
      send: (o) => (net ? net.send(o) : false),
      remainingMs: () => (net ? net.remainingMs(state) : 0),
      setPlaying: (on) => ctx.setPlaying(on),
      isHost: () => isHost(),
      player: (id) => player(id),
      avatarOf: (id) => avatarOf(id),
      nameOf: (id) => nameOf(id),
      onTeardown(fn) { hookTeardown = fn; },
      exit() { teardown(); ctx.goMenu(); },
      hideBanner() { banner.hidden = true; }
    };

    function teardown() { leaveRoom(true); }
    function destroy() { leaveRoom(false); banner.remove(); }

    return { showFriends, enter, teardown, destroy };
  }

  root.ShiritoriOnline = { create };
})(window);
