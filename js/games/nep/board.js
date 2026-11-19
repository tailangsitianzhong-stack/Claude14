/**
 * ミニネプリーグ(英語)の対戦画面の部品。ひとり用(CPU対戦)も友達対戦も、これを共通で使う。
 *
 *   const board = NepBoard.create({ el, myId, nameOf, avatarOf, serverNow, onSubmit(word), onHint(), onQuit() });
 *   board.update({ players, g }, events)   // 状態(core.js の state / 部屋の publicState)と、起きたこと
 *   board.rejected({ reason, base, word }) // 自分の答えが断られた
 *   board.destroy()
 *
 * 画面: チーム(♥・得点。赤/青、または みんなで1チーム) / 参加者(席の順・得点・💣) / お題カード(進み具合 ●●○○) / 導火線バー(1秒に1回だけ更新) /
 *       今のこたえ一覧 / 入力欄＋英語キーボード(自分の番だけ)
 * 省電力: 無限アニメーションなし。バーは 1 秒に1回。動きは Fx の1回きりの演出だけ(docs/battery.md)
 */
(function (root) {
  "use strict";

  const Input = root.ShiritoriInput;
  const Keyboard = root.ShiritoriKeyboard;
  const Ruby = root.Ruby;

  /** チームの色・名前(ルビ記法つき)。vs は赤と青、coop はみんなで1チーム */
  const TEAMS = {
    red: { emoji: "🔴", name: "赤{あか}チーム", cls: "team-red" },
    blue: { emoji: "🔵", name: "青{あお}チーム", cls: "team-blue" },
    all: { emoji: "🟢", name: "みんなのチーム", cls: "team-all" }
  };
  const teamInfo = (g, i) => TEAMS[(g.teams[i] || g.teams[0]).key];
  const hearts = (t) => "♥".repeat(Math.max(0, t.lives)) + "♡".repeat(Math.max(0, t.maxLives - t.lives));
  const meOf = (v, id) => v.players.find((p) => p.id === id);
  const MAX_WORD = 24;
  const GRACE_MS = 1500;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /** 答えが断られた理由 → 表示 */
  function rejectText(r) {
    switch (r.reason) {
      case "format": return "英字{えいじ}の1語{ご}だけで入力{にゅうりょく}してね";
      case "short": return "もう少{すこ}し長{なが}く入力{にゅうりょく}してね";
      case "dup": return "その言葉{ことば}はもう出{で}たよ！";
      case "inflected": return `「${esc(r.word || "")}」は変化形{へんかけい}だよ。原形{げんけい}${r.base ? "（" + esc(r.base) + "）" : ""}で答{こた}えてね`;
      case "wrong": return "お題{だい}に合{あ}わないよ";
      case "unknown": return "単語{たんご}リストにないよ";
      case "not_your_turn": return "今{いま}はあなたの番{ばん}じゃないよ";
      case "timeout": return "間{ま}に合{あ}わなかった…";
      case "hint_used": return "ヒントは、このラウンドではもう使{つか}ったよ";
      case "no_hint": return "ヒントが出{だ}せなかったよ";
      default: return "うまくいかなかったよ";
    }
  }

  function create(opts) {
    const el = opts.el;
    const myId = opts.myId;
    const nameOf = opts.nameOf || ((id) => id);
    const avatarOf = opts.avatarOf || (() => "");
    const serverNow = opts.serverNow || (() => Date.now());

    el.innerHTML = `
      <div class="nep">
        <div class="nep-teams" id="nep-teams"></div>
        <div class="mp-players nep-players" id="nep-players"></div>
        <div class="nep-card" id="nep-card">
          <div class="nep-title" id="nep-title"></div>
          <div class="nep-dots" id="nep-dots" aria-live="off"></div>
          <div class="nep-big" id="nep-big"></div>
          <div class="nep-sub" id="nep-sub"></div>
        </div>
        <div class="shiri-timer nep-fuse" role="timer" aria-live="off">
          <div class="shiri-timer-bar" id="nep-bar"></div>
          <span class="shiri-timer-num" id="nep-num"></span>
        </div>
        <div class="shiri-status nep-status" id="nep-status"></div>
        <div class="nep-hint" id="nep-hint" aria-live="polite" hidden></div>
        <div class="nep-used" id="nep-used" aria-label="出た答え"></div>
        <div class="shiri-field is-active nep-field" id="nep-field" hidden><span class="shiri-text shiri-en" id="nep-text"></span></div>
        <div class="kk-feedback nep-feedback" id="nep-feedback" role="status" aria-live="polite"></div>
        <div class="shiri-actions"><button type="button" class="btn btn-small nep-hint-btn" id="nep-hint-btn" hidden></button><button type="button" class="btn btn-small" id="nep-quit">やめる</button></div>
        <div id="shiri-kb"></div>
      </div>`;
    const $ = (s) => el.querySelector(s);
    const u = { text: "", busy: true, view: null, promptKey: "", wasMine: false, round: -1, shown: -1, timerId: null, busyTimer: null };

    const kb = Keyboard.create($("#shiri-kb"), { onAction });
    kb.setMode("en");
    $("#shiri-kb").hidden = true;
    const detach = Keyboard.attachPhysicalKeys(() => "en", onAction, null);

    function say(html, kind) {
      const f = $("#nep-feedback");
      f.innerHTML = Ruby.html(html);
      f.dataset.kind = kind || "";
    }
    function drawText() { $("#nep-text").textContent = u.text; }
    function setBusy(on) {
      u.busy = on;
      clearTimeout(u.busyTimer);
      if (on) u.busyTimer = setTimeout(() => { u.busy = false; }, 4000);   // 返事が来なくても、入力できなくなったままにしない
    }

    function onAction(action) {
      const v = u.view;
      if (u.busy || !v || v.g.phase !== "play" || v.g.holder !== myId) return;
      if (action.type === "submit") {
        const w = u.text.trim().toLowerCase();
        if (!w) return say("英語{えいご}を入力{にゅうりょく}してね", "ng");
        setBusy(true);
        return opts.onSubmit(w);
      }
      u.text = Input.applyAction(u.text, action, { maxLength: MAX_WORD }).replace(/[^A-Za-z]/g, "");
      drawText();
      if ($("#nep-feedback").dataset.kind === "ng") say("", "");
    }

    /* ---------- 描画 ---------- */
    /** チームの欄: 赤/青のライフと得点(coop はみんなのライフと解除した数) */
    function teams(v) {
      const g = v.g;
      const me = meOf(v, myId);
      const holder = meOf(v, g.holder);
      $("#nep-teams").innerHTML = g.teams.map((t, i) => {
        const info = TEAMS[t.key];
        const extra = g.mode === "coop" ? `<span class="goal">解除{かいじょ} ${g.defused}/${g.goal}</span>` : `<span class="sc">${t.score}点{てん}</span>`;
        return `<div class="nep-team ${info.cls}${me && me.team === i ? " is-mine" : ""}${holder && holder.team === i && g.phase === "play" ? " is-turn" : ""}" data-team="${i}">
          <span class="nm">${info.emoji} ${info.name}</span><span class="lv">${hearts(t)}</span>${extra}</div>`;
      }).join("");
      Ruby.apply($("#nep-teams"));
    }

    /** 参加者: 席の順に並ぶ(赤青赤青)。爆弾を持っている人に💣 */
    function chips(v) {
      const g = v.g;
      const me = meOf(v, myId);
      $("#nep-players").innerHTML = v.players.map((p) => {
        const who = p.id === myId ? "あなた" : me && p.team === me.team ? "仲間{なかま}" : "相手{あいて}";
        return `
        <div class="mp-chip ${TEAMS[g.teams[p.team].key].cls}${p.id === g.holder ? " is-turn" : ""}${p.connected === false ? " is-off" : ""}" data-pid="${esc(p.id)}">
          <span class="av">${p.id === g.holder && g.phase === "play" ? "💣" : esc(avatarOf(p.id) || p.avatar || "")}</span>
          <span class="who">${who}</span>
          <span class="sc">${p.score}</span>
        </div>`;
      }).join("");
      Ruby.apply($("#nep-players"));
    }

    function card(v) {
      const g = v.g;
      const playing = g.phase === "play" && g.prompt;
      $("#nep-card").classList.toggle("is-idle", !playing);
      if (!playing) {
        const wait = g.phase === "over" ? "" : g.round === 0 ? "ようい…" : "つぎのお題{だい}は…";
        $("#nep-title").innerHTML = Ruby.html(wait);
        $("#nep-big").textContent = g.round === 0 ? "💣" : (g.outcome && g.outcome.type === "explode" ? "💥" : "🎉");
        $("#nep-sub").textContent = "";
        $("#nep-dots").textContent = "";
        u.promptKey = "";
        return;
      }
      const key = g.round + ":" + g.count + ":" + g.prompt.big;
      $("#nep-title").innerHTML = Ruby.html(g.prompt.title);
      $("#nep-big").innerHTML = Ruby.html(g.prompt.big);   // 日本語→英語は「橋{はし}」の形(ふりがな付き)
      $("#nep-sub").innerHTML = Ruby.html(esc(g.prompt.sub || ""));
      $("#nep-dots").textContent = "●".repeat(g.count) + "○".repeat(Math.max(0, g.need - g.count));
      if (key !== u.promptKey) {
        if (u.promptKey) Fx.pop($("#nep-big"));
        u.promptKey = key;
      }
    }

    function status(v, events) {
      const g = v.g;
      const st = $("#nep-status");
      let html = "";
      let extra = "";
      let mine = false;
      if (g.phase === "play") {
        mine = g.holder === myId;
        html = mine ? "💣 あなたの番{ばん}！" : `${esc(avatarOf(g.holder))} が考{かんが}えてるよ…`;
      } else if (g.outcome && g.outcome.type === "explode") {
        const o = g.outcome;
        const ti = teamInfo(g, o.team);
        html = `💥 ばくはつ！ ${esc(avatarOf(o.pid))}${o.pid === myId ? "（あなた）" : ""} ${ti.emoji}${ti.name} ${o.out ? "のライフがなくなった…" : "ライフ -1"}`;
        if (o.examples && o.examples.length) extra = `<br><small>${Ruby.html("答{こた}えの例{れい}")}: ${o.examples.map(esc).join(", ")}</small>`;
      } else if (g.outcome && g.outcome.type === "defuse") {
        const ti = teamInfo(g, g.outcome.team);
        html = `🎉 かいじょ！ ${esc(avatarOf(g.outcome.pid))}${g.outcome.pid === myId ? "（あなた）" : ""} ${ti.emoji}${ti.name} +20点{てん}`;
      } else if (g.phase !== "over") {
        html = "もうすぐスタート！";
      }
      st.innerHTML = Ruby.html(html) + extra;
      st.classList.toggle("is-mine", mine);
      return mine;
    }

    function used(v) {
      const g = v.g;
      $("#nep-used").innerHTML = g.phase === "play" ? g.used.map((w) => `<span class="nep-w">${esc(w)}</span>`).join("") : "";
    }

    function feedbackFromEvents(events) {
      const msgs = [];
      for (const e of events || []) {
        const k = e.kind || e.type;
        if (k === "accept" && e.pid !== myId) msgs.push(`${esc(avatarOf(e.pid))} 「${esc(e.word)}」`);
        if (k === "reject" && e.pid !== myId) msgs.push(`${esc(avatarOf(e.pid))} 💦 まちがえた！`);
      }
      if (msgs.length) say(msgs.join("　"), "");
    }

    const chipOf = (id) => [...el.querySelectorAll("#nep-players .mp-chip")].find((c) => c.dataset.pid === id) || null;

    function sounds(v, events) {
      for (const e of events || []) {
        const k = e.kind || e.type;
        if (k === "accept") {
          if (e.pid === myId) { Sfx.play("ok"); Fx.floatText(chipOf(e.pid), "+10"); }
          else Sfx.play("pop");
        } else if (k === "explode") {
          Sfx.play("boom"); Fx.shake($("#nep-card"));
          Fx.shake(chipOf(e.pid));
        } else if (k === "defuse") {
          Sfx.play("defuse"); Fx.pop($("#nep-card"));
        } else if (k === "round") {
          Sfx.play("start");
        } else if (k === "hint") {
          Sfx.play("turn"); Fx.pop($("#nep-hint"));
        }
      }
    }

    /** ヒント: 出ているヒントは全員に見せる。ボタンは自分の番だけ(1ラウンドに1回) */
    function hintView(v, mine) {
      const g = v.g;
      const h = g.phase === "play" && g.hint && g.hint.round === g.round && g.hint.count === g.count ? g.hint : null;
      const box = $("#nep-hint");
      box.hidden = !h;
      if (h) box.innerHTML = Ruby.html(`💡 ${esc(avatarOf(h.pid))}のヒント：`) + ` <b class="nep-hint-text">${esc(h.text)}</b> ` + Ruby.html(`（${h.len}文字{もじ}）`);
      const btn = $("#nep-hint-btn");
      const can = mine && g.phase === "play";
      btn.hidden = !can;
      if (can) {
        const used = (g.hintUsed || []).includes(myId);
        btn.disabled = used;
        btn.innerHTML = Ruby.html(used ? "💡 ヒント使用済{しようず}み" : `💡 ヒント（-${opts.hintCost || 5}点{てん}）`);
      }
    }

    function update(v, events) {
      const g = v.g;
      u.view = v;
      teams(v);
      chips(v);
      card(v);
      const mine = status(v, events);
      used(v);
      feedbackFromEvents(events);
      sounds(v, events);

      hintView(v, mine);

      // 自分の番の入力欄
      const show = mine && g.phase === "play";
      $("#nep-field").hidden = !show;
      $("#shiri-kb").hidden = !show;
      if (show && (!u.wasMine || u.round !== g.round || (events || []).some((e) => (e.kind || e.type) === "accept" || (e.kind || e.type) === "round"))) {
        u.text = ""; drawText();
        if (!u.wasMine) { setTimeout(() => Sfx.play("turn"), 250); Fx.pulse($("#nep-status")); }
        say("", "");
      }
      if (show) setBusy(false);
      else { clearTimeout(u.busyTimer); u.busy = true; }
      u.wasMine = show;
      u.round = g.round;
      if (g.phase !== "play") { u.shown = -1; $("#nep-num").textContent = ""; Fx.timerBar($("#nep-bar"), 0, 1); }
    }

    /** 導火線: 1秒に1回だけバーと数字を更新(省電力) */
    u.timerId = setInterval(() => {
      const v = u.view;
      if (!v || v.g.phase !== "play") return;
      const rem = Math.max(0, v.g.fuseEndsAt - serverNow());
      const shown = Math.ceil(rem / 1000);
      if (shown === u.shown) return;
      u.shown = shown;
      $("#nep-num").textContent = shown;
      Fx.timerBar($("#nep-bar"), rem, v.g.fuseMs);
      $("#nep-bar").classList.toggle("is-low", rem <= 10000);
      if (shown > 0 && shown <= 5 && shown !== u.lastTick) { u.lastTick = shown; Sfx.play("tick"); }
    }, 250);

    $("#nep-hint-btn").addEventListener("click", () => {
      const v = u.view;
      if (!v || v.g.phase !== "play" || v.g.holder !== myId || (v.g.hintUsed || []).includes(myId)) return;
      $("#nep-hint-btn").disabled = true;              // 返事が来るまで二重に押せない
      if (opts.onHint) opts.onHint();
    });
    $("#nep-quit").addEventListener("click", () => { if (confirm("ゲームをやめますか？")) opts.onQuit(); });

    return {
      update,
      say,
      rejected(r) {
        setBusy(false); say(rejectText(r), "ng"); Fx.shake($("#nep-field")); Sfx.play("ng");
        if (u.view) hintView(u.view, u.view.g.holder === myId);       // 押せなくしていたヒントボタンを戻す
      },
      unbusy() { if (u.view && u.view.g.holder === myId) setBusy(false); },
      destroy() { clearInterval(u.timerId); clearTimeout(u.busyTimer); detach(); kb.destroy(); }
    };
  }

  /** 結果画面(HTML)。チームの勝ち負け(vs)/クリアできたか(coop)と、チームとメンバーの成績 */
  function resultHtml(v, o) {
    const g = v.g;
    const r = g.result;
    const me = meOf(v, o.myId);
    const t = (i) => TEAMS[g.teams[i].key];
    let icon, title, why;
    if (r.mode === "coop") {
      icon = r.cleared ? "🏆" : "💥";
      title = r.cleared ? "クリア！" : "ざんねん…";
      why = r.cleared ? `爆弾{ばくだん}を${r.goal}個{こ}解除{かいじょ}したよ！` : `ライフがなくなった（解除{かいじょ} ${r.defused}/${r.goal}）`;
    } else {
      const w = r.winnerTeam;
      const iWon = w !== null && me && me.team === w;
      icon = w === null ? "🤝" : iWon ? "🏆" : "💥";
      title = w === null ? "引{ひ}き分{わ}け！" : iWon ? "あなたのチームの勝{か}ち！" : `${t(w).emoji}${t(w).name}の勝{か}ち！`;
      why = r.reason === "rounds" ? `${g.maxRounds}ラウンド終了{しゅうりょう}（ライフ→得点{とくてん}の順{じゅん}）` : "相手{あいて}のライフをゼロにしたよ！";
    }
    const teamRows = r.teams.map((tm) => `<li class="${t(tm.team).cls}"><span class="no">${t(tm.team).emoji}</span><span>${t(tm.team).name}</span>
        <span class="lv">${"♥".repeat(Math.max(0, tm.lives))}${tm.lives ? "" : "✕"}</span><span class="sc">${tm.score}点{てん}</span></li>`).join("");
    const memberRows = r.players.map((p) => `<li class="${t(p.team).cls}"><span class="av">${esc(o.avatarOf(p.id) || "")}</span>
        <span>${p.id === o.myId ? "あなた" : me && p.team === me.team ? "仲間{なかま}" : "相手{あいて}"}</span>
        <span class="sc">${p.score}点{てん}</span><span class="wd">${p.correct}語{ご}</span></li>`).join("");
    return `
      <div class="panel shiri-result">
        <div class="result-icon">${icon}</div>
        <h3 class="menu-title">${title}</h3>
        <p class="note">${why}（全${r.round}ラウンド）</p>
        <ol class="rank-list nep-result-teams">${teamRows}</ol>
        <ol class="rank-list nep-result-members">${memberRows}</ol>`;
  }

  root.NepBoard = { create, resultHtml, rejectText, TEAMS };
})(window);
