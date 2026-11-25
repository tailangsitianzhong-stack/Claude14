/**
 * 地理クイズの画面: メニュー → ひとり用(CPUと対戦) → けっか / 友達対戦 / 写真の出典
 * 進行は core.js、出題は questions.js、CPUは cpu.js、対戦画面は board.js + view-*.js、友達対戦は online.js(部屋はサーバー)。
 * データ(data/geo.js 約140KB・data/geo-map.js 約270KB)は、遊び始める時に読み込む。
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby;
  const Core = root.GeoCore;
  const Text = root.GeoText;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const MODES = [
    { key: "mix", icon: "🎲", name: "ミックス", desc: "早押{はやお}し・地図{ちず}・資料選択{しりょうせんたく}が、1問{もん}ごとにまざって出{で}るよ！" },
    { key: "buzz", icon: "⚡", name: "早押{はやお}し", desc: "問題文{もんだいぶん}が1文字{もじ}ずつ流{なが}れる！わかったらすぐ押{お}して、かなで答{こた}えよう" },
    { key: "map", icon: "🗺️", name: "地図{ちず}で選{えら}ぶ", desc: "首都{しゅと}や有名{ゆうめい}な都市{とし}がある国{くに}（県{けん}）を、地図{ちず}からタップして選{えら}ぼう" },
    { key: "choice", icon: "🖼️", name: "資料{しりょう}選択{せんたく}", desc: "雨温図{うおんず}・表{ひょう}・写真{しゃしん}などを見{み}て、4択{たく}で答{こた}えよう" }
  ];
  const SCOPES = [{ key: "both", label: "どちらも" }, { key: "world", label: "世界{せかい}" }, { key: "japan", label: "日本{にほん}" }];
  const GRADES = [{ key: "all", label: "すべて" }, { key: "junior", label: "小学{しょうがく}・中学{ちゅうがく}" }, { key: "high", label: "高校{こうこう}" }, { key: "exam", label: "高校{こうこう}（大学入試{だいがくにゅうし}）", wide: true }];
  const DIFFS = [{ key: "easy", label: "やさしい" }, { key: "normal", label: "ふつう" }, { key: "hard", label: "むずかしい" }];
  const AVATARS = ["🐶", "🐱", "🐰", "🐻"];

  const loaders = {};
  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    if (!loaders[src]) {
      loaders[src] = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = () => { delete loaders[src]; reject(new Error("load failed")); };
        document.head.appendChild(s);
      });
    }
    return loaders[src];
  }
  /** 問題データ(+地図データ) を読み込む */
  const loadData = (withMap) => Promise.all([
    loadScript("data/geo.js", () => !!root.GEO_DATA),
    withMap ? loadScript("data/geo-map.js", () => !!root.GEO_MAP) : Promise.resolve()
  ]).then(() => root.GEO_DATA);

  let cleanup = null;

  function mount(rootEl) {
    let storage = null;
    try { storage = localStorage; } catch (_) {}
    const store = root.GeoStore.create(storage);
    let alive = true, stopSolo = null, online = null, tools = null;

    rootEl.innerHTML = '<div class="geo-root" id="geo-view"></div>';
    const view = rootEl.querySelector("#geo-view");
    const render = (html) => { view.innerHTML = html; Ruby.apply(view); };

    const playEls = [rootEl.closest(".screen"), rootEl.closest("#app")].filter(Boolean);
    const setPlaying = (on) => playEls.forEach((el) => el.classList.toggle("shiri-playing", on));
    function stopPlay() { if (stopSolo) stopSolo(); stopSolo = null; setPlaying(false); }

    /** 読み込み後の道具(出題・進行・CPU) */
    function makeTools(data) {
      if (!tools) {
        const Q = root.GeoQuestions.create(data);
        tools = { Q, E: Core.create(Q), Cpu: root.GeoCpu.create(data), data };
      }
      return tools;
    }

    /* ============ メニュー ============ */
    function showMenu() {
      stopPlay();
      const s = store.settings.get();
      const rec = store.stats.get(s.mode);
      const mode = MODES.find((m) => m.key === s.mode);
      render(`
        <div class="panel shiri-menu">
          <h3 class="menu-title">🌏 地理{ちり}クイズ</h3>
          <p class="note">世界{せかい}と日本{にほん}の地理{ちり}を、3つの形{かたち}（まぜて遊{あそ}ぶミックスも）で楽{たの}しもう！小学{しょうがく}・中学{ちゅうがく}から高校{こうこう}の地理{ちり}まで。CPUや友達{ともだち}（最大{さいだい}4人{にん}）と点数{てんすう}をきそえるよ。</p>
          <h4 class="menu-sub">形式{けいしき}</h4>
          <div class="geo-modes" role="radiogroup" aria-label="形式">
            ${MODES.map((m) => `
              <button type="button" class="geo-mode${m.key === s.mode ? " is-on" : ""}" role="radio" aria-checked="${m.key === s.mode}" data-mode="${m.key}">
                <span class="ic">${m.icon}</span><span class="tx"><b>${m.name}</b><small>${m.desc}</small></span></button>`).join("")}
          </div>
          <h4 class="menu-sub">範囲{はんい}</h4>
          <div class="geo-opts" role="radiogroup" aria-label="範囲">
            ${SCOPES.map((o) => `<button type="button" class="geo-opt${o.key === s.scope ? " is-on" : ""}" data-scope="${o.key}">${o.label}</button>`).join("")}
          </div>
          <h4 class="menu-sub">学年{がくねん}</h4>
          <div class="geo-opts" role="radiogroup" aria-label="学年">
            ${GRADES.map((o) => `<button type="button" class="geo-opt${o.key === s.grade ? " is-on" : ""}${o.wide ? " is-wide" : ""}" data-grade="${o.key}">${o.label}</button>`).join("")}
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
            <button type="button" class="btn btn-primary" id="geo-start" disabled>スタート！</button>
            ${root.GeoOnline ? '<button type="button" class="btn" id="geo-friends">👥 友達{ともだち}と遊{あそ}ぶ</button>' : ""}
            <button type="button" class="btn btn-small" id="geo-credits">📷 出典{しゅってん}・クレジット</button>
          </div>
          <p class="note" id="geo-note">データを読{よ}み込{こ}み中{ちゅう}…</p>
        </div>`);
      const bind = (sel, attr, key, conv) => view.querySelectorAll(sel).forEach((b) => b.addEventListener("click", () => { store.settings.set({ [key]: conv ? conv(b.dataset[attr]) : b.dataset[attr] }); showMenu(); }));
      bind(".geo-mode", "mode", "mode"); bind("[data-scope]", "scope", "scope"); bind("[data-grade]", "grade", "grade"); bind("[data-diff]", "diff", "difficulty");
      bind("[data-rounds]", "rounds", "rounds", Number); bind("[data-cpus]", "cpus", "cpus", Number);
      const fr = view.querySelector("#geo-friends");
      if (fr) fr.addEventListener("click", () => getOnline().showFriends());
      view.querySelector("#geo-credits").addEventListener("click", showCredits);
      const start = view.querySelector("#geo-start"), note = view.querySelector("#geo-note");
      start.addEventListener("click", playSolo);
      loadData(s.mode === "map" || s.mode === "mix").then((data) => {
        if (!alive) return;
        makeTools(data);
        if (view.querySelector("#geo-start")) { start.disabled = false; note.textContent = ""; }
      }).catch(() => { if (alive && view.querySelector("#geo-note")) view.querySelector("#geo-note").innerHTML = Ruby.html("データを読{よ}み込{こ}めませんでした。ページを再読{さいよ}み込{こ}みしてね"); });
    }

    /* ============ 写真の出典 ============ */
    function showCredits() {
      render(`<div class="panel"><h3 class="menu-title">出典{しゅってん}・クレジット</h3><p class="note" id="geo-cr">読{よ}み込{こ}み中{ちゅう}…</p>
        <div class="menu-actions"><button type="button" class="btn" id="geo-back">もどる</button></div></div>`);
      view.querySelector("#geo-back").addEventListener("click", showMenu);
      loadData(false).then((data) => {
        if (!alive || !view.querySelector("#geo-cr")) return;
        view.querySelector("#geo-cr").outerHTML = `
          <p class="note">地図: Natural Earth（パブリックドメイン）／ 国{くに}のデータ: world-countries（ODbL）／ 雨温図{うおんず}: 各都市{かくとし}の平年値{へいねんち}（気象庁{きしょうちょう}・各国{かっこく}の気象機関{きしょうきかん}の観測{かんそく}。英語版{えいごばん}Wikipediaの気候表{きこうひょう}より。一部{いちぶ}の都市{とし}は NASA POWER の気候値{きこうち}）／ 国{くに}の統計{とうけい}: World Bank Open Data（CC BY 4.0）</p>
          <h4 class="menu-sub">写真{しゃしん}</h4>
          <ul class="geo-credits">${data.photos.map((p) => `<li><b>${esc(p.answer)}</b>: ${esc(p.credit.author)} / <a href="${esc(p.credit.page)}" target="_blank" rel="noopener">${esc(p.credit.title)}</a> / ${p.credit.licenseUrl ? `<a href="${esc(p.credit.licenseUrl)}" target="_blank" rel="noopener">${esc(p.credit.license)}</a>` : esc(p.credit.license)}</li>`).join("")}</ul>`;
        Ruby.apply(view);
      });
    }

    /* ============ ひとり用(CPUと対戦) ============ */
    function playSolo() {
      if (!tools) return;
      stopPlay();
      const { E, Cpu, data } = tools;
      const s = store.settings.get();
      const players = [{ id: "me", name: "あなた", avatar: AVATARS[0] }];
      for (let i = 0; i < s.cpus; i++) players.push({ id: "c" + (i + 1), name: "CPU" + (i + 1), cpu: true, avatar: AVATARS[i + 1] });
      const st = E.newGame({ players, mode: s.mode, difficulty: s.difficulty, scope: s.scope, grade: s.grade, rounds: s.rounds, now: Date.now() });
      const avatarOf = (id) => (st.players.find((p) => p.id === id) || {}).avatar || "";
      const asView = () => E.view(st);
      const judgeFn = root.GeoJudge ? root.GeoJudge.create({ endpoint: (root.APP_CONFIG || {}).judgeEndpoint || "", storage }) : null;

      setPlaying(true);
      view.innerHTML = "";
      let board = null, plans = {}, planKey = "", hiddenAt = 0, done = false, timer = null;
      const push = (events) => { if (events && events.length) board.update(asView(), events); if (st.phase === "over") finish(); };

      board = root.GeoBoard.create({
        el: view, data, myId: "me", avatarOf, serverNow: () => Date.now(),
        actions: {
          choose(i) { push(E.choose(st, "me", i, Date.now()).events); },
          lock(id) { const r = E.lock(st, "me", id, Date.now()); if (!r.ok) board.rejected("うまく決定{けってい}できなかったよ"); else push(r.events); },
          press() { const r = E.press(st, "me", Date.now()); if (r.ok) push(r.events); },
          async answer(text) {
            const r = E.answer(st, "me", text, Date.now());
            if (!r.ok) return board.rejected(r.reason === "empty" ? "答{こた}えを入力{にゅうりょく}してね" : "うまく送{おく}れなかったよ");
            if (r.verdict === "unsure") {
              board.update(asView(), r.events);                                       // 「確認中…」
              let res = null;
              try { res = judgeFn ? await judgeFn.check({ question: st.q.text, answer: st.priv.ans, yomi: st.priv.yomi, input: text }) : null; } catch (_) { res = null; }
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
          render(html + `<div class="menu-actions"><button type="button" class="btn btn-primary" id="geo-again">もう一度{いちど}</button><button type="button" class="btn" id="geo-menu">メニューへ</button></div></div>`);
          view.querySelector("#geo-again").addEventListener("click", playSolo);
          view.querySelector("#geo-menu").addEventListener("click", showMenu);
        }, 2500);
      }

      /** CPUの動き: ラウンドごとに計画を立て、時間が来たら実行する */
      function cpuStep(now, events) {
        if (st.phase !== "play") { plans = {}; planKey = ""; return; }
        if (planKey !== st.q.id) { planKey = st.q.id; plans = {}; for (const p of st.players.filter((x) => x.cpu)) plans[p.id] = Object.assign(Cpu.plan(st, Math.random), { done: false }); }
        for (const p of st.players.filter((x) => x.cpu)) {
          const pl = plans[p.id]; if (!pl || pl.done || st.phase !== "play") continue;
          if (st.rmode === "choice" && now - st.startedAt >= pl.delayMs) { events.push(...E.choose(st, p.id, pl.i, now).events); pl.done = true; }
          else if (st.rmode === "map" && now - st.startedAt >= pl.delayMs) { events.push(...E.lock(st, p.id, pl.id, now).events); pl.done = true; }
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
      if (!online) {
        online = root.GeoOnline.create({ view, goMenu: showMenu, setPlaying, loadData, endpoint: (root.APP_CONFIG || {}).judgeEndpoint || "" });
      }
      return online;
    }

    showMenu();
    // QRコード/リンク(?room=12345&game=geo)から来た時は、その部屋にそのまま入る
    const m = /[?&]room=(\d{5})(?:&|$)/.exec(location.search);
    if (m && /[?&]game=geo(?:&|$)/.test(location.search) && root.GeoOnline) getOnline().enter(m[1]);
    cleanup = () => { alive = false; stopPlay(); if (online) online.destroy(); };
  }

  function unmount() { if (cleanup) cleanup(); cleanup = null; }

  root.GeoGame = { mount, unmount };
})(window);
