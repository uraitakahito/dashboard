/**
 * サンドボックスの代役 (sandbox/fake-ledger.mjs) の、応答を組み立てる部分。
 *
 * 欄の集合を台帳の応答と揃えておくことと、同梱の台本が画面の状態を全部出せることを固定する。
 * 台帳の欄は capture-ledger v0.57.4 から写した —— 台帳が欄を足したら、ここと代役を直す。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { stateOf } from "../public/format.js";
import { archiveRows, crawlDetail, crawlRow, idOf, signedUrlOf } from "../sandbox/fake-ledger.mjs";

const scenario = JSON.parse(readFileSync(new URL("../sandbox/scenario.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-10-12T12:00:00.000Z");

/** capture-ledger の src/api/crawls.ts が /api/crawls の 1 行に返す欄 (v0.57.4)。 */
const LEDGER_CRAWL_KEYS = [
  "crawlId",
  "state",
  "stopReason",
  "seeds",
  "requestedBy",
  "orgId",
  "startedAt",
  "finishedAt",
  "pagesDiscovered",
  "pagesCaptured",
  "error",
  "waczCount",
  "lastJob",
].sort();

/** capture-ledger の src/api/routes.ts が /api/archives の 1 行に返す欄 (v0.57.4)。 */
const LEDGER_ARCHIVE_KEYS = [
  "id",
  "taskId",
  "sourceUrl",
  "labels",
  "waczComplete",
  "capturedAt",
  "objectKey",
].sort();

test("クロールの 1 行は、台帳の /api/crawls と同じ欄を持つ", () => {
  for (const c of scenario.crawls) {
    assert.deepEqual(Object.keys(crawlRow(c, NOW)).sort(), LEDGER_CRAWL_KEYS, c.crawlId);
  }
});

test("時刻は台本の何秒前から組み、走行中は終わりが無い", () => {
  const running = crawlRow({ crawlId: "r", state: "running", seeds: [], startedSecondsAgo: 40 }, NOW);
  assert.equal(running.startedAt, "2026-10-12T11:59:20.000Z");
  assert.equal(running.finishedAt, null);

  const done = crawlRow(
    { crawlId: "d", state: "succeeded", stopReason: "completed", seeds: [], startedSecondsAgo: 900, tookSeconds: 75 },
    NOW,
  );
  assert.equal(done.startedAt, "2026-10-12T11:45:00.000Z");
  assert.equal(done.finishedAt, "2026-10-12T11:46:15.000Z");
});

test("同梱の台本は、画面の状態の言い分けを全部出す", () => {
  // 言い分けの規則は public/format.js の stateOf。サンドボックスは、その全部の枝を画面に出すためにある
  const texts = new Set(scenario.crawls.map((c) => stateOf(crawlRow(c, NOW)).text));
  for (const text of ["走行中", "完走", "打ち切り (深さ)", "打ち切り (枚数)", "失敗"]) {
    assert.ok(texts.has(text), text);
  }
  assert.ok([...texts].some((text) => text.startsWith("成功 (")), "知らない stopReason の行");
  assert.ok((scenario.hidden ?? []).length > 0, "見えない archive の行");
});

test("クロール 1 本は、画面が読む seeds と failures を返す", () => {
  const failed = scenario.crawls.find((c) => c.state === "failed");
  const detail = crawlDetail(failed);
  assert.deepEqual(detail.seeds, failed.seeds);
  assert.ok(detail.failures.length > 0);
});

test("アーカイブの 1 行は、台帳の /api/archives と同じ欄を持ち、台本で上書きできる", () => {
  const rows = archiveRows(["good.wacz", "datapackage-bad-hash.wacz"], scenario);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), LEDGER_ARCHIVE_KEYS, row.objectKey);
  const bad = rows.find((row) => row.objectKey === "sandbox/datapackage-bad-hash.wacz");
  assert.equal(bad.waczComplete, false);
});

test("見えない行は一覧に出るが、署名は出ない", () => {
  const names = ["good.wacz"];
  const ghost = archiveRows(names, { ...scenario, hidden: ["ghost.wacz"] }).find(
    (row) => row.objectKey === "sandbox/ghost.wacz",
  );
  assert.ok(ghost);
  assert.equal(signedUrlOf(ghost.id, names), undefined);
  assert.equal(signedUrlOf("not-an-id", names), undefined);
});

test("署名の代わりに、置き場の file:// の URL を返す", () => {
  assert.deepEqual(signedUrlOf(idOf("good.wacz"), ["good.wacz"]), {
    url: "file:///samples/good.wacz",
    expiresIn: 300,
  });
});

test("id は名前から決まり、UUID の形をしている", () => {
  assert.equal(idOf("good.wacz"), idOf("good.wacz"));
  assert.notEqual(idOf("good.wacz"), idOf("ghost.wacz"));
  assert.match(idOf("good.wacz"), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
