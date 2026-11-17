// Cloudflare に渡す入り口。判定API(index.mjs)と、友達対戦の部屋(room-do.mjs)をまとめる。
// （テストでは Node 上で index.mjs だけを読み込めるよう、部屋のクラスはここで再公開する）
export { default } from "./index.mjs";
export { Room } from "./room-do.mjs";
