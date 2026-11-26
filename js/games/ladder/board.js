/**
 * 英単語トランスミッションの対戦画面。ひとり用も友達対戦も、これを共通で使う。
 *
 *   const board = LadderBoard.create({ el, myId, avatarOf, serverNow, solo, actions:{ propose(word), hint(), undo(), quit() } });
 *   board.update(view, events)   // 状態(core.js の view / 部屋の publicState)と、起きたこと
 *   board.say(html, kind) / board.rejected(msg) / board.resultHtml(view) / board.destroy()
 *
 * 画面: ギア(ライフ)・ヒント・手番の人・制限時間 / ゴールの単語と意味 / つながった単語の列(1文字だけ変わった所を光らせ、意味を出す) /
 *   次の単語をつくるダイヤル(文字を回して、1か所だけ変える。文字をタップすると A〜Z から選べる) / 「ギアを入れる」「ヒント」「1手戻す」
 * 意味は、辞書(JMdict)のものか、AI が確認したもの(「AI」の印つき)。省電力: 動きは、ダイヤルを回す・単語が入る一瞬だけ(docs/battery.md)
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const A = "abcdefghijklmnopqrstuvwxyz";
  const REASONS = {
    format: "文字数{もじすう}が合{あ}わないか、英字{えいじ}ではないよ", same: "いまの単語{たんご}と同{おな}じだよ。1文字{もじ}だけ変{か}えてね", diff: "変{か}えられるのは1文字{もじ}だけだよ",
    used: "もう使{つか}った単語{たんご}だよ", judging: "確認中{かくにんちゅう}だよ。ちょっと待{ま}ってね", not_your_turn: "いまはあなたの番{ばん}じゃないよ", not_playing: "もうおしまいだよ", timeout: "時間切{じかんぎ}れ…",
    no_hints: "ヒントはもうないよ", nothing: "戻{もど}せる単語{たんご}がないよ"
  };

  /** 単語を、1文字ずつのタイルにする。prev と比べて変わった文字は光らせる。match=ゴールと同じ位置の文字は色をつける */
  function tiles(word, prev, goal, cls) {
    return `<span class="lad-tiles ${cls || ""}">${Array.from(word).map((c, i) => `<b class="lad-tile${prev && prev[i] !== c ? " is-new" : ""}${goal && goal[i] === c ? " is-match" : ""}">${esc(c.toUpperCase())}</b>`).join("")}</span>`;
  }
  const mean = (m) => (m && m.ja ? `<span class="lad-mean">${m.pos ? `<i>${esc(m.pos)}</i>` : ""}${esc(m.ja)}${m.form ? `<small>（${esc(m.form)}）</small>` : ""}${m.src === "ai" ? '<em class="lad-ai" title="AIが確認した単語">AI</em>' : ""}</span>` : '<span class="lad-mean lad-mean-none">（意味{いみ}は、ゲームのあとで）</span>');

  function create(opts) {
    const el = opts.el, myId = opts.myId;
    const avatarOf = opts.avatarOf || (() => "");
    const serverNow = opts.serverNow || (() => Date.now());
    const actions = opts.actions || {};
    const solo = !!opts.solo;

    el.innerHTML = `
      <div class="lad">
        <div class="lad-top"><span class="lad-gears" id="lad-gears" aria-label="ギア"></span><span class="lad-hints" id="lad-hints"></span><span class="geo-timer-num" id="lad-num"></span></div>
        <div class="shiri-timer geo-timer" role="timer" aria-live="off" id="lad-timerwrap" hidden><div class="shiri-timer-bar" id="lad-bar"></div></div>
        <div class="mp-players geo-players" id="lad-players" hidden></div>
        <div class="lad-goal" id="lad-goal"></div>
        <ol class="lad-chain" id="lad-chain"></ol>
        <div class="lad-dial" id="lad-dial">
          <div class="lad-wheels" id="lad-wheels"></div>
          <div class="lad-picker" id="lad-picker" hidden></div>
          <div class="lad-turn" id="lad-turn"></div>
        </div>
        <div class="kk-feedback geo-say" id="lad-say" role="status" aria-live="polite"></div>
        <div class="lad-actions">
          <button type="button" class="btn btn-primary" id="lad-go" disabled>⚙️ ギアを入{い}れる！</button>
          <button type="button" class="btn btn-small" id="lad-hint">💡 ヒント</button>
          <button type="button" class="btn btn-small" id="lad-undo">↩ 1手{て}戻{もど}す</button>
          <button type="button" class="btn btn-small" id="lad-quit">やめる</button>
        </div>
      </div>`;
    Ruby.apply(el);
    const $ = (s) => el.querySelector(s);
    const u = { view: null, chainLen: 0, pick: -1, letters: [], base: "", timerId: 0, shown: -1, holdT: 0, holdI: 0, lastKey: "" };

    function say(html, kind) { const f = $("#lad-say"); f.innerHTML = Ruby.html(html || ""); f.dataset.kind = kind || ""; }

    /* ---------- ダイヤル ---------- */
    const myTurn = (v) => v.phase === "play" && !v.judging && (v.players.length === 1 || (v.players[v.turn] && v.players[v.turn].id === myId));
    const proposed = () => u.letters.join("");
    const changedAt = () => { const idx = []; u.letters.forEach((c, i) => { if (c !== u.base[i]) idx.push(i); }); return idx; };

    function setLetter(i, ch) {
      if (u.view && u.view.phase !== "play") return;
      u.letters = Array.from(u.base);                      // 変えられるのは1か所だけ: ほかは、もとにもどす
      u.letters[i] = ch; u.pick = i;
      drawWheels();
    }
    function rotate(i, d) {
      const cur = u.letters[i];
      let k = (A.indexOf(cur) + d + 26) % 26;
      if (A[k] === u.base[i]) k = (k + d + 26) % 26;       // もとの文字は飛ばす(同じ文字では、変えたことにならない)
      setLetter(i, A[k]);
    }

    function drawWheels() {
      const v = u.view; if (!v) return;
      const box = $("#lad-wheels"), mine = myTurn(v), ch = changedAt();
      box.innerHTML = Array.from(u.base).map((_, i) => {
        const on = ch.includes(i), dim = ch.length && !on;
        return `<div class="lad-wheel${on ? " is-changed" : ""}${dim ? " is-dim" : ""}${u.pick === i ? " is-pick" : ""}" data-i="${i}">
          <button type="button" class="lad-arrow" data-d="-1" aria-label="${i + 1}文字目を前の文字へ" ${mine ? "" : "disabled"}>▲</button>
          <button type="button" class="lad-letter" data-act="pick" aria-label="${i + 1}文字目: ${esc(u.letters[i])}" ${mine ? "" : "disabled"}>${esc(u.letters[i].toUpperCase())}</button>
          <button type="button" class="lad-arrow" data-d="1" aria-label="${i + 1}文字目を次の文字へ" ${mine ? "" : "disabled"}>▼</button>
        </div>`;
      }).join("");
      box.querySelectorAll(".lad-wheel").forEach((w) => {
        const i = Number(w.dataset.i);
        w.querySelectorAll(".lad-arrow").forEach((b) => {
          const d = Number(b.dataset.d), fire = () => rotate(i, d);
          b.addEventListener("pointerdown", (e) => { e.preventDefault(); fire(); clearTimeout(u.holdT); clearInterval(u.holdI); u.holdT = setTimeout(() => { u.holdI = setInterval(fire, 110); }, 380); });
          for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => { clearTimeout(u.holdT); clearInterval(u.holdI); });
        });
        w.querySelector(".lad-letter").addEventListener("click", () => openPicker(i));
      });
      $("#lad-go").disabled = !(mine && ch.length === 1);
      $("#lad-turn").innerHTML = turnText(v);
      Ruby.apply($("#lad-turn"));
    }

    function openPicker(i) {
      const pk = $("#lad-picker");
      if (!pk.hidden && u.pick === i) { pk.hidden = true; return; }
      u.pick = i;
      pk.innerHTML = Array.from(A).map((c) => `<button type="button" class="lad-key${c === u.base[i] ? " is-base" : ""}${c === u.letters[i] ? " is-on" : ""}" data-c="${c}" ${c === u.base[i] ? "disabled" : ""}>${c.toUpperCase()}</button>`).join("");
      pk.hidden = false;
      pk.querySelectorAll(".lad-key").forEach((b) => b.addEventListener("click", () => { setLetter(i, b.dataset.c); pk.hidden = true; }));
      drawWheels();
    }

    function turnText(v) {
      if (v.phase === "over") return "";
      if (v.judging) return `🔍 AI（エーアイ）が「${esc(v.judging.word.toUpperCase())}」を確認中{かくにんちゅう}…`;
      if (v.players.length === 1) return "文字{もじ}を回{まわ}して、1か所{しょ}だけ変{か}えよう";
      const cur = v.players[v.turn];
      return cur.id === myId ? "👉 あなたの番{ばん}！ 1文字{もじ}だけ変{か}えよう" : `${esc(avatarOf(cur.id) || cur.avatar || "")} の番{ばん}だよ`;
    }

    /* ---------- 全体 ---------- */
    function header(v) {
      $("#lad-gears").innerHTML = Array.from({ length: v.maxLives }, (_, i) => `<span class="lad-gear${i < v.lives ? " is-on" : ""}">⚙️</span>`).join("");
      $("#lad-hints").textContent = `💡 ${v.hints}`;
      const timed = !!v.turnSec;
      $("#lad-timerwrap").hidden = !timed; $("#lad-players").hidden = v.players.length < 2;
      if (v.players.length > 1) {
        $("#lad-players").innerHTML = v.players.map((p, i) => `<div class="mp-chip geo-chip${p.id === myId ? " is-me" : ""}${v.phase === "play" && i === v.turn ? " is-turn" : ""}${(v.away || []).includes(p.id) ? " is-off" : ""}">
          <span class="av">${esc(avatarOf(p.id) || p.avatar || "")}</span><span class="who">${p.id === myId ? "あなた" : p.cpu ? "CPU" : "友達{ともだち}"}</span><span class="sc">${p.moves}語{ご}</span></div>`).join("");
        Ruby.apply($("#lad-players"));
      }
    }

    function drawChain(v, newWord) {
      const rows = v.chain.map((w, i) => {
        const prev = i ? v.chain[i - 1] : null;
        return `<li class="lad-row${i === v.chain.length - 1 ? " is-last" : ""}${newWord && w === newWord ? " is-fresh" : ""}"><span class="lad-no">${i === 0 ? "S" : i}</span>${tiles(w, prev, v.goal)}${mean(v.meanings[w])}</li>`;
      }).join("");
      $("#lad-chain").innerHTML = rows;
      const last = $("#lad-chain").lastElementChild; if (last && last.scrollIntoView && newWord) { try { last.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (_) { /* 古いブラウザ */ } }
      Ruby.apply($("#lad-chain"));
    }

    function drawGoal(v) {
      const last = v.chain[v.chain.length - 1], d = [...last].filter((c, i) => c !== v.goal[i]).length;
      $("#lad-goal").innerHTML = `<span class="lad-goal-label">🏁 ゴール</span>${tiles(v.goal, null, null, "is-goal")}${mean(v.meanings[v.goal])}<span class="lad-diff">${v.phase === "over" ? "" : `あと ${d}文字{もじ}ちがい`}</span>`;
      Ruby.apply($("#lad-goal"));
    }

    function update(v, events) {
      u.view = v;
      const newWord = (events || []).find((e) => e.type === "word");
      header(v); drawGoal(v);
      const last = v.chain[v.chain.length - 1];
      if (last !== u.base || v.chain.length !== u.chainLen) {            // 単語がつながった(または戻した): ダイヤルを新しい単語にそろえる
        u.base = last; u.letters = Array.from(last); u.pick = -1; u.chainLen = v.chain.length; $("#lad-picker").hidden = true;
      }
      drawChain(v, newWord && newWord.word);
      drawWheels();
      for (const e of events || []) {
        if (e.type === "word") { root.Sfx.play("ok"); say(`⭕ ${esc(e.word.toUpperCase())} をつないだよ！`, "ok"); if (e.pid === myId && root.Fx) root.Fx.pop($("#lad-chain")); }
        else if (e.type === "miss") { root.Sfx.play("ng"); say(e.reason === "time" ? "⏰ 時間切{じかんぎ}れ！ ギアが1つ減{へ}ったよ" : `❌ 「${esc((e.word || "").toUpperCase())}」は単語{たんご}として認{みと}められなかったよ。ギアが1つ減{へ}ったよ`, "ng"); shake(); }
        else if (e.type === "undo") { root.Sfx.play("ng"); say(`↩ 「${esc(e.word.toUpperCase())}」を戻{もど}したよ。ギアが1つ減{へ}ったよ`, "ng"); shake(); }
        else if (e.type === "judging") say("", "");
        else if (e.type === "ai_unavailable") say("AIで確認{かくにん}できなかったよ。もう一度{いちど}ためしてね（ギアは減{へ}らないよ）", "ng");
        else if (e.type === "hint") say(hintText(e.hint, v), "");
      }
      $("#lad-hint").disabled = v.phase !== "play" || v.hints <= 0 || !!v.judging;
      $("#lad-undo").disabled = v.phase !== "play" || v.chain.length <= 1 || !!v.judging;
      if (!v.turnSec || v.phase !== "play") { $("#lad-num").textContent = ""; root.Fx.timerBar($("#lad-bar"), 0, 1); u.shown = -1; }
    }

    function hintText(h, v) {
      if (h.kind === "distance") return `💡 ゴールまで、文字{もじ}があと ${h.diff} つちがうよ${h.steps != null ? `。辞書{じしょ}の単語{たんご}だけなら、最短{さいたん}あと ${h.steps} 手{て}` : "（辞書{じしょ}の中{なか}では道{みち}が見{み}つからないよ。AIが認{みと}める単語{たんご}で進{すす}めるかも）"}`;
      if (h.kind === "position") return `💡 次{つぎ}は、${h.index + 1}文字目{もじめ}を変{か}えるといいよ`;
      return `💡 ${h.index + 1}文字目{もじめ}を「${esc(h.letter.toUpperCase())}」にしてみよう`;
    }

    function shake() { const g = $("#lad-gears"); g.classList.remove("is-shake"); void g.offsetWidth; g.classList.add("is-shake"); if (root.navigator && root.navigator.vibrate) { try { root.navigator.vibrate(60); } catch (_) {} } }

    function result(v) {
      const r = v.result, win = r.win;
      const best = opts.dict && opts.dict.path ? opts.dict.path(v.start, v.goal) : null;
      const rows = r.chain.map((w, i) => `<li class="lad-row"><span class="lad-no">${i === 0 ? "S" : i}</span>${tiles(w, i ? r.chain[i - 1] : null, v.goal)}${mean(v.meanings[w])}</li>`).join("");
      const who = v.players.length > 1 ? `<p class="note">${r.contributions.map((c) => `${esc(avatarOf(c.id) || "")} ${c.moves}語{ご}${c.miss ? `（ミス${c.miss}）` : ""}`).join("　")}</p>` : "";
      return `
        <div class="panel shiri-result lad-result">
          <div class="result-icon">${win ? "🏁" : "⚙️"}</div>
          <h3 class="menu-title">${win ? "ゴール！ トランスミッション成功{せいこう}！" : r.why === "steps" ? "手数{てかず}が多{おお}すぎて止{と}まっちゃった…" : "ギアがこわれちゃった…"}</h3>
          <p class="lad-stars" aria-label="星 ${r.stars}">${win ? "★".repeat(r.stars) + "☆".repeat(3 - r.stars) : "☆☆☆"}</p>
          <p class="note">${r.steps}手{て}でつなげたよ（辞書{じしょ}上{じょう}の最短{さいたん}は ${v.par}手{て}）</p>
          ${who}
          <ol class="lad-chain">${rows}</ol>
          ${best && best.length - 1 < r.steps ? `<p class="note">もっと短{みじか}い道{みち}: ${best.map((w) => esc(w.toUpperCase())).join(" → ")}</p>` : ""}`;
    }

    /* ---------- 操作 ---------- */
    $("#lad-go").addEventListener("click", () => {
      const v = u.view; if (!v || !myTurn(v) || changedAt().length !== 1) return;
      const w = proposed(); $("#lad-go").disabled = true; $("#lad-picker").hidden = true;
      if (actions.propose) actions.propose(w);
    });
    $("#lad-hint").addEventListener("click", () => { if (actions.hint) actions.hint(); });
    $("#lad-undo").addEventListener("click", () => { if (confirm("1手戻しますか？（ギアが1つ減ります）") && actions.undo) actions.undo(); });
    $("#lad-quit").addEventListener("click", () => { if (confirm("ゲームをやめますか？")) actions.quit && actions.quit(); });

    const onKey = (e) => {
      const v = u.view;
      if (!v || e.ctrlKey || e.metaKey || e.altKey || (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) || !myTurn(v)) return;
      if (/^[a-z]$/i.test(e.key)) { const i = u.pick >= 0 ? u.pick : 0; if (e.key.toLowerCase() !== u.base[i]) setLetter(i, e.key.toLowerCase()); }
      else if (e.key === "ArrowLeft") { u.pick = (Math.max(0, u.pick) + u.base.length - 1) % u.base.length; drawWheels(); }
      else if (e.key === "ArrowRight") { u.pick = (u.pick + 1) % u.base.length; drawWheels(); }
      else if (e.key === "ArrowUp") rotate(Math.max(0, u.pick), -1);
      else if (e.key === "ArrowDown") rotate(Math.max(0, u.pick), 1);
      else if (e.key === "Enter" && changedAt().length === 1) $("#lad-go").click();
    };
    document.addEventListener("keydown", onKey);

    /** 制限時間(友達対戦): 1秒に1回だけバーと数字を更新(省電力) */
    u.timerId = setInterval(() => {
      const v = u.view;
      if (!v || v.phase !== "play" || !v.turnSec || v.judging || !v.turnEndsAt) return;
      const rem = Math.max(0, v.turnEndsAt - serverNow()), shown = Math.ceil(rem / 1000);
      if (shown === u.shown) return;
      u.shown = shown; $("#lad-num").textContent = shown;
      root.Fx.timerBar($("#lad-bar"), rem, v.turnSec * 1000);
      $("#lad-bar").classList.toggle("is-low", rem <= 8000);
      if (shown > 0 && shown <= 3 && myTurn(v)) root.Sfx.play("tick");
    }, 250);

    return {
      update, say, resultHtml: result,
      rejected(msg) { say(msg, "ng"); root.Sfx.play("ng"); if (u.view) drawWheels(); },
      reasonText(r) { return REASONS[r] || "うまくいかなかったよ"; },
      destroy() { clearInterval(u.timerId); clearTimeout(u.holdT); clearInterval(u.holdI); document.removeEventListener("keydown", onKey); }
    };
  }

  root.LadderBoard = { create, tiles, REASONS };
})(window);
