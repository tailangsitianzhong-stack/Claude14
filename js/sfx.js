/**
 * 効果音（音のファイルは使わず、ブラウザで合成する。無料・オフラインでも鳴る）と、バイブ
 *
 *   Sfx.play("ok")           … 鳴らす（設定で「音」がオフなら何もしない）
 *   Sfx.attach(document)     … ボタンを押した時の音を、画面全体に付ける + 最初のタップで音を使えるようにする
 *   Sfx.get() / Sfx.set({sound, volume, vibrate})
 *
 * 音の名前: tap key ok ng tick turn start pop heart win lose end
 * 設定は localStorage の "minigames.settings"（音のON/OFF・音量・バイブ）に保存する。
 * スマホ(iOS)は、ユーザーが画面を触るまで音を出せないので、最初のタップで準備する。
 *
 * 省電力: 音の準備(AudioContext)は、動かしたままだと無音でも電池を使う(測定: 約3.5ポイント、iPhoneでは省電力に入りにくくなる)。
 * そこで、最後に鳴らして/触ってから idleMs(既定8秒)たったら止め、次に鳴らす時に再開する。
 * アプリが裏に回った(画面が隠れた)時もすぐ止める。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Sfx = factory();
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  const KEY = "minigames.settings";
  const DEFAULTS = { sound: true, volume: 0.7, vibrate: true };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function create(opts) {
    const o = opts || {};
    const storage = o.storage === undefined ? safeStorage() : o.storage;
    const AudioCtor = o.AudioContext;               // テストでは偽物を渡す
    const idleMs = typeof o.idleMs === "number" ? o.idleMs : 8000;
    let idleTimer = null;
    const nav = o.navigator === undefined ? (typeof navigator !== "undefined" ? navigator : null) : o.navigator;
    let ctx = null;
    let settings = load();

    function safeStorage() { try { return localStorage; } catch (_) { return null; } }

    function readRaw() {
      try { return JSON.parse((storage && storage.getItem(KEY)) || "{}") || {}; } catch (_) { return {}; }
    }
    function load() {
      const s = readRaw();
      return {
        sound: s.sound !== false,
        volume: typeof s.volume === "number" ? clamp(s.volume, 0, 1) : DEFAULTS.volume,
        vibrate: s.vibrate !== false
      };
    }
    function save() {
      try { storage && storage.setItem(KEY, JSON.stringify(Object.assign(readRaw(), settings))); } catch (_) {}
    }

    function get() { return Object.assign({}, settings); }
    function set(patch) {
      if (patch.sound !== undefined) settings.sound = !!patch.sound;
      if (patch.vibrate !== undefined) settings.vibrate = !!patch.vibrate;
      if (typeof patch.volume === "number") settings.volume = clamp(patch.volume, 0, 1);
      save();
    }

    /** 音を出す準備（ユーザーの操作の中で呼ぶ） */
    function unlock() {
      if (!ctx) {
        const C = AudioCtor || (typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null);
        if (!C) return null;
        try { ctx = new C(); } catch (_) { return null; }
      }
      if (ctx.state === "suspended" && ctx.resume) { try { ctx.resume(); } catch (_) {} }
      scheduleSuspend();
      return ctx;
    }

    /** 無音が続いたら音の準備を止める(電池のため)。鳴らす/触るたびに延長される */
    function scheduleSuspend() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(suspendNow, idleMs);
    }
    function suspendNow() {
      clearTimeout(idleTimer);
      if (ctx && ctx.state === "running" && typeof ctx.suspend === "function") {
        try { const r = ctx.suspend(); if (r && r.catch) r.catch(() => {}); } catch (_) {}
      }
    }

    /** 1音: 周波数・開始(秒)・長さ(秒)。slideTo で音程をなめらかに変える */
    function tone(t0, freq, dur, opt) {
      const p = opt || {};
      const now = ctx.currentTime + t0;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = p.type || "sine";
      osc.frequency.setValueAtTime(freq, now);
      if (p.slideTo) osc.frequency.exponentialRampToValueAtTime(p.slideTo, now + dur);
      const peak = Math.max(0.0002, (p.vol || 0.3) * settings.volume);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + (p.attack || 0.01));
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.03);
    }

    // 音符(ドレミ)の周波数
    const N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G4: 392, E4: 329.63, C4: 261.63 };

    const SOUNDS = {
      tap:   () => tone(0, 660, 0.06, { type: "triangle", vol: 0.16 }),
      key:   () => tone(0, 1000, 0.035, { type: "square", vol: 0.05 }),
      pop:   () => tone(0, 520, 0.12, { type: "sine", vol: 0.22, slideTo: 880 }),
      start: () => { tone(0, N.C5, 0.1, { type: "triangle" }); tone(0.09, N.E5, 0.1, { type: "triangle" }); tone(0.18, N.G5, 0.18, { type: "triangle" }); },
      ok:    () => { tone(0, N.E5, 0.12, { type: "triangle", vol: 0.28 }); tone(0.09, N.A5, 0.22, { type: "triangle", vol: 0.28 }); },
      ng:    () => { tone(0, 200, 0.22, { type: "sawtooth", vol: 0.2, slideTo: 110 }); tone(0.12, 150, 0.22, { type: "sawtooth", vol: 0.16, slideTo: 90 }); },
      heart: () => tone(0, 330, 0.25, { type: "triangle", vol: 0.25, slideTo: 165 }),
      tick:  () => tone(0, 880, 0.07, { type: "square", vol: 0.1 }),
      turn:  () => { tone(0, N.G5, 0.12, { type: "sine", vol: 0.3 }); tone(0.12, N.C6, 0.25, { type: "sine", vol: 0.3 }); },
      win:   () => {
        [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(i * 0.11, f, 0.2, { type: "triangle", vol: 0.3 }));
        tone(0.5, N.G5, 0.14, { type: "triangle", vol: 0.25 }); tone(0.62, N.C6, 0.45, { type: "triangle", vol: 0.32 });
        tone(0.62, N.E6, 0.45, { type: "sine", vol: 0.14 });
      },
      lose:  () => { tone(0, 392, 0.25, { type: "triangle", vol: 0.25 }); tone(0.22, 330, 0.25, { type: "triangle", vol: 0.25 }); tone(0.44, 262, 0.5, { type: "triangle", vol: 0.25, slideTo: 220 }); },
      end:   () => { tone(0, N.E5, 0.16, { type: "triangle", vol: 0.25 }); tone(0.15, N.G5, 0.16, { type: "triangle", vol: 0.25 }); tone(0.3, N.E5, 0.3, { type: "triangle", vol: 0.25 }); }
    };
    const VIBRATE = { ng: [60], heart: [80], lose: [90, 50, 90], win: [40, 40, 80] };
    const NAMES = Object.keys(SOUNDS);

    function vibrate(name) {
      if (!settings.vibrate || !nav || typeof nav.vibrate !== "function" || !VIBRATE[name]) return;
      try { nav.vibrate(VIBRATE[name]); } catch (_) {}
    }

    /** 音を鳴らす。設定がオフ・音が出せない環境では何もしない（ゲームは止まらない） */
    function play(name) {
      if (!SOUNDS[name]) return false;
      vibrate(name);
      if (!settings.sound || settings.volume <= 0) return false;
      const c = unlock();
      if (!c) return false;
      try { SOUNDS[name](); return true; } catch (_) { return false; }
    }

    /** ボタンを押した音を画面全体に付け、最初のタップで音を使えるようにする */
    function attach(doc) {
      const d = doc || (typeof document !== "undefined" ? document : null);
      if (!d) return;
      // アプリが裏に回った/画面が消えた時は、すぐ止める
      d.addEventListener("visibilitychange", () => { if (d.hidden) suspendNow(); });
      d.addEventListener("pointerdown", (e) => {
        if (settings.sound) unlock();
        const b = e.target && e.target.closest && e.target.closest("button");
        if (!b || b.disabled) return;
        if (b.classList.contains("kb-key")) play("key");
        else if (!b.classList.contains("kk-choice")) play("tap");     // 4択は、答えの音(ok/ng)だけ鳴らす
      }, true);
    }

    return { play, get, set, attach, unlock, suspendNow, names: NAMES };
  }

  const shared = create();
  shared.create = create;
  return shared;
});
