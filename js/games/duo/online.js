/**
 * 二択クイズの友達対戦の画面（部屋・QR・番号入力・ロビーは、しりとりと同じ ShiritoriOnline を使う）
 *
 * ・出題・正解・時間・採点は部屋(サーバー)が持つ。端末は正解を知らず、選んだ側(0=左 / 1=右)を送るだけ
 * ・対戦画面は board.js(ひとり用と共通)。部屋の状態 { players, g } をそのまま渡す。3D は、全員のトロッコが同じ画面を走る
 * ・2〜4人。ホストが、モード(10・20・30問 / サバイバル)・科目・難しさを選ぶ。3D表示は、各自の端末の設定
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby;
  const MODES = [
    { key: "fixed10", mode: "fixed", rounds: 10, label: "10問{もん}" },
    { key: "fixed20", mode: "fixed", rounds: 20, label: "20問{もん}" },
    { key: "fixed30", mode: "fixed", rounds: 30, label: "30問{もん}" },
    { key: "survival", mode: "survival", rounds: 0, label: "サバイバル" }
  ];
  const SUBJECTS = [{ key: "en", icon: "📖", name: "英語{えいご}" }, { key: "chem", icon: "⚗️", name: "化学{かがく}" }, { key: "phys", icon: "🔭", name: "物理{ぶつり}" }, { key: "geo", icon: "🌏", name: "地理{ちり}" }];
  const DIFFS = [{ key: "easy", label: "やさしい" }, { key: "normal", label: "ふつう" }, { key: "hard", label: "むずかしい" }];
  const REASONS = {
    not_playing: "もう締{し}め切{き}られたよ", timeout: "間{ま}に合{あ}わなかった…", already: "もう決定{けってい}しているよ",
    sit_out: "この問題{もんだい}は答{こた}えられないよ（次{つぎ}の問題{もんだい}から）", bad_answer: "その答{こた}えは受{う}けつけられないよ"
  };

  function create(ctx) {
    let board = null, loading = false;
    const viewOf = (st) => Object.assign({}, st.g, { players: st.players });
    const modeKey = (s) => (s.mode === "survival" ? "survival" : "fixed" + s.rounds);

    function lobbySettings(st, isHost) {
      const s = st.settings, cur = MODES.find((m) => m.key === modeKey(s)), diff = DIFFS.find((o) => o.key === s.difficulty);
      const subj = SUBJECTS.filter((o) => s.subjects.includes(o.key));
      if (!isHost) return `<p class="note">モード: <b>${cur.label}</b> ・ 科目{かもく}: ${subj.map((o) => o.icon + o.name).join("・")} ・ 難{むずか}しさ: ${diff.label}</p>`;
      const row = (title, items, curKey, attr) => `<h4 class="menu-sub">${title}</h4><div class="geo-opts">${items.map((o) => `<button type="button" class="geo-opt${o.key === curKey ? " is-on" : ""}" data-${attr}="${o.key}">${o.icon ? o.icon + " " : ""}${o.name || o.label}</button>`).join("")}</div>`;
      return row("モード", MODES, modeKey(s), "dmode") +
        `<h4 class="menu-sub">科目{かもく}</h4><div class="geo-opts">${SUBJECTS.map((o) => `<button type="button" class="geo-opt${s.subjects.includes(o.key) ? " is-on" : ""}" data-dsubj="${o.key}">${o.icon} ${o.name}</button>`).join("")}</div>` +
        row("難{むずか}しさ", DIFFS, s.difficulty, "ddiff") +
        `<p class="note">${s.mode === "survival" ? "ミスは3回まで。全員{ぜんいん}のライフがなくなるまで続{つづ}くよ！" : "みんなで同{おな}じ二択{にたく}に挑戦{ちょうせん}！早{はや}く・連続{れんぞく}で正解{せいかい}すると高得点{こうとくてん}。"}</p>`;
    }
    function bindLobby(view, send, st) {
      view.querySelectorAll("[data-dmode]").forEach((b) => b.addEventListener("click", () => { const m = MODES.find((x) => x.key === b.dataset.dmode); send({ t: "settings", settings: { mode: m.mode, rounds: m.rounds || (st && st.settings.rounds) || 10 } }); }));
      view.querySelectorAll("[data-ddiff]").forEach((b) => b.addEventListener("click", () => send({ t: "settings", settings: { difficulty: b.dataset.ddiff } })));
      view.querySelectorAll("[data-dsubj]").forEach((b) => b.addEventListener("click", () => {
        const now = (st && st.settings.subjects) || [], k = b.dataset.dsubj;
        const next = now.includes(k) ? now.filter((x) => x !== k) : now.concat(k);
        if (next.length) send({ t: "settings", settings: { subjects: next } });
      }));
    }
    const startGate = (st, connected) => ({ ok: connected >= 2, note: "友達{ともだち}が入{はい}るまで待{ま}ってね（2人{ふたり}から遊{あそ}べるよ）" });

    function play(shell, events) {
      const st = shell.state;
      if (board) return board.update(viewOf(st), events || []);
      if (loading) return;
      loading = true;
      shell.setPlaying(true);
      shell.render('<div class="panel"><p class="note">じゅんびしています…</p></div>');
      const wantScene = ctx.getScene ? ctx.getScene() : true;
      (wantScene ? ctx.loadThree().catch(() => null) : Promise.resolve()).then(() => {
        loading = false;
        if (!shell.state || shell.state.phase !== "playing") return;
        shell.view.innerHTML = "";
        board = root.DuoBoard.create({
          el: shell.view, myId: shell.cid, avatarOf: (id) => shell.avatarOf(id), serverNow: () => shell.serverNow(), scene: wantScene, solo: false,
          actions: {
            choose: (i) => { if (!shell.send({ t: "choose", i })) board.rejected("通信{つうしん}できなかったよ"); },
            quit: () => shell.exit()
          }
        });
        shell.onTeardown(() => { if (board) board.destroy(); board = null; loading = false; });
        board.update(viewOf(shell.state), []);
      });
    }

    function onRejected(shell, m) {
      if (!board) return;
      board.rejected(REASONS[m.reason || m.error] || "うまくいかなかったよ");
    }

    function over(shell) {
      if (board) { board.destroy(); board = null; }
      shell.setPlaying(false);
      const st = shell.state, v = viewOf(st);
      const tmp = root.DuoBoard.create({ el: document.createElement("div"), myId: shell.cid, avatarOf: (id) => shell.avatarOf(id), serverNow: () => Date.now(), scene: false, actions: {} });
      const html = tmp.resultHtml(v); tmp.destroy();
      const won = v.result && v.result.winners.includes(shell.cid);
      root.Sfx.play(won ? "win" : "lose"); if (won) root.Fx.confetti();
      shell.render(html + `
          <div class="menu-actions">
            ${shell.isHost() ? '<button type="button" class="btn btn-primary" id="mp-again">もう一度{いちど}</button>' : '<p class="note">ホストが「もう一度{いちど}」を押{お}すのを待{ま}ってね</p>'}
            <button type="button" class="btn" id="mp-menu">メニューへ</button>
          </div></div>`);
      const again = shell.view.querySelector("#mp-again");
      if (again) again.addEventListener("click", () => shell.send({ t: "rematch" }));
      shell.view.querySelector("#mp-menu").addEventListener("click", () => shell.exit());
    }

    return root.ShiritoriOnline.create({
      view: ctx.view, endpoint: ctx.endpoint, store: null,
      getJudge: () => null, goMenu: ctx.goMenu, setPlaying: ctx.setPlaying,
      game: "duo",
      help: ["みんなで同{おな}じ二択{にたく}クイズに挑戦{ちょうせん}！トロッコがいっせいに走{はし}るよ", "一番{いちばん}点数{てんすう}が高{たか}い人{ひと}の勝{か}ち！"],
      hooks: { lobbySettings, bindLobby, startGate, play, over, onRejected }
    });
  }

  root.DuoOnline = { create };
})(window);
