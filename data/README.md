# data/

`words.js` は `tools/build-dict.mjs` が生成する辞書データです（直接編集しないでください）。

## 出典とライセンス
- **JMdict** © Electronic Dictionary Research and Development Group — [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html)。
  `words.js` はこのデータから派生したもので、同じく CC BY-SA 4.0 です（ゲーム内のクレジット表記が必要）。
- 英単語の使われやすさ（難易度・実在チェック）には SUBTLEX-US の頻度表
  （npm `subtlex-word-frequencies`）を使用しています。頻度表そのものは含めていません。
- 不適切語の除外に `@coffeeandfun/google-profanity-words` を使用しています。

## 再生成の手順
```sh
# 1) JMdict(SQLite版): PyPI の jamdict-data を展開して jamdict.db を取り出す
# 2) 頻度表と不適切語リスト: npm pack subtlex-word-frequencies @coffeeandfun/google-profanity-words
node tools/build-dict.mjs <jamdict.db> --freq <subtlex の index.json> \
     --profanity <google-profanity-words の data/en.txt> --out data/words.js --stats
```
手選びの「CPUが優先して出す語」は `tools/curated-words.txt` で編集します。

## kanji.js（ミニ漢字検定）
`tools/build-kanji.mjs` が JMdict と KANJIDIC2（どちらも © EDRDG, CC BY-SA 4.0）から生成する、漢字検定の出題データです。詳細は `docs/kanken.md`。

## 形式
`window.SHIRITORI_WORDS = { pairs: [[読み, 英語, レベル(1〜3), フラグ], ...] }`
フラグ: 1=主要訳 / 2=CPUが出してよい語 / 4=手選びの語
