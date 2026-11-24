/**
 * 地理クイズの友達対戦の画面（部屋・QR・番号入力・ロビーは、しりとりと同じ ShiritoriOnline を使う）
 *
 * ・出題・正解・時間・採点は部屋(サーバー)が持つ。端末は正解を知らず、選んだ答え(選択肢/場所/読み)を送るだけ
 * ・対戦画面は board.js + view-*.js(ひとり用と共通)。部屋の状態 { players, g } をそのまま渡す
 * ・2〜4人。早押しの答えのAI確認は、部屋(サーバー)が行う
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby;
  const MODES = [
    { key: "choice", icon: "🖼️", name: "資料{しりょう}選択{せんたく}" },
    { key: "map", icon: "🗺️", name: "地図{ちず}で選{えら}ぶ" },
    { key: "buzz", icon: "⚡", name: "早押{はやお}し" }
  ];
  const SCOPES = [{ key: "both", label: "どちらも" }, { key: "world", label: "世界{せかい}" }, { key: "japan", label: "日本{にほん}" }];
  const DIFFS = [{ key: "easy", label: "やさしい" }, { key: "normal", label: "ふつう" }, { key: "hard", label: "むずかしい" }];
  const REASONS = {
    not_playing: "もう締{し}め切{き}られたよ", timeout: "間{ま}に合{あ}わなかった…", already: "もう決定{けってい}しているよ", taken: "ほかの人{ひと}が先{さき}に押{お}したよ",
    locked_out: "この問題{もんだい}では押{お}せないよ", not_your_turn: "今{いま}はあなたの番{ばん}じゃないよ", bad_answer: "その答{こた}えは選{えら}べないよ", empty: "答{こた}えを入力{にゅうりょく}してね", judging: "確認中{かくにんちゅう}だよ"
  };

  function create(ctx) {
    let board = null, loading = false;
    const viewOf = (st) => Object.assign({}, st.g, { players: st.players });

    function lobbySettings(st, isHost) {
      const s = st.settings;
      const mode = MODES.find((m) => m.key === s.mode), scope = SCOPES.find((o) => o.key === s.scope), diff = DIFFS.find((o) => o.key === s.difficulty);
      if (!isHost) return `<p class="note">形式{けいしき}: <b>${mode.name}</b> ・ 範囲{はんい}: ${scope.label} ・ 難{むずか}しさ: ${diff.label} ・ ${s.rounds}問{もん}</p>`;
      const row = (title, items, cur, attr) => `<h4 class="menu-sub">${title}</h4><div class="geo-opts">${items.map((o) => `<button type="button" class="geo-opt${o.key === cur ? " is-on" : ""}" data-${attr}="${o.key}">${o.icon ? o.icon + " " : ""}${o.name || o.label}</button>`).join("")}</div>`;
      return row("形式{けいしき}", MODES, s.mode, "gmode") + row("範囲{はんい}", SCOPES, s.scope, "gscope") + row("難{むずか}しさ", DIFFS, s.difficulty, "gdiff") +
        row("問題数{もんだいすう}", [5, 10, 15].map((n) => ({ key: String(n), label: n + "問{もん}" })), String(s.rounds), "grounds") +
        `<p class="note">みんなで同{おな}じ問題{もんだい}に答{こた}えて、点数{てんすう}をきそおう！</p>`;
    }
    function bindLobby(view, send) {
      const bind = (sel, attr, key, conv) => view.querySelectorAll(sel).forEach((b) => b.addEventListener("click", () => send({ t: "settings", settings: { [key]: conv ? conv(b.dataset[attr]) : b.dataset[attr] } })));
      bind("[data-gmode]", "gmode", "mode"); bind("[data-gscope]", "gscope", "scope"); bind("[data-gdiff]", "gdiff", "difficulty"); bind("[data-grounds]", "grounds", "rounds", Number);
    }
    const startGate = (st, connected) => ({ ok: connected >= 2, note: "友達{ともだち}が入{はい}るまで待{ま}ってね（2人{ふたり}から遊{あそ}べるよ）" });

    function play(shell, events) {
      const st = shell.state;
      if (board) return board.update(viewOf(st), events || []);
      if (loading) return;
      loading = true;
      shell.setPlaying(true);
      shell.render('<div class="panel"><p class="note">データを読{よ}み込{こ}み中{ちゅう}…</p></div>');
      ctx.loadData(st.settings.mode === "map").then((data) => {
        loading = false;
        if (!shell.state || shell.state.phase !== "playing") return;
        shell.view.innerHTML = "";
        board = root.GeoBoard.create({
          el: shell.view, data, myId: shell.cid, avatarOf: (id) => shell.avatarOf(id), serverNow: () => shell.serverNow(),
          actions: {
            choose: (i) => { if (!shell.send({ t: "choose", i })) board.rejected("通信{つうしん}できなかったよ"); },
            lock: (id) => { if (!shell.send({ t: "lock", id })) board.rejected("通信{つうしん}できなかったよ"); },
            press: () => { shell.send({ t: "press" }); },
            answer: (text) => { if (!shell.send({ t: "answer", text })) board.rejected("通信{つうしん}できなかったよ"); },
            quit: () => shell.exit()
          }
        });
        shell.onTeardown(() => { if (board) board.destroy(); board = null; loading = false; });
        board.update(viewOf(shell.state), []);
      }).catch(() => { loading = false; shell.render('<div class="panel"><p class="note">データを読{よ}み込{こ}めませんでした。ページを再読{さいよ}み込{こ}みしてね</p></div>'); });
    }

    function onRejected(shell, m) {
      if (!board) return;
      board.rejected(REASONS[m.reason || m.error] || "うまくいかなかったよ");
    }

    function over(shell) {
      if (board) { board.destroy(); board = null; }
      shell.setPlaying(false);
      const st = shell.state;
      const v = viewOf(st);
      const tmp = root.GeoBoard.create({ el: document.createElement("div"), data: root.GEO_DATA || {}, myId: shell.cid, avatarOf: (id) => shell.avatarOf(id), serverNow: () => Date.now(), actions: {} });
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
      game: "geo",
      help: ["みんなで同{おな}じ地理{ちり}クイズに挑戦{ちょうせん}！早押{はやお}し・地図{ちず}・資料選択{しりょうせんたく}から選{えら}べるよ", "一番{いちばん}点数{てんすう}が高{たか}い人{ひと}の勝{か}ち！"],
      hooks: { lobbySettings, bindLobby, startGate, play, over, onRejected }
    });
  }

  root.GeoOnline = { create };
})(window);
