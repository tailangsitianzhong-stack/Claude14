/**
 * 英単語トランスミッションの友達対戦(協力)の画面（部屋・QR・番号入力・ロビーは、しりとりと同じ ShiritoriOnline を使う）
 *
 * ・2〜4人が、順番に1語ずつ出して、みんなでゴールまでつなぐ。手番・ギア・ヒント・AIの確認は、すべて部屋(サーバー)が持つ
 * ・対戦画面は board.js(ひとり用と共通)。部屋の状態 { players, g } をそのまま渡す。盤面はみんなに同じものが見える
 * ・ホストが、難しさ(文字数)を選ぶ
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby;
  const LEVELS = [{ key: "1", label: "やさしい（3文字{もじ}）" }, { key: "2", label: "ふつう（4文字{もじ}）" }, { key: "3", label: "むずかしい（5文字{もじ}）" }];

  function create(ctx) {
    let board = null, loading = false, dict = null;
    const viewOf = (st) => Object.assign({}, st.g, { players: st.players });

    function lobbySettings(st, isHost) {
      const lv = LEVELS.find((o) => o.key === String(st.settings.level));
      if (!isHost) return `<p class="note">難{むずか}しさ: <b>${lv.label}</b></p>`;
      return `<h4 class="menu-sub">難{むずか}しさ</h4><div class="geo-opts">${LEVELS.map((o) => `<button type="button" class="geo-opt${o.key === String(st.settings.level) ? " is-on" : ""}" data-llevel="${o.key}">${o.label}</button>`).join("")}</div>
        <p class="note">みんなで順番{じゅんばん}に1文字{もじ}ずつ変{か}えて、スタートからゴールまで単語{たんご}をつなごう！ギアが0になる前にゴールできるかな？</p>`;
    }
    function bindLobby(view, send) {
      view.querySelectorAll("[data-llevel]").forEach((b) => b.addEventListener("click", () => send({ t: "settings", settings: { level: Number(b.dataset.llevel) } })));
    }
    const startGate = (st, connected) => ({ ok: connected >= 2, note: "友達{ともだち}が入{はい}るまで待{ま}ってね（2人{ふたり}から遊{あそ}べるよ）" });

    function play(shell, events) {
      const st = shell.state;
      if (board) return board.update(viewOf(st), events || []);
      if (loading) return;
      loading = true;
      shell.setPlaying(true);
      shell.render('<div class="panel"><p class="note">じゅんびしています…</p></div>');
      ctx.loadData().then((data) => {
        loading = false;
        dict = root.LadderDict.create(data);
        if (!shell.state || shell.state.phase !== "playing") return;
        shell.view.innerHTML = "";
        board = root.LadderBoard.create({
          el: shell.view, myId: shell.cid, avatarOf: (id) => shell.avatarOf(id), serverNow: () => shell.serverNow(), solo: false, dict,
          actions: {
            propose: (word) => { if (!shell.send({ t: "propose", word })) board.rejected("通信{つうしん}できなかったよ"); },
            hint: () => { if (!shell.send({ t: "hint" })) board.rejected("通信{つうしん}できなかったよ"); },
            undo: () => { if (!shell.send({ t: "undo" })) board.rejected("通信{つうしん}できなかったよ"); },
            quit: () => shell.exit()
          }
        });
        shell.onTeardown(() => { if (board) board.destroy(); board = null; loading = false; });
        board.update(viewOf(shell.state), []);
      }).catch(() => { loading = false; shell.render('<div class="panel"><p class="note">データを読{よ}み込{こ}めませんでした。ページを再読{さいよ}み込{こ}みしてね</p></div>'); });
    }

    function onRejected(shell, m) {
      if (!board) return;
      board.rejected(Ruby.html(board.reasonText(m.reason || m.error)));
    }

    function over(shell) {
      if (board) { board.destroy(); board = null; }
      shell.setPlaying(false);
      const st = shell.state, v = viewOf(st);
      const tmp = root.LadderBoard.create({ el: document.createElement("div"), myId: shell.cid, avatarOf: (id) => shell.avatarOf(id), serverNow: () => Date.now(), solo: false, dict, actions: {} });
      const html = tmp.resultHtml(v); tmp.destroy();
      const win = v.result && v.result.win;
      root.Sfx.play(win ? "win" : "lose"); if (win) root.Fx.confetti();
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
      game: "ladder",
      help: ["みんなで順番{じゅんばん}に1文字{もじ}ずつ変{か}えて、スタートの単語{たんご}からゴールの単語{たんご}までつなごう！", "辞書{じしょ}にない単語{たんご}は、AI（エーアイ）が確認{かくにん}するよ。みんなで協力{きょうりょく}してクリアを目指{めざ}そう"],
      hooks: { lobbySettings, bindLobby, startGate, play, over, onRejected }
    });
  }

  root.LadderOnline = { create };
})(window);
