/**
 * しりとり画面（段階2: 入力まわりの確認用。判定はルールのみ・辞書は未接続）
 */
(function (root) {
  "use strict";

  const Rules = root.ShiritoriRules;
  const Input = root.ShiritoriInput;
  const Keyboard = root.ShiritoriKeyboard;
  const Dictionary = root.ShiritoriDictionary;
  const Judge = root.ShiritoriJudge;

  const MAX = { reading: 12, english: 30 };
  const MESSAGES = {
    invalid_reading: "よみは ひらがな・カタカナで 2もじ いじょう いれてね",
    invalid_english: "えいごは アルファベットだけ（2〜30もじ）で いれてね",
    not_connected: "つながってないよ！",
    duplicate: "その たんごは もう つかったよ！",
    wrong_english: "その よみと えいごは あってないみたい…",
    unknown_word: "じしょに のっていない ことばだよ"
  };

  let cleanup = null;

  function mount(rootEl) {
    rootEl.innerHTML = `
      <div class="shiri">
        <div class="shiri-status" id="shiri-status"></div>
        <div class="shiri-fields">
          <button type="button" class="shiri-field is-active" data-field="reading">
            <span class="shiri-label">にほんご（よみ）</span>
            <span class="shiri-text" data-text="reading"></span>
          </button>
          <button type="button" class="shiri-field" data-field="english">
            <span class="shiri-label">えいご</span>
            <span class="shiri-text shiri-en" data-text="english"></span>
          </button>
        </div>
        <div class="shiri-message" id="shiri-message" role="status" aria-live="polite"></div>
        <div id="shiri-kb"></div>
        <ol class="shiri-history" id="shiri-history"></ol>
        <p class="note" id="shiri-note">じしょを よみこみ中…</p>
      </div>`;

    const $ = (s) => rootEl.querySelector(s);
    const state = { active: "reading", text: { reading: "", english: "" },
                    required: null, used: [], history: [] };

    const kb = Keyboard.create($("#shiri-kb"), { onAction });
    let judge = null;
    let alive = true;

    Dictionary.load().then((dict) => {
      if (!alive) return;
      judge = Judge.create({ dict });
      $("#shiri-note").textContent = "※ 画面のテスト中です（CPUたいせんは これから つくります）";
    }).catch(() => {
      if (alive) $("#shiri-note").textContent = "じしょを よみこめませんでした。ページを さいどくみこみ してね";
    });

    function setActive(name) {
      state.active = name;
      kb.setMode(name === "reading" ? "kana" : "en");
      rootEl.querySelectorAll(".shiri-field").forEach((f) =>
        f.classList.toggle("is-active", f.dataset.field === name));
    }

    function render() {
      rootEl.querySelectorAll("[data-text]").forEach((t) => {
        t.textContent = state.text[t.dataset.text];
      });
      $("#shiri-status").textContent = state.required
        ? `つぎは 「${state.required}」から はじまる ことば！`
        : "さいしょは なんでも OK！";
      $("#shiri-history").innerHTML = state.history
        .map((h) => `<li><b>${h.reading}</b> ＝ ${h.english}</li>`).join("");
    }

    function say(msg, kind) {
      const m = $("#shiri-message");
      m.textContent = msg || "";
      m.dataset.kind = kind || "";
    }

    async function submit() {
      if (state.active === "reading") {
        if (!Rules.normalizeReading(state.text.reading)) return say(MESSAGES.invalid_reading, "ng");
        say("");
        return setActive("english");
      }
      if (!judge) return say("じしょを よみこみ中… もうすこし まってね", "ng");
      const r = await judge.judge({
        reading: state.text.reading,
        english: state.text.english,
        requiredKana: state.required,
        usedEnglish: state.used
      });
      if (!r.ok) {
        if (r.reason === "spelling") {
          say(`おしい！ つづりが ちがうよ。 せいかいは 「${r.suggestion}」`, "ng");
        } else {
          say(MESSAGES[r.reason], "ng");
        }
        if (r.reason === "not_connected") state.text = { reading: "", english: "" };
        if (r.reason === "not_connected" || r.reason === "invalid_reading") setActive("reading");
        render();
        return;
      }
      state.history.push({ reading: r.reading, english: r.english });
      state.used.push(r.english);
      state.text = { reading: "", english: "" };
      if (r.endsWithN) {
        say("「ん」で おわっちゃった… まけ！ もういちど あそぼう", "ng");
        state.required = null; state.used = []; state.history = [];
      } else {
        state.required = r.tail;
        say("OK！ つぎへ", "ok");
      }
      setActive("reading");
      render();
    }

    function onAction(action) {
      if (action.type === "submit") return submit();
      const f = state.active;
      state.text[f] = Input.applyAction(state.text[f], action, { maxLength: MAX[f] });
      say("");
      render();
    }

    rootEl.querySelectorAll(".shiri-field").forEach((f) =>
      f.addEventListener("click", () => setActive(f.dataset.field)));

    const detach = Keyboard.attachPhysicalKeys(() => kb.getMode(), onAction);
    cleanup = () => { alive = false; detach(); kb.destroy(); };
    render();
  }

  function unmount() {
    if (cleanup) cleanup();
    cleanup = null;
  }

  root.ShiritoriGame = { mount, unmount };
})(window);
