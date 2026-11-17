# Gemini 中継 Worker のセットアップ手順

辞書にない単語（例: 「ぬいぐるみ」＝ `plush`）だけを Gemini に判定させるための、Cloudflare Workers の中継サーバーを用意する手順です。
**費用は 0 円**（Cloudflare Workers 無料プラン + Gemini API 無料枠）。所要時間は 20〜30 分。

```
ブラウザ(ゲーム) ──→ Cloudflare Worker ──→ Gemini API
                     ↑ APIキーはここにだけ置く（ブラウザには出さない）
                     └ 判定結果を KV に保存（同じ単語は二度と Gemini に聞かない）
```

## 0. 用意するもの
- Cloudflare アカウント（無料）… https://dash.cloudflare.com/sign-up
- Google アカウント（Gemini APIキー用）
- Node.js 18 以上（`node -v` で確認）。`wrangler`(Cloudflareのコマンド)は `npx` で動くのでインストール不要

## 1. Gemini の APIキーを作る
1. https://aistudio.google.com/apikey を開き、Google アカウントでログイン
2. 「Create API key」でキーを作成 → 表示されたキー(`AIza…`)をコピーしておく
3. **請求(Billing)は設定しない**こと。無料枠のままなら課金は発生しません

> ⚠ 無料枠では、送った内容が Google のサービス改善に使われます（公式の料金表の "Used to improve our products: Yes"）。
> この Worker が送るのは「かなの読み」と「英単語」だけで、個人情報は一切含みません。
> 子ども向けに広く公開する場合は、Gemini API の利用規約（年齢条件など）も確認してください。

## 2. Worker をデプロイする
プロジェクトの `worker/` フォルダで作業します。

```sh
cd worker

# (1) Cloudflare にログイン（ブラウザが開くので「許可」を押す）
npx wrangler login

# (2) 初回デプロイ。キャッシュ用の KV も自動で作られ、IDが wrangler.jsonc に書き戻される
npx wrangler deploy
```

デプロイが終わると、次のようなURLが表示されます。**これを控えてください**。

```
https://shiritori-judge.<あなたのサブドメイン>.workers.dev
```

## 3. APIキーを Secret として登録する
```sh
npx wrangler secret put GEMINI_API_KEY
# → 「Enter a secret value:」と出るので、手順1のキーを貼り付けて Enter
```
- Secret は暗号化して保存され、コードにも設定ファイルにも残りません（`git` にも入りません）。
- 登録後は再デプロイ不要で、すぐ反映されます。

## 4. 動作テスト
ゲームのページがまだ無くても、`curl` で試せます（`Origin` ヘッダーは許可リストと一致させる必要があります）。

```sh
URL=https://shiritori-judge.<あなたのサブドメイン>.workers.dev

# 生きているか
curl -s $URL/health -H "Origin: http://localhost:8080"
# → {"ok":true}

# 判定（正しい組）
curl -s -X POST $URL/judge -H "Origin: http://localhost:8080" \
  -H "content-type: application/json" \
  -d '{"reading":"ぬいぐるみ","english":"plush"}'
# → {"ok":true,"reason":"none","suggestion":null,"cached":false}

# 判定（つづりミス）
curl -s -X POST $URL/judge -H "Origin: http://localhost:8080" \
  -H "content-type: application/json" \
  -d '{"reading":"ぬいぐるみ","english":"plsh"}'
# → {"ok":false,"reason":"spelling","suggestion":"plush","cached":false}
```
同じ内容をもう一度送ると `"cached":true` になり、Gemini には聞かずに返ります。

### 結果の読み方
| 返り値 | 意味 |
|---|---|
| `ok: true` | 正解（読みと英語が合っていて、つづりも正しい） |
| `ok: false, reason: "spelling"` | つづりミス。`suggestion` が正しいつづり |
| `ok: false, reason: "wrong_english"` | その読みと英語が合わない。`suggestion` は例（無いこともある） |
| `ok: null, reason: "unavailable"` | 判定できなかった（無料枠の上限・一時的な障害）。ゲームは辞書の結果に戻る |
| `ok: null, reason: "config"` | キー未設定・キー無効・モデル名の誤り。→ 手順3とモデル名を確認 |

## 5. ゲームにつなぐ
`js/config.js` の `judgeEndpoint` に Worker の URL を入れます。

```js
window.APP_CONFIG = {
  judgeEndpoint: "https://shiritori-judge.<あなたのサブドメイン>.workers.dev"
};
```

ローカルで試すなら、`worker/wrangler.jsonc` の `ALLOWED_ORIGINS` に入っている `http://localhost:8080` で配信します。

```sh
# プロジェクトのルートで
python3 -m http.server 8080
# ブラウザで http://localhost:8080 を開く
```
辞書にない単語（例: `ぬいぐるみ` ＋ `plush`）を入れると、「🔍 かくにん中…」が出て Gemini に判定されます。

> `index.html` をファイルで直接開く（`file://`）場合、ブラウザは `Origin: null` を送ります。
> `ALLOWED_ORIGINS` に `null` が入っているので動きますが、**公開時は `null` を消してください**。

## 6. ゲームを公開したとき
ゲームを GitHub Pages や Cloudflare Pages などで公開したら、そのオリジンを `worker/wrangler.jsonc` に追加して再デプロイします。

```jsonc
"ALLOWED_ORIGINS": "https://<ユーザー名>.github.io"   // パスは付けない。https://…まで
```
```sh
cd worker && npx wrangler deploy
```
複数ある場合はカンマ区切り。許可リストに無いオリジンからのリクエストは 403 で拒否されます。

## 7. 運用メモ
- **ログを見る**: `cd worker && npx wrangler tail`（リアルタイム表示。`gemini 429` などのエラーが出る）
- **モデルを変える**: `wrangler.jsonc` の `GEMINI_MODEL` を書き換えて `npx wrangler deploy`。
  無料枠で使えるモデルは公式の料金表（https://ai.google.dev/gemini-api/docs/pricing の "Free Tier" 列）で確認。
  現在の設定は `gemini-3.5-flash-lite`（無料枠あり・思考は最小で動く軽いモデル）。
- **キーを入れ替える**: もう一度 `npx wrangler secret put GEMINI_API_KEY`。漏れた疑いがあれば AI Studio でキーを削除して作り直す。
- **ローカルで Worker を動かす**: `worker/.dev.vars` に `GEMINI_API_KEY=…` を書き（git には入りません）、`npx wrangler dev --port 8787`。

## 8. 無料枠の目安（2026年11月時点・変わることがあります）
| 項目 | 無料枠 |
|---|---|
| Cloudflare Workers | 1日 100,000 リクエスト |
| Workers KV | 読み取り 1日 100,000 回 / 書き込み 1日 1,000 回 |
| Gemini API | モデル・アカウントごとに異なる（AI Studio の「Rate limit」ページで自分の枠を確認）。上限はプロジェクト単位、1日の枠は太平洋時間の0時にリセット |

節約のしくみ（実装済み）:
1. 辞書にある語は Gemini に聞かない（大半の語はここで終わる）
2. 辞書でつづりミスと分かる語（`appel`→`apple`）も聞かない
3. 聞いた結果は、**端末(localStorage)** と **Worker の KV** の両方に保存
4. 上限に達したら `ok: null` を返し、ゲームは辞書の結果にそのまま戻る（遊べなくならない）

KV の書き込みは1日1,000回までなので、**新しい単語の判定が1日およそ1,000件**を超えると、それ以降は保存されずに毎回 Gemini へ聞きます（動作はします）。

## 9. セキュリティの考え方
- APIキーは Worker の Secret にだけ置く。`js/config.js` に入れるのは Worker の URL だけ（これは公開されても問題ない）。
- `ALLOWED_ORIGINS` はブラウザ経由の無断利用を防ぐ**簡易的な**ガード。偽の `Origin` を付けた `curl` は止められません。
  対策を強めたい場合は、Cloudflare ダッシュボードの「Security → WAF → Rate limiting rules」で IP ごとの回数制限を足す。
- Worker は「かな2〜12文字 / 英小文字2〜30文字」以外を受け付けず、Gemini への指示は固定文＋検証済みの2語だけなので、プロンプトインジェクションの余地はほぼありません。

## 友達対戦について
同じ Worker が、友達対戦の「部屋」（Durable Object）も担当します。追加の設定は要りません（`wrangler.jsonc` の `durable_objects` / `migrations` は設定済みで、デプロイ時に自動で作られます）。
`ALLOWED_ORIGINS` に入れたゲームの公開URLは、部屋への接続（WebSocket）の許可にも使われます。詳細は `docs/multiplayer.md`。

## 困ったとき
| 症状 | 原因と対処 |
|---|---|
| ゲームで「かくにん中…」のあと必ず「じしょにのっていないことばだよ」になる | `ok:null`。`npx wrangler tail` でエラーを確認。`reason: config` なら Secret かモデル名 |
| ブラウザのコンソールに CORS エラー | `ALLOWED_ORIGINS` に開いているページのオリジンが無い（`http://localhost:8080` と `http://127.0.0.1:8080` は別物） |
| `curl` が 403 `forbidden_origin` | `-H "Origin: …"` を付けていない、または許可リストと不一致 |
| `wrangler deploy` が認証エラー | `npx wrangler login` をやり直す |
| 毎回 `"cached":false` | KV の保存に失敗している可能性。`wrangler tail` で `kv put failed` を確認（書き込み1,000回/日の上限など） |
