#!/usr/bin/env node
/**
 * 地理クイズの写真を Wikimedia Commons から集める(開発時だけ。結果は assets/geo/*.webp と tools/geo-source/photo-credits.json)
 *   node tools/fetch-geo-photos.mjs [id …]      id を付けると、その写真だけやり直す
 *
 * 使うのは、ライセンスが明確な画像だけ: パブリックドメイン / CC0 / CC BY / CC BY-SA(NC・ND は使わない)。
 * 横長で十分に大きい画像を選び、幅640pxのWebP(約30〜50KB)にして保存する。作者・ライセンス・元ページは photo-credits.json に残し、
 * ゲーム内の「写真の出典」に表示する。Commons に負担をかけないよう、1.5秒以上あけて取得する。
 * 取得した写真は、内容が合っているか目で確認すること(検索結果が別のものの場合がある)。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url).pathname;
const photos = readFileSync(root + "tools/geo-source/photos.txt", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => {
  const [id, search, answer, kind, hint] = l.split("|");
  return { id, search, answer, kind, hint: hint || "" };
});
const only = process.argv.slice(2);
const creditsPath = root + "tools/geo-source/photo-credits.json";
const credits = existsSync(creditsPath) ? JSON.parse(readFileSync(creditsPath, "utf8")) : {};
mkdirSync(root + "assets/geo", { recursive: true });
const UA = "MiniGameHiroba-GeoQuiz/1.0 (educational static web game; image fetch for CC-licensed photos)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (h) => String(h || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, " ").trim();
const okLicense = (name) => /^(CC0|Public domain|PD[- ]|CC[- ]BY(-SA)?[- ]\d)/i.test(name || "") && !/NC|ND/i.test(name);

async function get(url, binary) {
  for (let k = 0; k < 5; k++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 429 || res.status >= 500) { await sleep(20000 * (k + 1)); continue; }
    if (!res.ok) throw new Error("HTTP " + res.status);
    return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
  }
  throw new Error("busy");
}

for (const ph of photos) {
  if (only.length ? !only.includes(ph.id) : credits[ph.id] && existsSync(`${root}assets/geo/${ph.id}.webp`)) continue;
  const q = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: ph.search + " filetype:bitmap", gsrnamespace: "6", gsrlimit: "12",
    prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "800", format: "json"
  });
  let pages;
  try { pages = Object.values((await get("https://commons.wikimedia.org/w/api.php?" + q)).query?.pages || {}); } catch (e) { console.log(ph.id, "検索失敗", e.message); await sleep(3000); continue; }
  await sleep(1500);
  const cands = pages.sort((a, b) => a.index - b.index).map((p) => ({ p, i: p.imageinfo && p.imageinfo[0] })).filter(({ i }) => i);
  const good = cands.filter(({ p, i }) => {
    const lic = i.extmetadata && i.extmetadata.LicenseShortName && i.extmetadata.LicenseShortName.value;
    const ratio = i.width / i.height;
    return /image\/(jpeg|png)/.test(i.mime) && i.width >= 1000 && ratio >= 1.15 && ratio <= 2.4 && okLicense(lic) && !/\b(map|logo|flag|coat|diagram|panorama)\b/i.test(p.title);
  });
  if (!good.length) { console.log(ph.id, "適した画像なし(候補", cands.length, "件)"); continue; }
  const { p, i } = good[0];
  try {
    const buf = await get(i.thumburl, true);
    const tmp = `/tmp/geo-${ph.id}.img`;
    writeFileSync(tmp, buf);
    execFileSync("convert", [tmp + "[0]", "-auto-orient", "-resize", "640x", "-strip", "-quality", "72", `${root}assets/geo/${ph.id}.webp`]);
    unlinkSync(tmp);
  } catch (e) { console.log(ph.id, "ダウンロード失敗", e.message); await sleep(3000); continue; }
  const m = i.extmetadata;
  credits[ph.id] = {
    title: p.title.replace(/^File:/, ""), page: i.descriptionurl,
    author: strip(m.Artist && m.Artist.value).slice(0, 80) || "不明", license: strip(m.LicenseShortName && m.LicenseShortName.value),
    licenseUrl: (m.LicenseUrl && m.LicenseUrl.value) || ""
  };
  writeFileSync(creditsPath, JSON.stringify(credits, null, 1));
  console.log(ph.id, "OK", credits[ph.id].license, "|", credits[ph.id].title.slice(0, 60));
  await sleep(1500);
}
console.log("完了", Object.keys(credits).length, "/", photos.length);
