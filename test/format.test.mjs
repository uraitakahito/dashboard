/**
 * 画面が state をどう言葉にするか。
 *
 * **ここが嘘をつくと、画面全体が嘘になる。** 実機の 68 本のうち 41 本は「成功」だが
 * 打ち切りで、1 本は `succeeded` なのに `stopReason` が `failed` だった ——
 * `state` だけを描く実装は、その 42 本を取り違える。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { stateOf, took } from "../public/format.js";

const crawl = (state, stopReason) => ({ state, stopReason });

test("完走と打ち切りを、同じ「成功」にしない", () => {
  assert.equal(stateOf(crawl("succeeded", "completed")).text, "完走");
  assert.equal(stateOf(crawl("succeeded", "max_depth")).text, "打ち切り (深さ)");
  assert.equal(stateOf(crawl("succeeded", "max_pages")).text, "打ち切り (枚数)");
  // 色も分ける —— 完走だけが緑。
  assert.equal(stateOf(crawl("succeeded", "completed")).kind, "ok");
  assert.equal(stateOf(crawl("succeeded", "max_depth")).kind, "warn");
});

test("succeeded なのに stopReason が failed の行を、ただの成功にしない", () => {
  // 実機に 1 本ある。隠すと、その行だけが嘘になる。
  const odd = stateOf(crawl("succeeded", "failed"));
  assert.equal(odd.text, "成功 (failed)");
  assert.notEqual(odd.kind, "ok");
});

test("知らない stopReason は、そのまま見せる", () => {
  assert.equal(stateOf(crawl("succeeded", "なにか新しい理由")).text, "成功 (なにか新しい理由)");
});

test("走行中と失敗は stopReason を見ない", () => {
  assert.equal(stateOf(crawl("running", null)).text, "走行中");
  assert.equal(stateOf(crawl("failed", "failed")).text, "失敗");
});

test("走行中は「いままで」を出す —— finishedAt の null は時間が無いことではない", () => {
  const started = "2026-09-21T00:00:00.000Z";
  const now = new Date("2026-09-21T00:00:42.000Z").getTime();
  assert.equal(took({ startedAt: started, finishedAt: null }, now), "42s");
});

test("90 秒を超えたら分で言う", () => {
  assert.equal(
    took({ startedAt: "2026-09-21T00:00:00.000Z", finishedAt: "2026-09-21T00:02:05.000Z" }),
    "2m 5s",
  );
});
