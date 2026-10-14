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
 * 台本の `submit.runsSeconds` 秒走ってから完走になる (台本の行とは別に持つ)。走らせるもの
 * (`scripts`。目録の名指しとその場の JS) も台帳と同じ形で受け、1 本の詳しい所に返す。
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
 * /api/crawls/:id の、走らせたもの 1 本。欄は capture-ledger v0.58.0 の src/api/crawls.ts と同じ ——
 * 目録の物は身元だけ、その場の物にだけ頼まれた要素 (`inline`) が付く。
 */
const detailScript = (s) => ({
  id: s.id,
  version: s.version,
  phase: s.phase,
  sha256: s.sha256,
  jsSha256: s.jsSha256 ?? null,
  compiledWith: s.compiledWith ?? null,
  ...(s.inline !== undefined && { inline: s.inline }),
});

/**
 * /api/crawls/:id。台帳はほかの欄 (範囲・上限など) も返すが、画面が読むのは seeds・
 * error・scripts・failures なので、そこまでにしてある。受けた行は走らせたものを行に持たない
 * (行の欄は一覧と揃えて試験が固定している) ので、`scripts` で渡す。
 */
export const crawlDetail = (c, scripts = c.scripts ?? []) => ({
  crawlId: c.crawlId,
  seeds: c.seeds,
  state: c.state,
  stopReason: c.stopReason ?? null,
  error: c.error ?? null,
  scripts: scripts.map(detailScript),
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

/** その場の JS の名前の綴り (台帳の schema と同じ。`inline-` と合わせて 64 字まで)。 */
const INLINE_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Fastify が schema の誤りで返す本文の形 (台帳の 400 と同じ。画面は `message` を出す)。
 * 文は台帳 v0.58.0 の実物から写した —— 要素は鍵が 1 つの object なので、誤りの場所だけが出る。
 */
const schemaError = (message) => ({
  status: 400,
  body: { statusCode: 400, code: "FST_ERR_VALIDATION", error: "Bad Request", message },
});

/** `scripts` の 1 要素の形を見る。断るなら文を返す。 */
const elementRefusal = (element, i) => {
  const at = `body/scripts/${String(i)}`;
  const keys = element !== null && typeof element === "object" ? Object.keys(element) : [];
  if (keys.some((key) => key !== "catalog" && key !== "inline")) {
    return `${at} must NOT have additional properties`;
  }
  if (keys.length > 1) return `${at} must NOT have more than 1 properties`;
  if (keys.length === 0) return `${at} must NOT have fewer than 1 properties`;
  if ("catalog" in element) {
    return typeof element.catalog === "string" && element.catalog !== ""
      ? undefined
      : `${at}/catalog must NOT have fewer than 1 characters`;
  }
  const { name, phase, source } = element.inline ?? {};
  if (typeof name !== "string" || !INLINE_NAME.test(name) || name.length > 57) {
    return `${at}/inline/name must match pattern "^[a-z][a-z0-9-]*$"`;
  }
  if (phase !== "behavior" && phase !== "preload") {
    return `${at}/inline/phase must be equal to one of the allowed values`;
  }
  if (typeof source !== "string" || source === "") {
    return `${at}/inline/source must NOT have fewer than 1 characters`;
  }
  return undefined;
};

/**
 * 走らせるものを、台帳と同じ順で解く: 形 (schema) → 重ね → 目録に無い id。省けば目録の既定。
 * その場の JS は `inline-<name>`・版 1 で、sha256 は source から打つ (台帳と同じ)。
 */
const resolveRun = (scripts, catalog) => {
  if (scripts === undefined) return { scripts: catalog };
  if (!Array.isArray(scripts)) return schemaError("body/scripts must be array");
  for (const [i, element] of scripts.entries()) {
    const refused = elementRefusal(element, i);
    if (refused !== undefined) return schemaError(refused);
  }
  const ids = scripts.map((r) => ("catalog" in r ? r.catalog : `inline-${r.inline.name}`));
  const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (twice.length > 0) {
    return { status: 400, body: { error: "duplicate script ids", ids: twice } };
  }
  const missing = [
    ...new Set(
      scripts
        .filter((r) => "catalog" in r && !catalog.some((c) => c.id === r.catalog))
        .map((r) => r.catalog),
    ),
  ];
  if (missing.length > 0) {
    return { status: 400, body: { error: "unknown catalog scripts", ids: missing } };
  }
  return {
    scripts: scripts.map((r) =>
      "catalog" in r
        ? catalog.find((c) => c.id === r.catalog)
        : {
            id: `inline-${r.inline.name}`,
            version: 1,
            phase: r.inline.phase,
            sha256: createHash("sha256").update(r.inline.source, "utf8").digest("hex"),
            inline: r.inline,
          },
    ),
  };
};

/**
 * `POST /api/crawls` を真似る。受けたら `rows` の先頭に足す (新しい順)。
 *
 * 答えの文と形は capture-ledger v0.58.0 の src/api/crawls.ts から写した (試験が固定する)。
 * **走行中の 1 本は、受けた行だけで数える** —— 台本の走行中の行は飾りで、それで 409 に
 * すると何も起こせない。409 を見たいなら、走っている間にもう 1 度起こす。
 *
 * `catalog` は台本の目録 (既定の集合)。走らせたものは受けた行の `scripts` に持ち、
 * 一覧の行 (`submittedRow`) には出さない。
 */
export const submitCrawl = (rows, body, now, runsSeconds, catalog = []) => {
  if (body !== null && typeof body === "object" && "scriptIds" in body) {
    return schemaError("body must NOT have additional properties");
  }
  if (!Array.isArray(body?.seeds)) {
    return { status: 400, body: { error: "provide exactly one of seeds or fromTargets" } };
  }
  if (body.seeds.length === 0) return { status: 400, body: { error: "seeds must not be empty" } };
  if (!body.seeds.every(httpUrl)) {
    return { status: 400, body: { error: "every seed must be an http(s) URL" } };
  }
  // 走らせるものの誤りは、走行中でも 400 が先 —— 台帳は解いてから行を立て、409 は行を立てる所で出る
  const run = resolveRun(body.scripts, catalog);
  if (run.status !== undefined) return run;
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
  const row = {
    crawlId: randomUUID(),
    seeds: body.seeds,
    startedAt: now,
    runsSeconds,
    scripts: run.scripts,
  };
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
    const catalog = s.emptyCatalog === true ? [] : s.scripts;
    const answer = submitCrawl(submitted, body, Date.now(), s.submit?.runsSeconds ?? 15, catalog);
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
    const detail =
      mine === undefined
        ? (() => {
            const c = s.crawls.find((x) => x.crawlId === one[1]);
            return c === undefined ? undefined : crawlDetail(c);
          })()
        : crawlDetail(submittedRow(mine, Date.now()), mine.scripts);
    send(res, detail === undefined ? 404 : 200, detail ?? { error: "not found" });
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
