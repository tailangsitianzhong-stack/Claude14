#!/usr/bin/env node
/**
 * ホーム画面用のアイコン(PNG)を assets/icon.svg から作る（開発時だけ実行。playwright が必要）
 *   node tools/make-icons.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const svg = readFileSync(new URL("../assets/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
async function render(size, file, { padding = 0 } = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  // maskable は、安全領域(中央80%)に収まるよう周りに余白をつけ、背景を全面の黄色にする
  const inner = size - padding * 2;
  await page.setContent(`<body style="margin:0;background:#ffd23f;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div></body>`);
  await page.screenshot({ path: new URL(`../assets/${file}`, import.meta.url).pathname, omitBackground: padding === 0 });
  await page.close();
}
await render(192, "icon-192.png");
await render(512, "icon-512.png");
await render(180, "apple-touch-icon.png");
await render(512, "icon-maskable-512.png", { padding: 64 });
await browser.close();
console.log("assets/*.png を作りました");
