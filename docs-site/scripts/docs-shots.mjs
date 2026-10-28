/**
 * docs の「画面」のページの絵を撮る。`docs-site/src/assets/screens/` の WebP は全部この script の
 * 生成物で、手で撮った絵は 1 枚も無い。相手は代役（`npm run sandbox`・7081）で、台本
 * （`sandbox/scenario.json`）が見せる物を決める。CI では走らせない —— 代役のコンテナが要る。
 *
 *   npm run docs:shots                  # 全部。画素が前と同じ絵は書かない
 *   npm run docs:shots -- start crawls  # 名指した絵だけ（古さの控え source は替えない）
 *
 * ## 小さく
 *
 * 撮り直すたびに git に積もるので、1 枚を小さくし、変わらない絵は 1 バイトも増やさない（2026-10-24 に実測）。
 *
 *   - lossless WebP。PNG の 32%・パレット PNG より 15% 小さい。非可逆の q80 にしても、合計は可逆より大きい
 *   - 部品の箱だけを切り抜き、高さに上限を付ける。DPR 1
 *   - 画素が前の絵と同じなら書かない（sharp の版が替わってバイト列だけが変わっても、何も足さない）
 *
 * 予算（1 枚 32 KB・全部で 200 KB）と幅の上限は `scripts/check-doc-refs.mjs` の規則 7 が見る。
 *
 * ## 縮めずに読める絵に
 *
 * docs の本文の幅は、窓の幅で 468〜720px に変わる（2026-10-26 に実測）。本文より広い絵は縮んで、13px の字が
 * 8px 台になった。縮めても、絵のバイト数は減らない。
 *
 *   - 窓は全部 `WINDOW`。読ませる絵は、本文の幅 `COLUMN` 以内に切る。縮めて載せてよいのは、wide の表だけ
 *   - 撮る前に、撮れない理由が無いかを見る（`refusals`）。幅・切り口で切れる字・字に重なる丸。有れば撮らずに止まる
 *
 * ## 毎回同じ絵に
 *
 *   - dashboard の時計を止める。代役の時刻の基準は代役が起きた時刻なので、走行中の行の startedAt ＋ 100 秒に
 *     止めれば、「かかった」はいつ撮っても 1m 40s（止めないと、撮るたびに絵が変わった）
 *   - 引き直しを止める。dashboard の setTimeout は、引き直し（2 秒・30 秒）と「写しました」の戻し（1.5 秒）
 *     だけなので、2 秒以上の物を落とす（引き直しは表を作り直し、検証の答えを消す）
 *   - 明るい色・ja-JP・Asia/Tokyo（撮った時刻は toLocaleString）・字のカーソルと動きを消す・
 *     スクロールバーを隠す
 *   - Chrome の版を決める（`CHROME_BUILD`）。字の形は OS のフォントで変わるので、撮るのは macOS
 *   - DPR は整数（1.5 は、時計を止めても字の縁の画素が揺れた）
 *   - 撮る前に、その状態でしか出ない字があるかを見る（`ready`）。無ければ撮らずに止まる —— 違う状態の
 *     絵を、正しい名前で保存しないため
 *
 * 番号の丸は画面の中に置いてから写す。字は数字だけなので、ja・en で同じ絵を使える（説明は各言語の本文）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Browser, computeExecutablePath, install } from "@puppeteer/browsers";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import { COLUMN, shotsSource } from "../../scripts/shots-source.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = join(ROOT, "docs-site/src/assets/screens");
const MANIFEST = join(OUT, "shots.json");
const BASE = "http://127.0.0.1:7081";
/** 撮る Chrome（Chrome for Testing）。替えると全部の絵が替わりうる。shots.json にも書く */
const CHROME_BUILD = "152.0.7977.54";
const CACHE = join(homedir(), ".cache", "puppeteer");
const DPR = 1;
/**
 * 撮る窓の幅。絵は全部この幅で撮る（どの絵も同じ縮尺の dashboard）。スクリプトの画面の読む所
 * （窓 − 一覧 300 − 間 24 − 余白 40）が、ちょうど COLUMN になる。dashboard の組み方が変われば、幅の見張りが言う
 */
const WINDOW = 996;
/** 新しいクロールの欄に入れる JS。placeholder と同じ物を、本当に書いた状態で写す */
const INLINE = '(() => {\n  document.querySelector<HTMLButtonElement>("#accept")?.click();\n})();\n';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** 欄に書いて input を出す（dashboard は input で、起点のチェックや大きさの行を合わせる）。 */
const fill = (page, id, value) =>
  page.evaluate(
    (i, v) => {
      const box = document.getElementById(i);
      box.value = v;
      box.dispatchEvent(new Event("input", { bubbles: true }));
    },
    id,
    value,
  );

/** 文字で選んで押す（scope の中の button）。 */
const press = (page, scope, text) =>
  page.evaluate(
    (s, t) => {
      [...document.querySelectorAll(`${s} button`)].find((b) => b.textContent === t)?.click();
    },
    scope,
    text,
  );

/** アーカイブの 1 行（sourceUrl の終わりで選ぶ）の「検証」を押す。 */
const pressValidate = (page, file) =>
  page.evaluate((f) => {
    const row = [...document.querySelectorAll("#archives tr")].find((tr) =>
      tr.firstElementChild?.textContent.endsWith(`/${f}`),
    );
    [...row.querySelectorAll("button")].find((b) => b.textContent === "検証").click();
  }, file);

/** 新しいクロールの左の列（起点）と右の列（その場の JS）に書く。start と start-js は同じ状態の両側。 */
const writeStart = async (page) => {
  await fill(page, "start-seeds", "https://example.com/");
  await fill(page, "start-inline-name", "close-banner");
  await fill(page, "start-inline-source", INLINE);
};

/**
 * 撮る絵。box は切り抜く要素（並べれば和の箱）で、pad はその外の余白。右端は maxWidth の上限で切る。下端は
 * until の要素の下端か、maxHeight の上限で切り、snap があれば上限の中の最後の行の下端で切る（行の途中で
 * 切らない）。wide は COLUMN より広くてよい絵（本文に縮めて載せる表だけ）。prepare は撮る前の操作、ready は
 * その状態でしか出ない字（無ければ止まる）、marks は番号の丸。at の字の終わりの右に置く（edge: "box" は要素の箱
 * の右、"inside" は要素の右上の内側）。
 */
const SHOTS = [
  {
    name: "tabs",
    hash: "#start",
    box: "header h1, #tabs",
    pad: 10,
    ready: () => document.getElementById("tab-start").classList.contains("on"),
  },
  {
    name: "crawls",
    hash: "#crawls",
    box: "#face-crawls table",
    // 表は折り返さない欄で、中身の幅に伸びる。開いた行は crawl-detail
    wide: true,
    ready: () => document.querySelector("#crawls tr.head td:nth-child(8)")?.textContent === "1m 40s",
    marks: [
      { n: 1, at: "#crawls tr.head:first-child td:first-child" },
      { n: 2, at: "#crawls tr.head:first-child td:last-child a" },
    ],
  },
  {
    name: "crawl-detail",
    hash: "#crawls",
    box: "#crawls tr.detail td",
    // 開いた行は表の幅に伸びる。左の COLUMN を切り、「規則ごと」と Windmill の 1 行まで入れる
    maxWidth: COLUMN,
    until: "#crawls tr.detail .decided",
    prepare: async (page) => {
      await page.evaluate(() => {
        [...document.querySelectorAll("#crawls tr.head")]
          .find((tr) => tr.textContent.includes("5b0c0007"))
          .click();
      });
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#crawls tr.detail button")].some((b) => b.textContent === "欄に戻す"),
      );
    },
    ready: () =>
      document.querySelector("#crawls tr.detail")?.textContent.includes("走らせたもの") &&
      document.querySelector("#crawls tr.detail .decided a") !== null,
    marks: [
      { n: 1, at: "#crawls tr.detail p" },
      { n: 2, at: "#crawls tr.detail button", edge: "box" },
      { n: 3, at: "#crawls tr.detail .decided p" },
      { n: 4, at: "#crawls tr.detail .decided > p:last-child" },
    ],
  },
  {
    name: "start",
    hash: "#start",
    box: ".start-side",
    until: "#start-go",
    prepare: writeStart,
    ready: () => {
      const site = [...document.querySelectorAll("#start-picks label.pick")].find((l) =>
        l.textContent.startsWith("example-title"),
      );
      return site?.querySelector("input").checked === true && !document.getElementById("start-go").disabled;
    },
    marks: [
      { n: 1, at: 'label[for="start-seeds"]' },
      { n: 2, at: ".start-run legend" },
      { n: 3, at: "#start-go", edge: "box" },
    ],
  },
  {
    name: "start-js",
    hash: "#start",
    box: ".start-code",
    maxHeight: 300,
    prepare: writeStart,
    ready: () => document.getElementById("start-size").textContent.startsWith("4 行"),
    marks: [
      { n: 1, at: "#start-tab-js", edge: "box" },
      { n: 2, at: 'label[for="start-inline-name"]' },
      { n: 3, at: ".start-editor", edge: "inside" },
    ],
  },
  {
    name: "start-rules",
    hash: "#start",
    box: ".start-code",
    until: "#start-said",
    prepare: async (page) => {
      await fill(page, "start-seeds", "https://sandbox.example/news");
      await page.click("#start-follow");
      await press(page, "#start-presets", "サイトの中＋外は 1 歩");
      // 落とす行は上に入り、当てる物に字の位置が来る
      await page.click("#start-add-skip");
      await page.keyboard.type("ads.sandbox.example");
      // 下に足した落とす行は「どこでも撮るだけ」に覆われる —— 印と、始められない文が出る
      await page.click("#start-add-row");
      await page.select("#start-rule-rows tr:last-child select", "skip");
      await page.focus("#start-rule-rows tr:last-child input");
      await page.keyboard.type("tracker.example.net");
      await fill(page, "start-max-depth", "3");
      await fill(page, "start-max-pages", "200");
      await page.waitForFunction(() => document.querySelector("#start-rule-rows tr:last-child td.mark.bad") !== null);
      await page.evaluate(() => document.activeElement?.blur());
    },
    ready: () =>
      document.getElementById("start-said").textContent.includes("覆われて当たりません") &&
      document.getElementById("start-go").disabled,
    marks: [
      { n: 1, at: "#start-tab-rules", edge: "box" },
      { n: 2, at: "#start-presets .muted" },
      { n: 3, at: ".rules th:nth-child(2)" },
      { n: 4, at: ".rules th:nth-child(4)" },
      { n: 5, at: "#start-add-skip", edge: "box" },
      { n: 6, at: "#start-said" },
    ],
  },
  {
    name: "start-read",
    hash: "#start",
    box: ".start-code",
    snap: "#start-read-lines li",
    maxHeight: 300,
    prepare: async (page) => {
      const read = await page.evaluateHandle(() =>
        [...document.querySelectorAll("#start-picks label.pick")]
          .find((l) => l.textContent.startsWith("autoscroll"))
          .querySelector("a.read"),
      );
      await read.asElement().click();
      await page.waitForFunction(() => document.querySelectorAll("#start-read-lines .t span").length > 0);
    },
    ready: () =>
      document.getElementById("start-tab-read").textContent === "autoscroll v2" &&
      document.querySelector("#start-read-head .rmeta")?.textContent.includes("既定で走る版"),
  },
  {
    name: "archives",
    hash: "#archives",
    box: "#face-archives table",
    maxHeight: 360,
    wide: true,
    // 検証の答えは行に残る。報告の行（かかった ms が出る）は、もう 1 度押して閉じる
    prepare: async (page) => {
      for (const file of ["good.wacz", "datapackage-bad-hash.wacz"]) await pressValidate(page, file);
      await page.waitForFunction(
        () => [...document.querySelectorAll("#archives td span.state")].filter((s) => !/中|…/.test(s.textContent)).length >= 2,
      );
      for (const file of ["good.wacz", "datapackage-bad-hash.wacz"]) await pressValidate(page, file);
    },
    ready: () =>
      document.querySelectorAll("#archives tr.detail").length === 0 &&
      document.getElementById("archives").textContent.includes("問題なし") &&
      document.getElementById("archives").textContent.includes("失敗 1"),
  },
  {
    name: "scripts",
    hash: "#scripts/autoscroll",
    box: "#reading-list",
    ready: () =>
      document.querySelector("#reading-list a.ritem.on")?.textContent.startsWith("autoscroll") === true &&
      document.querySelector('#reading-list a.ritem[href="#scripts/types/host.d.ts"]') !== null,
  },
  {
    name: "script-read",
    hash: "#scripts/autoscroll",
    box: "#face-scripts .vmain",
    snap: "#reading-lines li",
    maxHeight: 300,
    prepare: (page) => page.waitForFunction(() => document.querySelectorAll("#reading-lines .t span").length > 0),
    ready: () => document.querySelector("#reading-head .rtitle b")?.textContent === "autoscroll v2",
  },
];

/**
 * dashboard の時計と引き直しを止める（どのスクリプトよりも先に走る）。Date は引数の無い new Date() と
 * Date.now() だけを止め、日付を組む new Date(x) はそのまま。setTimeout は 2 秒以上の物だけを落とす。
 */
const freeze = (now) => {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? [now] : args));
    }
    static now() {
      return now;
    }
  }
  globalThis.Date = FrozenDate;
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => (ms >= 2000 ? 0 : realSetTimeout(fn, ms, ...rest));
};

/**
 * 番号の丸を置き、丸の矩形（ページの座標・白い縁まで）を返す。字の終わり（edge: "box" なら要素の箱）の右に、
 * 切る矩形に入らなければ左に。"inside" は要素の右上の内側。
 */
const placeMarks = (marks, clip) => {
  const size = 16;
  const ring = 2;
  /** 字の終わり（最後の字の行の矩形）。折り返す文でも、丸は文の後に付く */
  const endOf = (el) => {
    const range = document.createRange();
    let last;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.textContent.trim() === "") continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 0) last = r;
    }
    return last;
  };
  return marks.map(({ n, at, edge = "text" }) => {
    const el = document.querySelector(at);
    if (el === null) throw new Error(`丸 ${String(n)} の置き場が無い: ${at}`);
    const inside = edge === "inside";
    const rect = (edge === "text" ? endOf(el) : undefined) ?? el.getBoundingClientRect();
    let x = scrollX + (inside ? rect.right - size - 6 : rect.right + 3);
    if (!inside && x + size + ring > clip.x + clip.width) x = scrollX + rect.left - size - 3;
    const y = scrollY + (inside ? rect.top + 6 : rect.top + (rect.height - size) / 2);
    const mark = document.createElement("span");
    mark.textContent = String(n);
    mark.style.cssText =
      `position:absolute;left:${String(x)}px;top:${String(y)}px;width:${String(size)}px;` +
      `height:${String(size)}px;border-radius:50%;background:#0d6b6b;color:#ffffff;` +
      "font:700 11px/16px -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;" +
      `box-shadow:0 0 0 ${String(ring)}px #ffffff;z-index:9999;pointer-events:none`;
    document.body.append(mark);
    return { n, left: x - ring, top: y - ring, right: x + size + ring, bottom: y + size + ring };
  });
};

/**
 * 見えている字の矩形（ページの座標）。字の node の行ごとの矩形を、overflow で切る祖先の箱で削る —— 読む所の
 * 長い行や省略（…）は dashboard が自分で隠した所で、切り口で切れた字ではない。欄（input・textarea）の中の
 * 字は node でないので見えない。丸を置く前に読む。
 */
const visibleText = () => {
  const cuts = new Map();
  const cutOf = (el) => {
    if (el === null) return { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    if (cuts.has(el)) return cuts.get(el);
    const cut = { ...cutOf(el.parentElement) };
    const style = getComputedStyle(el);
    // inline の箱に overflow は効かない（clientWidth も 0）
    if (style.display !== "inline" && style.display !== "contents") {
      const box = el.getBoundingClientRect();
      const left = box.left + el.clientLeft;
      const top = box.top + el.clientTop;
      if (style.overflowX !== "visible") {
        cut.left = Math.max(cut.left, left);
        cut.right = Math.min(cut.right, left + el.clientWidth);
      }
      if (style.overflowY !== "visible") {
        cut.top = Math.max(cut.top, top);
        cut.bottom = Math.min(cut.bottom, top + el.clientHeight);
      }
    }
    cuts.set(el, cut);
    return cut;
  };
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (text === "") continue;
    const cut = cutOf(node.parentElement);
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      const left = Math.max(r.left, cut.left);
      const top = Math.max(r.top, cut.top);
      const right = Math.min(r.right, cut.right);
      const bottom = Math.min(r.bottom, cut.bottom);
      if (right - left < 1 || bottom - top < 1) continue;
      out.push({ text, left: left + scrollX, top: top + scrollY, right: right + scrollX, bottom: bottom + scrollY });
    }
  }
  return out;
};

/**
 * 撮れない理由（空なら撮ってよい）。どれも 1px までは丸めの誤差として見逃す。
 *   幅      wide でない絵は COLUMN 以内（本文に縮まない）
 *   切り口  見えている字が、切る矩形の端をまたがない
 *   丸      切る矩形の中にあり、見えている字に重ならない
 */
const refusals = ({ clip, wide = false, texts, marks }) => {
  const box = { left: clip.x, top: clip.y, right: clip.x + clip.width, bottom: clip.y + clip.height };
  const meets = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
  const within = (a, b) =>
    a.left >= b.left - 1 && a.top >= b.top - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
  const quote = (text) => `「${text.length > 40 ? `${text.slice(0, 40)}…` : text}」`;
  const out = [];
  if (!wide && clip.width > COLUMN) {
    out.push(`幅 ${String(clip.width)}px —— 本文の ${String(COLUMN)}px を超える（縮めて載せる表なら wide）`);
  }
  const cut = [...new Set(texts.filter((t) => meets(t, box) && !within(t, box)).map((t) => t.text))];
  if (cut.length > 0) {
    const more = cut.length > 3 ? ` ほか ${String(cut.length - 3)} 個` : "";
    out.push(`切り口で ${cut.slice(0, 3).map(quote).join("・")}${more} が切れる`);
  }
  for (const mark of marks) {
    if (!within(mark, box)) out.push(`丸 ${String(mark.n)} が切り口の外に出る`);
    const hit = texts.find((t) => meets(t, mark));
    if (hit !== undefined) out.push(`丸 ${String(mark.n)} が ${quote(hit.text)} に重なる`);
  }
  return out;
};

/** 切り抜く矩形（ページの座標・整数）。shot の box・pad・maxWidth・until・maxHeight・snap から組む。 */
const clipOf = ({ box, pad = 0, maxWidth = Infinity, until, maxHeight = Infinity, snap }) => {
  const rects = [...document.querySelectorAll(box)].map((e) => e.getBoundingClientRect());
  const left = Math.min(...rects.map((r) => r.left)) - pad;
  const top = Math.min(...rects.map((r) => r.top)) - pad;
  const right = Math.max(...rects.map((r) => r.right)) + pad;
  let bottom = Math.max(...rects.map((r) => r.bottom)) + pad;
  if (until !== undefined) bottom = document.querySelector(until).getBoundingClientRect().bottom + 4;
  bottom = Math.min(bottom, top + maxHeight);
  if (snap !== undefined) {
    const whole = [...document.querySelectorAll(snap)]
      .map((e) => e.getBoundingClientRect().bottom)
      .filter((b) => b <= bottom);
    if (whole.length > 0) bottom = Math.max(...whole) + 4;
  }
  const x = Math.floor(left + scrollX);
  const y = Math.floor(top + scrollY);
  // 端数を外へ丸めても maxWidth を超えない
  const width = Math.min(Math.ceil(right + scrollX) - x, maxWidth);
  return { x, y, width, height: Math.ceil(bottom + scrollY) - y };
};

/** 前の絵と画素が同じか（大きさ・色の数・画素の全部）。 */
const samePixels = async (file, webp) => {
  if (!existsSync(file)) return false;
  const [before, now] = await Promise.all([
    sharp(file).raw().toBuffer({ resolveWithObject: true }),
    sharp(webp).raw().toBuffer({ resolveWithObject: true }),
  ]);
  return (
    before.info.width === now.info.width &&
    before.info.height === now.info.height &&
    before.info.channels === now.info.channels &&
    before.data.equals(now.data)
  );
};

const named = process.argv.slice(2);
const unknown = named.filter((name) => !SHOTS.some((shot) => shot.name === name));
if (unknown.length > 0) {
  console.error(`知らない絵: ${unknown.join(", ")}（在るのは ${SHOTS.map((s) => s.name).join(", ")}）`);
  process.exit(1);
}
const health = await fetch(`${BASE}/healthz`).catch(() => undefined);
if (health?.ok !== true) {
  console.error(`代役（${BASE}）が答えない。先に npm run sandbox で起こす`);
  process.exit(1);
}
const running = (await (await fetch(`${BASE}/api/crawls`)).json()).crawls.find((c) => c.state === "running");
if (running === undefined) {
  console.error("台本に走行中のクロールが無い（時計を止める基準にする）。sandbox/scenario.json を見る");
  process.exit(1);
}
const NOW = Date.parse(running.startedAt) + 100_000;

const executablePath = computeExecutablePath({ browser: Browser.CHROME, buildId: CHROME_BUILD, cacheDir: CACHE });
if (!existsSync(executablePath)) {
  console.log(`Chrome ${CHROME_BUILD} を ${CACHE} に入れます`);
  await install({ browser: Browser.CHROME, buildId: CHROME_BUILD, cacheDir: CACHE });
}

mkdirSync(OUT, { recursive: true });
const manifest = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, "utf8"))
  : { "//": "", chrome: CHROME_BUILD, dpr: DPR, source: "", shots: {} };
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--hide-scrollbars", "--lang=ja-JP"],
});
try {
  for (const shot of SHOTS.filter((s) => named.length === 0 || named.includes(s.name))) {
    const page = await browser.newPage();
    await page.setViewport({ width: WINDOW, height: 900, deviceScaleFactor: DPR });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    await page.emulateTimezone("Asia/Tokyo");
    await page.evaluateOnNewDocument(freeze, NOW);
    await page.goto(`${BASE}/${shot.hash}`, { waitUntil: "networkidle0" });
    await page.addStyleTag({
      content: "*{caret-color:transparent!important;animation:none!important;transition:none!important}",
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    if (shot.prepare !== undefined) await shot.prepare(page);
    await sleep(300); // 色を塗る worker の最後のコマを待つ
    if (!(await page.evaluate(shot.ready))) {
      throw new Error(`${shot.name}: 撮る前の字が無い（違う状態のまま撮らない）。代役の台本を見る`);
    }
    const { box, pad, maxWidth, until, maxHeight, snap } = shot;
    const clip = await page.evaluate(clipOf, { box, pad, maxWidth, until, maxHeight, snap });
    const texts = await page.evaluate(visibleText);
    const marks = await page.evaluate(placeMarks, shot.marks ?? [], clip);
    const why = refusals({ clip, wide: shot.wide, texts, marks });
    if (why.length > 0) throw new Error(`${shot.name}: 撮らない —— ${why.join("／")}`);
    const png = await page.screenshot({ clip, type: "png" });
    const webp = await sharp(png).webp({ lossless: true, effort: 6 }).toBuffer();
    const file = join(OUT, `${shot.name}.webp`);
    const same = await samePixels(file, webp);
    if (!same) writeFileSync(file, webp);
    // wide は、本文に縮めて載せる絵の印（規則 7 が幅の例外をこれで数える）
    manifest.shots[shot.name] = { width: clip.width, height: clip.height, ...(shot.wide ? { wide: true } : {}) };
    const kept = same ? readFileSync(file).length : webp.length;
    console.log(
      `${shot.name.padEnd(12)} ${String(clip.width)}×${String(clip.height)}  ${(kept / 1024).toFixed(1)} KB  ${same ? "同じ（書かない）" : "書いた"}`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}

manifest["//"] =
  "npm run docs:shots の生成物。手で直さない —— source を直して緑にすると、絵は古いまま残る";
manifest.chrome = CHROME_BUILD;
manifest.dpr = DPR;
// 名指して撮ったときは控えを替えない（撮っていない絵まで新しいことになる）
if (named.length === 0 || manifest.source === "") manifest.source = shotsSource(ROOT);
manifest.shots = Object.fromEntries(
  SHOTS.filter((s) => manifest.shots[s.name] !== undefined).map((s) => [s.name, manifest.shots[s.name]]),
);
const text = `${JSON.stringify(manifest, null, 2)}\n`;
if (!existsSync(MANIFEST) || readFileSync(MANIFEST, "utf8") !== text) writeFileSync(MANIFEST, text);
