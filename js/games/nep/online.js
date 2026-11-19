/**
 * ミニネプリーグ(英語)の友達対戦の画面（部屋・QR・番号入力・ロビーは、しりとりと同じ ShiritoriOnline を使う）
 *
 * ・お題・導火線・採点は部屋(サーバー)が持つ。端末は答えの一覧を知らず、答えた語(word)を送るだけ
 * ・対戦画面は board.js(ひとり用と共通)。部屋の状態 { players, g } をそのまま渡す
 * ・チーム戦だけ: 2対2(赤青赤青の席順・ちょうど4人) / チーム協力(2〜4人)。導火線は30秒で固定
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

    const MODES = [
      { key: "vs", icon: "🔴🔵", name: "2対{たい}2の対戦{たいせん}", desc: "ちょうど4人{にん}。席{せき}は赤青赤青{あかあおあかあお}の順{じゅん}" },
      { key: "coop", icon: "🟢", name: "チーム協力{きょうりょく}", desc: "2〜4人{にん}。相手{あいて}はいない。爆弾{ばくだん}を8個{こ}解除{かいじょ}しよう" }
    ];
    const TEAM_BADGE = { red: "🔴 赤{あか}", blue: "🔵 青{あお}", all: "🟢" };

    /** vs のとき、席(slot)の偶数が赤・奇数が青(席の順は赤青赤青) */
    const teamKeyOfSlot = (st, slot) => (st.settings.mode === "vs" ? (slot % 2 === 0 ? "red" : "blue") : "all");

    /** スタートできる条件: 2対2はちょうど4人、協力は2〜4人 */
    function startGate(st, connected) {
      if (st.settings.mode === "vs") {
        return { ok: connected === 4, note: "2対{たい}2は、ちょうど4人{にん}そろうとスタートできるよ（2〜3人{にん}なら「チーム協力{きょうりょく}」で遊{あそ}べるよ）" };
      }
      return { ok: connected >= 2, note: "友達{ともだち}が入{はい}るまで待{ま}ってね（2人{ふたり}から遊{あそ}べるよ）" };
    }
    /** メンバー欄の目印: どのチームか(2対2のとき) */
    function slotTag(st, p) {
      return st.settings.mode === "vs" ? `<span class="tag nep-tag team-${teamKeyOfSlot(st, p.slot)}">${TEAM_BADGE[teamKeyOfSlot(st, p.slot)]}</span>` : "";
    }

    function lobbySettings(st, isHost) {
      const cur = st.settings.difficulty;
      const mode = MODES.find((m) => m.key === st.settings.mode);
      const label = DIFFS.find((d) => d.key === cur).label;
      if (!isHost) return `<p class="note">モード: <b>${mode.name}</b>（${mode.desc}）<br>難{むずか}しさ: <b>${label}</b>（目標{もくひょう}は${needText[cur]}個{こ}）</p>`;
      return `
        <h4 class="menu-sub">モード</h4>
        <div class="nep-modes">
          ${MODES.map((m) => `<button type="button" class="nep-mode${m.key === st.settings.mode ? " is-on" : ""}" data-mode="${m.key}">
            <span class="ic">${m.icon}</span><span class="tx"><b>${m.name}</b><small>${m.desc}</small></span></button>`).join("")}
        </div>
        <h4 class="menu-sub">難{むずか}しさ</h4>
        <div class="nep-diffs">
          ${DIFFS.map((d) => `<button type="button" class="nep-diff${d.key === cur ? " is-on" : ""}" data-diff="${d.key}"><b>${d.label}</b><small>目標{もくひょう}${needText[d.key]}個{こ}</small></button>`).join("")}
        </div>
        <p class="note">爆弾{ばくだん}をまわして、30秒{びょう}以内{いない}に目標{もくひょう}の数{かず}まで答{こた}えよう。爆発{ばくはつ}したら、持{も}っていた人{ひと}のチームのライフ-1。</p>`;
    }
    function bindLobby(view, send) {
      view.querySelectorAll(".nep-mode").forEach((b) => b.addEventListener("click", () => send({ t: "settings", settings: { mode: b.dataset.mode } })));
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
          onHint: () => { if (!shell.send({ t: "hint" })) board.rejected({ reason: "send" }); },
          hintCost: 5,
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
      const r = st.g.result;
      const me = st.players.find((p) => p.id === shell.cid);
      const iWon = r.mode === "coop" ? r.cleared : !!me && r.winnerTeam === me.team;   // 協力はクリア / 対戦は自分のチームが勝ち
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
      help: ["爆弾{ばくだん}を持{も}っている人{ひと}が、お題{だい}に合{あ}う英単語{えいたんご}を答{こた}えて、次{つぎ}の席{せき}の人{ひと}にわたすよ", "2対{たい}2は赤{あか}vs青{あお}のチーム戦{せん}、協力{きょうりょく}はみんなで爆弾{ばくだん}を8個{こ}解除{かいじょ}！"],
      hooks: { lobbySettings, bindLobby, startGate, slotTag, play, over, onRejected }
    });
  }

  root.NepOnline = { create };
})(window);
