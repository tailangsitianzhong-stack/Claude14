/**
 * 地理クイズの対戦画面の共通部分。ひとり用(CPU対戦)も友達対戦も、これを共通で使う。
 *
 *   const board = GeoBoard.create({ el, data, mode, myId, avatarOf, serverNow, actions:{ choose, lock, press, answer, quit } });
 *   board.update(view, events)     // 状態(core.js の view / 部屋の publicState)と、起きたこと
 *   board.say(html, kind)          // 一言(まちがいの理由など)
 *   board.destroy()
 *
 * 画面: ラウンド/制限時間(バーは1秒に1回だけ更新) / 参加者(得点) / 問題の表示(形式ごとの view-*.js) / 答え合わせ(得点の増減)
 * 形式ごとの表示は root.GeoViews[mode] (view-choice.js / view-map.js / view-buzz.js) が担当する。
 * 省電力: 無限アニメーションなし。動きは正解・まちがいの1回きりの演出だけ(docs/battery.md)
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function create(opts) {
    const el = opts.el;
    const myId = opts.myId;
    const avatarOf = opts.avatarOf || (() => "");
    const serverNow = opts.serverNow || (() => Date.now());

    el.innerHTML = `
      <div class="geo">
        <div class="geo-top"><span id="geo-round"></span><span class="geo-timer-num" id="geo-num"></span></div>
        <div class="shiri-timer geo-timer" role="timer" aria-live="off"><div class="shiri-timer-bar" id="geo-bar"></div></div>
        <div class="mp-players geo-players" id="geo-players"></div>
        <div class="geo-stage" id="geo-stage"></div>
        <div class="kk-feedback geo-say" id="geo-say" role="status" aria-live="polite"></div>
        <div class="geo-reveal" id="geo-reveal" hidden></div>
        <div id="geo-extra"></div>
        <div class="shiri-actions"><span></span><button type="button" class="btn btn-small" id="geo-quit">やめる</button></div>
      </div>`;
    const $ = (s) => el.querySelector(s);
    const u = { view: null, mv: null, mvMode: "", shown: -1, lastQ: "", timerId: null, lastTick: 0, prevPhase: "" };

    const ctxBase = { myId, avatarOf, serverNow, data: opts.data, actions: opts.actions || {}, say, stage: $("#geo-stage"), extra: $("#geo-extra"), sfx: root.Sfx, fx: root.Fx };

    function say(html, kind) {
      const f = $("#geo-say");
      f.innerHTML = Ruby.html(html || "");
      f.dataset.kind = kind || "";
    }

    function players(v) {
      const answered = v.phase === "play" ? v.answers || {} : {};
      const gains = (v.reveal && v.reveal.gains) || {};
      $("#geo-players").innerHTML = v.players.map((p) => `
        <div class="mp-chip geo-chip${p.id === myId ? " is-me" : ""}${answered[p.id] ? " is-done" : ""}${p.connected === false ? " is-off" : ""}" data-pid="${esc(p.id)}">
          <span class="av">${esc(avatarOf(p.id) || p.avatar || "")}</span>
          <span class="who">${p.id === myId ? "あなた" : p.cpu ? "CPU" : "友達{ともだち}"}</span>
          <span class="sc">${p.score}${v.phase === "between" && gains[p.id] ? `<em class="${gains[p.id] > 0 ? "up" : "down"}">${gains[p.id] > 0 ? "+" : ""}${gains[p.id]}</em>` : ""}</span>
          ${answered[p.id] ? '<span class="ok-mark" aria-label="答えた">✔</span>' : ""}
        </div>`).join("");
      Ruby.apply($("#geo-players"));
    }

    /** 答え合わせ(ラウンドの間)。正解の表示は形式ごとの view が作る */
    function reveal(v) {
      const box = $("#geo-reveal");
      if (v.phase !== "between" || !v.reveal) { box.hidden = true; return; }
      const mine = v.reveal.gains[myId] || 0;
      const head = v.reveal.reason === "none" || v.reveal.reason === "allwrong" ? "だれも正解できなかった…" : mine > 0 ? `⭕ +${mine}点{てん}！` : v.mode === "buzz" && v.reveal.by && v.reveal.by !== myId ? `${esc(avatarOf(v.reveal.by))} が正解！` : mine < 0 ? `❌ ${mine}点{てん}` : "❌ ざんねん…";
      const body = u.mv && u.mv.revealHtml ? u.mv.revealHtml(v) : "";
      box.innerHTML = `<div class="geo-reveal-head">${Ruby.html(head)}</div><div class="geo-reveal-body">${body}</div>`;
      Ruby.apply(box);
      box.hidden = false;
    }

    function result(v) {
      const r = v.result;
      const rank = r.ranking.map((x) => Object.assign({}, v.players.find((p) => p.id === x.id), x));
      const iWon = r.winners.includes(myId);
      return `
        <div class="panel shiri-result">
          <div class="result-icon">${iWon ? "🏆" : "🌏"}</div>
          <h3 class="menu-title">${r.winners.length > 1 ? (iWon ? "同点で1位！" : "同点1位があるよ") : iWon ? "あなたの勝{か}ち！" : `${esc(avatarOf(r.winners[0]))} の勝{か}ち！`}</h3>
          <p class="note">全${r.rounds}問{もん}</p>
          <ol class="rank-list">
            ${rank.map((p, i) => `<li><span class="no">${i + 1}位{い}</span><span class="av">${esc(avatarOf(p.id) || p.avatar || "")}</span>
              <span>${p.id === myId ? "あなた" : p.cpu ? "CPU" : ""}</span><span class="sc">${p.score}点{てん}</span><span class="wd">${p.correct}問{もん}正解{せいかい}</span></li>`).join("")}
          </ol>`;
    }

    /** 今のラウンドの形式(ミックスは、ラウンドごとに変わる)。まだ決まっていなければ null */
    const roundMode = (v) => v.rmode || (v.mode !== "mix" ? v.mode : null);
    const ICON = { buzz: "⚡", map: "🗺️", choice: "🖼️" };

    /** 形式が変わったら、前の形式の表示(キーボードなど)を片づけて、新しい形式の表示に切りかえる */
    function switchView(rm) {
      if (u.mvMode === rm) return;
      if (u.mv && u.mv.destroy) u.mv.destroy();
      u.mv = null; u.mvMode = rm; u.lastQ = "";
      ctxBase.stage.innerHTML = ""; ctxBase.extra.innerHTML = "";
      const V = rm && root.GeoViews && root.GeoViews[rm];
      u.mv = V ? V.create(ctxBase) : null;
    }

    function update(v, events) {
      u.view = v;
      const rm = roundMode(v);
      switchView(rm);
      if (!rm) ctxBase.stage.innerHTML = `<div class="geo-wait">${Ruby.html("よーい…")}</div>`;
      const newRound = v.q && v.q.id !== u.lastQ;
      const label = v.phase === "over" ? "おしまい" : v.round === 0 ? "もうすぐスタート！" : `${v.mode === "mix" && rm ? ICON[rm] + " " : ""}第${v.round}問{もん} / ${v.rounds}問{もん}`;
      $("#geo-round").innerHTML = Ruby.html(label);
      players(v);
      if (u.mv) u.mv.update(v, events || [], newRound);
      if (newRound) { u.lastQ = v.q.id; u.shown = -1; say("", ""); }
      reveal(v);
      // 音: ラウンド開始・答え合わせ
      for (const e of events || []) {
        if (e.type === "round") ctxBase.sfx.play("start");
        else if (e.type === "reveal") {
          const g = (e.gains && e.gains[myId]) || 0;
          ctxBase.sfx.play(g > 0 ? "ok" : g < 0 ? "ng" : "pop");
          if (g > 0) ctxBase.fx.pop($("#geo-players"));
        }
      }
      u.prevPhase = v.phase;
      if (v.phase !== "play") { $("#geo-num").textContent = ""; ctxBase.fx.timerBar($("#geo-bar"), 0, 1); u.shown = -1; }
    }

    /** 制限時間: 1秒に1回だけバーと数字を更新(省電力) */
    u.timerId = setInterval(() => {
      const v = u.view;
      if (!v || v.phase !== "play") return;
      const t = u.mv && u.mv.timer ? u.mv.timer(v, serverNow()) : null;
      if (!t) { if (u.shown !== -2) { u.shown = -2; $("#geo-num").textContent = ""; ctxBase.fx.timerBar($("#geo-bar"), 0, 1); } return; }
      const shown = Math.ceil(t.rem / 1000);
      if (shown === u.shown) return;
      u.shown = shown;
      $("#geo-num").textContent = shown;
      ctxBase.fx.timerBar($("#geo-bar"), t.rem, t.total);
      $("#geo-bar").classList.toggle("is-low", t.rem <= 5000);
      if (shown > 0 && shown <= 3 && t.tick !== false) ctxBase.sfx.play("tick");
    }, 250);

    $("#geo-quit").addEventListener("click", () => { if (confirm("ゲームをやめますか？")) (opts.actions && opts.actions.quit) && opts.actions.quit(); });

    return {
      update, say,
      resultHtml: result,
      rejected(msg) { say(msg, "ng"); ctxBase.sfx.play("ng"); if (u.mv && u.mv.unbusy) u.mv.unbusy(); },
      destroy() { clearInterval(u.timerId); if (u.mv && u.mv.destroy) u.mv.destroy(); }
    };
  }

  root.GeoViews = root.GeoViews || {};
  root.GeoBoard = { create, esc };
})(window);
