/**
 * ミニ漢字検定の友達対戦の画面（部屋・QR・番号入力・ロビーは、しりとりと同じ ShiritoriOnline を使う）
 *
 * ・同じ問題を全員の画面に出し、答えられるのは「順番の人」だけ
 * ・出題・採点・時間管理は部屋(サーバー)。端末は答えを知らない
 * ・モードは ミニ検定(最大60問) と サバイバル の2つ。最終的な勝者は「ポイント」で決まる
 */
(function (root) {
  "use strict";

  const Q = root.KankenQuestion;
  const Romaji = root.ShiritoriRomaji;
  const Keyboard = root.ShiritoriKeyboard;
  const Ruby = root.Ruby;

  const MAX_READING = 14;
  const MODES = [
    { key: "exam", icon: "📝", name: "ミニ検定{けんてい}", desc: "最大{さいだい}60問{もん}・ライフ ♥5（時間切{じかんぎ}れもライフ-1）" },
    { key: "survival", icon: "🔥", name: "サバイバル", desc: "ライフ ♥3・時間切{じかんぎ}れは即脱落{そくだつらく}・問題数{もんだいすう}は無制限{むせいげん}" }
  ];
  const END_TEXT = { done: "全問終了{ぜんもんしゅうりょう}！", all_out: "全員{ぜんいん}脱落{だつらく}！", last_one: "最後{さいご}の1人{ひとり}が最高得点{さいこうとくてん}！" };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /** 答えの表示。読み問題: 教える→おし / 書き取り: 検（検定） */
  function answerText(ev) {
    return ev.type === "write" ? `${ev.answer}（${ev.word}）` : `${ev.word}→${ev.answer}`;
  }

  function create(ctx) {
    let ui = null;                       // 対戦画面の部品

    /* ---------- ロビーの設定欄 ---------- */
    function lobbySettings(st, isHost) {
      const s = st.settings;
      const lv = Q.LEVELS[s.level - 1];
      if (!isHost) {
        const m = MODES.find((x) => x.key === s.mode);
        return `<p class="note">モード: <b>${m.name}</b> ・ ${lv.label}（${lv.short}）<br>${m.desc}</p>`;
      }
      return `
        <h4 class="menu-sub">モード</h4>
        <div class="kk-modes">
          ${MODES.map((m) => `
            <button type="button" class="kk-mode${m.key === s.mode ? " is-on" : ""}" data-mode="${m.key}">
              <span class="ic">${m.icon}</span><span class="tx"><b>${m.name}</b><small>${m.desc}</small></span>
            </button>`).join("")}
        </div>
        <h4 class="menu-sub">レベル</h4>
        <div class="kk-levels">
          ${Q.LEVELS.map((l) => `
            <button type="button" class="kk-level${l.level === s.level ? " is-on" : ""}" data-level="${l.level}">
              <b>${l.label}</b><small>${l.short}</small></button>`).join("")}
        </div>
        <p class="note">同{おな}じ問題{もんだい}を順番{じゅんばん}に1問{もん}ずつ答{こた}えて、ポイントが一番{いちばん}高{たか}い人{ひと}の勝{か}ち！</p>`;
    }
    function bindLobby(view, send) {
      view.querySelectorAll(".kk-mode").forEach((b) => b.addEventListener("click", () => send({ t: "settings", settings: { mode: b.dataset.mode } })));
      view.querySelectorAll(".kk-level").forEach((b) => b.addEventListener("click", () => send({ t: "settings", settings: { level: +b.dataset.level } })));
    }

    /* ---------- 対戦画面 ---------- */
    function build(shell) {
      shell.setPlaying(true);
      shell.render(`
        <div class="mp-players" id="mp-players"></div>
        <div class="shiri-timer" role="timer" aria-live="off">
          <div class="shiri-timer-bar" id="timer-bar"></div>
          <span class="shiri-timer-num" id="timer-num"></span>
        </div>
        <div class="kk-progress" id="kk-progress"></div>
        <div class="shiri-status" id="kk-turn"></div>
        <div class="kk-stage" id="kk-stage"></div>
        <div class="kk-feedback" id="kk-feedback" role="status" aria-live="polite"></div>
        <div class="shiri-actions"><span></span><button type="button" class="btn btn-small" id="kk-quit">やめる</button></div>
        <div id="shiri-kb"></div>`);
      const $ = (s) => shell.view.querySelector(s);
      const u = { text: "", pending: "", busy: true, qid: null, turn: null, lastShown: -1, timerId: null };

      u.kb = Keyboard.create($("#shiri-kb"), { onAction });
      $("#shiri-kb").hidden = true;
      u.detach = Keyboard.attachPhysicalKeys(() => "kana", onAction, () => u.kb.getKanaMethod());
      const onKey = (e) => {
        if (u.busy || !/^[1-4]$/.test(e.key)) return;
        const q = shell.state && shell.state.q;
        if (q && q.type === "write") answer({ choice: +e.key - 1 });
      };
      document.addEventListener("keydown", onKey);
      shell.onTeardown(() => { clearInterval(u.timerId); document.removeEventListener("keydown", onKey); u.detach(); u.kb.destroy(); ui = null; });

      function drawField() {
        const f = $("#kk-reading");
        if (f) f.innerHTML = esc(u.text) + (u.pending ? `<span class="pending">${esc(u.pending)}</span>` : "");
      }
      function feedback(html, kind) { const f = $("#kk-feedback"); f.innerHTML = html; f.dataset.kind = kind || ""; Ruby.apply(f); }

      function answer(resp) {
        if (u.busy) return;
        u.busy = true;
        if (!shell.send(Object.assign({ t: "answer" }, resp))) { u.busy = false; feedback(Ruby.html("通信{つうしん}できなかったよ"), "ng"); }
      }
      function onAction(action) {
        if (u.busy) return;
        const q = shell.state && shell.state.q;
        if (!q || q.type !== "read") return;
        if (action.type === "submit") {
          const fixed = Romaji.flush({ text: u.text, pending: u.pending });
          u.text = fixed.text; u.pending = ""; drawField();
          if (!u.text) return feedback(Ruby.html("読{よ}みを入力{にゅうりょく}してね"), "ng");
          return answer({ reading: u.text });
        }
        const r = Romaji.applyReading({ text: u.text, pending: u.pending }, action, { maxLength: MAX_READING });
        u.text = r.text; u.pending = r.pending;
        drawField();
        if ($("#kk-feedback").dataset.kind === "ng") feedback("");
      }

      /* 問題の表示(問題か順番が変わった時) */
      function renderStage(st) {
        const q = st.q, myTurn = st.turnId === shell.cid;
        u.text = ""; u.pending = ""; u.busy = !myTurn;
        const stage = $("#kk-stage");
        if (q.type === "read") {
          const okuri = !!q.kanji;                       // 送りがな付き(教える): 線の漢字の部分だけ答える
          stage.innerHTML = `
            <div class="kk-prompt">${Ruby.html(myTurn ? (okuri ? "線{せん}の漢字{かんじ}の読{よ}みは？（送{おく}りがなは入力{にゅうりょく}しなくてOK）" : "この読{よ}みは？（ひらがなで入力{にゅうりょく}）") : `${shell.avatarOf(st.turnId)} が答{こた}えるよ`)}</div>
            <div class="kk-word">${okuri ? `<span class="kk-target">${esc(q.kanji)}</span><span class="kk-okuri">${esc(q.okuri)}</span>` : esc(q.text)}</div>
            ${myTurn ? '<div class="shiri-field is-active kk-field"><span class="shiri-text" id="kk-reading"></span></div>' : ""}`;
          $("#shiri-kb").hidden = !myTurn;
          drawField();
        } else {
          stage.innerHTML = `
            <div class="kk-prompt">${Ruby.html(myTurn ? "□に入{はい}る漢字{かんじ}は？" : `${shell.avatarOf(st.turnId)} が答{こた}えるよ`)}</div>
            <div class="kk-reading">${esc(q.reading)}</div>
            <div class="kk-word">${esc(q.text)}</div>
            <div class="kk-choices${myTurn ? "" : " is-off"}">
              ${q.choices.map((c, i) => `<button type="button" class="kk-choice" data-i="${i}" ${myTurn ? "" : "disabled"} aria-label="${i + 1}番 ${esc(c)}"><span class="no">${i + 1}</span>${esc(c)}</button>`).join("")}
            </div>`;
          $("#shiri-kb").hidden = true;
          if (myTurn) stage.querySelectorAll(".kk-choice").forEach((b) => b.addEventListener("pointerdown", (e) => { e.preventDefault(); answer({ choice: +b.dataset.i }); }));
        }
        u.qid = q.id; u.turn = st.turnId;
      }

      function eventText(ev, st) {
        const who = shell.nameOf(ev.playerId);
        if (ev.kind === "answered") {
          // 正解でも不正解でも、全員に答えを見せる(みんなで覚えられるように)
          const ans = answerText(ev);
          return ev.correct ? { t: `${who} ⭕ 正解{せいかい}！ +${ev.points}点{てん}　答{こた}え：${ans}`, k: "ok" }
            : { t: `${who} ${ev.timeout ? "⏰ 時間切{じかんぎ}れ。" : "❌"}　答{こた}え：${ans}`, k: "ng" };
        }
        if (ev.kind === "out") return { t: `${who} は脱落{だつらく}…`, k: "ng" };
        if (ev.kind === "skipped") return { t: `${who} の通信{つうしん}が切{き}れたので、番{ばん}を飛{と}ばしたよ`, k: "" };
        return null;
      }

      u.update = function (st, events) {
        const myTurn = st.turnId === shell.cid;
        $("#mp-players").innerHTML = st.players.map((x) => `
          <div class="mp-chip${x.id === st.turnId ? " is-turn" : ""}${x.alive ? "" : " is-out"}${x.connected ? "" : " is-off"}">
            <span class="av">${x.avatar}</span><span class="who">${x.id === shell.cid ? "あなた" : ""}</span>
            <span class="lv">${x.alive ? "♥".repeat(Math.max(0, x.lives)) : "✕"}</span><span class="sc">${x.score}</span>
          </div>`).join("");
        Ruby.apply($("#mp-players"));
        $("#kk-progress").innerHTML = Ruby.html(st.settings.mode === "exam" ? `${st.asked} / 60問{もん}` : `${st.asked}問目{もんめ}`);
        $("#kk-turn").innerHTML = Ruby.html(st.turnId === null ? "みんなの通信{つうしん}が切{き}れているよ。戻{もど}るのを待{ま}っているよ…" : myTurn ? "あなたの番{ばん}！" : `${shell.avatarOf(st.turnId)} の番{ばん}…`);
        $("#kk-turn").classList.toggle("is-mine", myTurn);

        // 結果の表示と、自分の間違いの復習リストへの保存
        const msgs = [];
        (events || []).forEach((ev) => {
          const m = eventText(ev, st);
          if (m) msgs.push(m);
          if (ev.kind === "answered" && !ev.correct && ev.playerId === shell.cid && ctx.store) ctx.store.review.add({ text: ev.word, reading: ev.reading });
        });
        if (msgs.length) feedback(Ruby.html(msgs.map((m) => m.t).join("　")), msgs[0].k);
        // 効果音: 正解=ok / 間違い=ng / 脱落=heart / 自分の番=turn
        (events || []).forEach((ev) => {
          if (ev.kind === "answered") {
            Sfx.play(ev.correct ? "ok" : "ng");
            if (ev.correct) Fx.floatText($("#mp-players"), "+" + ev.points); else Fx.shake($("#mp-players"));
          } else if (ev.kind === "out") Sfx.play("heart");
        });
        if ((events || []).some((e) => e.kind === "turn" && e.playerId === shell.cid)) setTimeout(() => Sfx.play("turn"), 380);

        if (st.q && (u.qid !== st.q.id || u.turn !== st.turnId)) renderStage(st);
      };

      u.timerId = setInterval(() => {
        const st = shell.state;
        if (!st || st.phase !== "playing" || !st.q) return;
        const rem = shell.remainingMs();
        const shown = Math.ceil(rem / 1000);
        if (shown !== u.lastShown) {                // 秒が変わった時だけ、画面を書きかえる
          u.lastShown = shown;
          $("#timer-num").textContent = shown;
          Fx.timerBar($("#timer-bar"), rem, st.seconds * 1000);
          $("#timer-bar").classList.toggle("is-low", rem <= 5000);
          if (shown > 0 && shown <= 3 && st.turnId === shell.cid) Sfx.play("tick");
        }
      }, 250);

      $("#kk-quit").addEventListener("click", () => { if (confirm("ゲームをやめて部屋を出ますか？")) shell.exit(); });
      return u;
    }

    function play(shell, events) {
      if (!ui) ui = build(shell);
      ui.update(shell.state, events);
    }

    function onRejected(shell, m) {
      if (!ui) return;
      const f = shell.view.querySelector("#kk-feedback");
      if (f) { f.innerHTML = Ruby.html(m.error === "not_your_turn" ? "今{いま}はあなたの番{ばん}じゃないよ" : "うまく送{おく}れなかったよ"); f.dataset.kind = "ng"; }
      const st = shell.state;
      ui.busy = !(st && st.turnId === shell.cid);
    }

    /* ---------- 結果 ---------- */
    function over(shell) {
      shell.setPlaying(false);
      const st = shell.state;
      const rank = st.ranking.map((id) => shell.player(id)).filter(Boolean);
      const winner = rank[0];
      const iWon = winner && winner.id === shell.cid;
      Sfx.play(iWon ? "win" : "lose");
      if (iWon) Fx.confetti();
      const lv = Q.LEVELS[st.settings.level - 1];
      const m = MODES.find((x) => x.key === st.settings.mode);
      shell.render(`
        <div class="panel shiri-result">
          <div class="result-icon">${iWon ? "🎓" : "🏁"}</div>
          <h3 class="menu-title">${winner ? (iWon ? "あなたの勝{か}ち！" : `${winner.avatar} の勝{か}ち！`) : "おしまい"}</h3>
          <p class="note">${m.icon} ${m.name} ・ ${lv.label} ・ ${END_TEXT[st.overReason] || ""}（${st.asked}問{もん}出題{しゅつだい}）</p>
          <ol class="rank-list">
            ${rank.map((p, i) => `<li><span class="no">${i + 1}位{い}</span><span class="av">${p.avatar}</span>
              <span>${p.id === shell.cid ? "あなた" : ""}</span><span class="sc">${p.score}点{てん}</span>
              <span class="wd">${p.words}問{もん}正解{せいかい}</span></li>`).join("")}
          </ol>
          ${st.last ? `<p class="kk-lastq ${st.last.correct ? "ok" : "ng"}">最後{さいご}の問題{もんだい}：${shell.nameOf(st.last.playerId)} ${st.last.correct ? "⭕" : st.last.timeout ? "⏰" : "❌"}　答{こた}え：${esc(answerText(st.last))}</p>` : ""}
          <div class="menu-actions">
            ${shell.isHost() ? '<button type="button" class="btn btn-primary" id="mp-again">もう一度{いちど}</button>'
              : '<p class="note">ホストが「もう一度{いちど}」を押{お}すのを待{ま}ってね</p>'}
            <button type="button" class="btn" id="mp-menu">メニューへ</button>
          </div>
        </div>`);
      const again = shell.view.querySelector("#mp-again");
      if (again) again.addEventListener("click", () => shell.send({ t: "rematch" }));
      shell.view.querySelector("#mp-menu").addEventListener("click", () => shell.exit());
    }

    return root.ShiritoriOnline.create({
      view: ctx.view, endpoint: ctx.endpoint, store: null,
      getJudge: () => null, goMenu: ctx.goMenu, setPlaying: ctx.setPlaying,
      game: "kanken",
      help: ["同{おな}じ問題{もんだい}を全員{ぜんいん}の画面{がめん}に出{だ}して、順番{じゅんばん}の人{ひと}だけが答{こた}えられるよ", "最後{さいご}に、ポイントが一番{いちばん}高{たか}い人{ひと}の勝{か}ち！"],
      hooks: { lobbySettings, bindLobby, play, over, onRejected }
    });
  }

  root.KankenOnline = { create };
})(window);
