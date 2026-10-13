/**
 * 語の取り違えを見張る。`npm run check` の中で走る。規則は下の RULES の 2 つ。
 *
 * ## なぜ要るのか
 *
 * - **「名乗り」を、物（トークン）の意味で書かない。** 「名乗り」は誰として見るか
 *   （`DASHBOARD_SUBJECT` と組織）を指す。issuer がそれに署名して返す物はアクセストークン
 *   （応答の欄は `access_token`）。2026-10 に、2 つを混ぜた書き方を docs・コメント・設定から除いた
 * - **クロールの seed は「起点」と書く。** crawler では 2026-10 に「種」から「起点」へ揃えた
 *   （capture-ledger と capture-scheduler が同じ規則で見張っている）。画面の見出しに
 *   「種」が残っていたのを、起こす欄（「起点の URL」）を足したときに直した
 *
 * 書き手（人と Claude）は長くこの形で書いてきたので、見張らなければ戻ってくる。
 *
 * ## 何を見るか
 *
 * git が追跡する text のファイルの全行。docs に限らない —— 語は、書かれる場所を選ばずに広がる。
 *
 * ## 見ないもの
 *
 *   - lockfile。この repo の言葉ではない
 *   - この file 自身。説明と、探す字そのものを書くため
 *   - 「名乗り」を誰として見るかの意味で使っているか、「起点」を seed の意味で使っているか。
 *     語の意味は機械には見えない
 *
 * 形は capture-ledger の scripts/check-terms.mjs に揃えてある。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SELF = "scripts/check-terms.mjs";

/** 名乗り（誰として）とトークン（物）を混ぜた形。足すときは、正しい使い方に当たらないことを確かめる。 */
const MIXED = /名乗りのトークン|名乗りを取|名乗るトークン|identity token/iu;
/** 「種」を seed の意味に取れない形。capture-ledger と同じ（種類・種別・数の後の「種」）。 */
const NOT_SEED = /種類|種別|\d\s?種/gu;

const RULES = [
  {
    find: (line) => MIXED.test(line),
    say:
      "「名乗り」を物の意味で書いています。issuer が返す物はアクセストークン（英語版は access token）と書き、" +
      "「名乗り」は誰として見るかにだけ使います。",
  },
  {
    find: (line) => line.replace(NOT_SEED, "").includes("種"),
    say: "「種」が残っています。クロールの seed は「起点」と書きます（本で数えるなら「起点の URL が N 本」）。",
  },
];

const files = execFileSync("git", ["-C", ROOT, "ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((f) => f !== "" && f !== SELF && !f.endsWith("package-lock.json"));

const hits = RULES.map(() => []);
for (const file of files) {
  const text = readFileSync(join(ROOT, file), "utf8");
  if (text.includes("\0")) continue; // WACZ の標本などの binary
  text.split("\n").forEach((line, i) => {
    RULES.forEach((rule, r) => {
      if (rule.find(line)) hits[r].push(`${file}:${String(i + 1)}: ${line.trim()}`);
    });
  });
}

const failing = RULES.filter((_, r) => hits[r].length > 0);
for (const [r, rule] of RULES.entries()) {
  if (hits[r].length === 0) continue;
  console.error(rule.say);
  for (const hit of hits[r]) console.error(`  ${hit}`);
}
if (failing.length > 0) process.exit(1);
console.log(`check:terms: ${String(files.length)} ファイルを見て、0 件`);
