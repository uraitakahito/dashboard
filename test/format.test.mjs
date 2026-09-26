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

/**
 * 検証の結果の描き方。
 *
 * **失敗 0 を「問題なし」と言い切らない。** 実機の WACZ は 21 passed / 1 warning で、
 * 失敗は 0 —— そこを緑 1 色にすると、警告が画面から消える。
 */
test("失敗が無くても、警告があれば緑にしない", async () => {
  const { verdict } = await import("../public/format.js");
  assert.deepEqual(verdict({ failed: 0, warnings: 1 }), { text: "警告 1", kind: "warn" });
  assert.deepEqual(verdict({ failed: 0, warnings: 0 }), { text: "問題なし", kind: "ok" });
  assert.equal(verdict({ failed: 2, warnings: 9 }).kind, "bad");
});

test("知らない severity を「問題なし」に倒さない", async () => {
  const { severityKind } = await import("../public/format.js");
  assert.equal(severityKind("error"), "bad");
  assert.equal(severityKind("warning"), "warn");
  assert.equal(severityKind("info"), "muted");
  // 検証器が新しく言い始めたことを、黙って緑にしない。
  assert.notEqual(severityKind("なにか新しい severity"), "ok");
});

/**
 * 報告がどの条件で作られたか。**版は報告のまま出す** —— 2026-09-26 まで、この画面は
 * 検証器の版を出していなかった。v0.28.1 の daemon が 2 日動いていても、どの報告からも
 * 分からなかった。
 */
test("報告を作った検証器の版と profile を、報告のまま出す", async () => {
  const { judgedUnder } = await import("../public/format.js");
  assert.deepEqual(
    judgedUnder({ validatorVersion: "0.31.0+3.gabcdef1", profile: { name: "browserhive" } }),
    ["wacz-validator 0.31.0+3.gabcdef1", "profile browserhive"],
  );
});

/**
 * **`stats` は best-effort で、無いことがある** —— WARC が統計を取れないほど壊れていても、
 * そう言う報告は出す (wacz-validator の約束)。この画面は在るものとして読み、無い報告では
 * 検証の行ごと「検証できず」に落ちていた。
 */
test("stats の無い報告でも、行を落とさない", async () => {
  const { statsOf } = await import("../public/format.js");
  assert.deepEqual(statsOf({}), []);
  assert.deepEqual(
    statsOf({ stats: { warcRecordCount: 3, hosts: ["a.example", "b.example"] } }),
    ["WARC 3 レコード", "a.example, b.example"],
  );
  assert.deepEqual(statsOf({ stats: { warcRecordCount: 0 } }), ["WARC 0 レコード"]);
});
