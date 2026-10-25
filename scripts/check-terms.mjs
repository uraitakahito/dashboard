/**
 * 語の取り違えを見張る。`npm run check` の中で走る。規則は下の RULES の 5 つ。
 *
 * ## なぜ要るのか
 *
 * - **「名乗り」を、物（トークン）の意味で書かない。** 「名乗り」は誰として見るか
 *   （`DASHBOARD_SUBJECT` と組織）を指す。issuer がそれに署名して返す物はアクセストークン
 *   （応答の欄は `access_token`）。2026-10 に、2 つを混ぜた書き方を docs・コメント・設定から除いた
 * - **クロールの seed は「起点」と書く。** crawler では 2026-10 に「種」から「起点」へ揃えた
 *   （capture-ledger と capture-scheduler が同じ規則で見張っている）。画面の見出しに
 *   「種」が残っていたのを、新しいクロールの画面（「起点の URL」）を足したときに直した
 * - **クロールは「始める」と書く。** 2026-10 に「起こす」から「始める」へ揃えた（タブは「新しいクロール」、
 *   ボタンは「始める」）。目的語の無い「起こす」は「目を覚まさせる」に読め、タブで 1 つだけ動詞だった。
 *   dashboard の `public/` は「起こ」そのものを書かない —— worker は「起動」、hashchange は「発火」と書く。
 *   ほかのファイルでは、クロールを始める意味の形だけを見る。プロセスの「起こす」（`dev:up` が dashboard を
 *   起こす、など）は別の意味で、見ない（capture-ledger と capture-scheduler も同じ形で見張っている）
 * - **タブで切り替える 5 つの 1 つは「〇〇の画面」、全体は dashboard と書く。** 2026-10 に、5 つの 1 つを
 *   「面」（コードの face の訳）、全体を「画面」と呼ぶ二段をやめた。「面」は単独では表面・側面に読め、
 *   「画面」は全体といま見ている所の 2 つを指していた。全体の「画面」を先に dashboard へ移してから、
 *   「面」を「画面」に充てた。いま見ている所の意味（画面の上・画面に出る・画面の地）は「画面」のまま
 * - **ページで走らせる物は「スクリプト」、置き場は「台帳」と書く。** 2026-10 に「目録」「台本」から
 *   そろえた（タブ「スクリプト」・「台帳 v1」・「台帳にスクリプトがありません」ほか画面の字 15）。「目録」は
 *   browserhive と wacz-validator では WACZ の中の storage の目録を指し、「台本」は代役の台本
 *   （sandbox/scenario.json）とスクリプト 1 本の両方を指していた。dashboard は storage の目録を持たないので、
 *   「目録」は全部見る。「台本」は、代役を説明するファイル（SCENARIO）の外では全部、中では
 *   スクリプト 1 本の意味の形（TAIHON）だけを見る（capture-ledger と capture-scheduler も見張っている）
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
 *   - sandbox/catalog/。capture-scripts のスクリプトの写しで、別の repo の言葉（autofetch.ts の「変種」は
 *     seed ではない）。直すと行番号が実物とずれる（読む所の行と下敷きの行を、代役で実物どおりに見るため）
 *   - 「名乗り」を誰として見るかの意味で使っているか、「起点」を seed の意味で使っているか、
 *     「起こす」がクロールの意味か。語の意味は機械には見えないので、3 つ目と、4 つ目の全体の「画面」と、5 つ目の代役のファイルの中の
 *     「台本」は形の並びで見る
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
/** 「面」を、5 つの 1 つの意味に取れない熟語。dashboard に在るのは「画面」だけ（2026-10）。 */
const NOT_VIEW = /画面|場面|表面|当面|全面|一面|側面|正面|方面|面倒|面積|面白/gu;
/**
 * 全体を「画面」と呼ぶ形。全体は dashboard と書く。「この画面」は入れない —— 5 つの 1 つの意味
 * （「この画面に残る」）でも使う。足すときは、いま見ている所の意味（画面の上・画面に出る）に当たらないことを確かめる。
 */
const WHOLE =
  /画面自身|画面のサーバ|画面を起こ|画面を配|画面 ?[（(]repo|画面の検査|画面のロジック|開発用の画面|画面の依存|画面から切り出|画面は npm|画面の待受|画面の Host|画面のページから|既に動いているこの画面|画面を 70\d\d|画面が 70\d\d/u;

/** 代役の台本（sandbox/scenario.json）を説明するファイル。ここの「台本」は、ほとんどが代役の意味。 */
const SCENARIO =
  /^sandbox\/|^test\/sandbox\.test\.mjs$|^docs-site\/scripts\/docs-shots\.mjs$|^docs-site\/src\/content\/docs\/ja\/development\.md$/u;
/** スクリプト 1 本の意味の「台本」の形。SCENARIO の中でも、この形は赤。 */
const TAIHON = /サイト用の台本|札の(無い|ある)台本|合わない台本|札を省いた台本|見本の台本/u;

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
      "dashboard の public/ では、プロセスの意味でも「起動」と書きます。",
  },
  {
    find: (line) => line.replace(NOT_VIEW, "").includes("面") || WHOLE.test(line),
    say:
      "「面」か、全体の意味の「画面」が残っています。タブで切り替える 5 つの 1 つは「〇〇の画面」、" +
      "全体は dashboard と書きます（画面の上・画面に出る、のような、いま見ている所の意味はそのまま）。",
  },
  {
    // dashboard は storage の目録（browserhive・wacz-validator の意味）を使わないので、「目録」は全部赤
    find: (line, file) =>
      line.includes("目録") || (SCENARIO.test(file) ? TAIHON.test(line) : line.includes("台本")),
    say:
      "「目録」か、スクリプトの意味の「台本」が残っています。ページで走らせる物は「スクリプト」、" +
      "置き場は「台帳」（台帳に無い・台帳 v1）、札のある物は「サイト用のスクリプト」と書きます（代役の台本はそのまま）。",
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
