/**
 * しりとり画面: メニュー → プレイ(対CPU) → けっか / ふくしゅう
 * 進行ロジックは game-core.js、保存は store.js、判定は judge.js。
 */
(function (root) {
  "use strict";

  const Rules = root.ShiritoriRules;
  const Input = root.ShiritoriInput;
  const Romaji = root.ShiritoriRomaji;
  const Keyboard = root.ShiritoriKeyboard;
  const Dictionary = root.ShiritoriDictionary;
  const Judge = root.ShiritoriJudge;
  const Core = root.ShiritoriGameCore;
  const Store = root.ShiritoriStore;
  const Remote = root.ShiritoriRemote;

  const MAX = { reading: 12, english: 30 };
  const CPU_THINK_MS = [700, 1300];

  const FORMAT_MESSAGES = {
    invalid_reading: "よみは ひらがな・カタカナで 2もじ いじょう いれてね",
    invalid_english: "えいごは アルファベットだけ（2〜30もじ）で いれてね",
    unknown_word: "じしょに のっていない ことばだよ。べつの ことばで ためしてね"
  };
  const RESULT_TEXT = {
    win:        { icon: "🎉", title: "かち！", sub: "CPUが ことばに こまっちゃった！" },
    lost_n:     { icon: "😵", title: "まけ…", sub: "「ん」で おわっちゃった！" },
    lost_lives: { icon: "😢", title: "ゲームオーバー", sub: "ライフが なくなっちゃった" }
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rand = (a, b) => a + Math.random() * (b - a);

  let cleanup = null;

  function mount(rootEl) {
    const store = Store.create((() => { try { return localStorage; } catch (_) { return null; } })());
    let dict = null, judge = null;
    let teardownPlay = null;      // プレイ中の後始末（タイマー・キーボード）
    let alive = true;

    rootEl.innerHTML = '<div class="shiri" id="shiri-view"></div>';
    const view = rootEl.querySelector("#shiri-view");

    /* ============ メニュー ============ */
    function showMenu() {
      stopPlay();
      const st = store.settings.get();
      const diffs = Object.values(Core.DIFFICULTIES);
      view.innerHTML = `
        <div class="panel shiri-menu">
          <h3 class="menu-title">しりとり × えいご</h3>
          <ul class="howto">
            <li>「り」から はじめて、さいごの もじで つなげよう！</li>
            <li>にほんごの <b>よみ</b> と、その <b>えいごの つづり</b> を ぜんぶ ただしく いれてね</li>
            <li>「ん」で おわったら まけ。おなじ えいごは つかえないよ</li>
          </ul>
          <h4 class="menu-sub">むずかしさ</h4>
          <div class="diff-row" role="radiogroup" aria-label="むずかしさ">
            ${diffs.map((d) => `
              <button type="button" class="diff-btn${d.key === st.difficulty ? " is-on" : ""}"
                      role="radio" aria-checked="${d.key === st.difficulty}" data-diff="${d.key}">
                <b>${d.label}</b>
                <small>${d.seconds}びょう ・ ♥${d.lives}</small>
                <small>ベスト ${store.best.get(d.key)}</small>
              </button>`).join("")}
          </div>
          <label class="setting small">
            <input type="checkbox" id="opt-dakuten" ${st.ignoreDakuten ? "checked" : ""}>
            <span>てんてんを くべつしない（ご→こ でも OK）</span>
          </label>
          <div class="menu-actions">
            <button type="button" class="btn btn-primary" id="btn-start">スタート！</button>
            <button type="button" class="btn" id="btn-review">ふくしゅう（${store.review.list().length}）</button>
          </div>
          <p class="note" id="shiri-note">じしょを よみこみ中…</p>
        </div>`;

      view.querySelectorAll(".diff-btn").forEach((b) => b.addEventListener("click", () => {
        store.settings.set({ difficulty: b.dataset.diff });
        showMenu();
      }));
      view.querySelector("#opt-dakuten").addEventListener("change", (e) =>
        store.settings.set({ ignoreDakuten: e.target.checked }));
      view.querySelector("#btn-review").addEventListener("click", showReview);
      const start = view.querySelector("#btn-start");
      start.addEventListener("click", startGame);
      start.disabled = !judge;
      const note = view.querySelector("#shiri-note");
      note.textContent = judge ? "" : "じしょを よみこみ中…";
      whenReady(() => { start.disabled = false; note.textContent = ""; });
    }

    let readyCallbacks = [];
    function whenReady(fn) { if (judge) fn(); else readyCallbacks.push(fn); }

    Dictionary.load().then((d) => {
      if (!alive) return;
      dict = d;
      const cfg = root.APP_CONFIG || {};
      let storage = null;
      try { storage = localStorage; } catch (_) {}
      // judgeEndpoint が空なら remote は null → 辞書だけで判定
      judge = Judge.create({ dict, remote: Remote.create({ endpoint: cfg.judgeEndpoint, storage }) });
      const cbs = readyCallbacks; readyCallbacks = [];
      cbs.forEach((fn) => fn());
    }).catch(() => {
      const note = view.querySelector("#shiri-note");
      if (alive && note) note.textContent = "じしょを よみこめませんでした。ページを さいどくみこみ してね";
    });

    /* ============ ふくしゅう ============ */
    function showReview() {
      const list = store.review.list();
      view.innerHTML = `
        <div class="panel">
          <h3 class="menu-title">ふくしゅう</h3>
          ${list.length ? `
            <p class="note">まちがえた ことばです。つづりを おぼえよう！</p>
            <ul class="review-list">
              ${list.map((e) => `
                <li>
                  <span class="rv-read">${esc(e.reading)}</span>
                  <span class="rv-correct">${esc(e.correct)}</span>
                  <span class="rv-typed">（${esc(e.typed)}）</span>
                  <button type="button" class="btn btn-small rv-del" data-r="${esc(e.reading)}" data-c="${esc(e.correct)}"
                          aria-label="${esc(e.reading)}を けす">✕</button>
                </li>`).join("")}
            </ul>` : '<p class="note">まだ ありません。まちがえた ことばが ここに たまるよ</p>'}
          <div class="menu-actions">
            <button type="button" class="btn" id="btn-back">もどる</button>
            ${list.length ? '<button type="button" class="btn btn-small" id="btn-clear">ぜんぶ けす</button>' : ""}
          </div>
        </div>`;
      view.querySelector("#btn-back").addEventListener("click", showMenu);
      const clear = view.querySelector("#btn-clear");
      if (clear) clear.addEventListener("click", () => {
        if (confirm("ふくしゅうリストを ぜんぶ けしますか？")) { store.review.clear(); showReview(); }
      });
      view.querySelectorAll(".rv-del").forEach((b) => b.addEventListener("click", () => {
        store.review.remove(b.dataset.r, b.dataset.c);
        showReview();
      }));
    }

    /* ============ プレイ ============ */
    const playEls = [rootEl.closest(".screen"), rootEl.closest("#app")].filter(Boolean);
    const setPlaying = (on) => playEls.forEach((el) => el.classList.toggle("shiri-playing", on));

    function stopPlay() {
      if (teardownPlay) teardownPlay();
      teardownPlay = null;
      setPlaying(false);
    }

    function startGame() {
      if (!judge) return;
      stopPlay();
      const st = store.settings.get();
      const game = Core.create({ dict, judge, difficulty: st.difficulty, ignoreDakuten: st.ignoreDakuten });
      const diff = game.difficulty;
      setPlaying(true);

      view.innerHTML = `
        <div class="shiri-hud">
          <div class="hud-lives" id="hud-lives" aria-label="ライフ"></div>
          <div class="hud-score">スコア <b id="hud-score">0</b></div>
        </div>
        <div class="shiri-timer" role="timer" aria-live="off">
          <div class="shiri-timer-bar" id="timer-bar"></div>
          <span class="shiri-timer-num" id="timer-num"></span>
        </div>
        <div class="shiri-bubble" id="bubble"></div>
        <div class="shiri-status" id="status"></div>
        <div class="shiri-fields">
          <button type="button" class="shiri-field is-active" data-field="reading">
            <span class="shiri-label">にほんご（よみ）</span>
            <span class="shiri-text" data-text="reading"></span>
          </button>
          <button type="button" class="shiri-field" data-field="english">
            <span class="shiri-label">えいご</span>
            <span class="shiri-text shiri-en" data-text="english"></span>
          </button>
        </div>
        <div class="shiri-message" id="message" role="status" aria-live="polite"></div>
        <div class="shiri-actions">
          <button type="button" class="btn btn-small" id="btn-hint">💡 ヒント（-5てん）</button>
          <button type="button" class="btn btn-small" id="btn-quit">やめる</button>
        </div>
        <div id="shiri-kb"></div>
        <ol class="shiri-history" id="history" reversed></ol>`;

      const $ = (s) => view.querySelector(s);
      // pending: ローマ字入力の途中(k など)。確定前なので text には入れない
      const state = { active: "reading", text: { reading: "", english: "" }, pending: "", busy: true };
      let deadline = 0, pausedAt = 0, timerId = null, cpuTimer = null, lastShown = -1;

      const kb = Keyboard.create($("#shiri-kb"), { onAction });
      const detachKeys = Keyboard.attachPhysicalKeys(() => kb.getMode(), onAction, () => kb.getKanaMethod());

      teardownPlay = () => {
        clearInterval(timerId); clearTimeout(cpuTimer);
        detachKeys(); kb.destroy();
      };

      /* ---- 表示 ---- */
      function renderHud() {
        const s = game.state();
        $("#hud-lives").textContent = "♥".repeat(Math.max(0, s.lives)) + "♡".repeat(Math.max(0, diff.lives - s.lives));
        $("#hud-score").textContent = s.score;
      }
      function renderFields() {
        view.querySelectorAll("[data-text]").forEach((t) => {
          const name = t.dataset.text;
          // よみ欄は、入力途中のローマ字を薄く下線つきで続けて表示する
          t.innerHTML = esc(state.text[name]) +
            (name === "reading" && state.pending ? `<span class="pending">${esc(state.pending)}</span>` : "");
        });
      }
      function renderHistory() {
        $("#history").innerHTML = game.state().history.slice().reverse().map((h) =>
          `<li class="${h.who}"><span class="who">${h.who === "cpu" ? "🤖" : "🙂"}</span>
             <b>${esc(h.reading)}</b> ＝ ${esc(h.english)}${h.points ? ` <em>+${h.points}</em>` : ""}</li>`).join("");
      }
      function renderStatus() {
        const req = game.state().required;
        $("#status").innerHTML = `つぎは 「<b>${esc(req)}</b>」から はじまる ことば！`;
      }
      function say(msg, kind) {
        const m = $("#message");
        m.textContent = msg || "";
        m.dataset.kind = kind || "";
      }
      function bubble(msg) { $("#bubble").textContent = msg || ""; }
      function setActive(name) {
        state.active = name;
        kb.setMode(name === "reading" ? "kana" : "en");
        view.querySelectorAll(".shiri-field").forEach((f) =>
          f.classList.toggle("is-active", f.dataset.field === name));
      }

      /* ---- タイマー ---- */
      function startTimer() {
        deadline = Date.now() + diff.seconds * 1000;
        clearInterval(timerId);
        timerId = setInterval(tick, 100);
        tick();
      }
      function remaining() { return Math.max(0, (deadline - Date.now()) / 1000); }
      function tick() {
        if (state.busy) return;
        const r = remaining();
        $("#timer-bar").style.width = (r / diff.seconds * 100) + "%";
        $("#timer-bar").classList.toggle("is-low", r <= 5);
        const shown = Math.ceil(r);
        if (shown !== lastShown) { lastShown = shown; $("#timer-num").textContent = shown; }
        if (r <= 0) onTimeout();
      }
      function pauseTimer() { pausedAt = Date.now(); }
      function resumeTimer() { deadline += Date.now() - pausedAt; }

      /* ---- ターン ---- */
      function newTurn(keepFields) {
        if (!keepFields) state.text = { reading: "", english: "" };
        state.pending = "";
        state.busy = false;
        renderFields(); renderStatus(); renderHud();
        setActive("reading");
        startTimer();
      }

      function handleMiss(r) {
        const MSG = {
          timeout: "じかんぎれ！",
          not_connected: `「${r.required}」から はじまって ないよ！`,
          duplicate: "その えいごは もう つかったよ！",
          spelling: `おしい！ つづりが ちがうよ。 せいかいは 「${r.correct}」`,
          wrong_english: r.correct
            ? `その よみと えいごは あってないよ。 たとえば 「${r.correct}」`
            : "その よみと えいごは あってないよ。"
        };
        if (r.review) store.review.add(r.review);
        renderHud();
        if (r.gameOver) { say(MSG[r.reason] || "", "ng"); return endGame(); }
        say((MSG[r.reason] || "") + "  ♥が 1つ へったよ", "ng");
        newTurn(false);
      }

      function onTimeout() {
        if (state.busy) return;
        state.busy = true;
        clearInterval(timerId);
        handleMiss(game.timeout());
      }

      async function submit() {
        if (state.busy) return;
        if (state.active === "reading") {
          // 入力途中の n を「ん」に確定してから調べる
          const fixed = Romaji.flush({ text: state.text.reading, pending: state.pending });
          state.text.reading = fixed.text; state.pending = "";
          renderFields();
          if (!Rules.normalizeReading(state.text.reading)) return say(FORMAT_MESSAGES.invalid_reading, "ng");
          say("");
          return setActive("english");
        }
        state.busy = true;
        const left = remaining();
        pauseTimer();
        const slow = setTimeout(() => say("🔍 かくにん中…", "hint"), 400); // Geminiに聞く時だけ見える
        const r = await game.submit(state.text.reading, state.text.english, left);
        clearTimeout(slow);
        if (!alive || !teardownPlay) return;

        if (r.kind === "retry") {
          say(FORMAT_MESSAGES[r.reason], "ng");
          if (r.reason === "invalid_reading") setActive("reading");
          resumeTimer(); state.busy = false;
          return;
        }
        clearInterval(timerId);
        if (r.kind === "miss") return handleMiss(r);

        // 成功
        renderHud(); renderHistory();
        say(`OK！ +${r.points}てん`, "ok");
        state.text = { reading: "", english: "" };
        state.pending = "";
        renderFields();
        if (r.gameOver) return endGame();
        cpuTurn();
      }

      function cpuTurn() {
        state.busy = true;
        bubble("🤖 かんがえ中…");
        cpuTimer = setTimeout(() => {
          const r = game.cpuTurn();
          if (r.kind === "cpu_stuck") { bubble("🤖 うーん… おもいつかない！"); return endGame(); }
          bubble(`🤖 「${r.reading}」 ＝ ${r.english}`);
          renderHistory();
          newTurn(true);
        }, rand(CPU_THINK_MS[0], CPU_THINK_MS[1]));
      }

      function onAction(action) {
        if (state.busy) return;
        if (action.type === "submit") return submit();
        const f = state.active;
        if (f === "reading") {
          const r = Romaji.applyReading({ text: state.text.reading, pending: state.pending }, action, { maxLength: MAX.reading });
          state.text.reading = r.text; state.pending = r.pending;
        } else {
          state.text[f] = Input.applyAction(state.text[f], action, { maxLength: MAX[f] });
        }
        renderFields();
        $("#message").dataset.kind === "ng" && say("");
      }

      function endGame() {
        state.busy = true;
        clearInterval(timerId);
        const s = game.state();
        const record = store.best.submit(diff.key, s.score);
        setTimeout(() => showResult(s, record), 900);
      }

      /* ---- ボタン ---- */
      $("#btn-hint").addEventListener("click", () => {
        if (state.busy) return;
        const h = game.hint();
        if (!h) return say("ヒントが みつからなかったよ", "ng");
        renderHud();
        say(`💡 「${h.reading}」 ＝ ${h.firstLetter.toUpperCase()}${" _".repeat(h.length - 1)}（${h.length}もじ） -${h.cost}てん`, "hint");
      });
      $("#btn-quit").addEventListener("click", () => {
        if (confirm("ゲームを やめて メニューに もどりますか？")) showMenu();
      });
      view.querySelectorAll(".shiri-field").forEach((f) =>
        f.addEventListener("click", () => { if (!state.busy) setActive(f.dataset.field); }));

      newTurn(false);
      bubble("🤖 「しりとり」！ きみは 「り」から だよ");
    }

    /* ============ けっか ============ */
    function showResult(s, record) {
      stopPlay();
      const t = RESULT_TEXT[s.result];
      const diffKey = store.settings.get().difficulty;
      view.innerHTML = `
        <div class="panel shiri-result">
          <div class="result-icon">${t.icon}</div>
          <h3 class="menu-title">${t.title}</h3>
          <p>${t.sub}</p>
          <div class="result-score">スコア <b>${s.score}</b>${record ? ' <span class="badge-new">しんきろく！</span>' : ""}</div>
          <p class="note">いえた ことば ${s.words}こ ・ ベスト ${store.best.get(diffKey)}</p>
          ${s.mistakes.length ? `
            <h4 class="menu-sub">まちがえた ことば（ふくしゅうに ほぞんしたよ）</h4>
            <ul class="review-list">
              ${s.mistakes.map((m) => `
                <li><span class="rv-read">${esc(m.reading)}</span>
                    <span class="rv-correct">${esc(m.correct)}</span>
                    <span class="rv-typed">（${esc(m.typed)}）</span></li>`).join("")}
            </ul>` : ""}
          <div class="menu-actions">
            <button type="button" class="btn btn-primary" id="btn-again">もういちど</button>
            <button type="button" class="btn" id="btn-menu">メニューへ</button>
          </div>
        </div>`;
      view.querySelector("#btn-again").addEventListener("click", startGame);
      view.querySelector("#btn-menu").addEventListener("click", showMenu);
    }

    cleanup = () => { alive = false; stopPlay(); };
    showMenu();
  }

  function unmount() {
    if (cleanup) cleanup();
    cleanup = null;
  }

  root.ShiritoriGame = { mount, unmount };
})(window);
