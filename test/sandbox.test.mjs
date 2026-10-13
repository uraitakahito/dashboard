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
import {
  archiveRows,
  crawlDetail,
  crawlRow,
  idOf,
  readingLastGood,
  signedUrlOf,
  submitCrawl,
  submittedRow,
} from "../sandbox/fake-ledger.mjs";

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

// ── 起こす口（POST /api/crawls）。文は capture-ledger v0.57.5 の src/api/crawls.ts から写した ──

const RUNS = 15;

test("起こすと 202 で、受けた行が走行中として先頭に出る", () => {
  // 台本には走行中の行が在るが、受けた行だけで数えるので塞がない
  assert.ok(scenario.crawls.some((c) => c.state === "running"));
  const rows = [];
  const answer = submitCrawl(rows, { seeds: ["https://example.com/"], maxDepth: 0 }, NOW, RUNS);
  assert.equal(answer.status, 202);
  assert.deepEqual(Object.keys(answer.body), ["crawlId"]);
  assert.equal(rows[0].crawlId, answer.body.crawlId);
  const row = submittedRow(rows[0], NOW + 1000);
  assert.equal(row.state, "running");
  assert.equal(row.finishedAt, null);
  assert.equal(row.startedAt, "2026-10-12T12:00:00.000Z");
});

test("走っている間の 2 本目は 409 で、塞いでいる行を名指す", () => {
  const rows = [];
  const first = submitCrawl(rows, { seeds: ["https://example.com/"] }, NOW, RUNS);
  const second = submitCrawl(rows, { seeds: ["https://example.org/"] }, NOW + 5000, RUNS);
  assert.equal(second.status, 409);
  assert.deepEqual(second.body, {
    error: "a crawl is already in progress",
    crawlId: first.body.crawlId,
    startedAt: "2026-10-12T12:00:00.000Z",
  });
  assert.equal(rows.length, 1, "断った本は行にしない");
});

test("runsSeconds を過ぎると完走になり、次を受ける", () => {
  const rows = [];
  submitCrawl(rows, { seeds: ["https://example.com/", "https://example.com/docs/"] }, NOW, RUNS);
  const done = submittedRow(rows[0], NOW + RUNS * 1000);
  assert.equal(done.state, "succeeded");
  assert.equal(done.stopReason, "completed");
  assert.equal(done.finishedAt, "2026-10-12T12:00:15.000Z");
  assert.equal(done.pagesCaptured, 2);
  assert.equal(stateOf(done).text, "完走");
  const next = submitCrawl(rows, { seeds: ["https://example.org/"] }, NOW + RUNS * 1000, RUNS);
  assert.equal(next.status, 202);
  assert.equal(rows[0].crawlId, next.body.crawlId, "新しい順の先頭");
});

test("読めない起点・空の起点・seeds の無い body は、台帳と同じ文で 400", () => {
  const rows = [];
  const say = (body) => submitCrawl(rows, body, NOW, RUNS);
  assert.deepEqual(say({}), { status: 400, body: { error: "provide exactly one of seeds or fromTargets" } });
  assert.deepEqual(say({ seeds: [] }), { status: 400, body: { error: "seeds must not be empty" } });
  for (const seed of ["ftp://example.com/", "not a url", "example.com"]) {
    assert.deepEqual(say({ seeds: ["https://example.com/", seed] }), {
      status: 400,
      body: { error: "every seed must be an http(s) URL" },
    });
  }
  assert.equal(rows.length, 0, "断った本は行にしない");
});

test("受けた行も、台帳の /api/crawls と同じ欄を持つ", () => {
  const rows = [];
  submitCrawl(rows, { seeds: ["https://example.com/"] }, NOW, RUNS);
  assert.deepEqual(Object.keys(submittedRow(rows[0], NOW)).sort(), LEDGER_CRAWL_KEYS);
  assert.deepEqual(Object.keys(submittedRow(rows[0], NOW + RUNS * 1000)).sort(), LEDGER_CRAWL_KEYS);
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

test("台本が少しの間だけ読めないときは、前に読めた台本で答える", () => {
  let t = 0;
  let broken;
  const read = readingLastGood(
    () => {
      if (broken !== undefined) throw broken;
      return { at: t };
    },
    3000,
    () => t,
  );
  assert.deepEqual(read(), { at: 0 });

  broken = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
  t = 1000;
  assert.deepEqual(read(), { at: 0 }, "置き換えの直後");
  t = 3999;
  assert.deepEqual(read(), { at: 0 }, "読めなくなってから 3 秒未満");
  t = 4000;
  assert.throws(read, /ENOENT/, "読めないのが続いたら投げる (書き損じを赤い文で言う)");

  broken = undefined;
  t = 5000;
  assert.deepEqual(read(), { at: 5000 }, "読めたら新しい台本");
});

test("1 度も読めていない台本は、待たずに投げる", () => {
  const read = readingLastGood(
    () => JSON.parse("{"),
    3000,
    () => 0,
  );
  assert.throws(read, SyntaxError);
});

test("同梱の台本の crawlId は、画面が出す頭の 8 字で見分けられる", () => {
  // 画面の id の欄は crawlId の頭の 8 字 (public/app.js)。頭が揃うと、全部の行が同じ id に見える
  const heads = scenario.crawls.map((c) => c.crawlId.slice(0, 8));
  assert.equal(new Set(heads).size, heads.length, heads.join(" "));
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
