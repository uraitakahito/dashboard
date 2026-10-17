/**
 * 読む所の色付けの部品（`public/highlight.js`）を、commit した束（`public/vendor/shiki.js`）に掛けて見る。
 * 束を読むだけなので、`npm run check` は今までどおり install なしで走る。
 *
 * 色を塗る所（worker と、行に塗る所）は `app.js` に在り、試験は import しない。代役で開いて見る。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { paint } from "../public/highlight.js";
import { linesOf } from "../public/reading.js";
import { makeHighlighter } from "../public/vendor/shiki.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const highlighter = await makeHighlighter();

/** 目録の写し（capture-scripts の実物と同じ。代役が配る物）。 */
const [autofetch, autoscroll, hostTypes] = ["autofetch.ts", "autoscroll.ts", "host.d.ts"].map(
  (file) => read(`../sandbox/catalog/${file}`),
);
const catalog = [autofetch, autoscroll, hostTypes];

/** app.css の地の色（明・暗の順）。地を変えたら、この試験が配色を測り直す。 */
const [lightGround, darkGround] = [
  ...read("../public/app.css").matchAll(/--ground:\s*(#[0-9a-f]{6})/gi),
].map((m) => m[1]);

/** WCAG 2 のコントラスト比。 */
const contrast = (a, b) => {
  const luminance = (hex) => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

test("行の数は読む所と同じ（Shiki が最後の改行の後ろに返す空の 1 行を数えない）", () => {
  for (const source of [...catalog, "", "a", "a\n", "a\n\n"]) {
    assert.equal(
      paint(highlighter, source).length,
      linesOf(source).length,
      JSON.stringify(source.slice(0, 20)),
    );
  }
});

test("目録で使うどの色も、dashboard の地に対して 4.5:1 以上（明暗とも）", () => {
  assert.ok(lightGround !== undefined && darkGround !== undefined, "app.css の --ground を 2 つ読めない");
  for (const source of catalog) {
    for (const line of paint(highlighter, source)) {
      for (const [text, light, dark] of line) {
        if (text.trim() === "") continue; // 空白の色は見えない
        assert.ok(contrast(light, lightGround) >= 4.5, `${text} ${light} on ${lightGround}`);
        assert.ok(contrast(dark, darkGround) >= 4.5, `${text} ${dark} on ${darkGround}`);
      }
    }
  }
});

test("autofetch の 69 行目: 正規表現の中の引用符は文字列を始めない（行末の { は行頭の ( と同じ色）", () => {
  const line = paint(highlighter, autofetch)[68];
  const open = line.find(([text]) => text.includes("("));
  const regex = line.find(([text]) => text.includes("url"));
  const brace = line.findLast(([text]) => text.includes("{"));
  assert.notEqual(regex[1], brace[1]); // 正規表現は正規表現の色
  assert.deepEqual(brace.slice(1), open.slice(1));
});

test("どの字句も、明と暗の 2 つの色を持つ", () => {
  for (const source of catalog) {
    for (const line of paint(highlighter, source)) {
      for (const [, light, dark] of line) {
        assert.match(light, /^#[0-9a-f]{6}$/i);
        assert.match(dark, /^#[0-9a-f]{6}$/i);
      }
    }
  }
});
