/**
 * 化学クイズの「単元えらび」の部品(ひとり用のメニューと、友達対戦のロビーで共通)。
 *
 *   const pick = ChemUnitPicker.create({ el, units, onChange(units), counter(units) → "この範囲の問題: …" の文(省略可) });
 *   pick.set(units)    … 外から選択を変える(友達対戦で、ホストの設定が届いたとき)
 *
 * 選びかた: ①プリセット(化学基礎・理論化学・電池と電気分解 など) ②「1つずつ」=タップで入れたり外したり
 * ③「はじめ〜おわり」=はじめの単元をタップ → おわりの単元をタップ(その間がすべて選ばれる)。何も選んでいない=すべて。
 */
(function (root) {
  "use strict";

  const U = root.ChemUnits, Ruby = root.Ruby;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  function create(o) {
    const el = o.el;
    let units = U.clean(o.units), rangeMode = false, anchor = null, open = o.open !== false;

    function render() {
      const all = !units.length, on = (id) => all || units.includes(id);
      const groups = [];
      for (const u of U.LIST) { let g = groups.find((x) => x.name === u.group); if (!g) groups.push(g = { name: u.group, list: [] }); g.list.push(u); }
      el.innerHTML = `
        <div class="chem-units">
          <div class="chem-units-head"><span class="chem-units-sum">選{えら}んだ範囲{はんい}: <b>${esc(U.label(units))}</b></span>
            <button type="button" class="btn btn-small" data-a="toggle">${open ? "とじる" : "ひらく"}</button></div>
          ${open ? `
          <div class="chem-presets">${U.PRESETS.map((p) => `<button type="button" class="chem-preset${same(U.clean(p.units), units) ? " is-on" : ""}" data-preset="${p.key}">${esc(p.name)}</button>`).join("")}</div>
          <div class="chem-rangebar">
            <button type="button" class="chem-preset${!rangeMode ? " is-on" : ""}" data-a="single">1つずつ選{えら}ぶ</button>
            <button type="button" class="chem-preset${rangeMode ? " is-on" : ""}" data-a="range">はじめ〜おわりで選{えら}ぶ</button>
            ${rangeMode ? `<span>${anchor ? `「${esc(U.nameOf(anchor))}」から… おわりの単元{たんげん}をタップ` : "はじめの単元{たんげん}をタップ"}</span>` : ""}
          </div>
          ${groups.map((g) => `<div class="chem-group">${esc(g.name)}</div><div class="chem-ulist">${g.list.map((u) => `<button type="button" class="chem-unit${on(u.id) ? " is-on" : ""}${anchor === u.id ? " is-anchor" : ""}" data-unit="${u.id}">${esc(u.name)}</button>`).join("")}</div>`).join("")}
          ${o.counter ? `<p class="chem-warn" id="chem-count">${o.counter(units) || ""}</p>` : ""}` : (o.counter ? `<p class="chem-warn" id="chem-count">${o.counter(units) || ""}</p>` : "")}
        </div>`;
      Ruby.apply(el);
    }
    function change(next) {
      const n = U.clean(next);
      if (!same(n, units)) { units = n; if (o.onChange) o.onChange(units); }
      render();
    }
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !el.contains(b)) return;
      if (b.dataset.a === "toggle") { open = !open; render(); return; }
      if (b.dataset.a === "single" || b.dataset.a === "range") { rangeMode = b.dataset.a === "range"; anchor = null; render(); return; }
      if (b.dataset.preset) { anchor = null; const p = U.PRESETS.find((x) => x.key === b.dataset.preset); change(p ? p.units : []); return; }
      const id = b.dataset.unit;
      if (!id) return;
      if (rangeMode) {
        if (!anchor) { anchor = id; render(); }
        else { const r = U.range(anchor, id); anchor = null; change(r); }
      } else {
        const cur = units.length ? units.slice() : U.IDS.slice();                // いま「すべて」なら、全部が選ばれている状態から外す
        const i = cur.indexOf(id);
        if (!units.length) change([id]);                                         // 「すべて」のときにタップしたら、その単元だけにする
        else { if (i >= 0) cur.splice(i, 1); else cur.push(id); change(cur); }
      }
    });
    render();
    return { set(list) { units = U.clean(list); anchor = null; render(); }, refresh: render };
  }

  root.ChemUnitPicker = { create };
})(window);
