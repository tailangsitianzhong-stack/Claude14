/**
 * 画面の下に出す「バージョン」を js/version.js に書く。コミットの前に実行する:  node tools/stamp-version.mjs
 * バージョン = 日付(日本時間) + コミットの通し番号(次のコミットの番号)。例: 2026.11.24-41
 * 公開されたページの一番下に出るので、「更新が届いたか」の目印になる。
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const jst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, ".");
let n = 1;
try { n = Number(execSync("git rev-list --count HEAD", { encoding: "utf8" }).trim()) + 1; } catch (_) { /* git が無いとき */ }
const v = `${jst}-${n}`;
writeFileSync(fileURLToPath(new URL("../js/version.js", import.meta.url)), `/* tools/stamp-version.mjs が書く。直接編集しない */\nwindow.APP_VERSION = "${v}";\n`);
console.log("バージョン", v);
