/**
 * 「起こす」欄の部品（`public/start.js`）。送る body と、答えの言い方。
 *
 * 送る道（`POST /api/crawls` の中継）と門は http の口に在り、門の判定は `lib.test.mjs` が見る。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  asTemplate,
  bodyBytes,
  hasNocheck,
  NOCHECK,
  scriptsOf,
  sizeOf,
  startAnswer,
  startBody,
  withNocheck,
} from "../public/start.js";

test("起点は 1 行に 1 本 —— 前後の空白と空行を落とし、順番は保つ", () => {
  const body = startBody("  https://example.com/ \n\n https://example.com/docs/\n", true);
  assert.deepEqual(body.seeds, ["https://example.com/", "https://example.com/docs/"]);
});

test("「このページだけ」は maxDepth: 0 を送り、「リンクを辿る」は何も足さない", () => {
  assert.equal(startBody("https://example.com/", true).maxDepth, 0);
  // 辿るときは鍵ごと送らない —— 深さも枚数も台帳の既定に任せる
  assert.equal("maxDepth" in startBody("https://example.com/", false), false);
  assert.deepEqual(Object.keys(startBody("https://example.com/", false)), ["seeds"]);
});

test("URL は検査しない —— 読めない URL も、そのまま台帳へ送る", () => {
  assert.deepEqual(startBody("ftp://example.com/\nnot a url", true).seeds, ["ftp://example.com/", "not a url"]);
});

test("空の欄は、空の seeds になる（画面はこれを送らない）", () => {
  assert.deepEqual(startBody(" \n \n", true).seeds, []);
});

test("202 は起こした 1 本を、409 は塞いでいる 1 本を名指す", () => {
  const ok = startAnswer(202, { crawlId: "9072b625-1111-4000-8000-000000000000" });
  assert.equal(ok.kind, "ok");
  assert.match(ok.text, /crawl 9072b625/);
  const busy = startAnswer(409, {
    error: "a crawl is already in progress",
    crawlId: "5b0c0001-6a1e-4000-8000-000000000001",
    startedAt: "2026-10-13T00:00:00.000Z",
  });
  assert.equal(busy.kind, "run");
  assert.match(busy.text, /crawl 5b0c0001/);
  // 塞いでいる行が見つからなかった 409 は id を持たない。空の括弧を出さない
  assert.doesNotMatch(startAnswer(409, { error: "a crawl is already in progress" }).text, /（crawl /);
});

test("台帳の文は言い換えず、hint があれば添える", () => {
  const empty = startAnswer(400, {
    error: "the script catalog is empty",
    hint: "pnpm run scripts import .upstream/capture-scripts (run nothing on purpose: send scripts: [])",
  });
  assert.equal(empty.kind, "bad");
  assert.equal(
    empty.text,
    "400 —— the script catalog is empty（pnpm run scripts import .upstream/capture-scripts (run nothing on purpose: send scripts: [])）",
  );
  assert.equal(startAnswer(404, { error: "not found" }).text, "404 —— not found");
});

test("Fastify の答えは message を拾う —— error には \"Not Found\" しか無い", () => {
  const noRoute = startAnswer(404, {
    message: "Route POST:/api/crawls not found",
    error: "Not Found",
    statusCode: 404,
  });
  assert.equal(noRoute.text, "404 —— Route POST:/api/crawls not found");
});

test("この画面のサーバに届かなければ、そう言う", () => {
  assert.equal(startAnswer(0, { error: "Failed to fetch" }).text, "この画面自身に届きません（Failed to fetch）");
});

/** 走らせるものの欄。目録は autofetch・autoscroll の 2 本（目録の面と同じ id 順）。 */
const CATALOG = ["autofetch", "autoscroll"];
const NO_INLINE = { name: "", phase: "behavior", source: "" };
const run = (picked, inline = NO_INLINE) => ({ catalog: CATALOG, picked, inline });

test("走らせるものが既定のまま（目録を全部選び、その場の JS が空）なら scripts を送らない", () => {
  // 台帳の既定と、目録が空のときの 400 を生かす
  assert.equal("scripts" in startBody("https://example.com/", true, run(CATALOG)), false);
  // 目録が空で、その場の JS も無いときも送らない（台帳が「目録が空」と言う）
  assert.equal(scriptsOf({ catalog: [], picked: [], inline: NO_INLINE }), undefined);
});

test("目録を 1 つ外すと、選んだ物だけを目録の並びで送る", () => {
  // 押した順ではなく、目録の並び
  assert.deepEqual(scriptsOf(run(["autoscroll"])), [{ catalog: "autoscroll" }]);
  assert.deepEqual(scriptsOf({ catalog: CATALOG, picked: ["autoscroll", "autofetch"], inline: { ...NO_INLINE, source: "x;" } }).slice(1), [
    { catalog: "autofetch" },
    { catalog: "autoscroll" },
  ]);
});

test("全部外すと scripts: [] を送る —— 何も走らせない", () => {
  assert.deepEqual(startBody("https://example.com/", true, run([])).scripts, []);
});

test("その場の JS は先頭に、名前・phase・source を送る（source は削らない）", () => {
  const source = "\n(() => {\n  void 0;\n})();\n\n";
  const body = startBody("https://example.com/", true, run(CATALOG, { name: " close-banner ", phase: "preload", source }));
  assert.deepEqual(body.scripts, [
    { inline: { name: "close-banner", phase: "preload", source } },
    { catalog: "autofetch" },
    { catalog: "autoscroll" },
  ]);
});

test("空白だけの JS は送らない", () => {
  assert.equal(scriptsOf(run(CATALOG, { name: "x", phase: "behavior", source: " \n\t" })), undefined);
});

test("名前の綴りは検査しない —— 読めない名前も、そのまま台帳へ送る", () => {
  const body = startBody("https://example.com/", true, run(CATALOG, { name: "Close_Banner", phase: "behavior", source: "x;" }));
  assert.equal(body.scripts[0].inline.name, "Close_Banner");
});

test("台帳が名指した ids を、文の後に添える", () => {
  assert.equal(
    startAnswer(400, { error: "unknown catalog scripts", ids: ["typo-scroll"] }).text,
    "400 —— unknown catalog scripts: typo-scroll",
  );
  assert.equal(
    startAnswer(400, { error: "duplicate script ids", ids: ["inline-a", "autofetch"] }).text,
    "400 —— duplicate script ids: inline-a, autofetch",
  );
});

test("本文の大きさは、門と同じく UTF-8 のバイトで数える", () => {
  // 「例」は 3 バイト。JS の文字列の長さ（UTF-16）なら 27 になる
  assert.equal(bodyBytes({ seeds: ["https://例.jp/"] }), 29);
  // 改行は JSON の中で \n（2 バイト）になる
  assert.equal(bodyBytes({ source: "a\nb" }), 17);
});

test("上限ちょうどは送れ、1 バイト超えは送れない", () => {
  assert.equal(sizeOf("x", 1024, 1024).over, false);
  assert.equal(sizeOf("x", 1025, 1024).over, true);
  assert.equal(sizeOf("x", 512, 1024).percent, 50);
  // 上限を知らなければ止めない（門が 413 で言う）
  assert.equal(sizeOf("x", 10 ** 9, Infinity).over, false);
});

test("行数は JS の行で、空の箱は 0 行", () => {
  assert.equal(sizeOf("", 0, 1024).lines, 0);
  assert.equal(sizeOf("a", 0, 1024).lines, 1);
  assert.equal(sizeOf("a\n", 0, 1024).lines, 2);
});

test("型を検査しないと 1 行目に印が入り、外すと消える —— ほかの行は 1 バイトも変えない", () => {
  const source = "  (() => {\n    void 0;\n  })();\n";
  const on = withNocheck(source, true);
  assert.equal(on, `${NOCHECK}\n${source}`);
  assert.equal(withNocheck(on, false), source);
  // 既に合っていれば触らない
  assert.equal(withNocheck(on, true), on);
  assert.equal(withNocheck(source, false), source);
  // 印だけの 1 行を外すと空になる
  assert.equal(withNocheck(NOCHECK, false), "");
});

test("貼った JS が印を持っていれば、付いた状態で始まる", () => {
  assert.equal(hasNocheck(`${NOCHECK}\nvoid 0;`), true);
  assert.equal(hasNocheck(`  ${NOCHECK}  \nvoid 0;`), true);
  // 2 行目の印は数えない（ts-compile-service も 1 行目しか見ない）
  assert.equal(hasNocheck(`void 0;\n${NOCHECK}`), false);
  assert.equal(hasNocheck(""), false);
});

test("下敷き: __bh.opts[\"<id>\"] と __bh.report(\"<id>\" の 2 つの形を替え、替えた行を返す", () => {
  const source = [
    ' * 設定 (`options_json`) は `__bh.opts["autoscroll"]` から引く:',
    "(async () => {",
    '  const opts = globalThis.__bh.opts["autoscroll"] ?? {};',
    '  globalThis.__bh.report("autoscroll", { steps: 1 });',
    "})();",
  ].join("\n");
  const { source: out, changed } = asTemplate(source, "autoscroll", "my-autoscroll");
  assert.deepEqual(changed, [1, 3, 4]);
  assert.equal(
    out,
    [
      ' * 設定 (`options_json`) は `__bh.opts["inline-my-autoscroll"]` から引く:',
      "(async () => {",
      '  const opts = globalThis.__bh.opts["inline-my-autoscroll"] ?? {};',
      '  globalThis.__bh.report("inline-my-autoscroll", { steps: 1 });',
      "})();",
    ].join("\n"),
  );
});

test("下敷き: ほかの綴りは触らない（ログ・地の文・__bh. の無い opts・別の id）", () => {
  const source = [
    'console.log("autoscroll");',
    " * built-in の `autoscroll` を送る形に",
    'const x = cfg.opts["autoscroll"];',
    'const y = globalThis.__bh.opts["autofetch"];',
    'globalThis.__bh.report("autoscroller", {});',
  ].join("\n");
  const { source: out, changed } = asTemplate(source, "autoscroll", "my-autoscroll");
  assert.deepEqual(changed, []);
  assert.equal(out, source);
});
