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
 *
 * 効いているのを見るには: ja のページを 1 枚 `.ja.md` に改名する → 赤。本文に `src/nope.mjs` → 赤。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
    /`((?:src|public|test|scripts|docs-site|\.github)\/[A-Za-z0-9_./-]+|\.env\.example|package\.json|\.nvmrc)`/g,
  )) {
    if (!existsSync(resolve(ROOT, path)))
      problems.push(`${rel}: \`${path}\` が無い (移した? 消した?)`);
  }
}

// ─── 報告 ─────────────────────────────────────────────────────────────────
if (problems.length > 0) {
  console.error(`✗ docs と repo がずれている (${problems.length} 件):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\ndocs が指す物が無い。docs を直すか、消した物を戻すこと。");
  process.exit(1);
}
console.log(`✓ docs と repo は揃っている (${en.length} ページ × 2 locale)`);
