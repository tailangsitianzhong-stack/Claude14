/**
 * 化学クイズ「計算」の表示: 問題文を読んで、数を入力して「決定」する。全員が同時に答え、時間か全員の決定で一斉に答え合わせ。
 * 答え合わせでは、正解と途中式(解説)を出す。(ChemBoard から呼ばれる。root.ChemViews.calc)
 *   入力: 数字キー(0-9 . − ×10^ ⌫)。パソコンでは、キーボードの数字・小数点・マイナス・Enter も使える。
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby, Fmt = root.ChemFmt, Calc = root.ChemCalc;
  const KEYS = [
    ["7", "8", "9", "⌫"],
    ["4", "5", "6", "×10^"],
    ["1", "2", "3", "−"],
    ["0", ".", "決定"]
  ];
  /** 入力した式の見た目: ×10^23 → ×10 の右上に 23 */
  const showInput = (t) => Fmt.esc(t).replace(/×10\^(−?-?\d*)/g, (m, e) => `×10<sup>${e.replace(/-/g, "−")}</sup>`).replace(/\^$/, "");

  function create(ctx) {
    const { stage, extra, myId, avatarOf } = ctx;
    const u = { qid: "", text: "", locked: false, v: null, detach: null };

    function drawInput() {
      const el = stage.querySelector("#chem-in");
      if (el) el.innerHTML = (u.text ? showInput(u.text) : '<span class="ph">答{こた}え</span>') + (u.v && u.v.q && u.v.q.unit ? `<span class="unit"> ${Fmt.html(u.v.q.unit)}</span>` : "");
      if (el) Ruby.apply(el);
    }
    function press(k) {
      if (u.locked || !u.v || u.v.phase !== "play") return;
      if (k === "⌫") u.text = u.text.replace(/(×10\^|.)$/, "");
      else if (k === "決定") return submit();
      else if (k === "×10^") { if (u.text && !u.text.includes("×10^")) u.text += "×10^"; }
      else if (k === "−") { if (u.text === "" || u.text.endsWith("×10^")) u.text += "-"; }          // マイナスは、数のはじめか、×10^ のすぐあとだけ
      else if (k === ".") { if (!u.text.includes("×10^") && !u.text.includes(".")) u.text += u.text === "" || u.text === "-" ? "0." : "."; }
      else if (u.text.length < 20) u.text += k;
      drawInput();
    }
    function submit() {
      if (u.locked || !u.v || u.v.phase !== "play") return;
      if (Calc.parse(u.text) == null) { ctx.say("数{かず}がよめないよ（例: 0.25 や 6.0×10^23）", "ng"); return; }
      u.locked = true;
      lockUi();
      ctx.actions.calc && ctx.actions.calc(u.text);
    }
    function lockUi() {
      stage.querySelectorAll(".chem-key").forEach((b) => { b.disabled = true; });
      const ok = stage.querySelector("#chem-in"); if (ok) ok.classList.add("is-locked");
    }
    function bindKeys() {
      stage.querySelectorAll(".chem-key").forEach((b) => b.addEventListener("pointerdown", (e) => { e.preventDefault(); press(b.dataset.k); }));
      const onKey = (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
        else if (e.key === ".") { e.preventDefault(); press("."); }
        else if (e.key === "-") { e.preventDefault(); press("−"); }
        else if (e.key === "x" || e.key === "*") { e.preventDefault(); press("×10^"); }
        else if (e.key === "Backspace") { e.preventDefault(); press("⌫"); }
        else if (e.key === "Enter") { e.preventDefault(); press("決定"); }
      };
      document.addEventListener("keydown", onKey);
      u.detach = () => document.removeEventListener("keydown", onKey);
    }

    function build(v) {
      const q = v.q;
      stage.innerHTML = `
        <div class="geo-q chem-q chem-calcq">${Fmt.html(q.text).replace(/\n/g, "<br>")}</div>
        <div class="chem-input" id="chem-in"></div>
        <div class="chem-pad">${KEYS.map((row) => row.map((k) => `<button type="button" class="chem-key${k === "決定" ? " is-go" : ""}" data-k="${k}">${k === "決定" ? "決定{けってい}" : k}</button>`).join("")).join("")}</div>`;
      Ruby.apply(stage);
      u.qid = q.id; u.text = ""; u.locked = false; u.v = v;
      drawInput();
      if (!u.detach) bindKeys();
    }

    function update(v) {
      u.v = v;
      if (!v.q) { stage.innerHTML = `<div class="geo-wait">${Ruby.html("よーい…")}</div>`; u.qid = ""; return; }
      if (u.qid !== v.q.id) build(v);
      if (!u.locked && v.answers && v.answers[myId]) { u.locked = true; lockUi(); }
      if (v.phase === "play" && Array.isArray(v.sit) && v.sit.includes(myId)) { u.locked = true; lockUi(); }
      if (v.phase === "between") { u.locked = true; lockUi(); }
    }

    function revealHtml(v) {
      const rv = v.reveal;
      const picks = Object.entries(rv.picks || {}).map(([pid, a]) => `${Fmt.esc(avatarOf(pid))} ${showInput(a.text)} ${a.ok ? "⭕" : "❌"}`).join("　");
      return `正解{せいかい}は <b>${Fmt.html(rv.ans)}</b>${picks ? `<br><small>${picks}</small>` : ""}
        <details class="chem-steps" open><summary>解説{かいせつ}</summary><ol>${(rv.steps || []).map((s) => `<li>${Fmt.html(s)}</li>`).join("")}</ol></details>`;
    }

    function unbusy() {
      if (u.locked && !(u.v && u.v.answers && u.v.answers[myId]) && u.v && u.v.phase === "play" && !(Array.isArray(u.v.sit) && u.v.sit.includes(myId))) {
        u.locked = false;
        stage.querySelectorAll(".chem-key").forEach((b) => { b.disabled = false; });
        const ok = stage.querySelector("#chem-in"); if (ok) ok.classList.remove("is-locked");
      }
    }

    const timer = (v, now) => (v.endsAt ? { rem: Math.max(0, v.endsAt - now), total: v.endsAt - v.startedAt } : null);
    return { update, revealHtml, timer, unbusy, destroy() { if (u.detach) u.detach(); u.detach = null; } };
  }

  root.ChemViews = root.ChemViews || {};
  root.ChemViews.calc = { create };
})(window);
