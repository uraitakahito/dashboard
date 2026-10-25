/**
 * サンドボックスの代役 (sandbox/fake-ledger.mjs) の、応答を組み立てる部分。
 *
 * 欄の集合を台帳の応答と揃えておくことと、同梱の台本が画面の状態を全部出せることを固定する。
 * 台帳の欄は capture-ledger v0.57.4 から写した —— 台帳が欄を足したら、ここと代役を直す。
 * スクリプトを読む口（版の一覧・1 版・受け皿の型）は v0.60.0 から、札（`sites`）と起点で選ぶ既定は v0.61.0 から。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { stateOf } from "../public/format.js";
import { asTemplate, defaultIds, seedHosts } from "../public/start.js";
import {
  archiveRows,
  catalogOf,
  crawlDetail,
  crawlRow,
  defaultSet,
  hostTypesOf,
  idOf,
  inlineSource,
  latestEnabled,
  readingLastGood,
  signedUrlOf,
  submitCrawl,
  submittedRow,
  versionOf,
  versionsOf,
} from "../sandbox/fake-ledger.mjs";

const scenario = JSON.parse(readFileSync(new URL("../sandbox/scenario.json", import.meta.url), "utf8"));
/** 台本のスクリプト（版の並び。source は sandbox/catalog の写しと、見本の sandbox/sites）。 */
const versions = catalogOf(scenario);
/** 版を `id@版` で並べる（既定の顔ぶれ・走らせたものを 1 行で比べる）。 */
const at = (list) => list.map((v) => `${v.id}@${String(v.version)}`);
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

// ── 始める口（POST /api/crawls）。文は capture-ledger v0.57.5 の src/api/crawls.ts から写した ──

const RUNS = 15;

test("始めると 202 で、受けた行が走行中として先頭に出る", () => {
  // 台本には走行中の行が在るが、受けた行だけで数えるので塞がない
  assert.ok(scenario.crawls.some((c) => c.state === "running"));
  const rows = [];
  const answer = submitCrawl(rows, { seeds: ["https://example.com/"], maxDepth: 0 }, NOW, RUNS, versions);
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
  const first = submitCrawl(rows, { seeds: ["https://example.com/"] }, NOW, RUNS, versions);
  const second = submitCrawl(rows, { seeds: ["https://example.org/"] }, NOW + 5000, RUNS, versions);
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
  submitCrawl(rows, { seeds: ["https://example.com/", "https://example.com/docs/"] }, NOW, RUNS, versions);
  const done = submittedRow(rows[0], NOW + RUNS * 1000);
  assert.equal(done.state, "succeeded");
  assert.equal(done.stopReason, "completed");
  assert.equal(done.finishedAt, "2026-10-12T12:00:15.000Z");
  assert.equal(done.pagesCaptured, 2);
  assert.equal(stateOf(done).text, "完走");
  const next = submitCrawl(rows, { seeds: ["https://example.org/"] }, NOW + RUNS * 1000, RUNS, versions);
  assert.equal(next.status, 202);
  assert.equal(rows[0].crawlId, next.body.crawlId, "新しい順の先頭");
});

test("読めない起点・空の起点・seeds の無い body は、台帳と同じ文で 400", () => {
  const rows = [];
  const say = (body) => submitCrawl(rows, body, NOW, RUNS, versions);
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
  submitCrawl(rows, { seeds: ["https://example.com/"] }, NOW, RUNS, versions);
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

test("クロール 1 本は、dashboard が読む seeds・error・scripts・failures を返す", () => {
  const failed = scenario.crawls.find((c) => c.state === "failed" && c.failures?.length > 0);
  const detail = crawlDetail(failed);
  assert.deepEqual(detail.seeds, failed.seeds);
  assert.equal(detail.error, failed.error);
  assert.ok(detail.failures.length > 0);
  // 走らせたものを持たない行は、空の並び（台帳も、何も走らせなければ []）
  assert.deepEqual(detail.scripts, []);
});

test("同梱の台本に、その場の JS で完走した行と、compile の段で落ちた行が在る", () => {
  const withInline = scenario.crawls.filter((c) => c.scripts?.some((s) => s.inline !== undefined));
  assert.deepEqual(withInline.map((c) => c.state).sort(), ["failed", "succeeded"]);
  const broken = crawlDetail(withInline.find((c) => c.state === "failed"));
  assert.match(broken.error, /compile 422 .*inline-close-banner\.ts/);
  // 台帳と同じく、その場の物にだけ inline が付き、台帳のスクリプトは身元だけ
  assert.equal(broken.scripts[0].id, "inline-close-banner");
  assert.equal(broken.scripts[0].inline.name, "close-banner");
  assert.equal("inline" in broken.scripts[1], false);
});

test("scripts を受けると、その場の JS は inline- の id・版 1 で写り、詳しい所には名前・口・バイト数だけが出る", () => {
  const rows = [];
  const inline = { name: "close-banner", phase: "preload", source: "x;" };
  const answer = submitCrawl(
    rows,
    { seeds: ["https://example.com/"], scripts: [{ inline }, { catalog: "autofetch" }] },
    NOW,
    RUNS,
    versions,
  );
  assert.equal(answer.status, 202);
  const detail = crawlDetail(submittedRow(rows[0], NOW), rows[0].scripts);
  assert.deepEqual(
    detail.scripts.map((s) => [s.id, s.version, s.phase]),
    [
      ["inline-close-banner", 1, "preload"],
      ["autofetch", 1, "behavior"],
    ],
  );
  // source は運ばない（capture-ledger v0.59.0）。走行中の行は 2 秒ごとに引き直すので
  assert.deepEqual(detail.scripts[0].inline, { name: "close-banner", phase: "preload", bytes: 2 });
  assert.equal(JSON.stringify(detail).includes('"source"'), false);
  assert.equal("inline" in detail.scripts[1], false);
  // 一覧の行には出さない（欄は台帳の一覧と揃えて固定している）
  assert.equal("scripts" in submittedRow(rows[0], NOW), false);
});

test("名前の口は、受けた行と台本の行の両方で、その場の JS を source ごと返す", () => {
  const rows = [];
  const inline = { name: "close-banner", phase: "preload", source: "x;" };
  submitCrawl(
    rows,
    { seeds: ["https://example.com/"], scripts: [{ inline }] },
    NOW,
    RUNS,
    versions,
  );
  const mine = inlineSource(rows[0].scripts, "close-banner");
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body, { ...inline, sha256: rows[0].scripts[0].sha256 });

  // 台本の行（compile の段で落ちた行）からも引ける。sha256 は詳しい所と同じ
  const failed = scenario.crawls.find(
    (c) => c.state === "failed" && c.scripts?.some((x) => x.inline !== undefined),
  );
  const theirs = inlineSource(failed.scripts, "close-banner");
  assert.equal(theirs.status, 200);
  assert.equal(theirs.body.sha256, crawlDetail(failed).scripts[0].sha256);
  assert.match(theirs.body.source, /close/);
});

test("名前の口は、台帳のスクリプト・知らない名前・知らない行には 404（台帳と同じ文）", () => {
  const rows = [];
  submitCrawl(
    rows,
    {
      seeds: ["https://example.com/"],
      scripts: [{ inline: { name: "a", phase: "behavior", source: "x;" } }, { catalog: "autofetch" }],
    },
    NOW,
    RUNS,
    versions,
  );
  for (const name of ["autofetch", "nope"]) {
    assert.deepEqual(inlineSource(rows[0].scripts, name), {
      status: 404,
      body: { error: "not found" },
    });
  }
  assert.equal(inlineSource(undefined, "a").status, 404);
});

test("走行中でも、走らせるものの誤りは 409 より先に 400 —— 台帳と同じ順", () => {
  const rows = [];
  submitCrawl(rows, { seeds: ["https://example.com/"] }, NOW, RUNS, versions);
  const busy = submitCrawl(
    rows,
    { seeds: ["https://example.com/"], scripts: [{ catalog: "typo-scroll" }] },
    NOW + 1000,
    RUNS,
    versions,
  );
  assert.equal(busy.status, 400);
  // 形が合っていれば、走行中は 409（今までどおり）
  const ok = submitCrawl(rows, { seeds: ["https://example.com/"], scripts: [] }, NOW + 1000, RUNS, versions);
  assert.equal(ok.status, 409);
});

test("scripts を省くと、起点で選んだ既定を走らせたものとして返す —— 合うサイト用のスクリプトは札ごと", () => {
  const ranFrom = (seed) => {
    const rows = [];
    submitCrawl(rows, { seeds: [seed] }, NOW, RUNS, versions);
    return crawlDetail(submittedRow(rows[0], NOW), rows[0].scripts).scripts;
  };
  assert.deepEqual(at(ranFrom("https://example.org/")), ["autofetch@1", "autoscroll@2"]);
  const onSite = ranFrom("https://example.com/");
  assert.deepEqual(at(onSite), ["autofetch@1", "autoscroll@2", "example-title@1"]);
  // 札は台帳 v0.61.0 と同じく詳しい所に出る。札の無い物は空の並び
  assert.deepEqual(
    onSite.map((s) => s.sites),
    [[], [], ["example.com"]],
  );
});

test("一覧の口（有効な各 id の最新版）は、サイト用のスクリプトも札つきで返す（無効な版は飛ばす）", () => {
  assert.deepEqual(at(latestEnabled(versions)), ["autofetch@1", "autoscroll@2", "example-title@1"]);
  assert.deepEqual(latestEnabled(versions)[2].sites, ["example.com"]);
  const off = versions.map((v) => (v.id === "autoscroll" && v.version === 2 ? { ...v, enabled: false } : v));
  assert.deepEqual(at(latestEnabled(off)), ["autofetch@1", "autoscroll@1", "example-title@1"]);
});

test("既定の顔ぶれは、札の無い物と、起点に合うサイト用の物 —— ポートは見ない", () => {
  assert.deepEqual(at(defaultSet(versions, new Set())), ["autofetch@1", "autoscroll@2"]);
  assert.deepEqual(at(defaultSet(versions, seedHosts("https://example.com:8443/a"))), [
    "autofetch@1",
    "autoscroll@2",
    "example-title@1",
  ]);
  // 完全一致。www. の付いたホストは別
  assert.deepEqual(at(defaultSet(versions, seedHosts("https://www.example.com/"))), ["autofetch@1", "autoscroll@2"]);
});

test("既定は最新版を選んでから札で絞る —— 札を付け直した id の、札の無い古い版は出てこない", () => {
  // 台帳 v0.61.0 の resolveScripts と同じ順。逆にすると v1 が出てくる
  const resited = [
    ...versions,
    { ...versions[0], id: "google-results", version: 1, sites: [] },
    { ...versions[0], id: "google-results", version: 2, sites: ["www.google.com"] },
  ];
  assert.deepEqual(at(defaultSet(resited, seedHosts("https://example.org/"))), ["autofetch@1", "autoscroll@2"]);
});

test("代役の既定と、新しいクロールの画面の既定（public/start.js）は、同じ起点に同じ顔ぶれを出す", () => {
  // 決まりの正は台帳。2 つの写しが食い違えば、dashboard が「省いても同じ」と送った頼みで別の物が走る
  const seeds = [
    "",
    "https://example.org/",
    "https://example.com/",
    "http://example.com:8080/a\nhttps://example.org/",
    "https://www.example.com/",
    "not a url\nHTTPS://EXAMPLE.COM/",
  ];
  for (const text of seeds) {
    const hosts = seedHosts(text);
    assert.deepEqual(
      defaultSet(versions, hosts).map((v) => v.id),
      defaultIds(latestEnabled(versions), hosts),
      JSON.stringify(text),
    );
  }
});

test("起点に合わないサイト用のスクリプトを名指すと、台帳と同じ文で 400 —— 走行中でも 409 より先", () => {
  const rows = [];
  const post = (seeds) =>
    submitCrawl(rows, { seeds, scripts: [{ catalog: "autofetch" }, { catalog: "example-title" }] }, NOW, RUNS, versions);
  assert.deepEqual(post(["https://example.org/"]), {
    status: 400,
    body: {
      error: "site scripts need a seed on their site",
      ids: ["example-title"],
      hint: "example-title: example.com",
    },
  });
  // 起点のどれかが合えば通る（ポートは見ない）
  assert.equal(post(["https://example.org/", "https://example.com:8443/"]).status, 202);
  assert.equal(post(["https://example.org/"]).status, 400);
});

test("既定が空なら 400 —— 台帳にスクリプトが無いのと、全部が別のサイト用とで文を分ける（台帳と同じ文）", () => {
  const post = (list, body = {}) => submitCrawl([], { seeds: ["https://example.org/"], ...body }, NOW, RUNS, list);
  assert.deepEqual(post([]), {
    status: 400,
    body: {
      error: "no scripts are registered",
      hint: "pnpm run scripts import .upstream/capture-scripts (run nothing on purpose: send scripts: [])",
    },
  });
  const onlySite = versions.filter((v) => v.id === "example-title");
  assert.deepEqual(post(onlySite), {
    status: 400,
    body: {
      error: "no default scripts for these seeds",
      hint: "example-title: example.com (run nothing on purpose: send scripts: [])",
    },
  });
  // 「何も走らせない」は書ける
  assert.equal(post(onlySite, { scripts: [] }).status, 202);
});

test("版の一覧は新しい順で、どの版にも source が無い。知らない id は 404", () => {
  const answer = versionsOf(versions, "autoscroll");
  assert.equal(answer.status, 200);
  assert.deepEqual(
    answer.body.versions.map((v) => v.version),
    [2, 1],
  );
  for (const v of answer.body.versions) {
    assert.deepEqual(Object.keys(v).sort(), ["bytes", "createdAt", "enabled", "phase", "sha256", "sites", "version"]);
  }
  assert.deepEqual(versionsOf(versions, "nope"), { status: 404, body: { error: "not found" } });
});

test("1 版は source を持ち、sha256 と bytes は source から数える（写しは capture-scripts v0.2.1）", () => {
  const fetch1 = versionOf(versions, "autofetch", "1");
  assert.equal(fetch1.status, 200);
  assert.equal(fetch1.body.sha256.slice(0, 12), "6aa6f4459d92");
  assert.equal(fetch1.body.bytes, 4358);
  const scroll1 = versionOf(versions, "autoscroll", "1").body;
  assert.equal(scroll1.sha256.slice(0, 12), "c9956819ffea");
  assert.equal(scroll1.bytes, 2695);
  assert.match(scroll1.source.split("\n")[32], /remainingMs < stepDelayMs \+ settleMs/);
  assert.deepEqual(versionOf(versions, "autoscroll", "2").body.options, { maxSteps: 60 });
  assert.deepEqual(versionOf(versions, "autoscroll", "9"), { status: 404, body: { error: "not found" } });
  assert.equal(versionOf(versions, "autoscroll", "abc").body.message, "params/version must be integer");
  assert.equal(versionOf(versions, "autoscroll", "0").body.message, "params/version must be >= 1");
});

test("受け皿の型は台本の file の中身。台本に無ければ 404（型を取り込んでいない台帳）", () => {
  const types = hostTypesOf(scenario);
  assert.equal(types.status, 200);
  assert.equal(types.body.version, 1);
  assert.match(types.body.source, /custom\.jsonl には残らない/);
  assert.equal(types.body.bytes, Buffer.byteLength(types.body.source, "utf8"));
  const { hostTypes: _hostTypes, ...without } = scenario;
  assert.deepEqual(hostTypesOf(without), { status: 404, body: { error: "not found" } });
});

test("台本のクロールが走らせた台帳のスクリプトは、台帳のその版と同じ sha256（5b0c0008 の autoscroll だけはわざと違う）", () => {
  const MISMATCH = "5b0c0008-6a1e-4000-8000-000000000008 autoscroll@1";
  const seen = [];
  for (const c of scenario.crawls) {
    for (const s of (c.scripts ?? []).filter((x) => x.inline === undefined)) {
      const key = `${c.crawlId} ${s.id}@${String(s.version)}`;
      const same = versions.find((v) => v.id === s.id && v.version === s.version)?.sha256 === s.sha256;
      seen.push(key);
      assert.equal(same, key !== MISMATCH, key);
    }
  }
  assert.ok(seen.includes(MISMATCH));
});

test("下敷きを実物の写しに掛けると、替わるのは autoscroll の 9・18・48 行と autofetch の 14・17・92 行", () => {
  const sourceOf = (id) => versionOf(versions, id, "1").body.source;
  assert.deepEqual(asTemplate(sourceOf("autoscroll"), "autoscroll", "my-autoscroll").changed, [9, 18, 48]);
  assert.deepEqual(asTemplate(sourceOf("autofetch"), "autofetch", "my-autofetch").changed, [14, 17, 92]);
});

test("知らないスクリプトの id・重ね・形の誤り・scriptIds は、台帳と同じ文で 400", () => {
  const post = (body) =>
    submitCrawl([], { seeds: ["https://example.com/"], ...body }, NOW, RUNS, versions);
  const inline = (name) => ({ inline: { name, phase: "behavior", source: "x;" } });
  assert.deepEqual(post({ scripts: [{ catalog: "typo-scroll" }] }), {
    status: 400,
    body: { error: "unknown script ids", ids: ["typo-scroll"] },
  });
  assert.deepEqual(post({ scripts: [inline("a"), inline("a")] }).body, {
    error: "duplicate script ids",
    ids: ["inline-a"],
  });
  // 文は台帳 v0.58.0 が Fastify の schema で返す物（dashboard は message を出す）
  assert.equal(
    post({ scripts: [inline("Probe")] }).body.message,
    'body/scripts/0/inline/name must match pattern "^[a-z][a-z0-9-]*$"',
  );
  assert.equal(
    post({ scripts: [{ catalog: "autofetch", ...inline("a") }] }).body.message,
    "body/scripts/0 must NOT have more than 1 properties",
  );
  assert.equal(post({ scripts: [{}] }).body.message, "body/scripts/0 must NOT have fewer than 1 properties");
  assert.equal(post({ scriptIds: ["autofetch"] }).body.message, "body must NOT have additional properties");
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
