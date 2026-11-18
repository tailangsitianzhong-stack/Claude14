/**
 * ミニネプリーグ(英語)の画面: メニュー → ひとり用(CPUと対戦) → けっか / 友達対戦
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
  const CPU_AVATARS = ["🐱", "🐰", "🐻"];
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
      const rec = store.stats.get(s.difficulty);
      render(`
        <div class="panel shiri-menu">
          <h3 class="menu-title">💣 ミニネプリーグ（英語{えいご}）</h3>
          <p class="note">爆弾{ばくだん}をまわしながら、お題{だい}に合{あ}う英単語{えいたんご}を1つずつ答{こた}えよう！</p>
          <details class="nep-rules">
            <summary>あそびかた</summary>
            <ul>
              <li>爆弾{ばくだん}を持{も}っている人{ひと}が、お題{だい}に合{あ}う英単語{えいたんご}を1つ答{こた}えると、となりの人{ひと}に爆弾{ばくだん}がわたるよ</li>
              <li>みんなで目標{もくひょう}の数{かず}まで答{こた}えれば、爆弾{ばくだん}は<b>解除{かいじょ}</b>！（最後{さいご}に答{こた}えた人{ひと}は +20点{てん}）</li>
              <li>30秒{びょう}のうちに目標{もくひょう}に届{とど}かないと<b>爆発{ばくはつ}</b>！持{も}っていた人{ひと}だけライフ(♥)が1つ減{へ}るよ</li>
              <li>最後{さいご}まで生{い}き残{のこ}った人{ひと}の勝{か}ち！</li>
              <li>答{こた}えは<b>原形{げんけい}</b>で（dogs ではなく dog）。同{おな}じ爆弾{ばくだん}で同{おな}じ答{こた}えは使{つか}えないよ</li>
            </ul>
          </details>
          <h4 class="menu-sub">難{むずか}しさ</h4>
          <div class="nep-diffs" role="radiogroup" aria-label="難しさ">
            ${DIFFS.map((d) => `
              <button type="button" class="nep-diff${d.key === s.difficulty ? " is-on" : ""}" role="radio" aria-checked="${d.key === s.difficulty}" data-diff="${d.key}">
                <b>${d.label}</b><small>${d.desc}</small></button>`).join("")}
          </div>
          <h4 class="menu-sub">CPUの人数{にんずう}</h4>
          <div class="nep-cpus" role="radiogroup" aria-label="CPUの人数">
            ${[1, 2, 3].map((n) => `
              <button type="button" class="nep-cpu${n === s.cpus ? " is-on" : ""}" role="radio" aria-checked="${n === s.cpus}" data-cpus="${n}">
                <b>${n}人{にん}</b><small>あわせて${n + 1}人{にん}</small></button>`).join("")}
          </div>
          <p class="note">戦績{せんせき}（${DIFFS.find((d) => d.key === s.difficulty).label}）: <b>${rec.wins}</b>勝{しょう} / ${rec.played}戦{せん}</p>
          <div class="menu-actions">
            <button type="button" class="btn btn-primary" id="nep-start" disabled>スタート！</button>
            <button type="button" class="btn" id="nep-friends">👥 友達{ともだち}と遊{あそ}ぶ</button>
          </div>
          <p class="note" id="nep-note">データを読{よ}み込{こ}み中{ちゅう}…</p>
        </div>`);
      view.querySelectorAll(".nep-diff").forEach((b) => b.addEventListener("click", () => { store.settings.set({ difficulty: b.dataset.diff }); showMenu(); }));
      view.querySelectorAll(".nep-cpu").forEach((b) => b.addEventListener("click", () => { store.settings.set({ cpus: +b.dataset.cpus }); showMenu(); }));
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
      const players = [{ id: "me", name: "あなた", avatar: "🐶" }];
      for (let i = 0; i < s.cpus; i++) players.push({ id: "c" + (i + 1), name: "CPU" + (i + 1), cpu: true, avatar: CPU_AVATARS[i] });
      const st = E.newGame({ players, difficulty: s.difficulty, now: Date.now() });
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
        const won = st.result.winnerId === "me";
        store.stats.add(s.difficulty, won);
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
