/**
 * 専用キーボード（かな50音 / 英語ABC・QWERTY）
 * 本物の <input> を使わないので、スマホの標準キーボード・変換候補・
 * スペルチェック・貼り付けは一切出ない。
 *
 *   const kb = ShiritoriKeyboard.create(rootEl, { onAction });
 *   kb.setMode("kana" | "en");
 *   kb.destroy();
 *
 * onAction には ShiritoriInput.applyAction 用の action と
 * {type:'submit'} が渡される。
 */
(function (root) {
  "use strict";

  // 表示は左から わ行…あ行（右端が あ行）。縦に あ・い・う・え・お の段
  const KANA_COLUMNS = [
    ["わ", "ん", "ー", "", ""],
    "らりるれろ".split(""),
    ["や", "", "ゆ", "", "よ"],
    "まみむめも".split(""),
    "はひふへほ".split(""),
    "なにぬねの".split(""),
    "たちつてと".split(""),
    "さしすせそ".split(""),
    "かきくけこ".split(""),
    "あいうえお".split("")
  ];

  const EN_LAYOUTS = {
    abc: ["abcdefghi", "jklmnopqr", "stuvwxyz"],
    qwerty: ["qwertyuiop", "asdfghjkl", "zxcvbnm"]
  };

  const LAYOUT_KEY = "minigames.shiritori.enLayout";

  function loadLayout() {
    try {
      const v = localStorage.getItem(LAYOUT_KEY);
      return v === "qwerty" ? "qwerty" : "abc";
    } catch (_) { return "abc"; }
  }
  function saveLayout(v) {
    try { localStorage.setItem(LAYOUT_KEY, v); } catch (_) {}
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function create(rootEl, handlers) {
    const onAction = handlers.onAction;
    let mode = "kana";
    let enLayout = loadLayout();

    const wrap = el("div", "kb");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "専用キーボード");
    // 長押しメニュー・選択・ダブルタップ拡大を止める
    wrap.addEventListener("contextmenu", (e) => e.preventDefault());
    wrap.addEventListener("dblclick", (e) => e.preventDefault());
    rootEl.appendChild(wrap);

    /** ボタン生成。pointerdown で即反応、キーボード操作(Enter/Space)は click で拾う */
    function button(label, cls, run, aria) {
      const b = el("button", "kb-key " + (cls || ""), label);
      b.type = "button";
      if (aria) b.setAttribute("aria-label", aria);
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();               // フォーカス移動・拡大・選択を防ぐ
        run();
      });
      b.addEventListener("click", (e) => {
        if (e.detail === 0) run();        // キーボードからの操作
      });
      return b;
    }
    function key(label, cls, action, aria) {
      return button(label, cls, () => onAction(action), aria);
    }

    function controls(extra) {
      const row = el("div", "kb-controls");
      (extra || []).forEach((k) => row.appendChild(k));
      row.appendChild(key("⌫ けす", "kb-wide kb-del", { type: "backspace" }, "ひとつけす"));
      row.appendChild(key("けってい", "kb-wide kb-enter", { type: "submit" }, "けってい"));
      return row;
    }

    function renderKana() {
      const grid = el("div", "kb-kana");
      for (let r = 0; r < 5; r++) {
        KANA_COLUMNS.forEach((col) => {
          const ch = col[r];
          grid.appendChild(
            ch ? key(ch, "", { type: "char", value: ch }) : el("span", "kb-gap")
          );
        });
      }
      wrap.appendChild(grid);
      wrap.appendChild(controls([
        key("゛", "kb-mod", { type: "dakuten" }, "てんてん"),
        key("゜", "kb-mod", { type: "handakuten" }, "まる"),
        key("小", "kb-mod", { type: "small" }, "ちいさいもじ")
      ]));
    }

    function renderEn() {
      const box = el("div", "kb-en");
      EN_LAYOUTS[enLayout].forEach((letters) => {
        const row = el("div", "kb-row");
        letters.split("").forEach((c) => {
          row.appendChild(key(c.toUpperCase(), "", { type: "char", value: c }, c));
        });
        box.appendChild(row);
      });
      wrap.appendChild(box);

      const toggle = button(
        enLayout === "abc" ? "QWERTYにする" : "ABCじゅんにする",
        "kb-mod kb-layout",
        () => {
          enLayout = enLayout === "abc" ? "qwerty" : "abc";
          saveLayout(enLayout);
          render();
        }
      );
      wrap.appendChild(controls([toggle]));
    }

    function render() {
      wrap.innerHTML = "";
      wrap.dataset.mode = mode;
      if (mode === "kana") renderKana(); else renderEn();
    }

    render();

    return {
      setMode(m) { if (m !== mode) { mode = m; render(); } },
      getMode() { return mode; },
      destroy() { wrap.remove(); }
    };
  }

  /**
   * パソコンの物理キーボード対応（英語モードは英字のみ、かなモードは操作キーのみ）
   * 戻り値の関数を呼ぶと解除される。
   */
  function attachPhysicalKeys(getMode, onAction) {
    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "Backspace") { e.preventDefault(); onAction({ type: "backspace" }); }
      else if (e.key === "Enter") {
        if (e.target && e.target.tagName === "BUTTON") return; // ボタン操作はそちらで処理
        e.preventDefault(); onAction({ type: "submit" });
      }
      else if (getMode() === "en" && /^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        onAction({ type: "char", value: e.key.toLowerCase() });
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }

  root.ShiritoriKeyboard = { create, attachPhysicalKeys };
})(window);
