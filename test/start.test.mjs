/**
 * 「起こす」欄の部品（`public/start.js`）。送る body と、答えの言い方。
 *
 * 送る道（`POST /api/crawls` の中継）と門は http の口に在り、門の判定は `lib.test.mjs` が見る。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { startAnswer, startBody } from "../public/start.js";

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
    hint: "pnpm run scripts import .upstream/capture-scripts (run nothing on purpose: send scriptIds: [])",
  });
  assert.equal(empty.kind, "bad");
  assert.equal(
    empty.text,
    "400 —— the script catalog is empty（pnpm run scripts import .upstream/capture-scripts (run nothing on purpose: send scriptIds: [])）",
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
