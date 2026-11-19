/**
 * ミニネプリーグ(英語)の画面: メニュー → ひとり用(CPUと組んでチーム戦) → けっか / 友達対戦
 * 進行は core.js、お題は topics.js、CPUは cpu.js、対戦画面は board.js、友達対戦は online.js(部屋はサーバー)。
 * お題データ(data/nep.js・約300KB)は、ひとり用を始める時に読み込む(友達対戦の端末には要らない)。
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby;
  const Board = root.NepBoard;
  const Core = root.NepCore;

  const DIFFS = [
    { key: "easy", label: "やさしい", desc: "目標{もくひょう}は少{すく}なめ・CPUはのんびり" },
    { key: "normal", label: "ふつう", desc: "ちょうどいい" },
    { key: "hard", label: "むずかしい", desc: "目標{もくひょう}は多{おお}め・CPUは速{はや}くて物知{ものし}り" }
  ];
  const MODES = [
    { key: "vs", icon: "🔴🔵", name: "2対{たい}2の対戦{たいせん}", desc: "CPUの仲間{なかま}と組{く}んで、赤{あか}vs青{あお}。席{せき}は赤青赤青{あかあおあかあお}の順{じゅん}" },
    { key: "coop", icon: "🟢", name: "4人{にん}チーム（協力{きょうりょく}）", desc: "相手{あいて}はいない！みんなで力{ちから}を合{あ}わせて爆弾{ばくだん}を8個{こ}解除{かいじょ}しよう" }
  ];
  const PLAYER_AVATARS = ["🐶", "🐱", "🐰", "🐻"];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let cleanup = null;
  let dataPromise = null;
  function loadData() {
    if (root.NEP_DATA) return Promise.resolve(root.NEP_DATA);
    if (!dataPromise) {
      dataPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "data/nep.js";
        s.onload = () => resolve(root.NEP_DATA);
        s.onerror = () => { dataPromise = null; reject(new Error("load failed")); };
        document.head.appendChild(s);
      });
    }
    return dataPromise;
  }

  function mount(rootEl) {
    let storage = null;
    try { storage = localStorage; } catch (_) {}
    const store = root.NepStore.create(storage);
    let tools = null;            // { E, Cpu } データ読み込み後
    let alive = true, stopSolo = null, online = null;

    rootEl.innerHTML = '<div class="nep-root" id="nep-view"></div>';
    const view = rootEl.querySelector("#nep-view");
    const render = (html) => { view.innerHTML = html; Ruby.apply(view); };

    const playEls = [rootEl.closest(".screen"), rootEl.closest("#app")].filter(Boolean);
    const setPlaying = (on) => playEls.forEach((el) => el.classList.toggle("shiri-playing", on));
    function stopPlay() { if (stopSolo) stopSolo(); stopSolo = null; setPlaying(false); }

    /* ============ メニュー ============ */
    function showMenu() {
      stopPlay();
      const s = store.settings.get();
      const rec = store.stats.get(s.mode, s.difficulty);
      const modeInfo = MODES.find((m) => m.key === s.mode);
      render(`
        <div class="panel shiri-menu">
          <h3 class="menu-title">💣 ミニネプリーグ（英語{えいご}）</h3>
          <p class="note">チーム戦{せん}！爆弾{ばくだん}をまわしながら、お題{だい}に合{あ}う英単語{えいたんご}を1つずつ答{こた}えよう！</p>
          <details class="nep-rules">
            <summary>あそびかた</summary>
            <ul>
              <li>爆弾{ばくだん}を持{も}っている人{ひと}が、お題{だい}に合{あ}う英単語{えいたんご}を1つ答{こた}えると、次{つぎ}の席{せき}の人{ひと}に爆弾{ばくだん}がわたるよ</li>
              <li>みんなで目標{もくひょう}の数{かず}まで答{こた}えれば、爆弾{ばくだん}は<b>解除{かいじょ}</b>！（最後{さいご}に答{こた}えた人{ひと}は +20点{てん}）</li>
              <li>30秒{びょう}のうちに目標{もくひょう}に届{とど}かないと<b>爆発{ばくはつ}</b>！持{も}っていた人{ひと}の<b>チームの</b>ライフ(♥)が1つ減{へ}るよ</li>
              <li><b>2対{たい}2</b>：赤{あか}と青{あお}の2チーム。席{せき}は赤青赤青{あかあおあかあお}の順{じゅん}なので、答{こた}えるたびに爆弾{ばくだん}は相手{あいて}チームへ。相手{あいて}のライフをゼロにしたチームの勝{か}ち！</li>
              <li><b>4人{にん}チーム</b>：相手{あいて}はいないよ。4人{にん}で1つのチームになって、爆弾{ばくだん}を8個{こ}解除{かいじょ}したらクリア！ライフがなくなったら失敗{しっぱい}</li>
              <li>答{こた}えは<b>原形{げんけい}</b>で（dogs ではなく dog）。同{おな}じ爆弾{ばくだん}で同{おな}じ答{こた}えは使{つか}えないよ</li>
            </ul>
          </details>
          <h4 class="menu-sub">モード</h4>
          <div class="nep-modes" role="radiogroup" aria-label="モード">
            ${MODES.map((m) => `
              <button type="button" class="nep-mode${m.key === s.mode ? " is-on" : ""}" role="radio" aria-checked="${m.key === s.mode}" data-mode="${m.key}">
                <span class="ic">${m.icon}</span><span class="tx"><b>${m.name}</b><small>${m.desc}</small></span></button>`).join("")}
          </div>
          <h4 class="menu-sub">難{むずか}しさ</h4>
          <div class="nep-diffs" role="radiogroup" aria-label="難しさ">
            ${DIFFS.map((d) => `
              <button type="button" class="nep-diff${d.key === s.difficulty ? " is-on" : ""}" role="radio" aria-checked="${d.key === s.difficulty}" data-diff="${d.key}">
                <b>${d.label}</b><small>${d.desc}</small></button>`).join("")}
          </div>
          <p class="note">戦績{せんせき}（${modeInfo.name}・${DIFFS.find((d) => d.key === s.difficulty).label}）: <b>${rec.wins}</b>${s.mode === "coop" ? "回{かい}クリア" : "勝{しょう}"} / ${rec.played}戦{せん}</p>
          <div class="menu-actions">
            <button type="button" class="btn btn-primary" id="nep-start" disabled>スタート！</button>
            <button type="button" class="btn" id="nep-friends">👥 友達{ともだち}と遊{あそ}ぶ</button>
          </div>
          <p class="note" id="nep-note">データを読{よ}み込{こ}み中{ちゅう}…</p>
        </div>`);
      view.querySelectorAll(".nep-mode").forEach((b) => b.addEventListener("click", () => { store.settings.set({ mode: b.dataset.mode }); showMenu(); }));
      view.querySelectorAll(".nep-diff").forEach((b) => b.addEventListener("click", () => { store.settings.set({ difficulty: b.dataset.diff }); showMenu(); }));
      view.querySelector("#nep-friends").addEventListener("click", () => getOnline().showFriends());
      const start = view.querySelector("#nep-start");
      start.addEventListener("click", playSolo);
      const note = view.querySelector("#nep-note");
      const ready = () => { start.disabled = false; note.textContent = ""; };
      if (tools) ready();
      else loadData().then((data) => {
        if (!alive) return;
        const W = root.NepWords.create(data);
        const T = root.NepTopics.create(W, data);
        tools = { E: Core.create(T), Cpu: root.NepCpu.create(W, T) };
        if (view.querySelector("#nep-start")) ready();
      }).catch(() => { if (alive) note.innerHTML = Ruby.html("データを読{よ}み込{こ}めませんでした。ページを再読{さいよ}み込{こ}みしてね"); });
    }

    /* ============ ひとり用(CPUと対戦) ============ */
    function playSolo() {
      if (!tools) return;
      stopPlay();
      const { E, Cpu } = tools;
      const s = store.settings.get();
      // 席は4つ。自分は席0(vs なら赤)。vs は席の順に 赤・青・赤・青 なので、席2が自分の仲間、席1・3が相手
      const players = PLAYER_AVATARS.map((avatar, i) => (i === 0 ? { id: "me", name: "あなた", avatar } : { id: "c" + i, name: "CPU" + i, cpu: true, avatar }));
      const st = E.newGame({ players, difficulty: s.difficulty, mode: s.mode, now: Date.now() });
      const avatarOf = (id) => (st.players.find((p) => p.id === id) || {}).avatar || "";
      const nameOf = (id) => (st.players.find((p) => p.id === id) || {}).name || "";
      const asView = () => ({ players: st.players, g: st });

      setPlaying(true);
      view.innerHTML = "";
      const board = Board.create({
        el: view, myId: "me", nameOf, avatarOf, serverNow: () => Date.now(),
        onSubmit(word) {
          const r = E.answer(st, "me", word, Date.now());
          if (!r.ok && r.reason !== "timeout") return board.rejected(r);
          board.update(asView(), r.events);
          if (st.phase === "over") finish();
        },
        onHint() {
          const r = E.hint(st, "me", Date.now());
          if (!r.ok) return board.rejected(r);
          board.update(asView(), r.events);
        },
        hintCost: Core.HINT_COST,
        onQuit: showMenu
      });
      let plan = null, hiddenAt = 0, done = false;

      function finish() {
        if (done) return;
        done = true;
        const myTeam = E.byId(st, "me").team;
        const won = st.mode === "coop" ? st.result.cleared : st.result.winnerTeam === myTeam;
        store.stats.add(s.mode, s.difficulty, won);
        clearInterval(timer);
        document.removeEventListener("visibilitychange", onVis);
        setTimeout(() => {                      // 爆発の演出を少し見せてから結果へ
          if (!alive || stopSolo !== stop) return;
          board.destroy();
          setPlaying(false);
          stopSolo = null;
          Sfx.play(won ? "win" : "lose");
          if (won) Fx.confetti();
          render(Board.resultHtml(asView(), { myId: "me", avatarOf, nameOf }) + `
              <div class="menu-actions">
                <button type="button" class="btn btn-primary" id="nep-again">もう一度{いちど}</button>
                <button type="button" class="btn" id="nep-menu">メニューへ</button>
              </div>
            </div>`);
          view.querySelector("#nep-again").addEventListener("click", playSolo);
          view.querySelector("#nep-menu").addEventListener("click", showMenu);
        }, 1800);
      }

      function step() {
        if (done || document.hidden) return;
        const now = Date.now();
        let events = E.tick(st, now);
        if (st.phase === "play") {
          const holder = E.byId(st, st.holder);
          if (holder.cpu) {
            const key = st.round + ":" + st.count + ":" + st.holder;
            if (!plan || plan.key !== key) { const p = Cpu.plan(st); plan = { key, at: now + p.delayMs, word: p.word }; }
            else if (now >= plan.at) {
              const r = E.answer(st, st.holder, plan.word, now);
              events = events.concat(r.events);
              plan = null;
            }
          } else plan = null;
        } else plan = null;
        if (events.length) board.update(asView(), events);
        if (st.phase === "over") finish();
      }
      /* 画面を離れている間は、時間を止める(戻ったら止まっていた分だけ延ばす) */
      function onVis() {
        if (document.hidden) hiddenAt = Date.now();
        else if (hiddenAt) { const d = Date.now() - hiddenAt; E.shift(st, d); if (plan) plan.at += d; hiddenAt = 0; }
      }
      document.addEventListener("visibilitychange", onVis);
      const timer = setInterval(step, 250);
      const stop = () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); board.destroy(); };
      stopSolo = stop;
      board.update(asView(), []);
    }

    /* ============ 友達対戦 ============ */
    function getOnline() {
      if (!online) {
        online = root.NepOnline.create({
          view, goMenu: showMenu, setPlaying,
          endpoint: (root.APP_CONFIG || {}).judgeEndpoint || ""
        });
      }
      return online;
    }

    showMenu();
    // QRコード/リンク(?room=12345&game=nep)から来た時は、その部屋にそのまま入る
    const m = /[?&]room=(\d{5})(?:&|$)/.exec(location.search);
    if (m && /[?&]game=nep(?:&|$)/.test(location.search)) getOnline().enter(m[1]);
    cleanup = () => { alive = false; stopPlay(); if (online) online.destroy(); };
  }

  function unmount() { if (cleanup) cleanup(); cleanup = null; }

  root.NepGame = { mount, unmount };
})(window);
