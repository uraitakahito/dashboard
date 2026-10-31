/**
 * 台帳の代役。dashboard のサンドボックス (docker-compose.yml の sandbox-ledger) の中で動く。
 *
 * dashboard が台帳に訊く口と、開発用 issuer の `POST /token` に、台本 (scenario.json) と
 * WACZ の置き場から答える。応答の欄は capture-ledger の応答に合わせてある (出どころは
 * 各関数の注記)。認可は真似ない —— 名乗りは何でも通す。
 *
 * 署名付き URL の代わりに、置き場の `file://` の URL を返す。検証の daemon
 * (sandbox-validator) も同じ置き場を同じ path に mount しているので、それを読める。
 *
 * `POST /api/crawls` (dashboard の新しいクロールの画面) にも答える。受けた行は代役が起きている間だけ在り、
 * 台本の `submit.runsSeconds` 秒走ってから完走になる (台本の行とは別に持つ)。走らせるもの
 * (`scripts`。台帳のスクリプトの名指しとその場の JS) も台帳と同じ形で受け、1 本の詳しい所に返す。
 *
 * 台帳のスクリプト (台本の `catalog`) は版の並びで、source は sandbox/catalog の写しから読む。スクリプトを読む口
 * (版の一覧・1 版・受け皿の型) にも答える。札 (`sites`) のある版はサイト用のスクリプトで、台帳と同じく
 * 起点のホストで選び、合わない名指しは 400 で断る。
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

/** 台本が `file` で名指すファイル (sandbox/ からの相対)。 */
const readBeside = (file) => readFileSync(new URL(`./${file}`, SCENARIO), "utf8");
const sha256Of = (text) => createHash("sha256").update(text, "utf8").digest("hex");

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
 * /api/crawls/:id の、走らせたもの 1 本。欄は capture-ledger v0.61.0 の src/api/crawls.ts と同じ ——
 * 台帳のスクリプトは身元と札だけ、その場の物にだけ `inline` が付く。**source は載せない**（名前・口・バイト数）。
 */
const detailScript = (s) => ({
  id: s.id,
  version: s.version,
  phase: s.phase,
  sha256: s.sha256,
  // 札。その場の JS と、札の無い物は空
  sites: s.sites ?? [],
  jsSha256: s.jsSha256 ?? null,
  compiledWith: s.compiledWith ?? null,
  ...(s.inline !== undefined && {
    inline: {
      name: s.inline.name,
      phase: s.inline.phase,
      bytes: Buffer.byteLength(s.inline.source, "utf8"),
    },
  }),
});

/**
 * /api/crawls/:id/inline/:name。欄は capture-ledger v0.59.0 の src/api/crawls.ts と同じ ——
 * その場の JS 1 本の source を返す（dashboard の「欄に戻す」が使う）。台帳のスクリプトと、知らない名前は 404。
 */
export const inlineSource = (scripts, name) => {
  const script = (scripts ?? []).find((x) => x.inline?.name === name);
  if (script === undefined) return { status: 404, body: { error: "not found" } };
  const { phase, source } = script.inline;
  return { status: 200, body: { name, phase, source, sha256: script.sha256 } };
};

/**
 * /api/crawls/:id。台帳はほかの欄 (上限など) も返すが、dashboard が読むのは seeds・rules・
 * error・scripts・failures なので、そこまでにしてある。受けた行は走らせたものを行に持たない
 * (行の欄は一覧と揃えて試験が固定している) ので、`scripts` で渡す。規則は行に無ければ台帳の既定。
 */
export const crawlDetail = (c, scripts = c.scripts ?? [], rules = c.rules ?? DEFAULT_RULES) => ({
  crawlId: c.crawlId,
  seeds: c.seeds,
  rules,
  state: c.state,
  stopReason: c.stopReason ?? null,
  error: c.error ?? null,
  scripts: scripts.map(detailScript),
  failures: c.failures ?? [],
});

/**
 * /api/crawls/:id/decisions。欄は capture-ledger v0.62.0 の src/api/crawls.ts と同じ。台本の行は
 * `decisions` と `robots` を持てる (無ければ空)。受けた行は何も辿っていないので空。
 */
export const decisionsOf = (c, rules = c.rules ?? DEFAULT_RULES) => ({
  crawlId: c.crawlId,
  rules,
  decisions: c.decisions ?? [],
  robots: c.robots ?? [],
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
    sourceUrl: `https://sandbox.test/${name}`,
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

// ── 規則（台帳 v0.62.0 の src/crawl/rules.ts と scope.ts の写し）────────────
/** 規則を省いた頼みの並び (台帳と同じ)。 */
const DEFAULT_RULES = [{ follow: "same-origin" }];
const SCOPES = new Set(["same-origin", "same-host", "same-site", "any"]);
const ACTIONS = ["follow", "capture", "skip"];
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const RANK = { "same-origin": 0, "same-host": 1, "same-site": 2, any: 3 };

/**
 * サイト (登録ドメイン)。**代役は Public Suffix List を持たない** —— ホスト名の最後の 2 ラベルで近似する。
 * `example.co.jp` を `co.jp` と読み違えるのは代役だけ (台帳は tldts。docs の development に書いてある)。
 */
export const siteOf = (hostname) => hostname.split(".").slice(-2).join(".");

const parseUrl = (raw) => {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  url.hash = "";
  return { normalized: url.toString(), host: url.host, hostname: url.hostname, origin: url.origin };
};

const parsePattern = (raw) => {
  if (SCOPES.has(raw)) return { kind: "scope", scope: raw };
  if (HOSTNAME.test(raw)) return { kind: "domain", domain: raw };
  const url = parseUrl(raw);
  return url === undefined ? undefined : { kind: "prefix", url };
};

const under = (hostname, domain) => hostname === domain || hostname.endsWith(`.${domain}`);

const inScope = (url, seeds, scope) =>
  scope === "any" ||
  seeds.some((seed) =>
    scope === "same-site"
      ? siteOf(seed.hostname) === siteOf(url.hostname)
      : scope === "same-host"
        ? seed.host === url.host
        : seed.origin === url.origin,
  );

const matches = (url, pattern, seeds) =>
  pattern.kind === "scope"
    ? inScope(url, seeds, pattern.scope)
    : pattern.kind === "domain"
      ? under(url.hostname, pattern.domain)
      : url.normalized.startsWith(pattern.url.normalized);

/** 言い切れるときだけ覆いと言う (台帳と同じ組)。 */
const covers = (a, b, seeds) => {
  if (a.kind === "scope" && a.scope === "any") return true;
  if (b.kind === "scope") return a.kind === "scope" && RANK[a.scope] >= RANK[b.scope];
  if (b.kind === "domain") {
    if (a.kind === "domain") return under(b.domain, a.domain);
    return a.kind === "scope" && a.scope === "same-site" && seeds.some((seed) => siteOf(seed.hostname) === siteOf(b.domain));
  }
  if (a.kind === "prefix") return b.url.normalized.startsWith(a.url.normalized);
  return b.url.normalized.startsWith(`${b.url.origin}/`) && matches(b.url, a, seeds);
};

const patternText = (pattern) =>
  pattern.kind === "scope" ? pattern.scope : pattern.kind === "domain" ? pattern.domain : pattern.url.normalized;

/** 上から当て、最初に当たった規則の動き。どれにも当たらなければ落とす。 */
const decide = (url, read, seeds) => read.find((rule) => matches(url, rule.pattern, seeds))?.action ?? "skip";

/**
 * 規則の並びを確かめる (台帳の `checkRules`)。読めない行は覆いと起点の判定から外し、番号は頼まれたまま。
 */
export const checkRules = (rules, seeds) => {
  const read = rules.map((rule) => {
    const [action, raw] = Object.entries(rule)[0];
    const pattern = parsePattern(raw);
    return pattern === undefined ? undefined : { action, pattern };
  });
  const invalid = rules.flatMap((rule, i) =>
    read[i] === undefined ? [{ rule: i + 1, pattern: Object.values(rule)[0] }] : [],
  );
  const covered = read.flatMap((rule, j) => {
    if (rule === undefined) return [];
    const by = read.slice(0, j).findIndex((earlier) => earlier !== undefined && covers(earlier.pattern, rule.pattern, seeds));
    return by < 0 ? [] : [{ rule: j + 1, coveredBy: by + 1 }];
  });
  const usable = read.filter((rule) => rule !== undefined);
  const unfollowedSeeds = seeds.filter((seed) => decide(seed, usable, seeds) !== "follow").map((seed) => seed.normalized);
  return { read, invalid, covered, unfollowedSeeds };
};

/** `rules` の形を見る (台帳の schema)。断るなら文を返す。 */
const rulesRefusal = (rules) => {
  if (!Array.isArray(rules)) return "body/rules must be array";
  if (rules.length < 1) return "body/rules must NOT have fewer than 1 items";
  if (rules.length > 32) return "body/rules must NOT have more than 32 items";
  for (const [i, rule] of rules.entries()) {
    const at = `body/rules/${String(i)}`;
    const keys = rule !== null && typeof rule === "object" ? Object.keys(rule) : [];
    if (keys.some((key) => !ACTIONS.includes(key))) return `${at} must NOT have additional properties`;
    if (keys.length > 1) return `${at} must NOT have more than 1 properties`;
    if (keys.length === 0) return `${at} must NOT have fewer than 1 properties`;
    const value = rule[keys[0]];
    if (typeof value !== "string" || value === "") return `${at}/${keys[0]} must NOT have fewer than 1 characters`;
    if (value.length > 2048) return `${at}/${keys[0]} must NOT have more than 2048 characters`;
  }
  return undefined;
};

/**
 * 始める口の規則の 400 (台帳 v0.62.0 と同じ順と文)。通れば、読んだ形で固定する規則を返す。
 */
const resolveRules = (rules, seeds) => {
  // 形は submitCrawl が先に見ている (schema の 400 は handler より前)
  const checked = checkRules(rules ?? DEFAULT_RULES, seeds);
  if (checked.invalid.length > 0) {
    return { status: 400, body: { error: "invalid rule patterns", rules: checked.invalid } };
  }
  if (checked.covered.length > 0) {
    return { status: 400, body: { error: "rules that can never match", rules: checked.covered } };
  }
  if (checked.unfollowedSeeds.length > 0) {
    return { status: 400, body: { error: "seeds the rules do not follow", seeds: checked.unfollowedSeeds } };
  }
  return { rules: checked.read.map(({ action, pattern }) => ({ [action]: patternText(pattern) })) };
};

/**
 * 確かめの口 (`GET /api/crawl-rules/check`)。答えの形は台帳 v0.62.0 と同じ。規則は「動き:当てる物」で、
 * 動きの名前が違えば schema の 400。
 */
export const crawlRulesCheck = (seedTexts, ruleTexts) => {
  const bad = ruleTexts.find((text) => !/^(follow|capture|skip):/.test(text));
  if (bad !== undefined || ruleTexts.length > 32) {
    return schemaError('querystring/rule/0 must match pattern "^(follow|capture|skip):"');
  }
  const asked = ruleTexts.map((text) => {
    const at = text.indexOf(":");
    return { [text.slice(0, at)]: text.slice(at + 1) };
  });
  const parsed = seedTexts.map(parseUrl).filter((seed) => seed !== undefined);
  const checked = checkRules(asked, parsed);
  const coveredBy = new Map(checked.covered.map((c) => [c.rule, c.coveredBy]));
  const unfollowed = new Set(checked.unfollowedSeeds);
  const seeds = seedTexts.map((raw) => {
    const url = parseUrl(raw);
    return url === undefined
      ? { url: raw, valid: false }
      : { url: url.normalized, valid: true, site: siteOf(url.hostname), followed: !unfollowed.has(url.normalized) };
  });
  const rules = asked.map((rule, i) => {
    const [action, raw] = Object.entries(rule)[0];
    const read = checked.read[i];
    const by = coveredBy.get(i + 1);
    return {
      rule: i + 1,
      action,
      kind: read === undefined ? "invalid" : read.pattern.kind,
      pattern: read === undefined ? raw : patternText(read.pattern),
      ...(by === undefined ? {} : { coveredBy: by }),
    };
  });
  return {
    status: 200,
    body: {
      seeds,
      rules,
      ok: checked.invalid.length === 0 && checked.covered.length === 0 && seeds.every((seed) => seed.valid && seed.followed === true),
    },
  };
};

/** その場の JS の名前の綴り (台帳の schema と同じ。`inline-` と合わせて 64 字まで)。 */
const INLINE_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Fastify が schema の誤りで返す本文の形 (台帳の 400 と同じ。dashboard は `message` を出す)。
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
 * 走らせるものを、台帳 (capture-ledger v0.61.0) と同じ順で解く: 形 (schema) → 重ね → 台帳に無い id →
 * 起点に合わないサイト用のスクリプト。省けば既定の顔ぶれ (`defaultSet`) で、それが空なら 400。
 * その場の JS は `inline-<name>`・版 1 で、sha256 は source から打つ (台帳と同じ)。札は持たない。
 */
const resolveRun = (scripts, versions, hosts) => {
  if (scripts === undefined) {
    const chosen = defaultSet(versions, hosts);
    return chosen.length > 0 ? { scripts: chosen } : emptyDefault(versions);
  }
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
  // 名指しは有効かどうかを見ない（台帳 v0.64.0 の resolveScripts）—— 既定に入らないスクリプトも、名指せば最新版が走る
  const catalog = latestOf(versions);
  const missing = [
    ...new Set(
      scripts
        .filter((r) => "catalog" in r && !catalog.some((c) => c.id === r.catalog))
        .map((r) => r.catalog),
    ),
  ];
  if (missing.length > 0) {
    return { status: 400, body: { error: "unknown script ids", ids: missing } };
  }
  const run = scripts.map((r) =>
    "catalog" in r
      ? catalog.find((c) => c.id === r.catalog)
      : {
          id: `inline-${r.inline.name}`,
          version: 1,
          phase: r.inline.phase,
          sha256: sha256Of(r.inline.source),
          inline: r.inline,
        },
  );
  const offsite = run.filter((s) => !onSeed(s.sites ?? [], hosts));
  if (offsite.length > 0) {
    return {
      status: 400,
      body: {
        error: "site scripts need a seed on their site",
        ids: offsite.map((s) => s.id),
        hint: offsite.map((s) => `${s.id}: ${s.sites.join(", ")}`).join(" / "),
      },
    };
  }
  return { scripts: run };
};

/**
 * 既定を頼まれたのに、既定が空。文は台帳 v0.61.3 の src/api/crawls.ts と同じ —— スクリプトは在るのに
 * 全部が別のサイト用なら、「スクリプトが無い」とは言わない (取り込み直しても直らない)。
 */
const emptyDefault = (versions) => {
  const enabled = latestEnabled(versions);
  if (enabled.length > 0) {
    return {
      status: 400,
      body: {
        error: "no default scripts for these seeds",
        hint:
          enabled.map((s) => `${s.id}: ${s.sites.join(", ")}`).join(" / ") +
          " (run nothing on purpose: send scripts: [])",
      },
    };
  }
  return {
    status: 400,
    body: {
      error: "no scripts are registered",
      hint: "pnpm run scripts import .upstream/capture-scripts (run nothing on purpose: send scripts: [])",
    },
  };
};

/**
 * 台本のスクリプト（版の並び）に source を読み込む。source は sandbox/catalog の写し（capture-scripts のファイル）で、
 * sha256 と bytes は台帳と同じく source から数える（手で書いた sha256 は、本物の
 * 中身と結び付かない）。欄は capture-ledger v0.61.0 の 1 版の口（`GET /api/scripts/:id/versions/:version`）と同じ。
 */
export const catalogOf = (s, read = readBeside) =>
  (s.catalog ?? []).map((v) => {
    const source = read(v.file);
    return {
      id: v.id,
      version: v.version,
      phase: v.phase,
      sha256: sha256Of(source),
      sites: v.sites ?? [],
      enabled: v.enabled ?? true,
      bytes: Buffer.byteLength(source, "utf8"),
      createdAt: v.createdAt,
      source,
      options: v.options ?? {},
    };
  });

/** 各 id の最新版を id 順で。有効かどうかは見ない（台帳の resolveScripts の名指しの側）。 */
export const latestOf = (versions) =>
  [...new Set(versions.map((v) => v.id))]
    .sort()
    .map((id) => versions.filter((v) => v.id === id).reduce((a, b) => (b.version > a.version ? b : a)));

/** 有効な各 id の最新版を id 順で。サイト用のスクリプトも入る（台帳の enabledLatest。既定の顔ぶれの元）。 */
export const latestEnabled = (versions) => latestOf(versions.filter((v) => v.enabled));

/**
 * 一覧の口（`GET /api/scripts`）の顔ぶれ。各 id に 1 行で、既定で走る版（有効な版の中の最新）があればそれ、
 * 無ければ最新版を `enabled: false` で（台帳 v0.64.0 の pickable）。既定に入らないスクリプトも、名指せば
 * 走るので載せる。
 */
export const pickable = (versions) => {
  const enabled = latestEnabled(versions);
  return latestOf(versions).map((v) => enabled.find((e) => e.id === v.id) ?? v);
};

/** 札の無いスクリプトはいつでも、サイト用のスクリプトは札のどれかが起点のホストにあるとき（台帳の onSeed）。 */
const onSeed = (sites, hosts) => sites.length === 0 || sites.some((site) => hosts.has(site));

/**
 * 既定の顔ぶれ: 有効な各 id の最新版のうち、札の無い物と、起点に合うサイト用の物（id 順）。
 * **最新版を選んでから札で絞る** —— 台帳の resolveScripts と同じ順。逆にすると、札を付け直した id の
 * 札の無い古い版が出てくる。
 */
export const defaultSet = (versions, hosts) => latestEnabled(versions).filter((v) => onSeed(v.sites, hosts));

/** GET /api/scripts/:id/versions。新しい順、**source は返さない**。無い id は 404。 */
export const versionsOf = (versions, id) => {
  const mine = versions.filter((v) => v.id === id).sort((a, b) => b.version - a.version);
  if (mine.length === 0) return { status: 404, body: { error: "not found" } };
  return {
    status: 200,
    body: {
      id,
      versions: mine.map(({ version, phase, sha256, sites, enabled, bytes, createdAt }) => ({
        version,
        phase,
        sha256,
        sites,
        enabled,
        bytes,
        createdAt,
      })),
    },
  };
};

/**
 * GET /api/scripts/:id/versions/:version。版が 1 以上の整数でなければ 400（文は台帳 v0.60.0 の実物から
 * 写した）、無ければ 404。有効かどうかは見ない。
 */
export const versionOf = (versions, id, raw) => {
  if (!/^\d+$/.test(raw)) return schemaError("params/version must be integer");
  if (Number(raw) < 1) return schemaError("params/version must be >= 1");
  const one = versions.find((v) => v.id === id && v.version === Number(raw));
  return one === undefined ? { status: 404, body: { error: "not found" } } : { status: 200, body: one };
};

/** GET /api/host-types。台本の `hostTypes` の file を読む。台本に無ければ 404（取り込んでいない台帳）。 */
export const hostTypesOf = (s, read = readBeside) => {
  if (s.hostTypes === undefined) return { status: 404, body: { error: "not found" } };
  const source = read(s.hostTypes.file);
  return {
    status: 200,
    body: {
      version: s.hostTypes.version,
      sha256: sha256Of(source),
      createdAt: s.hostTypes.createdAt,
      source,
      bytes: Buffer.byteLength(source, "utf8"),
    },
  };
};

/**
 * `POST /api/crawls` を真似る。受けたら `rows` の先頭に足す (新しい順)。
 *
 * 答えの文と形は capture-ledger の src/api/crawls.ts から写した (v0.58.0。札の 400 と既定が空の 400 は
 * v0.61.0。試験が固定する)。
 * **走行中の 1 本は、受けた行だけで数える** —— 台本の走行中の行は飾りで、それで 409 に
 * すると何も始められない。409 を見たいなら、走っている間にもう 1 度始める。
 *
 * `versions` はスクリプトの版の並び (`catalogOf`)。起点のホスト (台帳と同じく `hostname`。ポートは見ない) で
 * 既定を選び、名指しを照らす。走らせたものは受けた行の `scripts` に持ち、一覧の行 (`submittedRow`) には
 * 出さない。
 */
export const submitCrawl = (rows, body, now, runsSeconds, versions) => {
  // 消した鍵 (scriptIds・scope) は、知らない鍵として 400
  if (body !== null && typeof body === "object" && ("scriptIds" in body || "scope" in body)) {
    return schemaError("body must NOT have additional properties");
  }
  if (body !== null && typeof body === "object" && "rules" in body) {
    const refused = rulesRefusal(body.rules);
    if (refused !== undefined) return schemaError(refused);
  }
  if (!Array.isArray(body?.seeds)) {
    return { status: 400, body: { error: "provide exactly one of seeds or fromTargets" } };
  }
  if (body.seeds.length === 0) return { status: 400, body: { error: "seeds must not be empty" } };
  if (!body.seeds.every(httpUrl)) {
    return { status: 400, body: { error: "every seed must be an http(s) URL" } };
  }
  // 規則の誤りは起点の次 (台帳と同じ順)。走らせるものの誤りも、走行中でも 400 が先 —— 台帳は解いてから
  // 行を立て、409 は行を立てる所で出る
  const ruled = resolveRules(body.rules, body.seeds.map(parseUrl));
  if (ruled.status !== undefined) return ruled;
  const hosts = new Set(body.seeds.map((seed) => new URL(seed).hostname));
  const run = resolveRun(body.scripts, versions, hosts);
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
    rules: ruled.rules,
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

/** dashboard の欄から受けた行。代役が起きている間だけ在る (台本には書かない)。 */
const submitted = [];

/** 台本のスクリプトの版の並び。`emptyCatalog` なら空 (スクリプトが無い台帳。読む所には受け皿の型だけが残る)。 */
const versionsIn = (s) => (s.emptyCatalog === true ? [] : catalogOf(s));

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
    const answer = submitCrawl(submitted, body, Date.now(), s.submit?.runsSeconds ?? 15, versionsIn(s));
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
  // その場の JS 1 本（「欄に戻す」の口）。受けた行と台本の行のどちらからでも引く
  const back = /^\/api\/crawls\/([^/]+)\/inline\/([^/]+)$/.exec(pathname);
  if (req.method === "GET" && back !== null) {
    const mine = submitted.find((row) => row.crawlId === back[1]);
    const scripts = mine?.scripts ?? s.crawls.find((x) => x.crawlId === back[1])?.scripts;
    const answer = inlineSource(scripts, decodeURIComponent(back[2]));
    send(res, answer.status, answer.body);
    return;
  }
  // 規則が何を決めたか (台帳 v0.62.0)。受けた行は何も辿っていないので空
  const decided = /^\/api\/crawls\/([^/]+)\/decisions$/.exec(pathname);
  if (req.method === "GET" && decided !== null) {
    const mine = submitted.find((row) => row.crawlId === decided[1]);
    const c = mine ?? s.crawls.find((x) => x.crawlId === decided[1]);
    send(res, c === undefined ? 404 : 200, c === undefined ? { error: "not found" } : decisionsOf(mine === undefined ? c : { crawlId: mine.crawlId }, c.rules));
    return;
  }
  if (req.method === "GET" && pathname === "/api/crawl-rules/check") {
    const query = new URL(req.url ?? "/", "http://sandbox").searchParams;
    const answer = crawlRulesCheck(query.getAll("seed"), query.getAll("rule"));
    send(res, answer.status, answer.body);
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
        : crawlDetail(submittedRow(mine, Date.now()), mine.scripts, mine.rules);
    send(res, detail === undefined ? 404 : 200, detail ?? { error: "not found" });
    return;
  }
  if (req.method === "GET" && pathname === "/api/archives") {
    send(res, 200, { archives: archiveRows(samples(), s) });
    return;
  }
  if (req.method === "GET" && pathname === "/api/scripts") {
    // 各 id に 1 行、札と enabled つきで（台帳 v0.64.0。既定で走るのは、enabled の物のうち札の無い物と起点に合う物）
    const scripts = pickable(versionsIn(s)).map(({ id, version, phase, sha256, sites, enabled }) => ({
      id,
      version,
      phase,
      sha256,
      sites,
      enabled,
    }));
    send(res, 200, { scripts });
    return;
  }
  // スクリプトを読む口（台帳 v0.60.0）。id は % を解いてから引く
  const versions = /^\/api\/scripts\/([^/]+)\/versions(?:\/([^/]+))?$/.exec(pathname);
  if (req.method === "GET" && versions !== null) {
    const id = decodeURIComponent(versions[1]);
    const answer =
      versions[2] === undefined
        ? versionsOf(versionsIn(s), id)
        : versionOf(versionsIn(s), id, versions[2]);
    send(res, answer.status, answer.body);
    return;
  }
  if (req.method === "GET" && pathname === "/api/host-types") {
    const answer = hostTypesOf(s);
    send(res, answer.status, answer.body);
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
    // 本文を読み切ってから答える (始める口だけが使う。dashboard の欄が送る本文は小さい)
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
