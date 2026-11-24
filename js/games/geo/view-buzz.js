/**
 * 地理クイズ「早押し」の表示: 問題文が1文字ずつ流れる(「、」「。」で間があく)。わかったら「押す！」で文が止まり、
 * 押した人だけが、かな入力で答える(専用キーボード)。まちがい・時間切れは解答権を失い、文はつづきから流れる。
 * 辞書に合わない答えは、AI に確認する(確認中は時間が止まる)。(GeoBoard から呼ばれる。root.GeoViews.buzz)
 *
 * 文字の出る時刻は、問題が持つ表(q.at)と 出題時刻・止まっていた時間(pauseMs) から、端末と部屋が同じ式で計算する。
 * 省電力: 文が流れている間だけ、約90msごとに文字数を確かめる(1問につき十数秒)。止まれば何も動かない。
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby;
  const Text = root.GeoText;
  const Romaji = root.ShiritoriRomaji;
  const Keyboard = root.ShiritoriKeyboard;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAX_ANSWER = 20;

  function create(ctx) {
    const { stage, extra, myId, avatarOf, serverNow } = ctx;
    const u = { qid: "", v: null, text: "", pending: "", busy: false, ticker: null, shown: -1, kb: null, detach: null, answering: false };

    /* ---------- 問題文の表示 ---------- */
    function visibleCount(v) {
      const b = v.buzz;
      if (v.phase === "between" || v.phase === "over") return v.q.at.length;
      if (b && b.by) return b.idx;                                   // 押された: その位置で止まる
      return Text.visible(v.q.at, serverNow() - v.startedAt - ((b && b.pauseMs) || 0));
    }
    function drawText(n) {
      const chars = Array.from(u.v.q.text);
      stage.querySelector("#geo-btext").innerHTML = `<span class="vis">${esc(chars.slice(0, n).join(""))}</span><span class="inv">${esc(chars.slice(n).join(""))}</span>`;
      u.shown = n;
    }
    function tick() {
      const v = u.v;
      if (!v || v.phase !== "play" || (v.buzz && v.buzz.by)) return stop();
      const n = visibleCount(v);
      if (n !== u.shown) drawText(n);
      if (n >= v.q.at.length) stop();
    }
    const stop = () => { if (u.ticker) { clearInterval(u.ticker); u.ticker = null; } };
    const run = () => { if (!u.ticker) u.ticker = setInterval(tick, 90); };

    /* パソコンでは、スペースキーでも押せる(入力中は文字として使うので、押す側のときだけ) */
    const onKey = (e) => { if (e.key === " " && !u.answering && !(e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName))) { e.preventDefault(); press(); } };
    document.addEventListener("keydown", onKey);

    /* ---------- 組み立て ---------- */
    function build(v) {
      stage.innerHTML = `
        <div class="geo-q small">${Ruby.html("問題文{もんだいぶん}が流{なが}れるよ。わかったら「押{お}す！」")}</div>
        <div class="geo-btext" id="geo-btext" aria-live="off"></div>
        <div class="geo-bstatus" id="geo-bstatus"></div>
        <button type="button" class="geo-press" id="geo-press">⚡ 押{お}す！</button>
        <div class="shiri-field is-active geo-field" id="geo-field" hidden><span class="shiri-text" id="geo-ans"></span></div>`;
      Ruby.apply(stage);
      stage.querySelector("#geo-press").addEventListener("pointerdown", (e) => { e.preventDefault(); press(); });
      u.qid = v.q.id; u.shown = -1; u.text = ""; u.pending = ""; u.busy = false; u.answering = false;
      drawText(0);
    }
    function press() {
      const v = u.v;
      if (!v || v.phase !== "play" || (v.buzz && (v.buzz.by || v.buzz.lockedOut.includes(myId)))) return;
      ctx.actions.press && ctx.actions.press();
    }

    /* ---------- 入力(かな) ---------- */
    function ensureKeyboard() {
      if (u.kb) return;
      extra.innerHTML = '<div id="shiri-kb"></div>';
      u.kb = Keyboard.create(extra.querySelector("#shiri-kb"), { onAction });
      u.detach = Keyboard.attachPhysicalKeys(() => "kana", onAction, () => u.kb.getKanaMethod());
    }
    function dropKeyboard() {
      if (u.detach) { u.detach(); u.detach = null; }
      if (u.kb) { u.kb.destroy(); u.kb = null; }
      extra.innerHTML = "";
    }
    function drawAnswer() {
      const f = stage.querySelector("#geo-ans");
      if (f) f.innerHTML = esc(u.text) + (u.pending ? `<span class="pending">${esc(u.pending)}</span>` : "");
    }
    function onAction(action) {
      const v = u.v;
      if (!v || !u.answering || u.busy) return;
      if (action.type === "submit") {
        const fixed = Romaji.flush({ text: u.text, pending: u.pending });
        u.text = fixed.text; u.pending = ""; drawAnswer();
        if (!u.text) { ctx.say("答{こた}えを入力{にゅうりょく}してね", "ng"); return; }
        u.busy = true;
        ctx.actions.answer && ctx.actions.answer(u.text);
        return;
      }
      const r = Romaji.applyReading({ text: u.text, pending: u.pending }, action, { maxLength: MAX_ANSWER });
      u.text = r.text; u.pending = r.pending;
      drawAnswer();
    }

    /* ---------- 状態の反映 ---------- */
    function update(v, events) {
      u.v = v;
      if (!v.q) { stage.innerHTML = `<div class="geo-wait">${Ruby.html("よーい…")}</div>`; u.qid = ""; return; }
      if (u.qid !== v.q.id) build(v);
      const b = v.buzz || {};
      const lockedMe = (b.lockedOut || []).includes(myId);
      const mineNow = v.phase === "play" && b.by === myId;
      const press$ = stage.querySelector("#geo-press");
      const status$ = stage.querySelector("#geo-bstatus");

      if (v.phase === "play" && !b.by) { u.shown = -1; run(); } else { stop(); drawText(visibleCount(v)); }
      press$.hidden = !(v.phase === "play" && !b.by && !lockedMe);
      let st = "";
      if (v.phase === "play") {
        if (b.by) st = b.judging ? `🤖 AIが答{こた}えを確認{かくにん}中{ちゅう}…` : b.by === myId ? "✏️ あなたが押{お}した！かなで答{こた}えてね" : `${esc(avatarOf(b.by))} が押{お}した！答{こた}え中{ちゅう}…`;
        else if (lockedMe) st = "あなたはこの問題{もんだい}の解答権{かいとうけん}がないよ（ほかの人{ひと}を待{ま}とう）";
        else st = "わかったら押{お}してね！";
      }
      status$.innerHTML = Ruby.html(st);
      // 入力欄とキーボード(自分が押した時だけ)
      const wasAnswering = u.answering;
      u.answering = mineNow && !b.judging;
      stage.querySelector("#geo-field").hidden = !mineNow;
      if (mineNow) { ensureKeyboard(); if (!wasAnswering && !b.judging) { u.text = ""; u.pending = ""; u.busy = false; drawAnswer(); } }
      else dropKeyboard();
      if (b.judging) u.busy = true;
      // 起きたこと
      for (const e of events) {
        if (e.type === "press") root.Sfx.play(e.pid === myId ? "turn" : "pop");
        else if (e.type === "wrong") {
          root.Sfx.play("ng");
          ctx.say(e.pid === myId ? `❌ ${e.why === "timeout" || e.why === "ai_timeout" ? "時間切{じかんぎ}れ" : "まちがい"}！ -5点{てん}` : `${esc(avatarOf(e.pid))} がまちがえた！ -5点{てん}`, "ng");
          u.busy = false;
        }
      }
    }

    function revealHtml(v) {
      const rv = v.reveal;
      const lines = Object.entries(rv.wrong || {}).filter(([, n]) => n > 0).map(([pid, n]) => `${esc(avatarOf(pid))} -${n}`).join("　");
      return `正解{せいかい}は <b>${esc(rv.ans)}</b>${lines ? `<br><small>お手{て}つき: ${lines}</small>` : ""}`;
    }

    /** 制限時間: 答え中だけ(押してから12秒)。流れている間は時間制限なし */
    function timer(v, now) {
      const b = v.buzz;
      if (!b || !b.by || b.judging) return null;
      return { rem: Math.max(0, b.answerEndsAt - now), total: 12000 };
    }

    return { update, revealHtml, timer, unbusy() { u.busy = false; }, destroy() { stop(); dropKeyboard(); document.removeEventListener("keydown", onKey); } };
  }

  root.GeoViews = root.GeoViews || {};
  root.GeoViews.buzz = { create };
})(window);
