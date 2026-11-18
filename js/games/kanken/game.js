/**
 * ミニ漢字検定の画面: メニュー → プレイ → けっか / 復習
 * 進行は core.js、問題づくりは question.js、保存は store.js。
 * 読みの入力は、しりとりと同じ専用キーボード(ローマ字・フリック・50音)を使う。
 */
(function (root) {
  "use strict";

  const Q = root.KankenQuestion;
  const Core = root.KankenCore;
  const KStore = root.KankenStore;
  const Romaji = root.ShiritoriRomaji;
  const Keyboard = root.ShiritoriKeyboard;
  const Ruby = root.Ruby;

  const MAX_READING = 14;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const MODE_INFO = [
    { key: "timeattack", icon: "⏱️", name: "タイムアタック", desc: "60秒{びょう}で何問{なんもん}解{と}けるか！ライフなし" },
    { key: "survival", icon: "🔥", name: "サバイバル", desc: "1問{もん}ごとに制限時間{せいげんじかん}。時間切{じかんぎ}れ1回{かい}かライフ0で終了{しゅうりょう}" },
    { key: "exam", icon: "📝", name: "ミニ検定{けんてい}", desc: "最大{さいだい}60問{もん}。制限時間{せいげんじかん}とライフあり。何問正解{なんもんせいかい}で何点{なんてん}？" }
  ];
  const END_TEXT = {
    time: "時間切{じかんぎ}れ！",
    lives: "ライフがなくなった…",
    timeout: "時間切{じかんぎ}れでおしまい！",
    done: "全問終了{ぜんもんしゅうりょう}！"
  };
  const PASS_RATE = 0.7;

  let cleanup = null;
  let dataPromise = null;
  function loadData() {
    if (root.KANKEN_DATA) return Promise.resolve(root.KANKEN_DATA);
    if (!dataPromise) {
      dataPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "data/kanji.js";
        s.onload = () => resolve(root.KANKEN_DATA);
        s.onerror = () => { dataPromise = null; reject(new Error("load failed")); };
        document.head.appendChild(s);
      });
    }
    return dataPromise;
  }

  function mount(rootEl) {
    let storage = null;
    try { storage = localStorage; } catch (_) {}
    const store = KStore.create(storage);
    let bank = null, alive = true, teardownPlay = null;

    rootEl.innerHTML = '<div class="kk" id="kk-view"></div>';
    const view = rootEl.querySelector("#kk-view");
    const render = (html) => { view.innerHTML = html; Ruby.apply(view); };

    const playEls = [rootEl.closest(".screen"), rootEl.closest("#app")].filter(Boolean);
    const setPlaying = (on) => playEls.forEach((el) => el.classList.toggle("shiri-playing", on));
    function stopPlay() { if (teardownPlay) teardownPlay(); teardownPlay = null; setPlaying(false); }

    /* ============ メニュー ============ */
    function showMenu() {
      stopPlay();
      const st = store.settings.get();
      const best = store.best.get(st.mode, st.level);
      render(`
        <div class="panel shiri-menu">
          <h3 class="menu-title">ミニ漢字検定{かんじけんてい}</h3>
          <p class="note">読{よ}み（ひらがな入力{にゅうりょく}）か、漢字{かんじ}（4択{たく}）がランダムで出{で}るよ。レベルが高{たか}いほど高得点{こうとくてん}！</p>
          <h4 class="menu-sub">モード</h4>
          <div class="kk-modes" role="radiogroup" aria-label="モード">
            ${MODE_INFO.map((m) => `
              <button type="button" class="kk-mode${m.key === st.mode ? " is-on" : ""}" role="radio" aria-checked="${m.key === st.mode}" data-mode="${m.key}">
                <span class="ic">${m.icon}</span><span class="tx"><b>${m.name}</b><small>${m.desc}</small></span>
              </button>`).join("")}
          </div>
          <h4 class="menu-sub">レベル</h4>
          <div class="kk-levels" role="radiogroup" aria-label="レベル">
            ${Q.LEVELS.map((l) => `
              <button type="button" class="kk-level${l.level === st.level ? " is-on" : ""}" role="radio" aria-checked="${l.level === st.level}" data-level="${l.level}">
                <b>${l.label}</b><small>${l.short}</small>
              </button>`).join("")}
          </div>
          <p class="note">ベスト: <b>${best.score}</b>点{てん}（${best.correct}問{もん}正解{せいかい}）</p>
          <div class="menu-actions">
            <button type="button" class="btn btn-primary" id="kk-start" disabled>スタート！</button>
            <button type="button" class="btn" id="kk-friends">👥 友達{ともだち}と遊{あそ}ぶ</button>
            <button type="button" class="btn" id="kk-review">復習{ふくしゅう}（${store.review.list().length}）</button>
          </div>
          <p class="note" id="kk-note">漢字{かんじ}データを読{よ}み込{こ}み中{ちゅう}…</p>
        </div>`);
      view.querySelectorAll(".kk-mode").forEach((b) => b.addEventListener("click", () => { store.settings.set({ mode: b.dataset.mode }); showMenu(); }));
      view.querySelectorAll(".kk-level").forEach((b) => b.addEventListener("click", () => { store.settings.set({ level: +b.dataset.level }); showMenu(); }));
      view.querySelector("#kk-review").addEventListener("click", showReview);
      view.querySelector("#kk-friends").addEventListener("click", () => getOnline().showFriends());
      const start = view.querySelector("#kk-start");
      start.addEventListener("click", () => play(st.mode, st.level));
      const note = view.querySelector("#kk-note");
      const ready = () => { start.disabled = false; note.textContent = ""; };
      if (bank) ready();
      else loadData().then((data) => {
        if (!alive) return;
        bank = Q.createBank(data);
        if (view.querySelector("#kk-start")) ready();
      }).catch(() => { if (alive) note.innerHTML = Ruby.html("データを読{よ}み込{こ}めませんでした。ページを再読{さいよ}み込{こ}みしてね"); });
    }

    /* ============ 復習 ============ */
    function showReview() {
      const list = store.review.list();
      render(`
        <div class="panel">
          <h3 class="menu-title">復習{ふくしゅう}</h3>
          ${list.length ? `
            <p class="note">間違{まちが}えた言葉{ことば}です。読{よ}みを覚{おぼ}えよう！</p>
            <ul class="review-list">
              ${list.map((e) => `<li><span class="kk-rv-word">${esc(e.text)}</span><span class="rv-words"><span class="rv-correct">${esc(e.reading)}</span></span>
                <button type="button" class="btn btn-small rv-del" data-t="${esc(e.text)}" aria-label="${esc(e.text)}を消す">✕</button></li>`).join("")}
            </ul>` : '<p class="note">まだありません。間違{まちが}えた言葉{ことば}がここにたまるよ</p>'}
          <div class="menu-actions">
            <button type="button" class="btn" id="kk-back">戻{もど}る</button>
            ${list.length ? '<button type="button" class="btn btn-small" id="kk-clear">全部{ぜんぶ}消{け}す</button>' : ""}
          </div>
        </div>`);
      view.querySelector("#kk-back").addEventListener("click", showMenu);
      const clear = view.querySelector("#kk-clear");
      if (clear) clear.addEventListener("click", () => { if (confirm("復習リストを全部消しますか？")) { store.review.clear(); showReview(); } });
      view.querySelectorAll(".rv-del").forEach((b) => b.addEventListener("click", () => { store.review.remove(b.dataset.t); showReview(); }));
    }

    /* ============ プレイ ============ */
    function play(modeKey, level) {
      stopPlay();
      setPlaying(true);
      const g = Core.create({ bank, mode: modeKey, level });
      const cfg = g.config;
      Sfx.play("start");
      const info = MODE_INFO.find((m) => m.key === modeKey);

      render(`
        <div class="shiri-hud">
          <div class="kk-badge">${esc(info.icon)} ${esc(Q.LEVELS[level - 1].label)}${level >= 6 ? " " + Ruby.html(Q.LEVELS[level - 1].short) : ""}</div>
          <div class="hud-lives" id="hud-lives" aria-label="ライフ"></div>
          <div class="hud-score">スコア <b id="hud-score">0</b></div>
        </div>
        <div class="shiri-timer" role="timer" aria-live="off">
          <div class="shiri-timer-bar" id="timer-bar"></div>
          <span class="shiri-timer-num" id="timer-num"></span>
        </div>
        <div class="kk-progress" id="kk-progress"></div>
        <div class="kk-stage" id="kk-stage"></div>
        <div class="kk-feedback" id="kk-feedback" role="status" aria-live="polite"></div>
        <div class="shiri-actions">
          ${cfg.totalSeconds ? '<button type="button" class="btn btn-small" id="kk-skip">パス ⏭</button>' : "<span></span>"}
          <button type="button" class="btn btn-small" id="kk-quit">やめる</button>
        </div>
        <div id="shiri-kb"></div>`);

      const $ = (s) => view.querySelector(s);
      const p = { text: "", pending: "", busy: true, timerId: null, pauseId: null, lastShown: -1 };
      p.kb = Keyboard.create($("#shiri-kb"), { onAction });
      p.detach = Keyboard.attachPhysicalKeys(() => "kana", onAction, () => p.kb.getKanaMethod());
      $("#shiri-kb").hidden = true;
      teardownPlay = () => { clearInterval(p.timerId); clearTimeout(p.pauseId); p.detach(); p.kb.destroy(); };

      /* ---- 表示 ---- */
      function drawHud() {
        const s = g.state();
        $("#hud-score").textContent = s.score;
        $("#hud-lives").textContent = s.lives === null ? "" : "♥".repeat(Math.max(0, s.lives)) + "♡".repeat(Math.max(0, cfg.lives - s.lives));
        let prog = "";
        if (cfg.maxQuestions) prog = `${Math.min(s.asked, cfg.maxQuestions)} / ${cfg.maxQuestions}問{もん}　正解{せいかい} ${s.correct}`;
        else prog = `正解{せいかい} ${s.correct}問{もん}` + (s.streak >= 2 ? `　🔥${s.streak}連続{れんぞく}` : "");
        $("#kk-progress").innerHTML = Ruby.html(prog);
      }
      function drawFields() {
        const f = $("#kk-reading");
        if (f) f.innerHTML = esc(p.text) + (p.pending ? `<span class="pending">${esc(p.pending)}</span>` : "");
      }
      function feedback(html, kind) { const f = $("#kk-feedback"); f.innerHTML = html; f.dataset.kind = kind || ""; Ruby.apply(f); }

      function showQuestion() {
        const q = g.state().q;
        p.text = ""; p.pending = "";
        if (!cfg.totalSeconds) feedback("");            // 前の問題の結果を消す(タイムアタックは待たずに進むので残す)
        const stage = $("#kk-stage");
        if (q.type === "read") {
          const okuri = !!q.kanji;                       // 送りがな付き(教える): 線の漢字の部分だけ答える
          stage.innerHTML = `
            <div class="kk-prompt">${Ruby.html(okuri ? "線{せん}の漢字{かんじ}の読{よ}みは？（送{おく}りがなは入力{にゅうりょく}しなくてOK）" : "この読{よ}みは？（ひらがなで入力{にゅうりょく}）")}</div>
            <div class="kk-word">${okuri ? `<span class="kk-target">${esc(q.kanji)}</span><span class="kk-okuri">${esc(q.okuri)}</span>` : esc(q.text)}</div>
            <div class="shiri-field is-active kk-field"><span class="shiri-text" id="kk-reading"></span></div>`;
          $("#shiri-kb").hidden = false;
          drawFields();
        } else {
          stage.innerHTML = `
            <div class="kk-prompt">${Ruby.html("□に入{はい}る漢字{かんじ}は？")}</div>
            <div class="kk-reading">${esc(q.reading)}</div>
            <div class="kk-word">${esc(q.text)}</div>
            <div class="kk-choices">
              ${q.choices.map((c, i) => `<button type="button" class="kk-choice" data-i="${i}" aria-label="${i + 1}番 ${esc(c)}"><span class="no">${i + 1}</span>${esc(c)}</button>`).join("")}
            </div>`;
          $("#shiri-kb").hidden = true;
          stage.querySelectorAll(".kk-choice").forEach((b) => b.addEventListener("pointerdown", (e) => { e.preventDefault(); submit({ choice: +b.dataset.i }); }));
        }
        p.busy = false;
        drawHud();
      }

      /* ---- 入力 ---- */
      function onAction(action) {
        if (p.busy || g.state().q === null || g.state().q.type !== "read") return;
        if (action.type === "submit") {
          const fixed = Romaji.flush({ text: p.text, pending: p.pending });
          p.text = fixed.text; p.pending = ""; drawFields();
          if (!p.text) return feedback(Ruby.html("読{よ}みを入力{にゅうりょく}してね"), "ng");
          return submit({ reading: p.text });
        }
        const r = Romaji.applyReading({ text: p.text, pending: p.pending }, action, { maxLength: MAX_READING });
        p.text = r.text; p.pending = r.pending;
        drawFields();
        if ($("#kk-feedback").dataset.kind === "ng") feedback("");
      }
      const onKey = (e) => {                      // 4択は 1〜4 キーでも答えられる
        if (p.busy || !/^[1-4]$/.test(e.key)) return;
        const q = g.state().q;
        if (q && q.type === "write") submit({ choice: +e.key - 1 });
      };
      document.addEventListener("keydown", onKey);
      const prevTeardown = teardownPlay;
      teardownPlay = () => { document.removeEventListener("keydown", onKey); prevTeardown(); };

      /* ---- 答える・次へ ---- */
      function submit(resp) {
        if (p.busy) return;
        p.busy = true;
        handle(g.answer(resp, Date.now()));
      }

      function handle(r) {
        if (r.ignored) { if (g.state().phase === "over") return finish(); p.busy = false; return; }
        drawHud();
        const q = r.question;
        const ans = q.type === "read" ? `${q.text}→${q.answer}` : `${q.answer}（${q.full}）`;
        if (r.skipped) feedback(Ruby.html("パス"), "");
        else if (r.correct) feedback(Ruby.html(`⭕ 正解{せいかい}！ +${r.points}点{てん}　答{こた}え：${ans}`), "ok");
        else feedback(Ruby.html(`${r.timeout ? "⏰ 時間切{じかんぎ}れ。" : "❌ "}答{こた}え：${ans}`), "ng");
        $("#kk-stage").classList.toggle("is-ng", !r.correct && !r.skipped);
        if (r.correct) { Sfx.play("ok"); Fx.floatText($("#hud-score"), "+" + r.points); Fx.pop($("#hud-score")); }
        else if (!r.skipped) { Sfx.play("ng"); Fx.shake($("#kk-stage")); if (g.state().lives !== null) Fx.shake($("#hud-lives")); }

        const quick = cfg.totalSeconds !== null;                          // タイムアタックは待たずに次へ
        const wait = quick ? 0 : r.correct ? 500 : 1700;
        const go = () => {
          if (!alive) return;
          if (r.over || !g.next(Date.now())) return finish();
          $("#kk-stage").classList.remove("is-ng");
          showQuestion();
        };
        if (r.over && !r.correct) p.pauseId = setTimeout(finish, 1500);   // 最後に間違えた時は、正解を少し見せる
        else if (wait) p.pauseId = setTimeout(go, wait);
        else go();
      }

      function finish() {
        clearInterval(p.timerId);
        p.busy = true;
        const sum = g.summary();
        sum.mistakes.forEach((m) => store.review.add({ text: m.text, reading: m.reading }));
        const record = store.best.submit(modeKey, level, sum.score, sum.correct);
        stopPlay();
        showResult(sum, record);
      }

      /* ---- タイマー(100msごと): 全体時間 or 1問の制限時間 ---- */
      p.timerId = setInterval(() => {
        const now = Date.now();
        const t = g.tick(now);
        if (t && t.timeout && !p.busy) { p.busy = true; return handle(t); }
        const s = g.state();
        if (s.phase === "over" && !p.busy) { p.busy = true; return finish(); }
        if (s.phase !== "asking") return;
        const rem = g.remainingMs(now);
        const total = cfg.totalSeconds ? cfg.totalSeconds * 1000 : Core.LIMIT[s.q.type] * 1000;
        $("#timer-bar").style.width = Math.min(100, rem / total * 100) + "%";
        $("#timer-bar").classList.toggle("is-low", rem <= 5000);
        const shown = Math.ceil(rem / 1000);
        if (shown !== p.lastShown) { p.lastShown = shown; $("#timer-num").textContent = shown; if (shown > 0 && shown <= 3) Sfx.play("tick"); }
      }, 100);

      $("#kk-quit").addEventListener("click", () => { if (confirm("やめてメニューに戻りますか？")) showMenu(); });
      const skip = $("#kk-skip");
      if (skip) skip.addEventListener("click", () => { if (p.busy) return; p.busy = true; handle(g.skip(Date.now())); });

      g.start(Date.now());
      showQuestion();
    }

    /* ============ けっか ============ */
    function showResult(sum, record) {
      const info = MODE_INFO.find((m) => m.key === sum.mode);
      const passed = sum.mode === "exam" && sum.reason === "done" && sum.correct >= Math.ceil(sum.maxQuestions * PASS_RATE);
      Sfx.play(passed || record ? "win" : sum.correct ? "end" : "lose");
      if (passed || record) Fx.confetti();
      let headline;
      if (sum.mode === "timeattack") headline = `60秒{びょう}で <b>${sum.correct}</b>問{もん}正解{せいかい}！`;
      else if (sum.mode === "survival") headline = `<b>${sum.correct}</b>問{もん}正解{せいかい}！`;
      else headline = `<b>${sum.correct}</b> / ${sum.answered}問{もん}正解{せいかい}`;
      const best = store.best.get(sum.mode, sum.level);
      render(`
        <div class="panel shiri-result">
          <div class="result-icon">${passed ? "🎓" : sum.correct ? "🎉" : "😢"}</div>
          <h3 class="menu-title">${info.icon} ${info.name}　${Q.LEVELS[sum.level - 1].label}</h3>
          <p>${END_TEXT[sum.reason] || ""}${passed ? "　<b>合格{ごうかく}！</b>" : ""}</p>
          <div class="result-score">${headline}</div>
          <div class="result-score">スコア <b>${sum.score}</b>${record ? ' <span class="badge-new">新記録{しんきろく}！</span>' : ""}</div>
          <p class="note">最高{さいこう}連続{れんぞく}正解{せいかい} ${sum.bestStreak}　・　ベスト ${best.score}点{てん}${sum.mode === "exam" ? `　・　合格{ごうかく}ライン ${Math.ceil(sum.maxQuestions * PASS_RATE)}問{もん}` : ""}</p>
          ${sum.mistakes.length ? `
            <h4 class="menu-sub">間違{まちが}えた言葉{ことば}（復習{ふくしゅう}に保存{ほぞん}したよ）</h4>
            <ul class="review-list">
              ${sum.mistakes.slice(0, 12).map((m) => `<li><span class="kk-rv-word">${esc(m.text)}</span><span class="rv-words"><span class="rv-correct">${esc(m.reading)}</span></span></li>`).join("")}
            </ul>` : ""}
          <div class="menu-actions">
            <button type="button" class="btn btn-primary" id="kk-again">もう一度{いちど}</button>
            <button type="button" class="btn" id="kk-menu">メニューへ</button>
          </div>
        </div>`);
      view.querySelector("#kk-again").addEventListener("click", () => play(sum.mode, sum.level));
      view.querySelector("#kk-menu").addEventListener("click", showMenu);
    }

    /* ============ 友達対戦(別ファイル online.js)。使う時に1回だけ作る ============ */
    let online = null;
    function getOnline() {
      if (!online) {
        online = root.KankenOnline.create({
          view, store, goMenu: showMenu, setPlaying,
          endpoint: (root.APP_CONFIG || {}).judgeEndpoint || ""
        });
      }
      return online;
    }

    cleanup = () => { alive = false; stopPlay(); if (online) online.destroy(); };
    showMenu();

    // QRコード/リンク(?room=12345&game=kanken)から来た時は、その部屋にそのまま入る
    const m = /[?&]room=(\d{5})(?:&|$)/.exec(location.search);
    if (m && /[?&]game=kanken(?:&|$)/.test(location.search)) getOnline().enter(m[1]);
  }

  function unmount() { if (cleanup) cleanup(); cleanup = null; }

  root.KankenGame = { mount, unmount };
})(window);
