/**
 * ミニネプリーグ(英語)の「お題」づくりと答え合わせ（画面・時間・通信に依存しない純粋な関数）
 *
 *   const T = NepTopics.create(NepWords.create(NEP_DATA), NEP_DATA);
 *   const topic = T.pick({ difficulty:"normal", need:5, rng, exclude:{ kinds:["letter"], keys:[] } });
 *   T.prompt(topic, count, last)        // 画面に出す問題 { kind, title, big, sub }
 *   T.judge(topic, count, last, used, "Apple")   // → { ok:true, word } / { ok:false, reason, base? }
 *   T.candidates(topic, count, last, used)       // CPUが選べる答えの一覧(知名度順)
 *
 * お題の種類(12): letter(○で始まる) length(○文字) endletter(○で終わる) category(カテゴリ)
 *   collocation(穴うめ・答えが多い) phrase(慣用句・1つ答えるたびに別の文) translate(日本語→英語)
 *   antonym(反対語) past(過去形) anagram(並べかえ) atoz(ABC順) chain(英語しりとり)
 *
 * 形:
 *   ・「答えが何個でも」型(letter/length/endletter/category/collocation): count 個答えれば解除
 *   ・「1つ答えるたびに問題が変わる」型(phrase/translate/antonym/past/anagram/atoz/chain)
 * topic は JSON にできる(部屋の保存用)。**答えの一覧が入っているので、他のプレイヤーへは送らない**。
 *
 * 答えは「原形」。変化形(dogs・played・running など)は reason:"inflected" で base(原形)つきで断る。
 * reason: format(英字以外) short(1文字) dup(もう使った) inflected(原形で) wrong(お題に合わない) unknown(単語リストにない)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NepTopics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KINDS = ["letter", "length", "endletter", "category", "collocation", "phrase", "translate", "antonym", "past", "anagram", "atoz", "chain"];

  /** 難しさごとの出題する種類。やさしいほど「答えが思いつきやすい」お題だけにする */
  const POOLS = {
    easy: ["letter", "length", "category", "collocation", "phrase", "translate", "antonym", "atoz"],
    normal: KINDS,
    hard: KINDS
  };
  /** 頭文字のお題に使う文字(単語が十分ある文字。x z q y などは使わない) */
  const LETTERS = {
    easy: "abcdfghmnpstw",
    normal: "abcdefghilmnoprstuw",
    hard: "abcdefghijklmnoprstuvw"
  };
  const END_LETTERS = { easy: "ent", normal: "entdrylk", hard: "entdrylkmgp" };
  const LENGTHS = { easy: [3, 4, 5], normal: [4, 5, 6], hard: [5, 6, 7] };
  /** 翻訳・アナグラムで使う語の知名度(順位)の上限 */
  const RANK_LIMIT = { easy: 3000, normal: 8000, hard: 30000 };
  /** この文字で終わったら、しりとりは「次は何でもOK」 */
  const FREE_END = "xzqj";

  const shuffle = (a, rng) => {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
  };
  const choice = (a, rng) => a[Math.floor(rng() * a.length)];
  const up = (s) => s.toUpperCase();

  function create(W, data) {
    const catById = new Map(data.categories.map((c) => [c.id, c]));
    const AZ = "abcdefghijklmnopqrstuvwxyz";

    // ---------- お題をつくる ----------
    const makers = {
      letter(o) {
        const c = choice(LETTERS[o.difficulty].split(""), o.rng);
        return { kind: "letter", key: "letter:" + c, need: o.need, c };
      },
      length(o) {
        const n = choice(LENGTHS[o.difficulty], o.rng);
        return { kind: "length", key: "length:" + n, need: o.need, n };
      },
      endletter(o) {
        const c = choice(END_LETTERS[o.difficulty].split(""), o.rng);
        return { kind: "endletter", key: "endletter:" + c, need: o.need, c };
      },
      category(o) {
        const c = choice(data.categories, o.rng);
        return { kind: "category", key: "category:" + c.id, need: Math.min(o.need, c.words.length - 3), id: c.id };
      },
      collocation(o) {
        const pool = data.collocations.filter((e) => (o.difficulty === "easy" ? e.level === 1 : true) && e.answers.length >= 5);
        const e = choice(pool, o.rng);
        return { kind: "collocation", key: "collocation:" + e.prompt, need: Math.max(3, Math.min(o.need, e.answers.length - 2)), prompt: e.prompt, answers: e.answers };
      },
      phrase(o) {
        const steps = shuffle(data.phrases, o.rng).slice(0, o.need).map((p) => ({ prompt: p.prompt, answers: p.answers }));
        return { kind: "phrase", key: "phrase:" + steps[0].prompt, need: steps.length, steps };
      },
      translate(o) {
        const lim = RANK_LIMIT[o.difficulty];
        const pool = data.translate.filter(([, ans]) => ans.some((a) => { const r = W.rank(a); return r === 0 || r <= lim; }));
        const steps = shuffle(pool, o.rng).slice(0, o.need).map(([reading, answers]) => ({ reading, answers }));
        return { kind: "translate", key: "translate:" + steps[0].reading, need: steps.length, steps };
      },
      antonym(o) {
        const keys = shuffle(Object.keys(data.antonyms), o.rng).slice(0, o.need);
        const steps = keys.map((k) => ({ word: k, answers: data.antonyms[k] }));
        return { kind: "antonym", key: "antonym:" + keys[0], need: steps.length, steps };
      },
      past(o) {
        const keys = shuffle(Object.keys(data.pasts), o.rng).slice(0, o.need);
        const steps = keys.map((k) => ({ word: k, answers: data.pasts[k] }));
        return { kind: "past", key: "past:" + keys[0], need: steps.length, steps };
      },
      anagram(o) {
        const lim = RANK_LIMIT[o.difficulty];
        const lens = o.difficulty === "easy" ? [4, 5] : o.difficulty === "normal" ? [4, 5, 6] : [5, 6, 7];
        const steps = [];
        const seen = new Set();
        for (let tries = 0; steps.length < o.need && tries < 400; tries++) {
          const len = choice(lens, o.rng);
          const list = W.ofLength(len);
          const w = list[Math.floor(o.rng() * Math.min(list.length, lim))];
          if (!w || seen.has(w) || new Set(w).size < 3) continue;
          let letters = w;
          for (let k = 0; k < 8 && letters === w; k++) letters = shuffle(w.split(""), o.rng).join("");
          if (letters === w) continue;
          const answers = W.anagramsOf(w);
          if (!answers.length) continue;
          seen.add(w);
          steps.push({ letters, answers });
        }
        return { kind: "anagram", key: "anagram:" + (steps[0] && steps[0].letters), need: steps.length, steps };
      },
      atoz(o) {
        const len = Math.max(4, o.need);
        const first = Math.floor(o.rng() * (AZ.indexOf("p") - len + 2)); // a〜p の範囲だけ(x z q などは使わない)
        const letters = AZ.slice(first, first + len);
        return { kind: "atoz", key: "atoz:" + letters, need: len, letters };
      },
      chain(o) {
        const c = choice("abcdefghilmnoprstw".split(""), o.rng);
        return { kind: "chain", key: "chain:" + c, need: o.need, start: c };
      }
    };

    /** お題を1つ選ぶ。直前と同じ種類・使ったお題は避ける */
    function pick(o) {
      const rng = o.rng || Math.random;
      const ex = o.exclude || {};
      const pool = (POOLS[o.difficulty] || POOLS.normal).filter((k) => !(ex.kinds || []).includes(k));
      const kinds = shuffle(pool.length ? pool : POOLS.normal, rng);
      const opts = { difficulty: o.difficulty || "normal", need: o.need, rng };
      let fallback = null;
      for (const kind of kinds) {
        for (let tries = 0; tries < 6; tries++) {
          const t = makers[kind](opts);
          if (!t || t.need < 2) break;
          fallback = fallback || t;
          if (!(ex.keys || []).includes(t.key)) return t;
        }
      }
      return fallback || makers.letter(opts);
    }

    // ---------- 今の問題 ----------
    const stepOf = (topic, count) => (topic.steps ? topic.steps[Math.min(count, topic.steps.length - 1)] : null);
    const nextLetter = (topic, count, last) => {
      if (topic.kind === "atoz") return topic.letters[Math.min(count, topic.letters.length - 1)];
      if (!last) return topic.start;
      const e = last[last.length - 1];
      return FREE_END.includes(e) ? "" : e; // "" = 何でもOK
    };

    function prompt(topic, count, last) {
      const t = topic;
      switch (t.kind) {
        case "letter": return { kind: t.kind, title: "「" + up(t.c) + "」で始{はじ}まる英単語{えいたんご}", big: up(t.c) + "…", sub: "" };
        case "length": return { kind: t.kind, title: t.n + "文字{もじ}の英単語{えいたんご}", big: "＿ ".repeat(t.n).trim(), sub: "" };
        case "endletter": return { kind: t.kind, title: "「" + up(t.c) + "」で終{お}わる英単語{えいたんご}", big: "…" + up(t.c), sub: "" };
        case "category": {
          const c = catById.get(t.id);
          return { kind: t.kind, title: c.emoji + " " + c.name + "の英単語{えいたんご}", big: c.emoji, sub: "" };
        }
        case "collocation": return { kind: t.kind, title: "＿＿に入{はい}る英単語{えいたんご}", big: t.prompt.replace("___", "＿＿＿"), sub: "" };
        case "phrase": return { kind: t.kind, title: "言葉{ことば}のつづきは？", big: stepOf(t, count).prompt.replace("___", "＿＿＿"), sub: "" };
        case "translate": return { kind: t.kind, title: "英語{えいご}にすると？", big: stepOf(t, count).reading, sub: "" };
        case "antonym": return { kind: t.kind, title: "反対{はんたい}の意味{いみ}の英単語{えいたんご}", big: stepOf(t, count).word, sub: "" };
        case "past": return { kind: t.kind, title: "過去形{かこけい}にしよう", big: stepOf(t, count).word, sub: "" };
        case "anagram": return { kind: t.kind, title: "並{なら}べかえて英単語{えいたんご}に", big: up(stepOf(t, count).letters).split("").join(" "), sub: "" };
        case "atoz": {
          const L = nextLetter(t, count, last);
          return { kind: t.kind, title: "ABC順{じゅん}（" + up(t.letters[0]) + "→" + up(t.letters[t.letters.length - 1]) + "）", big: up(L) + "…", sub: "" };
        }
        case "chain": {
          const L = nextLetter(t, count, last);
          return { kind: t.kind, title: "英語{えいご}しりとり", big: L ? up(L) + "…" : "なんでもOK", sub: last ? "前{まえ}の言葉{ことば}: " + last : "" };
        }
      }
      return { kind: t.kind, title: "", big: "", sub: "" };
    }

    /**
     * 今の問題で通る答えの条件。
     *   explicit: 答えの一覧(あれば、この中だけ) / test: 単語リストの語が条件に合うか / list(): 単語リストの候補
     */
    function spec(topic, count, last) {
      const t = topic;
      switch (t.kind) {
        case "letter": return { test: (w) => w[0] === t.c, list: () => W.starting(t.c) };
        case "length": return { test: (w) => w.length === t.n, list: () => W.ofLength(t.n) };
        case "endletter": return { test: (w) => w[w.length - 1] === t.c, list: () => W.ending(t.c) };
        case "category": return { explicit: catById.get(t.id).words };
        case "collocation": return { explicit: t.answers };
        case "atoz": {
          const L = nextLetter(t, count, last);
          return { test: (w) => w[0] === L, list: () => W.starting(L) };
        }
        case "chain": {
          const L = nextLetter(t, count, last);
          return L ? { test: (w) => w[0] === L, list: () => W.starting(L) } : { test: () => true, list: () => W.list };
        }
        default: return { explicit: stepOf(t, count).answers };
      }
    }

    function judge(topic, count, last, used, raw) {
      const w = W.normalize(raw);
      if (!w) return { ok: false, reason: "format" };
      if (w.length < 2) return { ok: false, reason: "short" };
      if (used.includes(w)) return { ok: false, reason: "dup", word: w };
      const sp = spec(topic, count, last);
      if (sp.explicit) {
        if (sp.explicit.includes(w)) return { ok: true, word: w };
      } else if (w.length >= W.MIN_LEN && W.has(w)) {
        if (sp.test(w)) return { ok: true, word: w };
        return { ok: false, reason: "wrong", word: w };
      }
      if (topic.kind !== "past") {
        const base = W.baseOf(w);
        if (base && base !== w) return { ok: false, reason: "inflected", base, word: w };
      }
      return { ok: false, reason: W.known(w) ? "wrong" : "unknown", word: w };
    }

    /** CPUが選べる答え(使用済みを除く)。知名度の高い順。explicit は一覧の並びのまま */
    function candidates(topic, count, last, used) {
      const sp = spec(topic, count, last);
      const src = sp.explicit || sp.list();
      return src.filter((w) => !used.includes(w) && (sp.explicit || (w.length >= W.MIN_LEN && sp.test(w))));
    }

    return { KINDS, POOLS, pick, make: (kind, o) => makers[kind](Object.assign({ rng: Math.random, need: 5, difficulty: "normal" }, o)), prompt, judge, candidates, spec, nextLetter, FREE_END };
  }

  return { KINDS, POOLS, LETTERS, RANK_LIMIT, FREE_END, create };
});
