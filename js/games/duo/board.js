/**
 * 二択クイズの対戦画面。ひとり用も友達対戦も、これを共通で使う。
 *
 *   const board = DuoBoard.create({ el, myId, avatarOf, serverNow, scene:true, solo:true, actions:{ choose(i), skip(), quit() } });
 *   board.update(view, events)     // 状態(core.js の view / 部屋の publicState)と、起きたこと
 *   board.say(html, kind) / board.rejected(msg) / board.resultHtml(view) / board.destroy()
 *
 * 画面: ラウンド/制限時間(バーは1秒に1回だけ更新) / 参加者(得点・連続正解・ライフ) / 問題 / 3Dシーン(トロッコ) / 左右の選択ボタン / 答え合わせ(解説)
 * 3D が使えない(または設定でオフ)ときは、シーンなしで、ボタンの色だけで答え合わせを見せる。
 * 問題・選択肢の化学式は [[H2SO4]] のように書いてある(ChemFmt が下つき・上つきに直す)。化学の資料(表・グラフ・構造式・周期表)は ChemDraw で描く。
 * 省電力: 3D は動きのある間だけ描く。ふだんの画面に無限アニメーションはない(docs/battery.md)。
 */
(function (root) {
  "use strict";

  const Ruby = root.Ruby;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (t) => (root.ChemFmt ? root.ChemFmt.html(t) : esc(t));
  const SUBJECT = { en: ["📖", "英語{えいご}"], chem: ["⚗️", "化学{かがく}"], phys: ["🔭", "物理{ぶつり}"], geo: ["🌏", "地理{ちり}"] };
  const LETTERS = ["A", "B"];

  /** 化学の資料(q.m)を HTML にする */
  function material(q) {
    const Draw = root.ChemDraw, m = q.m || {};
    if (!q.k || !Draw) return "";
    if (q.k === "table") {
      const head = m.head ? `<thead><tr>${m.head.map((h) => `<th>${fmt(h)}</th>`).join("")}</tr></thead>` : "";
      return `<table class="geo-table chem-table">${head}<tbody>${m.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 && !m.head ? `<th>${fmt(c)}</th>` : `<td>${fmt(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table>`;
    }
    if (q.k === "chart") return Draw.chart(m);
    if (q.k === "mol") return Draw.mol(m);
    if (q.k === "pt") return Draw.periodic(m);
    if (q.k === "svg") return m.svg || "";
    return "";
  }

  function create(opts) {
    const el = opts.el, myId = opts.myId;
    const avatarOf = opts.avatarOf || (() => "");
    const serverNow = opts.serverNow || (() => Date.now());
    const actions = opts.actions || {};

    el.innerHTML = `
      <div class="geo duo">
        <div class="geo-top"><span id="duo-round"></span><span class="geo-timer-num" id="duo-num"></span></div>
        <div class="shiri-timer geo-timer" role="timer" aria-live="off"><div class="shiri-timer-bar" id="duo-bar"></div></div>
        <div class="mp-players geo-players" id="duo-players"></div>
        <div class="duo-subj" id="duo-subj"></div>
        <div class="geo-q chem-q duo-q" id="duo-q"></div>
        <div class="geo-material duo-mat" id="duo-mat" hidden></div>
        <div class="duo-stage" id="duo-stage"><canvas id="duo-cv" aria-label="トロッコが分かれ道に向かう3Dの絵"></canvas><div class="duo-ready" id="duo-ready"></div></div>
        <div class="geo-choices duo-choices" id="duo-choices"></div>
        <div class="kk-feedback geo-say" id="duo-say" role="status" aria-live="polite"></div>
        <div class="geo-reveal" id="duo-reveal" hidden></div>
        <div class="shiri-actions"><button type="button" class="btn btn-small" id="duo-skip" hidden>つぎへ ▶</button><button type="button" class="btn btn-small" id="duo-quit">やめる</button></div>
      </div>`;
    const $ = (s) => el.querySelector(s);
    const u = { view: null, lastQ: "", revealed: 0, shownRound: 0, snap: null, revealTimer: 0, waitAny: false, selected: -1, locked: false, shown: -1, timerId: null, scene: null, sceneTried: false, alive: true, answeredSent: new Set() };

    /* ---------- 3D ---------- */
    function sceneFor(v) {
      if (u.scene || u.sceneTried || !opts.scene || !root.DuoScene || !root.THREE) return u.scene;
      u.sceneTried = true;
      u.scene = root.DuoScene.create({ canvas: $("#duo-cv"), players: v.players.map((p) => ({ id: p.id, avatar: avatarOf(p.id) || p.avatar || "🙂" })), myId, now: serverNow, onImpact });
      if (!u.scene) $("#duo-stage").hidden = true;
      return u.scene;
    }
    if (!opts.scene) $("#duo-stage").hidden = true;

    function say(html, kind) { const f = $("#duo-say"); f.innerHTML = Ruby.html(html || ""); f.dataset.kind = kind || ""; }

    /** 答え合わせの結果(得点・ライフ・連続)は、トロッコが壁にぶつかるまで見せない。それまでは、答える前の値を出す */
    const hidden = (v) => v.phase === "between" && !!v.reveal && u.shownRound !== v.round;

    function players(v) {
      const answered = v.phase === "play" ? v.answers || {} : {};
      const hide = hidden(v) && u.snap, snap = (p) => (hide && u.snap[p.id]) || p;
      const gains = (v.reveal && v.phase === "between" && !hide && v.reveal.gains) || {};
      $("#duo-players").innerHTML = v.players.map((p0) => { const p = snap(p0); return `
        <div class="mp-chip geo-chip${p0.id === myId ? " is-me" : ""}${answered[p0.id] ? " is-done" : ""}${p0.connected === false ? " is-off" : ""}${v.mode === "survival" && p.lives <= 0 ? " is-out" : ""}" data-pid="${esc(p0.id)}">
          <span class="av">${esc(avatarOf(p0.id) || p0.avatar || "")}</span>
          <span class="who">${p0.id === myId ? "あなた" : p0.cpu ? "CPU" : "友達{ともだち}"}</span>
          <span class="sc">${p.score}${gains[p0.id] ? `<em class="up">+${gains[p0.id]}</em>` : ""}</span>
          ${v.mode === "survival" ? `<span class="duo-lives" aria-label="ライフ ${p.lives}">${"♥".repeat(Math.max(0, p.lives))}${"♡".repeat(Math.max(0, 3 - p.lives))}</span>` : ""}
          ${p.streak >= 2 ? `<span class="duo-streak">🔥${p.streak}</span>` : ""}
          ${answered[p0.id] ? '<span class="ok-mark" aria-label="答えた">✔</span>' : ""}
        </div>`; }).join("");
      Ruby.apply($("#duo-players"));
    }

    function buildQuestion(v) {
      const q = v.q, sj = SUBJECT[q.s] || SUBJECT.en;
      $("#duo-subj").innerHTML = Ruby.html(`${sj[0]} ${sj[1]}${q.ex ? `・${["", "基礎{きそ}", "標準{ひょうじゅん}", "発展{はってん}"][q.ex]}` : ""}`);
      // 英語: 「〜は？」の指示と、英文を分けて表示する
      const split = q.s === "en" ? /^(.*?[？。])\s+([A-Za-z"'“].*)$/.exec(q.text) : null;
      $("#duo-q").innerHTML = split ? `<span class="duo-ins">${fmt(split[1])}</span><span class="duo-sent">${fmt(split[2])}</span>` : fmt(q.text);
      const mat = material(q), mb = $("#duo-mat");
      mb.innerHTML = mat; mb.hidden = !mat;
      $("#duo-choices").innerHTML = q.c.map((t, i) => `
        <button type="button" class="geo-choice duo-choice" data-i="${i}"><span class="no">${LETTERS[i]}</span><span class="tx">${fmt(t)}</span></button>`).join("");
      $("#duo-choices").querySelectorAll(".duo-choice").forEach((b) => b.addEventListener("click", () => pick(Number(b.dataset.i))));
      u.selected = -1; u.locked = false; u.answeredSent = new Set();
      $("#duo-reveal").hidden = true; say("", "");
      const sc = sceneFor(v);
      if (sc) sc.question({ s: q.s, labels: q.c, startedAt: v.startedAt, endsAt: v.endsAt });
    }

    function pick(i) {
      const v = u.view;
      if (!v || v.phase !== "play" || u.locked) return;
      if ((v.sit || []).includes(myId)) { say("この問題{もんだい}は答{こた}えられないよ（次{つぎ}の問題{もんだい}から）", "ng"); return; }
      u.locked = true; u.selected = i;
      markButtons(v);
      if (u.scene) u.scene.answered(myId, i);
      say("決定{けってい}！ 結果{けっか}を待{ま}とう…", "");
      root.Sfx.play("pop");
      if (actions.choose) actions.choose(i);
    }

    function markButtons(v) {
      const rv = v.phase === "between" && v.reveal && !hidden(v) && v.reveal, bs = $("#duo-choices").querySelectorAll(".duo-choice");
      bs.forEach((b, i) => {
        b.disabled = !!rv || u.locked || v.phase !== "play" || (v.sit || []).includes(myId);
        b.classList.toggle("is-picked", !rv && u.selected === i);       // 答えたあとは、色が変わるだけ(正解・まちがいは、壁にぶつかるまでわからない)
        b.classList.toggle("is-correct", !!rv && rv.a === i);
        b.classList.toggle("is-wrong", !!rv && rv.picks[myId] === i && rv.a !== i);
      });
    }

    function reveal(v) {
      const box = $("#duo-reveal");
      if (v.phase !== "between" || !v.reveal || hidden(v)) { box.hidden = true; return; }
      const rv = v.reveal, mine = rv.gains[myId] || 0, ok = !!(rv.ok && rv.ok[myId]);
      const me = v.players.find((p) => p.id === myId) || {};
      const head = ok ? `⭕ +${mine}点{てん}！${me.streak >= 2 ? `　🔥${me.streak}連続{れんぞく}！` : ""}` : rv.picks[myId] == null ? "⏰ 時間切{じかんぎ}れ…" : "❌ ざんねん…";
      const right = v.q.c[rv.a];
      const life = v.mode === "survival" && !ok && me.lives != null ? `<p class="note">ライフが 1 つ減{へ}ったよ（のこり ${me.lives}）</p>` : "";
      box.innerHTML = `<div class="geo-reveal-head">${Ruby.html(head)}</div><div class="geo-reveal-body"><p>正解{せいかい}は <b>${fmt(right)}</b></p>${rv.explain ? `<p class="duo-explain">${fmt(rv.explain)}</p>` : ""}${Ruby.html(life)}</div>`;
      Ruby.apply(box);
      box.hidden = false;
    }

    function result(v) {
      const r = v.result;
      const rank = r.ranking.map((x) => Object.assign({}, v.players.find((p) => p.id === x.id), x));
      const iWon = r.winners.includes(myId), solo = v.players.length === 1;
      const me = rank.find((p) => p.id === myId) || {};
      const title = solo ? (v.mode === "survival" ? `${r.rounds}問{もん}まで進{すす}んだ！` : `${me.correct}/${r.rounds}問{もん}正解{せいかい}！`) : r.winners.length > 1 ? (iWon ? "同点で1位！" : "同点1位があるよ") : iWon ? "あなたの勝{か}ち！" : `${esc(avatarOf(r.winners[0]))} の勝{か}ち！`;
      return `
        <div class="panel shiri-result">
          <div class="result-icon">${iWon || solo ? "🚃" : "🥈"}</div>
          <h3 class="menu-title">${title}</h3>
          <p class="note">${v.mode === "survival" ? "サバイバル" : `全${r.rounds}問{もん}`} ・ 最高{さいこう}の連続正解{れんぞくせいかい} ${me.bestStreak || 0}</p>
          <ol class="rank-list">
            ${rank.map((p, i) => `<li><span class="no">${i + 1}位{い}</span><span class="av">${esc(avatarOf(p.id) || p.avatar || "")}</span>
              <span>${p.id === myId ? "あなた" : p.cpu ? "CPU" : ""}</span><span class="sc">${p.score}点{てん}</span><span class="wd">${p.correct}問{もん}正解{せいかい}</span></li>`).join("")}
          </ol>`;
    }

    /** 結果を出す: ボタンの色・正解・解説・得点。トロッコが壁にぶつかった瞬間(または保険のタイマー)で呼ぶ */
    function showReveal(v) {
      if (!v || v.phase !== "between" || !v.reveal || u.shownRound === v.round) return;
      u.shownRound = v.round; clearTimeout(u.revealTimer);
      reveal(v); markButtons(v); players(v);
      const ok = !!(v.reveal.ok && v.reveal.ok[myId]);
      root.Sfx.play(ok ? "ok" : "ng"); if (ok && root.Fx) root.Fx.pop($("#duo-players"));
      if (root.navigator && root.navigator.vibrate && !ok) { try { root.navigator.vibrate(60); } catch (_) {} }
      say("", "");
      $("#duo-skip").hidden = !opts.solo;
    }
    function onImpact(pid) {
      const v = u.view;
      if (!v || v.phase !== "between" || !v.reveal) return;
      if (pid === myId || u.waitAny) showReveal(v);
    }

    function update(v, events) {
      u.view = v;
      const alive = v.mode !== "survival" || ((v.players.find((p) => p.id === myId) || {}).lives > 0);
      const label = v.phase === "over" ? "おしまい" : v.round === 0 ? "もうすぐスタート！" : v.mode === "survival" ? `第${v.round}問{もん}（サバイバル）` : `第${v.round}問{もん} / ${v.rounds}問{もん}`;
      $("#duo-round").innerHTML = Ruby.html(label);
      players(v);
      if (!v.q) { $("#duo-ready").innerHTML = Ruby.html("よーい…"); $("#duo-ready").hidden = false; $("#duo-skip").hidden = true; return; }
      $("#duo-ready").hidden = true;
      const sig = v.q.id + ":" + v.round;
      let fresh = false;
      if (sig !== u.lastQ) { u.lastQ = sig; u.revealed = 0; u.shownRound = 0; u.waitAny = false; clearTimeout(u.revealTimer); buildQuestion(v); fresh = true; }
      if (!hidden(v) || fresh) u.snap = Object.fromEntries(v.players.map((p) => [p.id, { score: p.score, lives: p.lives, streak: p.streak }]));
      // 友達が答えた(自分の選択だけが、3Dの中で自分のトロッコにあらわれる)
      if (u.scene && v.phase === "play") for (const pid of Object.keys(v.answers || {})) if (!u.answeredSent.has(pid)) { u.answeredSent.add(pid); if (pid !== myId || u.selected < 0) u.scene.answered(pid, pid === myId ? u.selected : null); }
      if (v.phase === "play" && v.answers && v.answers[myId] && !u.locked) { u.locked = true; }      // つなぎなおしたとき
      if (v.phase === "play" && !alive) say("ライフがなくなったよ。ほかの人{ひと}を見守{みまも}ろう", "");
      if (v.phase === "between" && v.reveal && u.revealed !== v.round) {
        u.revealed = v.round;
        if (fresh) { showReveal(v); }                // つなぎなおしたときなどは、すぐに結果を出す
        else {
          if (u.scene) {
            const dead = {}, skip = {};
            for (const p of v.players) { if (v.mode === "survival" && v.reveal.lives && v.reveal.lives[p.id] <= 0) dead[p.id] = true; if ((v.sit || []).includes(p.id)) skip[p.id] = true; }
            u.waitAny = !!skip[myId];                                         // 自分のトロッコが走らないときは、だれかがぶつかった時に結果を出す
            u.scene.reveal({ a: v.reveal.a, picks: v.reveal.picks, ok: v.reveal.ok, dead, skip, round: v.round });
          }
          clearTimeout(u.revealTimer);
          u.revealTimer = setTimeout(() => { if (u.view && u.shownRound !== u.view.round) showReveal(u.view); }, u.scene ? 4300 : 1100);    // 3Dが進まないとき(裏のタブなど)の保険 / 3Dなしの待ち
        }
      }
      markButtons(v);
      players(v);
      $("#duo-skip").hidden = !(opts.solo && v.phase === "between" && v.reveal && !hidden(v));
      for (const e of events || []) if (e.type === "round") root.Sfx.play("start");
      if (v.phase !== "play") { $("#duo-num").textContent = ""; root.Fx.timerBar($("#duo-bar"), 0, 1); u.shown = -1; }
    }

    /** 制限時間: 1秒に1回だけバーと数字を更新(省電力) */
    u.timerId = setInterval(() => {
      const v = u.view;
      if (!v || v.phase !== "play") return;
      const rem = Math.max(0, v.endsAt - serverNow()), total = Math.max(1, v.endsAt - v.startedAt), shown = Math.ceil(rem / 1000);
      if (shown === u.shown) return;
      u.shown = shown;
      $("#duo-num").textContent = shown;
      root.Fx.timerBar($("#duo-bar"), rem, total);
      $("#duo-bar").classList.toggle("is-low", rem <= 4000);
      if (shown > 0 && shown <= 3 && !u.locked) root.Sfx.play("tick");
    }, 250);

    const onKey = (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "1") pick(0);
      else if (e.key === "ArrowRight" || e.key === "d" || e.key === "2") pick(1);
      else if ((e.key === " " || e.key === "Enter") && opts.solo && actions.skip && u.view && u.view.phase === "between") actions.skip();
    };
    document.addEventListener("keydown", onKey);
    const onResize = () => { if (u.scene) u.scene.resize(); };
    root.addEventListener("resize", onResize);

    $("#duo-skip").addEventListener("click", () => { if (actions.skip) actions.skip(); });
    $("#duo-quit").addEventListener("click", () => { if (confirm("ゲームをやめますか？")) actions.quit && actions.quit(); });

    return {
      update, say,
      resultHtml: result,
      rejected(msg) { u.locked = false; u.selected = -1; if (u.view) markButtons(u.view); say(msg, "ng"); root.Sfx.play("ng"); },
      destroy() {
        u.alive = false; clearInterval(u.timerId); clearTimeout(u.revealTimer); document.removeEventListener("keydown", onKey); root.removeEventListener("resize", onResize);
        if (u.scene) { u.scene.dispose(); u.scene = null; }
      }
    };
  }

  root.DuoBoard = { create, material };
})(window);
