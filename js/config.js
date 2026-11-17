/**
 * 設定。Gemini 中継 Worker をデプロイしたら、そのURLを入れる（docs/gemini-worker-setup.md）。
 * 空のままなら Gemini は使わず、辞書だけで判定する。
 */
window.APP_CONFIG = {
  // 例: "https://shiritori-judge.<あなたのサブドメイン>.workers.dev"
  judgeEndpoint: ""
};
