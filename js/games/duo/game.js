/**
 * 二択クイズの画面: メニュー(モード・科目・難しさ・3D) → ひとり用 → けっか / 友達対戦
 * 進行は core.js、出題は questions.js、3Dは scene3d.js、対戦画面は board.js、友達対戦は online.js(部屋はサーバー)。
 * データは、遊び始める時に必要な分だけ読み込む(data/duo.js、選んだ科目に応じて data/chem.js・data/geo.js、3D は js/vendor/three.min.js)。
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby;
  const Core = root.DuoCore;

  const MODES = [
    { key: "fixed10", mode: "fixed", rounds: 10, label: "10問{もん}" },
    { key: "fixed20", mode: "fixed", rounds: 20, label: "20問{もん}" },
    { key: "fixed30", mode: "fixed", rounds: 30, label: "30問{もん}" },
    { key: "survival", mode: "survival", rounds: 0, label: "サバイバル" }
  ];
  const SUBJECTS = [
    { key: "en", icon: "📖", name: "英語{えいご}" },
    { key: "chem", icon: "⚗️", name: "化学{かがく}" },
    { key: "phys", icon: "🔭", name: "物理{ぶつり}" },
    { key: "geo", icon: "🌏", name: "地理{ちり}" }
  ];
  const DIFFS = [{ key: "easy", label: "やさしい（基礎{きそ}中心{ちゅうしん}）" }, { key: "normal", label: "ふつう" }, { key: "hard", label: "むずかしい（発展{はってん}中心{ちゅうしん}）" }];
  const SRC = { duo: ["data/duo.js", () => !!root.DUO_DATA], chem: ["data/chem.js", () => !!root.CHEM_DATA], geo: ["data/geo.js", () => !!root.GEO_DATA] };

  const loaders = {};
  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    if (!loaders[src]) {
      loaders[src] = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src; s.onload = resolve;
        s.onerror = () => { delete loaders[src]; reject(new Error("load failed")); };
        document.head.appendChild(s);
      });
    }
    return loaders[src];
  }
  /** 選んだ科目に必要なデータを読み込む(化学の資料の描画に使う ChemDraw などは、ページの最初に読み込み済み) */
  function loadData(subjects) {
    const need = ["duo"];
    if (subjects.includes("chem")) need.push("chem");
    if (subjects.includes("geo")) need.push("geo");
    return Promise.all(need.map((k) => loadScript(SRC[k][0], SRC[k][1])));
  }
  const loadThree = () => loadScript("js/vendor/three.min.js", () => !!root.THREE);
  const makeQ = () => root.DuoQuestions.create({ duo: root.DUO_DATA, chem: root.CHEM_DATA, geo: root.GEO_DATA });
  const AVATAR = "🐶";

  let cleanup = null;

  function mount(rootEl) {
    let storage = null;
    try { storage = localStorage; } catch (_) {}
    const store = root.DuoStore.create(storage);
    let alive = true, stopSolo = null, online = null;

    rootEl.innerHTML = '<div class="geo-root duo-root" id="duo-view"></div>';
    const view = rootEl.querySelector("#duo-view");
    const render = (html) => { view.innerHTML = html; Ruby.apply(view); };

    const playEls = [rootEl.closest(".screen"), rootEl.closest("#app")].filter(Boolean);
    const setPlaying = (on) => playEls.forEach((el) => el.classList.toggle("shiri-playing", on));
    function stopPlay() { if (stopSolo) stopSolo(); stopSolo = null; setPlaying(false); }

    /* ============ メニュー ============ */
    function showMenu() {
      stopPlay();
      const s = store.settings.get();
      const cur = MODES.find((m) => m.mode === s.mode && (m.mode === "survival" || m.rounds === s.rounds));
      const rec = store.stats.get(s.mode, s.rounds);
      render(`
        <div class="panel shiri-menu">
          <h3 class="menu-title">🚃 二択{にたく}クイズ</h3>
          <p class="note">トロッコに乗{の}って、分{わ}かれ道{みち}で左右{さゆう}を選{えら}ぼう！正解{せいかい}の壁{かべ}は突{つ}き破{やぶ}れるけれど、まちがいの壁{かべ}にはぶつかっちゃう…。英語{えいご}・化学{かがく}・物理{ぶつり}・地理{ちり}の、大学入試{だいがくにゅうし}レベルの二択{にたく}問題{もんだい}に挑戦{ちょうせん}！友達{ともだち}（最大{さいだい}4人{にん}）とも遊{あそ}べるよ。</p>
          <h4 class="menu-sub">モード</h4>
          <div class="geo-opts" role="radiogroup" aria-label="モード">
            ${MODES.map((m) => `<button type="button" class="geo-opt${m === cur ? " is-on" : ""}" data-mode="${m.key}">${m.label}</button>`).join("")}
          </div>
          <p class="note">${s.mode === "survival" ? "ミスは3回まで。進{すす}むほど、制限時間{せいげんじかん}が短{みじか}く、問題{もんだい}がむずかしくなるよ。どこまで行{い}けるかな？" : "決{き}まった問題数{もんだいすう}で、点数{てんすう}をきそおう。早{はや}く答{こた}えるほど、連続{れんぞく}で正解{せいかい}するほど高得点{こうとくてん}！"}</p>
          <h4 class="menu-sub">科目{かもく}（いくつでも選{えら}べるよ）</h4>
          <div class="geo-opts duo-subjects">
            ${SUBJECTS.map((o) => `<button type="button" class="geo-opt${s.subjects.includes(o.key) ? " is-on" : ""}" data-subj="${o.key}" aria-pressed="${s.subjects.includes(o.key)}">${o.icon} ${o.name}</button>`).join("")}
          </div>
          <h4 class="menu-sub">難{むずか}しさ</h4>
          <div class="geo-opts" role="radiogroup" aria-label="難しさ">
            ${DIFFS.map((o) => `<button type="button" class="geo-opt${o.key === s.difficulty ? " is-on" : ""}" data-diff="${o.key}">${o.label}</button>`).join("")}
          </div>
          <h4 class="menu-sub">3D表示{ひょうじ}</h4>
          <div class="geo-opts">
            <button type="button" class="geo-opt${s.scene ? " is-on" : ""}" data-scene="1">ON（トロッコが走{はし}る）</button>
            <button type="button" class="geo-opt${!s.scene ? " is-on" : ""}" data-scene="0">OFF（かんたん・省電力{しょうでんりょく}）</button>
          </div>
          <p class="note">記録{きろく}（${cur ? cur.label : ""}）: ベスト <b>${rec.best}</b>点{てん} ・ 最高{さいこう}の連続正解{れんぞくせいかい} <b>${rec.streak}</b>${s.mode === "survival" ? ` ・ 最長{さいちょう} <b>${rec.rounds}</b>問{もん}` : ""} ・ ${rec.played}回{かい}</p>
          <div class="menu-actions">
            <button type="button" class="btn btn-primary" id="duo-start" disabled>スタート！</button>
            ${root.DuoOnline ? '<button type="button" class="btn" id="duo-friends">👥 友達{ともだち}と遊{あそ}ぶ</button>' : ""}
          </div>
          <p class="note" id="duo-note">データを読{よ}み込{こ}み中{ちゅう}…</p>
        </div>`);
      view.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { const m = MODES.find((x) => x.key === b.dataset.mode); store.settings.set({ mode: m.mode, rounds: m.rounds || store.settings.get().rounds }); showMenu(); }));
      view.querySelectorAll("[data-subj]").forEach((b) => b.addEventListener("click", () => {
        const now = store.settings.get().subjects, k = b.dataset.subj;
        const next = now.includes(k) ? now.filter((x) => x !== k) : now.concat(k);
        if (next.length) store.settings.set({ subjects: next });
        showMenu();
      }));
      view.querySelectorAll("[data-diff]").forEach((b) => b.addEventListener("click", () => { store.settings.set({ difficulty: b.dataset.diff }); showMenu(); }));
      view.querySelectorAll("[data-scene]").forEach((b) => b.addEventListener("click", () => { store.settings.set({ scene: b.dataset.scene === "1" }); showMenu(); }));
      const fr = view.querySelector("#duo-friends");
      if (fr) fr.addEventListener("click", () => getOnline().showFriends());
      const start = view.querySelector("#duo-start"), note = view.querySelector("#duo-note");
      start.addEventListener("click", playSolo);
      loadData(s.subjects).then(() => {
        if (!alive || !view.querySelector("#duo-note")) return;
        const Q = makeQ(), n = Q.count(s.subjects);
        const per = SUBJECTS.filter((o) => s.subjects.includes(o.key)).map((o) => `${o.name} ${Q.count([o.key])}`).join(" ・ ");
        start.disabled = n < 1;
        note.innerHTML = Ruby.html(n ? `出{だ}せる問題{もんだい}: ${n}問{もん}（${per}）` : "この科目{かもく}には、まだ問題{もんだい}がないよ。ほかの科目{かもく}も選{えら}んでね");
      }).catch(() => { if (alive && view.querySelector("#duo-note")) view.querySelector("#duo-note").innerHTML = Ruby.html("データを読{よ}み込{こ}めませんでした。ページを再読{さいよ}み込{こ}みしてね"); });
    }

    /* ============ ひとり用 ============ */
    function playSolo() {
      stopPlay();
      const s = store.settings.get();
      render('<div class="panel"><p class="note">じゅんびしています…</p></div>');
      Promise.all([loadData(s.subjects), s.scene ? loadThree().catch(() => null) : null]).then(() => {
        if (!alive) return;
        const E = Core.create(makeQ());
        const st = E.newGame({ players: [{ id: "me", name: "あなた", avatar: AVATAR }], mode: s.mode, rounds: s.rounds, difficulty: s.difficulty, subjects: s.subjects, now: Date.now() });
        setPlaying(true);
        view.innerHTML = "";
        let board = null, hiddenAt = 0, done = false, timer = null;
        const asView = () => E.view(st);
        const push = (events) => { if (events && events.length) board.update(asView(), events); if (st.phase === "over") finish(); };
        board = root.DuoBoard.create({
          el: view, myId: "me", avatarOf: () => AVATAR, serverNow: () => Date.now(), scene: s.scene, solo: true,
          actions: {
            choose(i) { push(E.choose(st, "me", i, Date.now()).events); },
            skip() { if (E.skip(st, Date.now())) { push(E.tick(st, Date.now())); } },
            quit: showMenu
          }
        });
        function finish() {
          if (done) return;
          done = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVis);
          const me = st.players[0];
          const rec = store.stats.add(s.mode, s.rounds, { score: me.score, bestStreak: me.bestStreak, rounds: st.round });
          setTimeout(() => {
            if (!alive || stopSolo !== stop) return;
            const html = board.resultHtml(asView());
            board.destroy(); setPlaying(false); stopSolo = null;
            root.Sfx.play("win"); root.Fx.confetti();
            render(html + `${rec.newBest ? '<p class="note"><b>🎉 ベスト記録{きろく}こうしん！</b></p>' : ""}<div class="menu-actions"><button type="button" class="btn btn-primary" id="duo-again">もう一度{いちど}</button><button type="button" class="btn" id="duo-menu">メニューへ</button></div></div>`);
            view.querySelector("#duo-again").addEventListener("click", playSolo);
            view.querySelector("#duo-menu").addEventListener("click", showMenu);
          }, 2800);
        }
        function step() {
          if (done || document.hidden) return;
          const events = E.tick(st, Date.now());
          if (events.length) push(events);
        }
        function onVis() {
          if (document.hidden) hiddenAt = Date.now();
          else if (hiddenAt) { E.shift(st, Date.now() - hiddenAt); hiddenAt = 0; }
        }
        document.addEventListener("visibilitychange", onVis);
        timer = setInterval(step, 120);
        const stop = () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); board.destroy(); };
        stopSolo = stop;
        board.update(asView(), []);
      }).catch(() => { if (alive) showMenu(); });
    }

    /* ============ 友達対戦 ============ */
    function getOnline() {
      if (!online) online = root.DuoOnline.create({ view, goMenu: showMenu, setPlaying, loadData: () => store.settings.get().subjects, load: loadData, loadThree, endpoint: (root.APP_CONFIG || {}).judgeEndpoint || "", getScene: () => store.settings.get().scene });
      return online;
    }

    showMenu();
    // QRコード/リンク(?room=12345&game=duo)から来た時は、その部屋にそのまま入る
    const m = /[?&]room=(\d{5})(?:&|$)/.exec(location.search);
    if (m && /[?&]game=duo(?:&|$)/.test(location.search) && root.DuoOnline) getOnline().enter(m[1]);
    cleanup = () => { alive = false; stopPlay(); if (online) online.destroy(); };
  }

  function unmount() { if (cleanup) cleanup(); cleanup = null; }

  root.DuoGame = { mount, unmount };
})(window);
