/**
 * ミニネプリーグ(英語)の友達対戦の画面（部屋・QR・番号入力・ロビーは、しりとりと同じ ShiritoriOnline を使う）
 *
 * ・お題・導火線・採点は部屋(サーバー)が持つ。端末は答えの一覧を知らず、答えた語(word)を送るだけ
 * ・対戦画面は board.js(ひとり用と共通)。部屋の状態 { players, g } をそのまま渡す
 * ・2〜4人。導火線は30秒で固定
 */
(function (root) {
  "use strict";

  const Board = root.NepBoard;
  const Ruby = root.Ruby;
  const DIFFS = [
    { key: "easy", label: "やさしい" },
    { key: "normal", label: "ふつう" },
    { key: "hard", label: "むずかしい" }
  ];
  const needText = { easy: "3〜5", normal: "4〜6", hard: "5〜8" };

  function create(ctx) {
    let board = null;

    function lobbySettings(st, isHost) {
      const cur = st.settings.difficulty;
      const label = DIFFS.find((d) => d.key === cur).label;
      if (!isHost) return `<p class="note">難{むずか}しさ: <b>${label}</b>（目標{もくひょう}は${needText[cur]}個{こ}）</p>`;
      return `
        <h4 class="menu-sub">難{むずか}しさ</h4>
        <div class="nep-diffs">
          ${DIFFS.map((d) => `<button type="button" class="nep-diff${d.key === cur ? " is-on" : ""}" data-diff="${d.key}"><b>${d.label}</b><small>目標{もくひょう}${needText[d.key]}個{こ}</small></button>`).join("")}
        </div>
        <p class="note">爆弾{ばくだん}をまわして、30秒{びょう}以内{いない}に目標{もくひょう}の数{かず}まで答{こた}えよう。爆発{ばくはつ}したら持{も}っていた人{ひと}だけライフ-1。最後{さいご}の1人{ひとり}が勝{か}ち！</p>`;
    }
    function bindLobby(view, send) {
      view.querySelectorAll(".nep-diff").forEach((b) => b.addEventListener("click", () => send({ t: "settings", settings: { difficulty: b.dataset.diff } })));
    }

    function play(shell, events) {
      if (!board) {
        shell.setPlaying(true);
        board = Board.create({
          el: shell.view, myId: shell.cid,
          nameOf: (id) => shell.nameOf(id), avatarOf: (id) => shell.avatarOf(id),
          serverNow: () => shell.serverNow(),
          onSubmit: (word) => { if (!shell.send({ t: "answer", word })) board.rejected({ reason: "send" }); },
          onQuit: () => shell.exit()
        });
        shell.onTeardown(() => { if (board) board.destroy(); board = null; });
      }
      const st = shell.state;
      board.update({ players: st.players, g: st.g }, events);
    }

    function onRejected(shell, m) {
      if (!board) return;
      board.rejected({ reason: m.reason || m.error, base: m.base, word: m.word });
    }

    function over(shell) {
      if (board) { board.destroy(); board = null; }
      shell.setPlaying(false);
      const st = shell.state;
      const v = { players: st.players, g: st.g };
      const iWon = st.g.result && st.g.result.winnerId === shell.cid;
      Sfx.play(iWon ? "win" : "lose");
      if (iWon) Fx.confetti();
      shell.render(Board.resultHtml(v, { myId: shell.cid, avatarOf: (id) => shell.avatarOf(id), nameOf: (id) => shell.nameOf(id) }) + `
          <div class="menu-actions">
            ${shell.isHost() ? '<button type="button" class="btn btn-primary" id="mp-again">もう一度{いちど}</button>'
              : '<p class="note">ホストが「もう一度{いちど}」を押{お}すのを待{ま}ってね</p>'}
            <button type="button" class="btn" id="mp-menu">メニューへ</button>
          </div>
        </div>`);
      const again = shell.view.querySelector("#mp-again");
      if (again) again.addEventListener("click", () => shell.send({ t: "rematch" }));
      shell.view.querySelector("#mp-menu").addEventListener("click", () => shell.exit());
    }

    return root.ShiritoriOnline.create({
      view: ctx.view, endpoint: ctx.endpoint, store: null,
      getJudge: () => null, goMenu: ctx.goMenu, setPlaying: ctx.setPlaying,
      game: "nep",
      help: ["爆弾{ばくだん}を持{も}っている人{ひと}が、お題{だい}に合{あ}う英単語{えいたんご}を答{こた}えて、となりの人{ひと}にわたすよ", "30秒{びょう}で目標{もくひょう}の数{かず}に届{とど}かないと爆発{ばくはつ}！最後{さいご}の1人{ひとり}が勝{か}ち！"],
      hooks: { lobbySettings, bindLobby, play, over, onRejected }
    });
  }

  root.NepOnline = { create };
})(window);
