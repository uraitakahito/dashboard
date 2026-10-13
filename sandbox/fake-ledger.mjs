/**
 * 台帳の代役。dashboard のサンドボックス (docker-compose.yml の sandbox-ledger) の中で動く。
 *
 * 画面が台帳に訊く口と、開発用 issuer の `POST /token` に、台本 (scenario.json) と
 * WACZ の置き場から答える。応答の欄は capture-ledger の応答に合わせてある (出どころは
 * 各関数の注記)。認可は真似ない —— 名乗りは何でも通す。
 *
 * 署名付き URL の代わりに、置き場の `file://` の URL を返す。検証の daemon
 * (sandbox-validator) も同じ置き場を同じ path に mount しているので、それを読める。
 *
 * `POST /api/crawls` (画面の起こす欄) にも答える。受けた行は代役が起きている間だけ在り、
 * 台本の `submit.runsSeconds` 秒走ってから完走になる (台本の行とは別に持つ)。
 *
 * 試験から関数を import できるように、server は直に走らせたときだけ立てる。
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** WACZ の置き場。compose の中では /samples (daemon も同じ path で読む)。 */
const SAMPLES = process.env.SANDBOX_SAMPLES ?? "/samples";
const SCENARIO = new URL("./scenario.json", import.meta.url);

/**
 * 台本の時刻の基準。代役が起きた時刻に固定する —— 要求のたびの「いま」を基準にすると、
 * 走行中の行はいつ引いても startedSecondsAgo 秒前に始まったことになり、かかった時間が伸びない。
 */
const STARTED = Date.now();

/** 台帳と同じ UUID の形の id を、名前から決める (何度起こしても同じ id になる)。 */
export const idOf = (name) =>
  createHash("sha1")
    .update(name)
    .digest("hex")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*/, "$1-$2-$3-$4-$5");

/**
 * /api/crawls の 1 行。欄は capture-ledger の src/api/crawls.ts (v0.57.4) と同じ。
 * 時刻は台本の「何秒前」から、now (代役が起きた時刻) を基準に組む。走行中は終わりが無い。
 */
export const crawlRow = (c, now) => ({
  crawlId: c.crawlId,
  state: c.state,
  stopReason: c.stopReason ?? null,
  seeds: c.seeds,
  requestedBy: c.requestedBy ?? "sandbox",
  orgId: c.orgId ?? "acme",
  startedAt: new Date(now - c.startedSecondsAgo * 1000).toISOString(),
  finishedAt:
    c.state === "running"
      ? null
      : new Date(now - (c.startedSecondsAgo - c.tookSeconds) * 1000).toISOString(),
  pagesDiscovered: c.pagesDiscovered ?? 0,
  pagesCaptured: c.pagesCaptured ?? 0,
  error: c.error ?? null,
  waczCount: c.waczCount ?? 0,
  lastJob: c.lastJobId === undefined ? null : { id: c.lastJobId, depth: c.lastJobDepth ?? 0 },
});

/**
 * /api/crawls/:id。台帳はほかの欄 (範囲・上限・走らせたスクリプトなど) も返すが、
 * 画面が読むのは seeds と failures だけなので、そこまでにしてある。
 */
export const crawlDetail = (c) => ({
  crawlId: c.crawlId,
  seeds: c.seeds,
  state: c.state,
  stopReason: c.stopReason ?? null,
  failures: c.failures ?? [],
});

/**
 * /api/archives の行。欄は capture-ledger の src/api/routes.ts (v0.57.4) と同じ。
 * 置き場の WACZ に、台本の「見えない」行 (hidden) を足し、台本の archives で欄を上書きする。
 * 見えない行は一覧に出るが、署名は出ない (台帳の「見てよくない」と同じ 404 になる)。
 */
export const archiveRows = (names, s) =>
  [...names, ...(s.hidden ?? [])].map((name) => ({
    id: idOf(name),
    taskId: idOf(`task:${name}`),
    sourceUrl: `https://sandbox.example/${name}`,
    labels: ["sandbox"],
    waczComplete: true,
    capturedAt: s.capturedAt,
    objectKey: `sandbox/${name}`,
    ...(s.archives?.[name] ?? {}),
  }));

const httpUrl = (raw) => {
  try {
    const { protocol } = new URL(String(raw));
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * `POST /api/crawls` を真似る。受けたら `rows` の先頭に足す (新しい順)。
 *
 * 答えの文と形は capture-ledger v0.57.5 の src/api/crawls.ts から写した (試験が固定する)。
 * **走行中の 1 本は、受けた行だけで数える** —— 台本の走行中の行は飾りで、それで 409 に
 * すると何も起こせない。409 を見たいなら、走っている間にもう 1 度起こす。
 */
export const submitCrawl = (rows, body, now, runsSeconds) => {
  if (!Array.isArray(body?.seeds)) {
    return { status: 400, body: { error: "provide exactly one of seeds or fromTargets" } };
  }
  if (body.seeds.length === 0) return { status: 400, body: { error: "seeds must not be empty" } };
  if (!body.seeds.every(httpUrl)) {
    return { status: 400, body: { error: "every seed must be an http(s) URL" } };
  }
  const running = rows.find((row) => now < row.startedAt + row.runsSeconds * 1000);
  if (running !== undefined) {
    return {
      status: 409,
      body: {
        error: "a crawl is already in progress",
        crawlId: running.crawlId,
        startedAt: new Date(running.startedAt).toISOString(),
      },
    };
  }
  const row = { crawlId: randomUUID(), seeds: body.seeds, startedAt: now, runsSeconds };
  rows.unshift(row);
  return { status: 202, body: { crawlId: row.crawlId } };
};

/** 受けた行を /api/crawls の 1 行に (欄は crawlRow と同じ)。runsSeconds の間は走行中、その後は完走。 */
export const submittedRow = (row, now) => {
  const end = row.startedAt + row.runsSeconds * 1000;
  const done = now >= end;
  return {
    crawlId: row.crawlId,
    state: done ? "succeeded" : "running",
    stopReason: done ? "completed" : null,
    seeds: row.seeds,
    requestedBy: "sandbox",
    orgId: "acme",
    startedAt: new Date(row.startedAt).toISOString(),
    finishedAt: done ? new Date(end).toISOString() : null,
    pagesDiscovered: 0,
    pagesCaptured: done ? row.seeds.length : 0,
    error: null,
    waczCount: 0,
    lastJob: null,
  };
};

/** 署名の代わりの URL。置き場に在る名前だけ。見えない行と、知らない id は undefined。 */
export const signedUrlOf = (id, names) => {
  const name = names.find((n) => idOf(n) === id);
  return name === undefined
    ? undefined
    : { url: pathToFileURL(resolve(SAMPLES, name)).href, expiresIn: 300 };
};

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

/** 置き場の WACZ の名前。並びは名前順。 */
const samples = () =>
  readdirSync(SAMPLES)
    .filter((name) => name.endsWith(".wacz"))
    .sort();

/**
 * 読み直す関数を包み、**読めない間が短ければ、前に読めたもので答える**。
 *
 * host で rename して置き換えたファイル (`sed -i` や、多くの editor の保存) は、コンテナの中からは
 * 置き換えの直後のしばらく ENOENT に見える (container 1.5.0 で実測)。その場で書き直す editor
 * なら、空や途中の JSON が読める。どちらもすぐ終わるので、その間は前のもので答える。
 * 読めないのが graceMs より続いたら投げる —— 台本の書き損じは、画面の上の赤い文で言う。
 */
export const readingLastGood = (read, graceMs, now = Date.now) => {
  let last;
  let failingSince;
  return () => {
    try {
      last = read();
      failingSince = undefined;
      return last;
    } catch (err) {
      failingSince ??= now();
      if (last !== undefined && now() - failingSince < graceMs) return last;
      throw err;
    }
  };
};

/** 台本は要求のたびに読む。書き換えると、代役を起こし直さずに画面に出る。 */
const scenario = readingLastGood(() => JSON.parse(readFileSync(SCENARIO, "utf8")), 3000);

/** 画面の欄から受けた行。代役が起きている間だけ在る (台本には書かない)。 */
const submitted = [];

const handle = (req, res, raw) => {
  const { pathname } = new URL(req.url ?? "/", "http://sandbox");
  const s = scenario();
  if (req.method === "POST" && pathname === "/token") {
    send(res, 200, { access_token: "sandbox", token_type: "Bearer" });
    return;
  }
  if (req.method === "POST" && pathname === "/api/crawls") {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      send(res, 400, { error: "body is not valid JSON" });
      return;
    }
    const answer = submitCrawl(submitted, body, Date.now(), s.submit?.runsSeconds ?? 15);
    send(res, answer.status, answer.body);
    return;
  }
  if (req.method === "GET" && pathname === "/api/crawls") {
    const now = Date.now();
    send(res, 200, {
      crawls: [...submitted.map((row) => submittedRow(row, now)), ...s.crawls.map((c) => crawlRow(c, STARTED))],
    });
    return;
  }
  const one = /^\/api\/crawls\/([^/]+)$/.exec(pathname);
  if (req.method === "GET" && one !== null) {
    const mine = submitted.find((row) => row.crawlId === one[1]);
    const c = mine === undefined ? s.crawls.find((x) => x.crawlId === one[1]) : submittedRow(mine, Date.now());
    send(res, c === undefined ? 404 : 200, c === undefined ? { error: "not found" } : crawlDetail(c));
    return;
  }
  if (req.method === "GET" && pathname === "/api/archives") {
    send(res, 200, { archives: archiveRows(samples(), s) });
    return;
  }
  if (req.method === "GET" && pathname === "/api/scripts") {
    send(res, 200, { scripts: s.emptyCatalog === true ? [] : s.scripts });
    return;
  }
  const sign = /^\/api\/archives\/([^/]+)\/url$/.exec(pathname);
  if (req.method === "POST" && sign !== null) {
    const signed = signedUrlOf(sign[1], samples());
    send(res, signed === undefined ? 404 : 200, signed ?? { error: "not found" });
    return;
  }
  send(res, 404, { error: "not found" });
};

if (import.meta.main) {
  const port = Number(process.env.SANDBOX_PORT ?? "7070");
  // コンテナの中では外向きに待つ。host への口は compose が 127.0.0.1 にだけ出す
  const host = process.env.SANDBOX_HOST ?? "0.0.0.0";
  createServer((req, res) => {
    // 本文を読み切ってから答える (起こす口だけが使う。画面の欄が送る本文は小さい)
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      // 台本の書き損じで代役ごと落とさない。何が読めないかを、画面の上の赤い文で言う
      try {
        handle(req, res, Buffer.concat(chunks).toString("utf8"));
      } catch (err) {
        send(res, 500, { error: `sandbox: ${err instanceof Error ? err.message : String(err)}` });
      }
    });
  }).listen(port, host, () => {
    process.stdout.write(`sandbox-ledger http://${host}:${String(port)}/  WACZ: ${SAMPLES}\n`);
  });
}
