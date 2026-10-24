/**
 * docs-site と repo の中身がずれていないかを見る。`npm run site:check` (build ＋ これ) で走る。
 *
 * `astro build` は守りにならない —— .md のページは Starlight の docs loader が描画の例外を握り潰して
 * exit 0 で終わる (crawler の他の repo で実測)。だから機械の守りはここに置く。見るのは:
 *
 *   1. en と ja の対: docs/*.md と docs/ja/*.md が同じ file 名で揃っている (見出しの構造は見ない ——
 *      同じ見出しを強制すると日本語が悪くなる)
 *   2. 本文の [x](/page/) が、同じ locale に在るページを指す
 *   3. 本文が code span で名指しする repo の path (`src/…` `public/…` `scripts/…` …) が実在する
 *   4. routes.md の「中継の口」の表が src/wacz.mjs の `OPS` と一致する (**両方向**: 表に無い口も、
 *      OPS に無い行も赤)
 *   5. configuration.md の環境変数の表・src/server.mjs の `optional()`・.env.example の 3 者で、
 *      名前の集合と既定値が一致する
 *   6. README の Documentation の 2 本の URL が、docs-site/astro.config.ts の `site` ＋ `BASE` から
 *      組んだものと一致する (base を変えた日に、README だけが 404 を指し続けないように)
 *   7. 「画面」の絵 (`docs-site/src/assets/screens/`) が shots.json の一覧と揃い、ja・en の screens.md が
 *      全部を載せている。どれも lossless の WebP で、予算 (1 枚 40 KB・全部で 150 KB) の中。画面
 *      (`public/`・`sandbox/`・撮る道具) が、撮ったときから変わっていない
 *
 * 4 と 5 が要るのは、表が手で写した物だから。口や変数を足しても、表は誰かが直すまで古いまま ——
 * README に表があった頃、画面が読まなくなった口が書かれたまま残っていた。それをこの検査が PR で止める。
 *
 * 効いているのを見るには: ja のページを 1 枚 `.ja.md` に改名する → 赤。本文に `src/nope.mjs` → 赤。
 * routes.md から 1 行消す → 赤。.env.example の既定値を 1 つ変える → 赤。README の URL を綴り違える → 赤。
 * public/app.css に 1 行足す → 撮り直すまで赤。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SHOT_SOURCES, shotsSource } from "./shots-source.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOCS = resolve(ROOT, "docs-site/src/content/docs");
const problems = [];

const pages = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
const en = pages(DOCS);
const ja = pages(join(DOCS, "ja"));

// ─── 1. en と ja の対 ─────────────────────────────────────────────────────
for (const f of en) if (!ja.includes(f)) problems.push(`docs/ja/${f} が無い (en には在る)`);
for (const f of ja) if (!en.includes(f)) problems.push(`docs/${f} が無い (ja には在る)`);

for (const [locale, f] of [...en.map((f) => ["", f]), ...ja.map((f) => ["ja/", f])]) {
  const rel = `docs/${locale}${f}`;
  const text = readFileSync(join(DOCS, locale, f), "utf8");

  // ─── 2. 内部リンク → 同じ locale のページ ────────────────────────────────
  // code (fence と span) の中はリンクではない。`[link](/page/)` と書いた説明文を実リンクと読まないように
  const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const [, slug] of prose.matchAll(/\]\(\/([a-z0-9-]+)\/(?:#[^)]*)?\)/g)) {
    if (!existsSync(join(DOCS, locale, `${slug}.md`))) {
      problems.push(`${rel}: リンク /${slug}/ の先のページが無い`);
    }
  }

  // ─── 3. 名指した path の実在 ─────────────────────────────────────────
  // root の file は名前で見る。素の `package.json` は root のもの (docs-site のものは `docs-site/package.json`)
  for (const [, path] of text.matchAll(
    /`((?:src|public|test|scripts|sandbox|docs-site|highlighter|\.github)\/[A-Za-z0-9_./-]+|\.env\.example|package\.json|\.nvmrc|docker-compose\.yml)`/g,
  )) {
    if (!existsSync(resolve(ROOT, path)))
      problems.push(`${rel}: \`${path}\` が無い (移した? 消した?)`);
  }
}

// 表を持つページを locale ごとに読む。無ければ 1 で既に赤なので、ここでは名指しだけする
const tablePage = (name) =>
  ["", "ja/"].flatMap((locale) => {
    const rel = `docs/${locale}${name}`;
    const file = join(DOCS, locale, name);
    if (existsSync(file)) return [{ rel, text: readFileSync(file, "utf8") }];
    problems.push(`${rel} が無い (表の検査ができない)`);
    return [];
  });

// ─── 4. 中継の口の表 ⇔ src/wacz.mjs の OPS ─────────────────────────────────
// wacz.mjs は副作用が無いので import してよい。行の形は | `GET /wacz/:id/lines?path=…` | …
const { OPS } = await import("../src/wacz.mjs");
for (const { rel, text } of tablePage("routes.md")) {
  const documented = new Set(
    [...text.matchAll(/^\|\s*`(?:GET|POST) \/wacz\/:id\/([a-z/]+)[`?]/gm)].map((m) => m[1]),
  );
  for (const op of OPS) {
    if (!documented.has(op)) problems.push(`${rel}: 口 ${op} の行が無い (src/wacz.mjs の OPS には在る)`);
  }
  for (const op of documented) {
    if (!OPS.includes(op)) problems.push(`${rel}: src/wacz.mjs の OPS に無い口 ${op} が表に在る`);
  }
}

// ─── 5. 環境変数の表 ⇔ src/server.mjs ⇔ .env.example ──────────────────────
// server.mjs は import しない (読み込んだ時点で待ち受けが始まる)。名前と既定値を文字から読む。
// 既定値は「文字列の literal で書いてある物」だけを比べる (DASHBOARD_SUBJECT は OS のユーザー名)
const sides = [
  {
    rel: "src/server.mjs",
    vars: new Map(
      [
        ...readFileSync(resolve(ROOT, "src/server.mjs"), "utf8").matchAll(
          /optional\("(DASHBOARD_[A-Z_]+)",\s*(?:"([^"]*)")?/g,
        ),
      ].map((m) => [m[1], m[2]]),
    ),
  },
  {
    rel: ".env.example",
    vars: new Map(
      [
        ...readFileSync(resolve(ROOT, ".env.example"), "utf8").matchAll(
          /^#?(DASHBOARD_[A-Z_]+)=(.*)$/gm,
        ),
      ].map((m) => [m[1], m[2]]),
    ),
  },
  ...tablePage("configuration.md").map(({ rel, text }) => ({
    rel,
    // 行の形は | `DASHBOARD_PORT` | `7080` | …。既定値の cell が code でなければ (ユーザー名など) 比べない
    vars: new Map(
      [...text.matchAll(/^\|\s*`(DASHBOARD_[A-Z_]+)`\s*\|\s*([^|]*?)\s*\|/gm)].map((m) => [
        m[1],
        /^`[^`]*`$/.test(m[2]) ? m[2].slice(1, -1) : undefined,
      ]),
    ),
  })),
];
const [code] = sides;
const names = new Set(sides.flatMap((side) => [...side.vars.keys()]));
for (const name of names) {
  for (const side of sides) {
    if (!side.vars.has(name)) problems.push(`${side.rel}: ${name} が無い (他の側には在る)`);
  }
  const fallback = code.vars.get(name);
  if (fallback === undefined) continue;
  for (const side of sides.slice(1)) {
    const value = side.vars.get(name);
    if (side.vars.has(name) && value !== fallback) {
      problems.push(`${side.rel}: ${name} の既定値が ${JSON.stringify(value ?? "(code でない)")} —— src/server.mjs は ${JSON.stringify(fallback)}`);
    }
  }
}

// ─── 6. README の URL ⇔ astro.config.ts の site ＋ BASE ─────────────────────
const config = readFileSync(resolve(ROOT, "docs-site/astro.config.ts"), "utf8");
const site = /^\s*site:\s*"([^"]+)"/m.exec(config)?.[1];
const base = /^const BASE = "([^"]+)";/m.exec(config)?.[1];
if (site === undefined || base === undefined) {
  problems.push("docs-site/astro.config.ts: site か BASE が読めない (書き方を変えたなら、ここも直す)");
} else {
  const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
  for (const url of [`${site}${base}/`, `${site}${base}/ja/`]) {
    if (!readme.includes(`<${url}>`)) {
      problems.push(`README.md: <${url}> へのリンクが無い (astro.config.ts の site と BASE から組んだ URL)`);
    }
  }
}

// ─── 7. 「画面」の絵 ⇔ shots.json ⇔ いまの画面 ───────────────────────────────
// 絵は npm run docs:shots (docs-site/scripts/docs-shots.mjs) の生成物。CI では撮らない (代役のコンテナが
// 要る) ので、撮った物のほうを見る。予算があるのは、撮り直すたびに git に積もるから。古さの物差しは撮る
// 道具と同じ関数 (scripts/shots-source.mjs)。この赤は撮り直して消す —— shots.json の source を手で写すと、
// 絵が古いまま緑になる
const SHOTS_REL = "docs-site/src/assets/screens";
const SHOTS = resolve(ROOT, SHOTS_REL);
const BUDGET = { one: 40 * 1024, all: 150 * 1024 };
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const manifest = JSON.parse(readFileSync(join(SHOTS, "shots.json"), "utf8"));
const isShot = (name) => Object.hasOwn(manifest.shots, name);

// 置き場に在るのは shots.json と、そこに名の在る WebP だけ (撮らない絵・手で撮った絵を残さない)
for (const f of readdirSync(SHOTS)) {
  if (f !== "shots.json" && !(f.endsWith(".webp") && isShot(basename(f, ".webp"))))
    problems.push(`${SHOTS_REL}/${f}: shots.json に無い (撮る道具の生成物でない)`);
}
let shotBytes = 0;
for (const name of Object.keys(manifest.shots)) {
  const rel = `${SHOTS_REL}/${name}.webp`;
  if (!existsSync(join(SHOTS, `${name}.webp`))) {
    problems.push(`${rel} が無い (shots.json には在る)`);
    continue;
  }
  const webp = readFileSync(join(SHOTS, `${name}.webp`));
  shotBytes += webp.length;
  // lossless の WebP は RIFF・大きさ・WEBPVP8L で始まる (非可逆は VP8 、拡張の形は VP8X)
  if (webp.toString("latin1", 0, 4) !== "RIFF" || webp.toString("latin1", 8, 16) !== "WEBPVP8L")
    problems.push(`${rel}: lossless の WebP でない (VP8L で始まらない)`);
  if (webp.length > BUDGET.one)
    problems.push(`${rel}: ${kb(webp.length)} —— 1 枚 ${kb(BUDGET.one)} まで`);
}
if (shotBytes > BUDGET.all)
  problems.push(`${SHOTS_REL}: 絵が全部で ${kb(shotBytes)} —— ${kb(BUDGET.all)} まで`);
if (shotsSource(ROOT) !== manifest.source) {
  problems.push(
    `${SHOTS_REL}/shots.json: 画面 (${SHOT_SOURCES.join("・")}) が、絵を撮ったときと違う。npm run docs:shots で撮り直す`,
  );
}

// screens.md は ja・en とも、全部の絵を載せる。載せた絵の path の誤りは build が落とす (ImageNotFound。
// .md でも握り潰されない —— 段を 1 つ数え違えて確かめた)
for (const locale of ["", "ja/"]) {
  const file = join(DOCS, locale, "screens.md");
  if (!existsSync(file)) continue; // 1 で既に赤
  const shown = new Set(
    [...readFileSync(file, "utf8").matchAll(/assets\/screens\/([^/)\s]+)\.webp\)/g)].map((m) => m[1]),
  );
  for (const name of Object.keys(manifest.shots)) {
    if (!shown.has(name)) problems.push(`docs/${locale}screens.md: 絵 ${name} を載せていない`);
  }
}

// ─── 報告 ─────────────────────────────────────────────────────────────────
if (problems.length > 0) {
  console.error(`✗ docs と repo がずれている (${problems.length} 件):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\ndocs が指す物が無いか、表がコードと違う。docs を直すか、消した物を戻すこと。");
  process.exit(1);
}
console.log(
  `✓ docs と repo は揃っている (${en.length} ページ × 2 locale、口 ${OPS.length}、環境変数 ${names.size}、絵 ${Object.keys(manifest.shots).length} 枚で ${kb(shotBytes)})`,
);
