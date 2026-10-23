/**
 * 語の取り違えを見張る。`npm run check` の中で走る。規則は下の RULES の 3 つ。
 *
 * ## なぜ要るのか
 *
 * - **「名乗り」を、物（トークン）の意味で書かない。** 「名乗り」は誰として見るか
 *   （`DASHBOARD_SUBJECT` と組織）を指す。issuer がそれに署名して返す物はアクセストークン
 *   （応答の欄は `access_token`）。2026-10 に、2 つを混ぜた書き方を docs・コメント・設定から除いた
 * - **クロールの seed は「起点」と書く。** crawler では 2026-10 に「種」から「起点」へ揃えた
 *   （capture-ledger と capture-scheduler が同じ規則で見張っている）。画面の見出しに
 *   「種」が残っていたのを、新しいクロールの面（「起点の URL」）を足したときに直した
 * - **クロールは「始める」と書く。** 2026-10 に「起こす」から「始める」へ揃えた（タブは「新しいクロール」、
 *   ボタンは「始める」）。目的語の無い「起こす」は「目を覚まさせる」に読め、タブで 1 つだけ動詞だった。
 *   画面（`public/`）は「起こ」そのものを書かない —— worker は「起動」、hashchange は「発火」と書く。
 *   ほかのファイルでは、クロールを始める意味の形だけを見る。プロセスの「起こす」（`dev:up` が画面を
 *   起こす、など）は別の意味で、見ない（capture-ledger と capture-scheduler も同じ形で見張っている）
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
 *   - sandbox/catalog/。capture-scripts の目録の写しで、別の repo の言葉（autofetch.ts の「変種」は
 *     seed ではない）。直すと行番号が実物とずれる（読む所の行と下敷きの行を、代役で実物どおりに見るため）
 *   - 「名乗り」を誰として見るかの意味で使っているか、「起点」を seed の意味で使っているか、
 *     「起こす」がクロールの意味か。語の意味は機械には見えないので、3 つ目は形の並びで見る
 *     （並びに無い言い回しは止まらない）
 *
 * 形は capture-ledger の scripts/check-terms.mjs に揃えてある。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SELF = "scripts/check-terms.mjs";
/** 別の repo の言葉の写し（上の「見ないもの」）。 */
const COPIED = "sandbox/catalog/";

/** 名乗り（誰として）とトークン（物）を混ぜた形。足すときは、正しい使い方に当たらないことを確かめる。 */
const MIXED = /名乗りのトークン|名乗りを取|名乗るトークン|identity token/iu;
/** 「種」を seed の意味に取れない形。capture-ledger と同じ（種類・種別・数の後の「種」）。 */
const NOT_SEED = /種類|種別|\d\s?種/gu;
/** 画面のファイル。ここには「起こ」を 1 つも書かない（同梱の vendor は別の repo の言葉）。 */
const SCREEN = "public/";
const VENDOR = "public/vendor/";
/**
 * クロールを始める意味の「起こす」の形。capture-ledger・capture-scheduler と同じ並び。
 * 足すときは、プロセスの「起こす」（dev:up が起こす・起こし直す・webhook で起こす）に当たらないことを確かめる。
 */
const OKOSU =
  /クロールを起こ|クロールは起こ|取り込みを起こ|取り込みの実行を起こ|起こしたクロール|起こせ(ます|ません|る|ない|れば|ば|て)|起こす(面|欄|口)|起こした(人|本人|行)|起こしました|起こしてよ|下敷きにして起こ|「起こす」|"起こす"/u;

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
  {
    find: (line, file) =>
      file.startsWith(SCREEN) && !file.startsWith(VENDOR) ? line.includes("起こ") : OKOSU.test(line),
    say:
      "「起こす」が残っています。クロールは「始める」と書きます（タブは「新しいクロール」）。" +
      "画面（public/）では、プロセスの意味でも「起動」と書きます。",
  },
];

const files = execFileSync("git", ["-C", ROOT, "ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(
    (f) => f !== "" && f !== SELF && !f.endsWith("package-lock.json") && !f.startsWith(COPIED),
  );

const hits = RULES.map(() => []);
for (const file of files) {
  const text = readFileSync(join(ROOT, file), "utf8");
  if (text.includes("\0")) continue; // WACZ の標本などの binary
  text.split("\n").forEach((line, i) => {
    RULES.forEach((rule, r) => {
      if (rule.find(line, file)) hits[r].push(`${file}:${String(i + 1)}: ${line.trim()}`);
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
