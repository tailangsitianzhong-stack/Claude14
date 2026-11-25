/**
 * 化学クイズの画面: メニュー(形式・単元・学年・難しさ・問題数・CPU) → ひとり用(CPUと対戦) → けっか / 友達対戦
 * 進行は core.js、出題は questions.js(計算は calc.js)、CPUは cpu.js、対戦画面は board.js + view-*.js、友達対戦は online.js(部屋はサーバー)。
 * データ(data/chem.js)は、遊び始める時に読み込む。地理クイズと同じ作り。
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby;
  const Core = root.ChemCore;
  const Text = root.ChemText;
  const Fmt = root.ChemFmt;
  const Units = root.ChemUnits;

  const MODES = [
    { key: "mix", icon: "🎲", name: "ミックス", desc: "早押{はやお}し・計算{けいさん}・資料選択{しりょうせんたく}が、1問{もん}ごとにまざって出{で}るよ！" },
    { key: "buzz", icon: "⚡", name: "早押{はやお}し", desc: "問題文{もんだいぶん}が1文字{もじ}ずつ流{なが}れる！わかったらすぐ押{お}して、用語{ようご}や化学式{かがくしき}を答{こた}えよう" },
    { key: "calc", icon: "🧮", name: "計算{けいさん}", desc: "モル・pH・電気分解{でんきぶんかい}など。数字{すうじ}キーで答{こた}えて、途中式{とちゅうしき}で復習{ふくしゅう}しよう" },
    { key: "choice", icon: "🖼️", name: "資料{しりょう}選択{せんたく}", desc: "グラフ・表{ひょう}・構造式{こうぞうしき}・周期表{しゅうきひょう}などを見{み}て、4択{たく}で答{こた}えよう" }
  ];
  const GRADES = [{ key: "high", label: "高校{こうこう}" }, { key: "exam", label: "高校{こうこう}（大学入試{だいがくにゅうし}）" }];
  const DIFFS = [{ key: "easy", label: "やさしい" }, { key: "normal", label: "ふつう" }, { key: "hard", label: "むずかしい" }];
  const AVATARS = ["🐶", "🐱", "🐰", "🐻"];

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
  const loadData = () => loadScript("data/chem.js", () => !!root.CHEM_DATA).then(() => root.CHEM_DATA);

  let cleanup = null;

  function mount(rootEl) {
    let storage = null;
    try { storage = localStorage; } catch (_) {}
    const store = root.ChemStore.create(storage);
    let alive = true, stopSolo = null, online = null, tools = null;

    rootEl.innerHTML = '<div class="geo-root chem-root" id="chem-view"></div>';
    const view = rootEl.querySelector("#chem-view");
    const render = (html) => { view.innerHTML = html; Ruby.apply(view); };

    const playEls = [rootEl.closest(".screen"), rootEl.closest("#app")].filter(Boolean);
    const setPlaying = (on) => playEls.forEach((el) => el.classList.toggle("shiri-playing", on));
    function stopPlay() { if (stopSolo) stopSolo(); stopSolo = null; setPlaying(false); }

    function makeTools(data) {
      if (!tools) {
        const Q = root.ChemQuestions.create(data);
        tools = { Q, E: Core.create(Q), Cpu: root.ChemCpu.create(), data };
      }
      return tools;
    }

    /** 選んだ範囲(学年・単元)で、出せる問題の数と、注意の文 */
    function rangeNote(s) {
      if (!tools) return "";
      const { Q } = tools, c = (m) => Q.count(m, { grade: s.grade, units: s.units });
      const total = c("buzz") + c("choice") + c("calc");
      if (!total) return "この範囲{はんい}には、まだ問題{もんだい}がないよ。ほかの単元{たんげん}も選{えら}んでね";
      const names = { buzz: "早押{はやお}し", calc: "計算{けいさん}", choice: "資料選択{しりょうせんたく}" };
      const missing = ["buzz", "calc", "choice"].filter((m) => !c(m)).map((m) => names[m]);
      const sel = s.mode === "mix" ? null : s.mode;
      if (sel && !c(sel)) return `この範囲{はんい}には「${names[sel]}」の問題{もんだい}がないよ。ミックスか、ほかの形式{けいしき}にしてね`;
      return missing.length ? `（この範囲{はんい}には ${missing.join("・")} の問題{もんだい}はないので、出{で}ないよ）` : "";
    }
    const canStart = (s) => !!tools && ["buzz", "calc", "choice"].filter((m) => (s.mode === "mix" || s.mode === m)).some((m) => tools.Q.count(m, { grade: s.grade, units: s.units }) > 0);

    /* ============ メニュー ============ */
    function showMenu() {
      stopPlay();
      const s = store.settings.get();
      const rec = store.stats.get(s.mode);
      const mode = MODES.find((m) => m.key === s.mode);
      render(`
        <div class="panel shiri-menu">
          <h3 class="menu-title">⚗️ 化学{かがく}クイズ</h3>
          <p class="note">高校{こうこう}の化学{かがく}を、早押{はやお}し・計算{けいさん}・資料選択{しりょうせんたく}（まぜて遊{あそ}ぶミックスも）で楽{たの}しもう！電池{でんち}や有機{ゆうき}・高分子{こうぶんし}など、単元{たんげん}を選{えら}んで練習{れんしゅう}できるよ。CPUや友達{ともだち}（最大{さいだい}4人{にん}）と点数{てんすう}をきそえるよ。</p>
          <h4 class="menu-sub">形式{けいしき}</h4>
          <div class="geo-modes" role="radiogroup" aria-label="形式">
            ${MODES.map((m) => `
              <button type="button" class="geo-mode${m.key === s.mode ? " is-on" : ""}" role="radio" aria-checked="${m.key === s.mode}" data-mode="${m.key}">
                <span class="ic">${m.icon}</span><span class="tx"><b>${m.name}</b><small>${m.desc}</small></span></button>`).join("")}
          </div>
          <h4 class="menu-sub">単元{たんげん}</h4>
          <div id="chem-units"></div>
          <h4 class="menu-sub">学年{がくねん}</h4>
          <div class="geo-opts" role="radiogroup" aria-label="学年">
            ${GRADES.map((o) => `<button type="button" class="geo-opt${o.key === s.grade ? " is-on" : ""}" data-grade="${o.key}">${o.label}</button>`).join("")}
          </div>
          <h4 class="menu-sub">難{むずか}しさ</h4>
          <div class="geo-opts" role="radiogroup" aria-label="難しさ">
            ${DIFFS.map((o) => `<button type="button" class="geo-opt${o.key === s.difficulty ? " is-on" : ""}" data-diff="${o.key}">${o.label}</button>`).join("")}
          </div>
          <h4 class="menu-sub">問題数{もんだいすう}</h4>
          <div class="geo-opts" role="radiogroup" aria-label="問題数">
            ${Core.ROUNDS.map((n) => `<button type="button" class="geo-opt${n === s.rounds ? " is-on" : ""}" data-rounds="${n}">${n}問{もん}</button>`).join("")}
          </div>
          <h4 class="menu-sub">CPUの人数{にんずう}</h4>
          <div class="geo-opts" role="radiogroup" aria-label="CPUの人数">
            ${[0, 1, 2, 3].map((n) => `<button type="button" class="geo-opt${n === s.cpus ? " is-on" : ""}" data-cpus="${n}">${n === 0 ? "ひとり" : n + "人{にん}"}</button>`).join("")}
          </div>
          <p class="note">戦績{せんせき}（${mode.name}）: <b>${rec.wins}</b>勝{しょう} / ${rec.played}戦{せん}・ベスト <b>${rec.best}</b>点{てん}</p>
          <div class="menu-actions">
            <button type="button" class="btn btn-primary" id="chem-start" disabled>スタート！</button>
            ${root.ChemOnline ? '<button type="button" class="btn" id="chem-friends">👥 友達{ともだち}と遊{あそ}ぶ</button>' : ""}
          </div>
          <p class="note" id="chem-note">データを読{よ}み込{こ}み中{ちゅう}…</p>
        </div>`);
      const bind = (sel, attr, key, conv) => view.querySelectorAll(sel).forEach((b) => b.addEventListener("click", () => { store.settings.set({ [key]: conv ? conv(b.dataset[attr]) : b.dataset[attr] }); showMenu(); }));
      bind(".geo-mode", "mode", "mode"); bind("[data-grade]", "grade", "grade"); bind("[data-diff]", "diff", "difficulty");
      bind("[data-rounds]", "rounds", "rounds", Number); bind("[data-cpus]", "cpus", "cpus", Number);
      const fr = view.querySelector("#chem-friends");
      if (fr) fr.addEventListener("click", () => getOnline().showFriends());
      const start = view.querySelector("#chem-start"), note = view.querySelector("#chem-note");
      const refresh = () => {
        if (!view.querySelector("#chem-start")) return;
        const cur = store.settings.get(), msg = rangeNote(cur);
        start.disabled = !canStart(cur);
        note.innerHTML = Ruby.html(msg);
      };
      root.ChemUnitPicker.create({ el: view.querySelector("#chem-units"), units: s.units, open: !s.units.length, onChange: (units) => { store.settings.set({ units }); refresh(); } });
      start.addEventListener("click", playSolo);
      loadData().then((data) => {
        if (!alive) return;
        makeTools(data);
        refresh();
      }).catch(() => { if (alive && view.querySelector("#chem-note")) view.querySelector("#chem-note").innerHTML = Ruby.html("データを読{よ}み込{こ}めませんでした。ページを再読{さいよ}み込{こ}みしてね"); });
    }

    /* ============ ひとり用(CPUと対戦) ============ */
    function playSolo() {
      if (!tools) return;
      stopPlay();
      const { E, Cpu, data } = tools;
      const s = store.settings.get();
      const players = [{ id: "me", name: "あなた", avatar: AVATARS[0] }];
      for (let i = 0; i < s.cpus; i++) players.push({ id: "c" + (i + 1), name: "CPU" + (i + 1), cpu: true, avatar: AVATARS[i + 1] });
      const st = E.newGame({ players, mode: s.mode, difficulty: s.difficulty, grade: s.grade, units: s.units, rounds: s.rounds, now: Date.now() });
      const avatarOf = (id) => (st.players.find((p) => p.id === id) || {}).avatar || "";
      const asView = () => E.view(st);
      const judgeFn = root.ChemJudge ? root.ChemJudge.create({ endpoint: (root.APP_CONFIG || {}).judgeEndpoint || "", storage }) : null;

      setPlaying(true);
      view.innerHTML = "";
      let board = null, plans = {}, planKey = "", hiddenAt = 0, done = false, timer = null;
      const push = (events) => { if (events && events.length) board.update(asView(), events); if (st.phase === "over") finish(); };

      board = root.ChemBoard.create({
        el: view, data, myId: "me", avatarOf, serverNow: () => Date.now(),
        actions: {
          choose(i) { push(E.choose(st, "me", i, Date.now()).events); },
          calc(text) { const r = E.calc(st, "me", text, Date.now()); if (!r.ok) board.rejected("うまく決定{けってい}できなかったよ"); else push(r.events); },
          press() { const r = E.press(st, "me", Date.now()); if (r.ok) push(r.events); },
          async answer(text) {
            const r = E.answer(st, "me", text, Date.now());
            if (!r.ok) return board.rejected(r.reason === "empty" ? "答{こた}えを入力{にゅうりょく}してね" : "うまく送{おく}れなかったよ");
            if (r.verdict === "unsure") {
              board.update(asView(), r.events);                                       // 「確認中…」
              let res = null;
              try { res = judgeFn ? await judgeFn.check({ question: Fmt.plain(st.q.text), answer: Fmt.plain(st.priv.ans), yomi: st.priv.yomi, forms: st.priv.forms, input: text }) : null; } catch (_) { res = null; }
              if (st.phase === "play" && st.buzz && st.buzz.judging) push(E.judged(st, "me", res === true, Date.now()).events);
              if (res === null) board.say("AIで確認{かくにん}できなかったよ（不正解{ふせいかい}になるよ）", "ng");
            } else push(r.events);
          },
          quit: showMenu
        }
      });

      function finish() {
        if (done) return;
        done = true;
        clearInterval(timer);
        document.removeEventListener("visibilitychange", onVis);
        const me = st.players.find((p) => p.id === "me");
        store.stats.add(s.mode, st.result.winners.includes("me"), me.score);
        setTimeout(() => {
          if (!alive || stopSolo !== stop) return;
          const html = board.resultHtml(asView());
          board.destroy(); setPlaying(false); stopSolo = null;
          const won = st.result.winners.includes("me");
          root.Sfx.play(won ? "win" : "lose"); if (won) root.Fx.confetti();
          render(html + `<div class="menu-actions"><button type="button" class="btn btn-primary" id="chem-again">もう一度{いちど}</button><button type="button" class="btn" id="chem-menu">メニューへ</button></div></div>`);
          view.querySelector("#chem-again").addEventListener("click", playSolo);
          view.querySelector("#chem-menu").addEventListener("click", showMenu);
        }, 2500);
      }

      /** CPUの動き: ラウンドごとに計画を立て、時間が来たら実行する */
      function cpuStep(now, events) {
        if (st.phase !== "play") { plans = {}; planKey = ""; return; }
        if (planKey !== st.q.id) { planKey = st.q.id; plans = {}; for (const p of st.players.filter((x) => x.cpu)) plans[p.id] = Object.assign(Cpu.plan(st, Math.random), { done: false }); }
        for (const p of st.players.filter((x) => x.cpu)) {
          const pl = plans[p.id]; if (!pl || pl.done || st.phase !== "play") continue;
          if (st.rmode === "choice" && now - st.startedAt >= pl.delayMs) { events.push(...E.choose(st, p.id, pl.i, now).events); pl.done = true; }
          else if (st.rmode === "calc" && now - st.startedAt >= pl.delayMs) { events.push(...E.calc(st, p.id, pl.text, now).events); pl.done = true; }
          else if (st.rmode === "buzz") {
            const b = st.buzz;
            if (!b.by && pl.pressIdx !== null && !b.lockedOut.includes(p.id) && !pl.pressedAt && Text.visible(st.q.at, now - st.startedAt - b.pauseMs) >= pl.pressIdx) {
              const r = E.press(st, p.id, now); if (r.ok) { pl.pressedAt = now; events.push(...r.events); }
            } else if (b.by === p.id && pl.pressedAt && !b.judging && now - pl.pressedAt >= pl.answerMs) {
              const r = E.answer(st, p.id, pl.text, now);
              events.push(...r.events);
              if (r.verdict === "unsure") events.push(...E.judged(st, p.id, false, now).events);      // CPUの答えは AI に聞かない
              pl.done = true;
            }
          }
        }
      }

      function step() {
        if (done || document.hidden) return;
        const now = Date.now();
        const events = E.tick(st, now);
        cpuStep(now, events);
        if (events.length) push(events);
      }
      /* 画面を離れている間は時間を止める(戻ったら止まっていた分だけ延ばす) */
      function onVis() {
        if (document.hidden) hiddenAt = Date.now();
        else if (hiddenAt) { const d = Date.now() - hiddenAt; E.shift(st, d); for (const pl of Object.values(plans)) if (pl.pressedAt) pl.pressedAt += d; hiddenAt = 0; }
      }
      document.addEventListener("visibilitychange", onVis);
      timer = setInterval(step, s.mode === "buzz" || s.mode === "mix" ? 100 : 250);
      const stop = () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); board.destroy(); };
      stopSolo = stop;
      board.update(asView(), []);
    }

    /* ============ 友達対戦 ============ */
    function getOnline() {
      if (!online) online = root.ChemOnline.create({ view, goMenu: showMenu, setPlaying, loadData, endpoint: (root.APP_CONFIG || {}).judgeEndpoint || "" });
      return online;
    }

    showMenu();
    // QRコード/リンク(?room=12345&game=chem)から来た時は、その部屋にそのまま入る
    const m = /[?&]room=(\d{5})(?:&|$)/.exec(location.search);
    if (m && /[?&]game=chem(?:&|$)/.test(location.search) && root.ChemOnline) getOnline().enter(m[1]);
    cleanup = () => { alive = false; stopPlay(); if (online) online.destroy(); };
  }

  function unmount() { if (cleanup) cleanup(); cleanup = null; }

  root.ChemGame = { mount, unmount };
})(window);
