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
    invalid_reading: "読{よ}みはひらがな・カタカナで2文字{もじ}以上{いじょう}入{い}れてね",
    invalid_english: "英語{えいご}はアルファベットだけ（2〜30文字{もじ}）で入{い}れてね",
    unknown_word: "辞書{じしょ}にのっていない言葉{ことば}だよ。別{べつ}の言葉{ことば}で試{ため}してね"
  };
  const RESULT_TEXT = {
    win:        { icon: "🎉", title: "勝{か}ち！", sub: "CPUが言葉{ことば}に困{こま}っちゃった！" },
    lost_n:     { icon: "😵", title: "負{ま}け…", sub: "「ん」で終{お}わっちゃった！" },
    lost_lives: { icon: "😢", title: "ゲームオーバー", sub: "ライフがなくなっちゃった" }
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
          <h3 class="menu-title">しりとり × 英語{えいご}</h3>
          <ul class="howto">
            <li>「り」から始{はじ}めて、最後{さいご}の文字{もじ}でつなげよう！</li>
            <li>日本語{にほんご}の<b>読{よ}み</b>と、その<b>英語{えいご}のつづり</b>を全部{ぜんぶ}正{ただ}しく入{い}れてね</li>
            <li>「ん」で終{お}わったら負{ま}け。同{おな}じ英語{えいご}は使{つか}えないよ</li>
          </ul>
          <h4 class="menu-sub">難{むずか}しさ</h4>
          <div class="diff-row" role="radiogroup" aria-label="難しさ">
            ${diffs.map((d) => `
              <button type="button" class="diff-btn${d.key === st.difficulty ? " is-on" : ""}"
                      role="radio" aria-checked="${d.key === st.difficulty}" data-diff="${d.key}">
                <b>${d.label}</b>
                <small>${d.seconds}秒{びょう} ・ ♥${d.lives}</small>
                <small>ベスト ${store.best.get(d.key)}</small>
              </button>`).join("")}
          </div>
          <label class="setting small">
            <input type="checkbox" id="opt-dakuten" ${st.ignoreDakuten ? "checked" : ""}>
            <span>「てんてん」を区別{くべつ}しない（ご→こ でもOK）</span>
          </label>
          <div class="menu-actions">
            <button type="button" class="btn btn-primary" id="btn-start">スタート！</button>
            <button type="button" class="btn" id="btn-review">復習{ふくしゅう}（${store.review.list().length}）</button>
          </div>
          <p class="note" id="shiri-note">辞書{じしょ}を読{よ}み込{こ}み中{ちゅう}…</p>
        </div>`;
      Ruby.apply(view);

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
      note.innerHTML = judge ? "" : Ruby.html("辞書{じしょ}を読{よ}み込{こ}み中{ちゅう}…");
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
      if (alive && note) note.innerHTML = Ruby.html("辞書{じしょ}を読{よ}み込{こ}めませんでした。ページを再読{さいよ}み込{こ}みしてね");
    });

    /* ============ ふくしゅう ============ */
    function showReview() {
      const list = store.review.list();
      view.innerHTML = `
        <div class="panel">
          <h3 class="menu-title">復習{ふくしゅう}</h3>
          ${list.length ? `
            <p class="note">間違{まちが}えた言葉{ことば}です。つづりを覚{おぼ}えよう！</p>
            <ul class="review-list">
              ${list.map((e) => `
                <li>
                  <span class="rv-read">${esc(e.reading)}</span>
                  <span class="rv-words">
                    <span class="rv-correct">${esc(e.correct)}</span>
                    <span class="rv-typed">（${esc(e.typed)}）</span>
                  </span>
                  <button type="button" class="btn btn-small rv-del" data-r="${esc(e.reading)}" data-c="${esc(e.correct)}"
                          aria-label="${esc(e.reading)}を消す">✕</button>
                </li>`).join("")}
            </ul>` : '<p class="note">まだありません。間違{まちが}えた言葉{ことば}がここにたまるよ</p>'}
          <div class="menu-actions">
            <button type="button" class="btn" id="btn-back">戻{もど}る</button>
            ${list.length ? '<button type="button" class="btn btn-small" id="btn-clear">全部{ぜんぶ}消{け}す</button>' : ""}
          </div>
        </div>`;
      Ruby.apply(view);
      view.querySelector("#btn-back").addEventListener("click", showMenu);
      const clear = view.querySelector("#btn-clear");
      if (clear) clear.addEventListener("click", () => {
        if (confirm("復習リストを全部消しますか？")) { store.review.clear(); showReview(); }
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
        <ol class="shiri-history" id="history" reversed></ol>`;
      Ruby.apply(view);

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
        $("#status").innerHTML = Ruby.html("次{つぎ}は「") + `<b>${esc(req)}</b>` + Ruby.html("」から始{はじ}まる言葉{ことば}！");
      }
      function say(msg, kind) {
        const m = $("#message");
        m.innerHTML = Ruby.html(msg || "");
        m.dataset.kind = kind || "";
      }
      function bubble(msg) { $("#bubble").innerHTML = Ruby.html(msg || ""); }
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
          timeout: "時間{じかん}切{ぎ}れ！",
          not_connected: `「${r.required}」から始{はじ}まってないよ！`,
          duplicate: "その英語{えいご}はもう使{つか}ったよ！",
          spelling: `おしい！ つづりが違{ちが}うよ。 正解{せいかい}は「${r.correct}」`,
          wrong_english: r.correct
            ? `その読{よ}みと英語{えいご}は合{あ}ってないよ。 例{たと}えば「${r.correct}」`
            : "その読{よ}みと英語{えいご}は合{あ}ってないよ。"
        };
        if (r.review) store.review.add(r.review);
        renderHud();
        if (r.gameOver) { say(MSG[r.reason] || "", "ng"); return endGame(); }
        say((MSG[r.reason] || "") + "  ♥が1つ減{へ}ったよ", "ng");
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
        const slow = setTimeout(() => say("🔍 確認中{かくにんちゅう}…", "hint"), 400); // Geminiに聞く時だけ見える
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
        say(`OK！ +${r.points}点{てん}`, "ok");
        state.text = { reading: "", english: "" };
        state.pending = "";
        renderFields();
        if (r.gameOver) return endGame();
        cpuTurn();
      }

      function cpuTurn() {
        state.busy = true;
        bubble("🤖 考{かんが}え中{ちゅう}…");
        cpuTimer = setTimeout(() => {
          const r = game.cpuTurn();
          if (r.kind === "cpu_stuck") { bubble("🤖 うーん… 思{おも}いつかない！"); return endGame(); }
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
        if (!h) return say("ヒントが見{み}つからなかったよ", "ng");
        renderHud();
        say(`💡 「${h.reading}」 ＝ ${h.firstLetter.toUpperCase()}${" _".repeat(h.length - 1)}（${h.length}文字{もじ}） -${h.cost}点{てん}`, "hint");
      });
      $("#btn-quit").addEventListener("click", () => {
        if (confirm("ゲームをやめてメニューに戻りますか？")) showMenu();
      });
      view.querySelectorAll(".shiri-field").forEach((f) =>
        f.addEventListener("click", () => { if (!state.busy) setActive(f.dataset.field); }));

      newTurn(false);
      bubble("🤖 「しりとり」！ きみは「り」からだよ");
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
          <div class="result-score">スコア <b>${s.score}</b>${record ? ' <span class="badge-new">新記録{しんきろく}！</span>' : ""}</div>
          <p class="note">言{い}えた言葉{ことば} ${s.words}個{こ} ・ ベスト ${store.best.get(diffKey)}</p>
          ${s.mistakes.length ? `
            <h4 class="menu-sub">間違{まちが}えた言葉{ことば}（復習{ふくしゅう}に保存{ほぞん}したよ）</h4>
            <ul class="review-list">
              ${s.mistakes.map((m) => `
                <li><span class="rv-read">${esc(m.reading)}</span>
                    <span class="rv-words">
                      <span class="rv-correct">${esc(m.correct)}</span>
                      <span class="rv-typed">（${esc(m.typed)}）</span>
                    </span></li>`).join("")}
            </ul>` : ""}
          <div class="menu-actions">
            <button type="button" class="btn btn-primary" id="btn-again">もう一度{いちど}</button>
            <button type="button" class="btn" id="btn-menu">メニューへ</button>
          </div>
        </div>`;
      Ruby.apply(view);
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
