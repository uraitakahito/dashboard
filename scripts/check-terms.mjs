/**
 * 「名乗り」を、物（トークン）の意味で書いていないかを見張る。`npm run check` の中で走る。
 *
 * ## なぜ要るのか
 *
 * 「名乗り」は誰として見るか（`DASHBOARD_SUBJECT` と組織）を指す。issuer がそれに署名して
 * 返す物はアクセストークン（応答の欄は `access_token`）。2026-10 に、2 つを混ぜた書き方を
 * docs・コメント・設定から除いた。書き手（人と Claude）は長くこの形で書いてきたので、
 * 見張らなければ戻ってくる。
 *
 * ## 何を見るか
 *
 * git が追跡する text のファイルの全行で、下の MIXED の形（英語は大小を問わない）。
 * docs に限らない —— 語は、書かれる場所を選ばずに広がる。
 *
 * ## 見ないもの
 *
 *   - lockfile。この repo の言葉ではない
 *   - この file 自身。説明と、探す字そのものを書くため
 *   - 「名乗り」を誰として見るかの意味で使っているか。語の意味は機械には見えない
 *
 * 形は capture-ledger の scripts/check-terms.mjs（クロールの seed を「起点」と書く見張り）に揃えてある。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SELF = "scripts/check-terms.mjs";
/** 名乗り（誰として）とトークン（物）を混ぜた形。足すときは、正しい使い方に当たらないことを確かめる。 */
const MIXED = /名乗りのトークン|名乗りを取|名乗るトークン|identity token/iu;

const files = execFileSync("git", ["-C", ROOT, "ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((f) => f !== "" && f !== SELF && !f.endsWith("package-lock.json"));

const hits = [];
for (const file of files) {
  const text = readFileSync(join(ROOT, file), "utf8");
  if (text.includes("\0")) continue; // WACZ の標本などの binary
  text.split("\n").forEach((line, i) => {
    if (MIXED.test(line)) hits.push(`${file}:${String(i + 1)}: ${line.trim()}`);
  });
}

if (hits.length > 0) {
  console.error(
    "「名乗り」を物の意味で書いています。issuer が返す物はアクセストークン（英語版は access token）と書き、" +
      "「名乗り」は誰として見るかにだけ使います。",
  );
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
console.log(`check:terms: ${String(files.length)} ファイルを見て、0 件`);
