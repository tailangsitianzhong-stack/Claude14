/**
 * 英単語トランスミッションの画面: メニュー(難しさ・制限時間) → ひとり用 → けっか / 友達対戦
 * 進行は core.js、辞書は dict.js、AI確認は judge.js(辞書にない単語だけ)、対戦画面は board.js、友達対戦は online.js(部屋はサーバー)。
 * データ(data/ladder.js)は、遊び始める時に読み込む。
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby;
  const Core = root.LadderCore;
  const LEVELS = [
    { key: 1, label: "やさしい", desc: "3文字{もじ}・2〜3手{て}" },
    { key: 2, label: "ふつう", desc: "4文字{もじ}・3〜5手{て}" },
    { key: 3, label: "むずかしい", desc: "5文字{もじ}・4〜9手{て}" }
  ];
  const AVATAR = "🐶";

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
  const loadData = () => loadScript("data/ladder.js", () => !!root.LADDER_DATA).then(() => root.LADDER_DATA);

  let cleanup = null;

  function mount(rootEl) {
    let storage = null;
    try { storage = localStorage; } catch (_) {}
    const store = root.LadderStore.create(storage);
    let alive = true, stopSolo = null, online = null, tools = null;

    rootEl.innerHTML = '<div class="geo-root lad-root" id="lad-view"></div>';
    const view = rootEl.querySelector("#lad-view");
    const render = (html) => { view.innerHTML = html; Ruby.apply(view); };

    const playEls = [rootEl.closest(".screen"), rootEl.closest("#app")].filter(Boolean);
    const setPlaying = (on) => playEls.forEach((el) => el.classList.toggle("shiri-playing", on));
    function stopPlay() { if (stopSolo) stopSolo(); stopSolo = null; setPlaying(false); }

    function makeTools(data) {
      if (!tools) { const Dict = root.LadderDict.create(data); tools = { data, Dict, E: Core.create(Dict) }; }
      return tools;
    }

    /* ============ メニュー ============ */
    function showMenu() {
      stopPlay();
      const s = store.settings.get(), rec = store.stats.get(s.level), cur = LEVELS.find((l) => l.key === s.level);
      render(`
        <div class="panel shiri-menu">
          <h3 class="menu-title">⚙️ 英単語{えいたんご}トランスミッション</h3>
          <p class="note">スタートの単語{たんご}から、文字{もじ}を<b>1つずつ回{まわ}して</b>変{か}えて、ゴールの単語{たんご}までつなごう！途中{とちゅう}もぜんぶ意味{いみ}のある英単語{えいたんご}にするよ。</p>
          <div class="lad-example" aria-label="れい"><span class="lad-tiles"><b class="lad-tile">R</b><b class="lad-tile">O</b><b class="lad-tile">C</b><b class="lad-tile">K</b></span> → <span class="lad-tiles"><b class="lad-tile is-new">L</b><b class="lad-tile">O</b><b class="lad-tile">C</b><b class="lad-tile">K</b></span> → <span class="lad-tiles"><b class="lad-tile">L</b><b class="lad-tile">O</b><b class="lad-tile is-new">O</b><b class="lad-tile">K</b></span></div>
          <ul class="howto">
            <li>1回{かい}に変{か}えられるのは1文字{もじ}だけ。もう使{つか}った単語{たんご}は使{つか}えないよ</li>
            <li>ふつうの英単語{えいたんご}ならすぐ通{とお}って、意味{いみ}も出{で}るよ。NIKE（ナイキ）のような有名{ゆうめい}な名前{なまえ}は、AI（エーアイ）が確認{かくにん}するよ</li>
            <li>単語{たんご}じゃなかったら、ギア⚙️が1つ減{へ}る。0になるとおしまい</li>
            <li>最短{さいたん}の手数{てかず}でつなげたら★3！友達{ともだち}（最大{さいだい}4人{にん}）と順番{じゅんばん}に協力{きょうりょく}もできるよ</li>
          </ul>
          <h4 class="menu-sub">難{むずか}しさ</h4>
          <div class="geo-opts" role="radiogroup" aria-label="難しさ">
            ${LEVELS.map((l) => `<button type="button" class="geo-opt${l.key === s.level ? " is-on" : ""}" data-level="${l.key}"><b>${l.label}</b><br><small>${l.desc}</small></button>`).join("")}
          </div>
          <h4 class="menu-sub">制限時間{せいげんじかん}（ひとりのとき）</h4>
          <div class="geo-opts">
            <button type="button" class="geo-opt${!s.timed ? " is-on" : ""}" data-timed="0">なし（のんびり）</button>
            <button type="button" class="geo-opt${s.timed ? " is-on" : ""}" data-timed="1">あり（1手{て}ごとに）</button>
          </div>
          <p class="note">記録{きろく}（${cur.label}）: クリア <b>${rec.cleared}</b> / ${rec.played}回{かい} ・ ベスト <b>${"★".repeat(rec.stars) || "―"}</b>${rec.bestSteps ? ` ・ 最少{さいしょう} ${rec.bestSteps}手{て}` : ""}</p>
          <div class="menu-actions">
            <button type="button" class="btn btn-primary" id="lad-start" disabled>スタート！</button>
            ${root.LadderOnline ? '<button type="button" class="btn" id="lad-friends">👥 友達{ともだち}と遊{あそ}ぶ</button>' : ""}
          </div>
          <p class="note" id="lad-note">データを読{よ}み込{こ}み中{ちゅう}…</p>
        </div>`);
      view.querySelectorAll("[data-level]").forEach((b) => b.addEventListener("click", () => { store.settings.set({ level: Number(b.dataset.level) }); showMenu(); }));
      view.querySelectorAll("[data-timed]").forEach((b) => b.addEventListener("click", () => { store.settings.set({ timed: b.dataset.timed === "1" }); showMenu(); }));
      const fr = view.querySelector("#lad-friends");
      if (fr) fr.addEventListener("click", () => getOnline().showFriends());
      const start = view.querySelector("#lad-start"), note = view.querySelector("#lad-note");
      start.addEventListener("click", playSolo);
      loadData().then((data) => {
        if (!alive || !view.querySelector("#lad-note")) return;
        const t = makeTools(data);
        start.disabled = false;
        note.innerHTML = Ruby.html(`辞書{じしょ}の単語{たんご}: ${t.Dict.size}語{ご} ・ パズル: ${data.puzzles.filter((p) => p[3] === s.level).length}問{もん}`);
      }).catch(() => { if (alive && view.querySelector("#lad-note")) view.querySelector("#lad-note").innerHTML = Ruby.html("データを読{よ}み込{こ}めませんでした。ページを再読{さいよ}み込{こ}みしてね"); });
    }

    /* ============ ひとり用 ============ */
    function playSolo() {
      if (!tools) return;
      stopPlay();
      const { E, Dict, data } = tools;
      const s = store.settings.get();
      const puzzle = Core.pickPuzzle(data, s.level, Math.random, s.used);
      if (!puzzle) return;
      store.settings.markUsed(puzzle.id);
      const st = E.newGame({ players: [{ id: "me", name: "あなた", avatar: AVATAR }], puzzle, turnSec: s.timed ? Core.TURN_SEC[s.level] : null, now: Date.now() });
      const judgeFn = root.LadderJudge ? root.LadderJudge.create({ endpoint: (root.APP_CONFIG || {}).judgeEndpoint || "", storage }) : null;
      setPlaying(true);
      view.innerHTML = "";
      let board = null, hiddenAt = 0, done = false, timer = null;
      const asView = () => E.view(st);
      const push = (events) => { if (events && events.length) board.update(asView(), events); if (st.phase === "over") finish(); };

      board = root.LadderBoard.create({
        el: view, myId: "me", avatarOf: () => AVATAR, serverNow: () => Date.now(), solo: true, dict: Dict,
        actions: {
          async propose(word) {
            const r = E.propose(st, "me", word, Date.now());
            if (!r.ok || r.verdict === "rejected") { board.update(asView(), []); return board.rejected(Ruby.html(board.reasonText(r.reason))); }
            if (r.verdict === "unsure") {
              board.update(asView(), r.events);                                    // 「AIが確認中…」
              let res = null;
              try { res = judgeFn ? await judgeFn.check(r.word) : null; } catch (_) { res = null; }
              if (st.judging && st.phase === "play") push(E.judged(st, res ? res.ok : null, res, Date.now()).events);
            } else {
              push(r.events);
              if (r.needMeaning) fetchMeaning(r.word);                             // 意味は、あとから AI に聞く(待たずに先へ進める)
            }
          },
          hint() { const r = E.hint(st, "me", Date.now()); if (!r.ok) return board.rejected(Ruby.html(board.reasonText(r.reason))); push(r.events); },
          undo() { const r = E.undo(st, "me", Date.now()); if (!r.ok) return board.rejected(Ruby.html(board.reasonText(r.reason))); push(r.events); },
          quit: showMenu
        }
      });

      /** 辞書に意味がない単語の意味を、AI に聞いて、わかったら画面に出す(進行は止めない) */
      async function fetchMeaning(word) {
        let res = null;
        try { res = judgeFn ? await judgeFn.check(word) : null; } catch (_) { res = null; }
        if (done || st.phase === "over" && !st.meanings[word]) return;
        const r = E.setMeaning(st, word, res && res.ok ? res : null, Date.now());
        if (r.ok) board.update(asView(), r.events);
      }

      function finish() {
        if (done) return;
        done = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVis);
        store.stats.add(s.level, { win: st.result.win, stars: st.result.stars, steps: st.result.steps });
        setTimeout(() => {
          if (!alive || stopSolo !== stop) return;
          const html = board.resultHtml(asView());
          board.destroy(); setPlaying(false); stopSolo = null;
          root.Sfx.play(st.result.win ? "win" : "lose"); if (st.result.win) root.Fx.confetti();
          render(html + `<div class="menu-actions"><button type="button" class="btn btn-primary" id="lad-again">もう一度{いちど}</button><button type="button" class="btn" id="lad-menu">メニューへ</button></div></div>`);
          view.querySelector("#lad-again").addEventListener("click", playSolo);
          view.querySelector("#lad-menu").addEventListener("click", showMenu);
        }, 1800);
      }
      function step() { if (done || document.hidden) return; const ev = E.tick(st, Date.now()); if (ev.length) push(ev); }
      function onVis() { if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt) { E.shift(st, Date.now() - hiddenAt); hiddenAt = 0; } }
      document.addEventListener("visibilitychange", onVis);
      timer = setInterval(step, 250);
      const stop = () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); board.destroy(); };
      stopSolo = stop;
      board.update(asView(), []);
    }

    /* ============ 友達対戦 ============ */
    function getOnline() {
      if (!online) online = root.LadderOnline.create({ view, goMenu: showMenu, setPlaying, loadData, getDict: () => tools && tools.Dict, endpoint: (root.APP_CONFIG || {}).judgeEndpoint || "" });
      return online;
    }

    showMenu();
    // QRコード/リンク(?room=12345&game=ladder)から来た時は、その部屋にそのまま入る
    const m = /[?&]room=(\d{5})(?:&|$)/.exec(location.search);
    if (m && /[?&]game=ladder(?:&|$)/.test(location.search) && root.LadderOnline) getOnline().enter(m[1]);
    cleanup = () => { alive = false; stopPlay(); if (online) online.destroy(); };
  }

  function unmount() { if (cleanup) cleanup(); cleanup = null; }

  root.LadderGame = { mount, unmount };
})(window);
