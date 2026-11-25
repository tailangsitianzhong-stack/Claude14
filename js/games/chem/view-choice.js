/**
 * 化学クイズ「資料選択」の表示: 表・グラフ・構造式・周期表などの資料を見て、4択で答える。
 * (ChemBoard から呼ばれる。root.ChemViews.choice)  問題・選択肢の化学式は [[H2SO4]] で書く(ChemFmt が下つき・上つきに直す)
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby, Fmt = root.ChemFmt, Draw = root.ChemDraw;
  const LETTERS = ["A", "B", "C", "D"];

  /** 資料(q.m)を HTML にする。k: text(資料なし) / table / chart / mol / pt / svg */
  function material(q) {
    const m = q.m || {};
    if (q.k === "table") {
      const head = m.head ? `<thead><tr>${m.head.map((h) => `<th>${Fmt.html(h)}</th>`).join("")}</tr></thead>` : "";
      return `<table class="geo-table chem-table">${head}<tbody>${m.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 && !m.head ? `<th>${Fmt.html(c)}</th>` : `<td>${Fmt.html(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table>${m.note ? `<p class="note chem-note">${Fmt.html(m.note)}</p>` : ""}`;
    }
    if (q.k === "chart") return Draw.chart(m) + (m.note ? `<p class="note chem-note">${Fmt.html(m.note)}</p>` : "");
    if (q.k === "mol") return Draw.mol(m) + (m.note ? `<p class="note chem-note">${Fmt.html(m.note)}</p>` : "");
    if (q.k === "pt") return Draw.periodic(m);
    if (q.k === "svg") return m.svg || "";
    return "";
  }

  function create(ctx) {
    const { stage, myId, avatarOf } = ctx;
    const u = { qid: "", selected: -1, locked: false };

    function build(v) {
      const q = v.q;
      const mat = material(q);
      stage.innerHTML = `
        <div class="geo-q chem-q">${Fmt.html(q.q)}</div>
        ${mat ? `<div class="geo-material">${mat}</div>` : ""}
        <div class="geo-choices" id="geo-choices">
          ${q.c.map((t, i) => `<button type="button" class="geo-choice" data-i="${i}"><span class="no">${LETTERS[i]}</span><span class="tx">${Fmt.html(t)}</span><span class="who"></span></button>`).join("")}
        </div>`;
      stage.querySelectorAll(".geo-choice").forEach((b) => b.addEventListener("click", () => {
        if (u.locked || v.phase !== "play") return;
        u.selected = +b.dataset.i; u.locked = true;
        b.classList.add("is-picked");
        stage.querySelectorAll(".geo-choice").forEach((x) => { x.disabled = true; });
        if (ctx.actions.choose) ctx.actions.choose(u.selected);
      }));
      u.qid = q.id; u.selected = -1; u.locked = false;
    }

    function update(v) {
      u.v = v;
      if (!v.q) { stage.innerHTML = `<div class="geo-wait">${Ruby.html("よーい…")}</div>`; u.qid = ""; return; }
      if (u.qid !== v.q.id) build(v);
      if (!u.locked && v.answers && v.answers[myId]) { u.locked = true; stage.querySelectorAll(".geo-choice").forEach((x) => { x.disabled = true; }); }
      if (v.phase === "play" && Array.isArray(v.sit) && v.sit.includes(myId)) { u.locked = true; stage.querySelectorAll(".geo-choice").forEach((x) => { x.disabled = true; }); }
      if (v.phase === "between" && v.reveal) {
        const rv = v.reveal;
        stage.querySelectorAll(".geo-choice").forEach((b) => {
          const i = +b.dataset.i;
          b.disabled = true;
          b.classList.toggle("is-correct", i === rv.a);
          b.classList.toggle("is-wrong", i !== rv.a && Object.values(rv.picks).includes(i));
          b.querySelector(".who").textContent = Object.entries(rv.picks).filter(([, pi]) => pi === i).map(([pid]) => avatarOf(pid)).join(" ");
        });
      }
    }

    const revealHtml = (v) => `正解{せいかい}は <b>${Fmt.html(v.q.c[v.reveal.a])}</b>`;

    /** 送れなかった/断られたとき: まだ答えが届いていなければ、選び直せるようにする */
    function unbusy() {
      if (u.locked && !(u.v && u.v.answers && u.v.answers[myId]) && u.v && u.v.phase === "play" && !(Array.isArray(u.v.sit) && u.v.sit.includes(myId))) {
        u.locked = false;
        stage.querySelectorAll(".geo-choice").forEach((x) => { x.disabled = false; x.classList.remove("is-picked"); });
      }
    }

    const timer = (v, now) => (v.endsAt ? { rem: Math.max(0, v.endsAt - now), total: v.endsAt - v.startedAt } : null);
    return { update, revealHtml, timer, unbusy };
  }

  root.ChemViews = root.ChemViews || {};
  root.ChemViews.choice = { create, material };
})(window);
