/**
 * クロールの行を開いたときの「規則が何を決めたか」（`public/decisions.js`）。台帳の
 * `GET /api/crawls/:id/decisions` の答え（capture-ledger v0.62.0 の形）を数え直すだけ。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { dropsOf, inspectHref, ruleTallies } from "../public/decisions.js";

const RULES = [
  { skip: "skipped.invalid" },
  { skip: "tracker.example.net" },
  { follow: "same-host" },
  { capture: "any" },
];
const row = (depth, rule, action, hostname, links, sample) => ({
  depth,
  rule,
  action,
  hostname,
  links,
  samples: [sample],
});
const DECIDED = [
  row(1, 1, "skip", "skipped.invalid", 1, "http://skipped.invalid/page"),
  row(1, 3, "follow", "capture-fixtures.capture-ledger", 1, "http://capture-fixtures.capture-ledger:8080/links/leaf/1"),
  row(1, 4, "capture", "outside.invalid", 1, "http://outside.invalid/page"),
  row(2, 1, "skip", "skipped.invalid", 2, "http://skipped.invalid/a"),
  row(2, 0, "skip", "nowhere.invalid", 1, "http://nowhere.invalid/"),
];

test("規則ごとの数は段を跨いで足し、0 回の規則も行にし、どれにも当たらない物を最後に置く", () => {
  assert.deepEqual(ruleTallies(RULES, DECIDED), [
    { rule: 1, action: "skip", pattern: "skipped.invalid", links: 3 },
    { rule: 2, action: "skip", pattern: "tracker.example.net", links: 0 },
    { rule: 3, action: "follow", pattern: "same-host", links: 1 },
    { rule: 4, action: "capture", pattern: "any", links: 1 },
    { rule: 0, action: "skip", pattern: "", links: 1 },
  ]);
});

test("どれにも当たらない物が無ければ、その行は足さない", () => {
  assert.equal(ruleTallies(RULES, DECIDED.filter((r) => r.rule !== 0)).length, RULES.length);
});

test("落とした物は、規則とホスト名ごとに段を跨いで足し、robots.txt の分を後ろに。辿った物と撮るだけは入れない", () => {
  const robots = [{ hostname: "capture-fixtures.capture-ledger", pages: 1, samples: ["http://capture-fixtures.capture-ledger:8080/links/hidden"] }];
  assert.deepEqual(dropsOf(DECIDED, robots), [
    { why: 1, hostname: "skipped.invalid", links: 3, sample: "http://skipped.invalid/page" },
    { why: 0, hostname: "nowhere.invalid", links: 1, sample: "http://nowhere.invalid/" },
    { why: "robots", hostname: "capture-fixtures.capture-ledger", links: 1, sample: "http://capture-fixtures.capture-ledger:8080/links/hidden" },
  ]);
});

test("Windmill の走らせる画面は、hash に JSON の引数を置いて開く（id は全部）", () => {
  const href = inspectHref("http://127.0.0.1:8000", "crawler", "5b0c0007-6a1e-4000-8000-000000000007");
  assert.equal(
    href,
    "http://127.0.0.1:8000/scripts/get/f/waggle/inspect_crawl?workspace=crawler" +
      "#crawl=%225b0c0007-6a1e-4000-8000-000000000007%22",
  );
  // hash の値を戻すと、Windmill が読む JSON の文字列になる
  const value = decodeURIComponent(new URL(href).hash.slice("#crawl=".length));
  assert.equal(JSON.parse(value), "5b0c0007-6a1e-4000-8000-000000000007");
});
