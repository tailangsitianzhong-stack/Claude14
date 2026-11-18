# ミニゲーム広場

スマホで遊べるミニゲーム集です（無料で動きます）。ビルド不要で、`index.html` をブラウザで開くだけで1人用は遊べます。

## ゲーム
| ゲーム | 内容 | 詳しく |
|---|---|---|
| 🔤 英単語しりとり | 日本語の読みと英語のつづりを答えてつなぐ。CPU対戦・友達対戦（最大4人） | `docs/shiritori-design.md` |
| 📝 ミニ漢字検定 | 常用漢字2,136字の読み(入力)と書き取り(4択)。3モード・Lv1〜5＋漢検2級・1級・友達対戦 | `docs/kanken.md` |
| 💣 ミニネプリーグ（英語） | 爆弾をまわしてお題の英単語を答える。12種類のお題・CPU対戦・友達対戦（2〜4人） | `docs/nep.md` |

共通の機能: 専用キーボード（ローマ字・フリック・50音）／ふりがな付きの表示／効果音・演出（設定で音量・バイブ）／QRコードで友達と対戦（`docs/multiplayer.md`）／ホーム画面に追加できるアイコン。

## 構成
- `index.html` `css/` `js/` … 画面（`js/games.js` にゲームを登録するとホームにカードが増える）
- `js/games/shiritori/` `js/games/kanken/` `js/games/nep/` … 各ゲーム（進行ロジックは画面と分けてテスト済み）
- `js/sfx.js`（効果音を合成）`js/fx.js`（演出）`js/ruby.js`（ふりがな）
- `data/` … 辞書データ（`tools/` のツールで生成。出典とライセンスは `data/README.md`）
- `worker/` … Cloudflare Workers（Gemini中継 + 友達対戦の部屋）。手順は `docs/gemini-worker-setup.md`
- `assets/` `manifest.webmanifest` … アイコン（`node tools/make-icons.mjs` で再生成）

## 開発
```sh
npm test          # テスト一式
```
公開は GitHub に push すると Cloudflare が自動で行います（ゲーム本体は Workers の静的アセット、判定と部屋は `worker/`）。

## ゲームの追加
`js/games.js` に `{ id, title, icon, desc, ready, mount(root), unmount() }` を足します。
文章の漢字には `漢字{かんじ}` と書くと、ふりがな(ルビ)が付きます。ずっと動き続けるアニメーションは電池を大量に使うので作らないでください（`docs/battery.md`）。音は `Sfx.play("ok")`、演出は `Fx.confetti()` などが使えます。
