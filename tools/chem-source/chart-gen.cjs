/**
 * 資料選択の「グラフ」を、パラメータから作る(手で点を打たなくてよいように)。tools/build-chem.mjs が使う。
 *   Gen.make({gen:"titration", ...}) → { k:"chart", title, xlabel, ylabel, series:[{label, pts:[[x,y]…], dash?}], marks:[{x,y,text}], xmax, ymax }
 * 後の段階で、滴定曲線・溶解度曲線・反応エネルギー図などを足していく。
 */
"use strict";
const GENS = {};
function make(spec) { const g = GENS[spec.gen]; if (!g) throw new Error("知らないグラフ " + spec.gen); return g(spec); }
module.exports = { make, GENS };
