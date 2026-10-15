/**
 * 画面。**素の JS**（bundler も framework も通さない）。
 *
 * 読むのは台帳の口と、WACZ の中身へ行く `/wacz/` の口だけ。ここで畳むのは「どの面を
 * 出すか」と「どう描くか」で、何が起きたかは全部向こうが知っている。
 *
 * **撮った中身は他人が書いたもの。** 文字は `textContent`、画像は raster だけを
 * `<img>` で。生の HTML を差し込む API はこのファイルに無い（`check` が見張る）。
 */
import { judgedUnder, severityKind, stateOf, statsOf, took, verdict } from "/format.js";
import { bodyBytes, hasNocheck, sizeOf, startAnswer, startBody, withNocheck } from "/start.js";
import {
  bodyLabel,
  buildTree,
  codecName,
  entryMarker,
  expectedLabel,
  flattenTree,
  formatBytes,
  isWarc,
  lineLabel,
  parseWaczHash,
  recordCells,
  recordOpener,
  typeName,
  waczHash,
} from "/wacz-view.js";

const $ = (id) => document.getElementById(id);

/** `/healthz` が配る、この配備の事実。深いリンクの行き先はここから来る。 */
let settings = {};

const api = async (path) => {
  const res = await fetch(path);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? body.message ?? `${path} → ${String(res.status)}`);
  return body;
};

const post = async (path) => {
  const res = await fetch(path, { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? body.message ?? `${path} → ${String(res.status)}`);
  return body;
};

/**
 * 失敗は**消さずに出す**。台帳が落ちている間も、最後に描けた表は残す ——
 * 空の表は「見えるものが無い」と読めてしまい、「取りに行けない」と区別が付かない。
 */
const trouble = (message) => {
  const box = $("trouble");
  box.hidden = message === undefined;
  if (message !== undefined) box.textContent = message;
};

const tag = (name, text, className) => {
  const el = document.createElement(name);
  el.textContent = text;
  if (className !== undefined) el.className = className;
  return el;
};

const cell = (text, className) => tag("td", text, className);

const linkCell = (href, text) => {
  const td = document.createElement("td");
  if (href !== undefined) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = text;
    td.append(a);
  }
  return td;
};

/** 同じ画面の中の行き先（hash）。新しいタブで開かない。 */
const hashCell = (href, text) => {
  const td = document.createElement("td");
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  td.append(a);
  return td;
};

const button = (text, onclick) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.onclick = onclick;
  return b;
};

const enc = encodeURIComponent;
const failedText = (err) => (err instanceof Error ? err.message : String(err));

// ── クロール ───────────────────────────────────────────────────────
let crawls = [];

/**
 * 起こした 1 本か、409 で塞いでいた 1 本。**行は開かずに印を付ける** —— 表は引くたびに
 * 作り直すので、開いた行は次の引きで消える。id で覚えておけば、描き直しのたびに付け直せる。
 */
let spotlight;

const runHref = (crawl) =>
  crawl.lastJob === null
    ? undefined
    : `${settings.windmillOrigin}/run/${crawl.lastJob.id}?workspace=${settings.windmillWorkspace}`;

/**
 * 開いている行。**id で覚え、描き直しのたびに開き直す** —— 表は引くたびに作り直すので、
 * DOM に置いただけの行は次の引きで消える（走行中なら 2 秒で）。値は最後に引いた
 * `/api/crawls/:id` の答え（まだ引いていなければ undefined、引けなければ Error）。
 */
const opened = new Map();

const failuresText = (one) => {
  const failures = one.failures ?? [];
  return failures.length === 0
    ? `取れなかったページはありません（起点: ${one.seeds.join(", ")}）`
    : failures.map((f) => `${f.url} — ${f.reason ?? "理由なし"}`).join("\n");
};

/**
 * 走らせたもの。**並びが実行順。** 目録の物は版を、その場で書いた物は「その場」と出す ——
 * その場の物にだけ、台帳は頼まれた要素（`inline`）を返す。
 */
const ranOf = (one) => {
  const scripts = one.scripts ?? [];
  if (scripts.length === 0) return tag("p", "走らせたもの: なし");
  const list = document.createElement("ol");
  list.className = "ran";
  for (const script of scripts) {
    const item = document.createElement("li");
    const where =
      script.inline === undefined
        ? `目録 v${String(script.version)}・${script.phase}`
        : `その場・${script.phase}・${count(script.inline.bytes)} バイト`;
    item.append(tag("span", script.id, "mono"), tag("span", where, "muted"));
    // その場の JS は、直して撮り直せるように欄へ戻せる（目録の物は目録に在る）。source は詳しい所に
    // 無いので、押したときに名前の口から取る
    if (script.inline !== undefined) {
      item.append(button("欄に戻す", () => void putBack(one.crawlId, script.inline.name)));
    }
    list.append(item);
  }
  const box = document.createElement("div");
  box.append(tag("p", "走らせたもの（並びが実行順）"), list);
  return box;
};

/**
 * 1 本の詳しい所。**失敗の文が先** —— compile の段で落ちたクロールは 1 枚も撮っていないので
 * failures が空で、それだけを出すと「取れなかったページはありません」と、成功のように読める。
 * 台帳の文は言い換えない。
 */
const detailOf = (one) => [
  ...(one.error === null || one.error === undefined
    ? []
    : [tag("p", `失敗の文: ${one.error}`, "state bad pre")]),
  ranOf(one),
  tag("p", failuresText(one), "pre"),
];

/** 開いた行の下に出す 1 行。最後の答えで、引き直しを待たずに描く。 */
const detailRow = (crawl) => {
  const row = document.createElement("tr");
  row.className = "detail";
  row.dataset.crawl = crawl.crawlId;
  const td = document.createElement("td");
  td.colSpan = 9;
  const one = opened.get(crawl.crawlId);
  if (one === undefined) td.textContent = "読み込み中…";
  else if (one instanceof Error) td.replaceChildren(tag("p", failedText(one), "state bad"));
  else td.replaceChildren(...detailOf(one));
  row.append(td);
  return row;
};

/** 1 本を引いて覚え、その行だけを描き直す。**開いたときと、変わりうるときだけ引く。** */
const loadDetail = async (crawlId) => {
  let one;
  try {
    one = await api(`/api/crawls/${crawlId}`);
  } catch (err) {
    one = err instanceof Error ? err : new Error(String(err));
  }
  if (!opened.has(crawlId)) return; // 待っている間に閉じた
  opened.set(crawlId, one);
  const crawl = crawls.find((c) => c.crawlId === crawlId);
  const row = document.querySelector(`tr.detail[data-crawl="${crawlId}"]`);
  if (crawl !== undefined && row !== null) row.replaceWith(detailRow(crawl));
};

/**
 * 引き直しの後、開いている行の答えを新しくする。**引くのは、まだ答えが無い・引けなかった・
 * 走行中・状態が変わった行だけ** —— 終わった行は 1 度で足りる。1 ページ目から外れた行は忘れる。
 */
const refreshOpened = () => {
  for (const [crawlId, one] of opened) {
    const crawl = crawls.find((c) => c.crawlId === crawlId);
    if (crawl === undefined) {
      opened.delete(crawlId);
      continue;
    }
    const stale =
      one === undefined ||
      one instanceof Error ||
      crawl.state === "running" ||
      one.state !== crawl.state;
    if (stale) void loadDetail(crawlId);
  }
};

const drawCrawls = () => {
  const body = $("crawls");
  body.replaceChildren();
  $("crawls-empty").hidden = crawls.length > 0;
  for (const crawl of crawls) {
    const state = stateOf(crawl);
    const row = document.createElement("tr");
    row.className = crawl.crawlId === spotlight ? "head spot" : "head";
    row.append(cell(state.text, `state ${state.kind}`));
    row.append(cell(crawl.crawlId.slice(0, 8), "mono"));
    row.append(cell(`${crawl.requestedBy} / ${crawl.orgId}`));
    row.append(cell(crawl.seeds[0] ?? "", "wide"));
    // **2 つの数を 1 つの欄に混ぜない。** `pagesDiscovered` はリンクを辿って見つけた数
    // なので、深さ 0 のクロールは「撮れた 1・見つけた 0」になる —— `1 / 0` と並べると
    // 「分母より分子が大きい」に見えて、毎回つまずく（実機を見て気づいた）。
    row.append(cell(String(crawl.pagesCaptured), "num mono"));
    row.append(cell(String(crawl.pagesDiscovered), "num mono"));
    row.append(cell(String(crawl.waczCount), "num mono"));
    row.append(cell(took(crawl), "num mono"));
    row.append(linkCell(runHref(crawl), "run ↗"));
    row.onclick = (event) => {
      if (event.target instanceof HTMLAnchorElement) return;
      if (opened.delete(crawl.crawlId)) {
        if (row.nextElementSibling?.classList.contains("detail")) row.nextElementSibling.remove();
        return;
      }
      opened.set(crawl.crawlId, undefined);
      row.after(detailRow(crawl));
      void loadDetail(crawl.crawlId);
    };
    body.append(row);
    // 開いていた行は、最後の答えで開き直す（表は引くたびに作り直す）
    if (opened.has(crawl.crawlId)) body.append(detailRow(crawl));
  }
};

// ── 起こす ─────────────────────────────────────────────────────────
/** 目録の id（目録の面と同じ並び）。チェックはこの並びで描き、送るときもこの並び。 */
let catalogIds = [];

/** 外した目録の id。**引き直しても覚えておく。** 新しく現れた id は、選んだ状態で出る。 */
const unpicked = new Set();

/** 最後に描いた目録の形（id と版）。同じなら描き直さない。 */
let catalogKey;

/**
 * 目録のチェックを描く。**目録が変わったときだけ描き直す** —— 一覧は走行中なら 2 秒ごとに
 * 引くので、毎回作り直すと、押そうとしているチェックが手の下で入れ替わる。
 */
const drawPicks = (scripts) => {
  const key = scripts.map((s) => `${s.id}@${String(s.version)}`).join(",");
  if (key === catalogKey) return;
  catalogKey = key;
  catalogIds = scripts.map((s) => s.id);
  const box = $("start-picks");
  box.replaceChildren();
  if (scripts.length === 0) {
    box.append(tag("span", "目録が空です（目録の面を見てください）", "muted"));
    return;
  }
  for (const script of scripts) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !unpicked.has(script.id);
    input.onchange = () => {
      if (input.checked) unpicked.delete(script.id);
      else unpicked.add(script.id);
    };
    const label = document.createElement("label");
    label.className = "pick";
    label.append(input, tag("span", `${script.id} v${String(script.version)}`, "mono"));
    box.append(label);
  }
};

/** 欄の「走らせるもの」。組み立ては `start.js` の `scriptsOf`（試験から呼べる）。 */
const runOf = () => ({
  catalog: catalogIds,
  picked: catalogIds.filter((id) => !unpicked.has(id)),
  inline: {
    name: $("start-inline-name").value,
    phase: $("start-inline-preload").checked ? "preload" : "behavior",
    source: $("start-inline-source").value,
  },
});

/**
 * その場の JS を欄に戻し、起こす面へ移る。直して撮り直すため。**起点と目録の選びは触らない。**
 * source は詳しい所に無い（capture-ledger v0.59.0）ので、名前の口から取る。
 */
const putBack = async (crawlId, name) => {
  let back;
  try {
    back = await api(`/api/crawls/${crawlId}/inline/${enc(name)}`);
  } catch (err) {
    trouble(`欄に戻せません: ${failedText(err)}`);
    return;
  }
  $("start-inline-name").value = name;
  $(back.phase === "preload" ? "start-inline-preload" : "start-inline-behavior").checked = true;
  $("start-inline-source").value = back.source;
  $("start-answer").hidden = true; // 前の答えは、戻した JS の物ではない
  location.hash = "start";
  drawSource();
  syncStart();
  $("start-inline-source").focus();
};

/**
 * ファイルを読む。**ブラウザの中で読むだけ**で、サーバには何も足さない。capture-scripts の中で
 * 型の補完を効かせて書いたファイルを、そのまま欄に入れるため。名前が空なら、拡張子を除いた
 * ファイル名を入れる（綴りは台帳が見る）。
 */
const readFileIntoForm = async () => {
  const file = $("start-inline-file").files?.[0];
  if (file === undefined) return;
  $("start-inline-source").value = await file.text();
  if ($("start-inline-name").value.trim() === "") {
    $("start-inline-name").value = file.name.replace(/\.[^.]*$/, "");
  }
  $("start-inline-file").value = ""; // 同じファイルをもう 1 度読めるように
  drawSource();
  syncStart();
};

/** 数を 3 桁ずつ区切る（大きさの行と、走らせたものの行）。 */
const count = (n) => n.toLocaleString("en-US");

/** 行番号の溝。**行の数が変わったときだけ**組み直す（2 万行でも、打つたびには組まない）。 */
let drawnLines = -1;
const drawGutter = () => {
  const lines = Math.max(1, $("start-inline-source").value.split("\n").length);
  if (lines === drawnLines) return;
  $("start-gutter").textContent = Array.from({ length: lines }, (_, i) => String(i + 1)).join("\n");
  drawnLines = lines;
};

/**
 * 空の欄では押せない。**上限を超えた本文も**、送る前に止める（上限は /healthz の writeLimit。
 * 知らなければ止めない —— 門が 413 で言う）。欄の下に、行数・本文の大きさ・上限に対する割合を出す。
 */
const syncStart = () => {
  const body = startBody($("start-seeds").value, $("start-page").checked, runOf());
  const limit = settings.writeLimit ?? Infinity;
  const size = sizeOf($("start-inline-source").value, bodyBytes(body), limit);
  const line = $("start-size");
  line.textContent = size.over
    ? `本文が上限（${count(limit)} バイト）を ${count(size.bytes - limit)} バイト超えています。起こせません`
    : `${count(size.lines)} 行 · 本文 ${count(size.bytes)} バイト` +
      (limit === Infinity ? "" : ` · 上限の ${String(size.percent)}%`);
  line.classList.toggle("bad", size.over);
  $("start-go").disabled = body.seeds.length === 0 || size.over;
};

/**
 * 箱の中身が変わったら、溝と「型を検査しない」のチェックを中身に合わせる（貼った JS が印を持っていれば
 * 付く）。**チェックを押したときには呼ばない** —— checkbox は change の前に input を出すので、そこで
 * 中身から読み直すと、押した向きが change に届く前に戻ってしまう。
 */
const drawSource = () => {
  drawGutter();
  $("start-nocheck").checked = hasNocheck($("start-inline-source").value);
};

/**
 * 欄から 1 本起こす。**送る前に検査しない** —— 読めない URL は台帳が 400 で言う。
 * 答えは欄の下に 1 行で、台帳の文は言い換えずに出す（`start.js` の `startAnswer`）。
 */
const startCrawl = async (event) => {
  event.preventDefault();
  const body = startBody($("start-seeds").value, $("start-page").checked, runOf());
  if (body.seeds.length === 0) return;
  $("start-go").disabled = true;
  let status = 0;
  let answer = {};
  try {
    const res = await fetch("/api/crawls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    status = res.status;
    answer = await res.json().catch(() => ({}));
  } catch (err) {
    answer = { error: failedText(err) };
  }
  const said = startAnswer(status, answer);
  const line = $("start-answer");
  line.hidden = false;
  line.className = `start-answer state ${said.kind}`;
  line.textContent = said.text;
  // 起点は消す。その場の JS は残す —— 直して撮り直すことが多い
  if (status === 202) $("start-seeds").value = "";
  syncStart();
  // 202 は起こした 1 本、409 は塞いでいる 1 本。どちらも印を付けて、すぐ引き直す
  if (typeof answer.crawlId === "string") {
    spotlight = answer.crawlId;
    location.hash = "crawls"; // 印は一覧の面で見る
    await refresh();
  }
};

// 箱・起点・チェック・2 択のどれが変わっても、大きさの行と「起こす」を合わせる。溝とチェックは箱のときだけ
$("start").addEventListener("input", (event) => {
  if (event.target === $("start-inline-source")) drawSource();
  syncStart();
});
$("start-inline-source").addEventListener("scroll", (event) => {
  $("start-gutter").scrollTop = event.target.scrollTop;
});
$("start-nocheck").addEventListener("change", (event) => {
  const box = $("start-inline-source");
  box.value = withNocheck(box.value, event.target.checked); // 見えている物が送る物
  drawSource();
  syncStart();
});
$("start").addEventListener("submit", (event) => void startCrawl(event));
$("start-inline-file").addEventListener("change", () => void readFileIntoForm());

// ── 検証 ───────────────────────────────────────────────────────────
/**
 * 1 本の報告を描く。**文は 1 つも持たない** —— message も日本語も spec の節も、
 * daemon が解決して返したものをそのまま出す (`renderJson(report, locale)`)。
 * ここで言い換えると、検証器が言い始めたことと画面がずれていく。
 */
const drawReport = (td, report) => {
  td.replaceChildren();
  const s = report.summary;
  const bar = document.createElement("div");
  bar.className = "bar";
  const v = verdict(s);
  bar.append(
    tag("span", `合格 ${String(s.passed)}`, "big"),
    tag("span", v.text, `big state ${v.kind}`),
    tag(
      "span",
      [...judgedUnder(report), `${String(s.durationMs)} ms`, ...statsOf(report)].join(" ／ "),
      "mono muted",
    ),
  );
  td.append(bar);

  for (const issue of report.issues) {
    const line = document.createElement("div");
    line.className = "line";
    line.append(
      tag("span", issue.severity, `state ${severityKind(issue.severity)}`),
      tag("span", issue.rule, "mono"),
      tag("span", issue.message),
    );
    // **spec へのリンクも daemon が持っている。** 画面が URL を組み立てない。
    if (issue.specUrl) {
      const a = document.createElement("a");
      a.href = issue.specUrl;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "仕様 ↗";
      a.className = "mono";
      line.append(a);
    }
    td.append(line);
  }

  for (const entry of report.entries) {
    const line = document.createElement("div");
    line.className = "line";
    line.append(
      tag("span", entry.present ? "entry" : "無い", entry.present ? "muted" : "state warn"),
      tag("span", entry.path, "mono"),
      tag(
        "span",
        entry.present ? `${String(entry.uncompressedSize ?? 0)} B` : "（上の指摘の実体）",
        "mono muted",
      ),
    );
    td.append(line);
  }
};

/**
 * 押されたら 1 本検証する。**押すまで走らせない** —— 一覧を開くだけで走らせない。
 *
 * 結果は行にも残す。閉じたあとに「この 1 本はどうだったか」が消えると、
 * 何本か見たときに**もう一度押さないと思い出せない**。
 */
const validate = async (archive, after, verdictCell) => {
  const row = document.createElement("tr");
  row.className = "detail";
  const td = document.createElement("td");
  td.colSpan = 8;
  td.textContent = "検証しています…";
  row.append(td);
  after.after(row);
  try {
    const body = await post(`/wacz/${enc(archive.id)}/validate`);
    drawReport(td, body);
    if (verdictCell) {
      const v = verdict(body.summary);
      verdictCell.replaceChildren(tag("span", v.text, `state ${v.kind}`));
    }
  } catch (err) {
    td.textContent = failedText(err);
    if (verdictCell) verdictCell.replaceChildren(tag("span", "検証できず", "state bad"));
  }
};

// ── アーカイブ ─────────────────────────────────────────────────────
let archives = [];

const drawArchives = () => {
  const body = $("archives");
  body.replaceChildren();
  $("archives-empty").hidden = archives.length > 0;
  for (const archive of archives) {
    const row = document.createElement("tr");
    row.append(cell(archive.sourceUrl, "wide"));
    row.append(cell(archive.labels.join(" ")));
    row.append(cell(new Date(archive.capturedAt).toLocaleString("ja-JP"), "mono"));
    // **null は「分からない」。** 「不完全」と同じに描かない。
    row.append(
      cell(archive.waczComplete === null ? "—" : archive.waczComplete ? "完全" : "欠けあり"),
    );
    const check = document.createElement("td");
    const verdictCell = document.createElement("td");
    let open = false;
    check.append(
      button("検証", () => {
        const next = row.nextElementSibling;
        if (open && next?.classList.contains("detail")) next.remove();
        else void validate(archive, row, verdictCell);
        open = !open;
      }),
    );
    row.append(verdictCell);
    row.append(check);
    row.append(hashCell(waczHash(archive.id), "開く"));
    row.append(
      linkCell(
        `${settings.replayOrigin}/?source=/wacz/${encodeURIComponent(archive.objectKey)}`,
        "replay ↗",
      ),
    );
    body.append(row);
  }
};

// ── 目録 ───────────────────────────────────────────────────────────
const drawScripts = (scripts) => {
  const body = $("scripts");
  body.replaceChildren();
  $("scripts-empty").hidden = scripts.length > 0;
  for (const script of scripts) {
    const row = document.createElement("tr");
    row.append(cell(script.id));
    row.append(cell(`v${String(script.version)}`, "mono"));
    row.append(cell(script.phase));
    row.append(cell(`${script.sha256.slice(0, 12)}…`, "mono"));
    body.append(row);
  }
};

// ── 中身（WACZ の 1 本）────────────────────────────────────────────
/**
 * waxlens と同じ入力から同じ木を組む（検証の報告の `entries`）。中身は `/wacz/` の口に
 * **窓で**頼む —— 行の窓（200 行ずつ）、1 行を丸ごと（fields は daemon が割る）、
 * レコードの一覧（200 件ずつ）、1 レコード。窓の位置はこの画面が持つ。
 */
const WINDOW = 200;

const wacz = {
  archive: undefined,
  report: undefined,
  rows: [],
  selected: undefined,
  /** 一覧のレコード（読んだ窓の合計）と、種別の絞り。 */
  records: undefined,
  hash: undefined,
};

const remember = (path, n) => {
  wacz.hash = waczHash(wacz.archive.id, path, n);
  // **hashchange を起こさずに** URL だけ替える（起こすと route が検証をやり直す）。
  history.replaceState(null, "", wacz.hash);
};

const drawWaczBar = (status) => {
  const bar = $("wacz-bar");
  bar.replaceChildren();
  const archive = wacz.archive;
  bar.append(
    tag("span", archive.sourceUrl, "mono"),
    tag("span", new Date(archive.capturedAt).toLocaleString("ja-JP"), "mono muted"),
  );
  if (status !== undefined) {
    bar.append(tag("span", status, "muted"));
    return;
  }
  const s = wacz.report.summary;
  const v = verdict(s);
  bar.append(
    tag("span", `合格 ${String(s.passed)}`, "mono state ok"),
    tag("span", v.text, `mono state ${v.kind}`),
    tag(
      "span",
      `${judgedUnder(wacz.report).join(" · ")} · ${String(s.durationMs)} ms`,
      "mono muted",
    ),
  );
};

const drawTree = () => {
  const pre = $("wacz-tree");
  pre.replaceChildren();
  for (const row of wacz.rows) {
    const line = tag("span", row.connector + row.name, "trow");
    if (row.path === wacz.selected) line.classList.add("sel");
    const entry = row.entry;
    if (entry !== undefined && entry.present && entry.uncompressedSize !== undefined) {
      line.append(tag("span", `  ${formatBytes(entry.uncompressedSize)}`, "sz"));
    }
    const mark = entryMarker(entry);
    if (mark.glyph !== "") line.append(tag("span", `  ${mark.glyph}`, `mark ${mark.tone}`));
    if (entry !== undefined && entry.present) {
      line.classList.add("file");
      line.onclick = () => void selectEntry(row.path);
    }
    pre.append(line, document.createTextNode("\n"));
  }
};

/** この entry を指す指摘。`ReportEntry.issues` は rule と severity しか持たないので、報告側を突き合わせる。 */
const issuesOf = (path) => wacz.report.issues.filter((i) => i.location?.entry === path);

const drawHead = (entry, extra) => {
  const head = $("wacz-head");
  head.replaceChildren(
    tag("b", entry.path),
    tag("span", entry.uncompressedSize === undefined ? "" : formatBytes(entry.uncompressedSize)),
    tag("span", codecName(entry.compressionMethod)),
    tag("span", expectedLabel(entry.expectedBy, entry.expectedSection)),
  );
  for (const text of extra) head.append(tag("span", text));
  const issues = issuesOf(entry.path);
  head.append(tag("span", issues.length === 0 ? "指摘なし" : `指摘 ${String(issues.length)}`, issues.length === 0 ? "muted" : "state warn"));
  for (const issue of issues) {
    const line = document.createElement("div");
    line.className = "issue";
    line.append(
      tag("span", issue.severity, `state ${severityKind(issue.severity)}`),
      tag("span", issue.rule, "mono"),
      tag("span", issue.message),
    );
    head.append(line);
  }
};

/** 面に入る。archive が変われば検証し直し、木を組み直す。同じなら選び直すだけ。 */
const openWacz = async ({ archiveId, path, n }) => {
  const archive = archives.find((a) => a.id === archiveId);
  if (archive === undefined) {
    trouble(`archive ${archiveId} は見えません`);
    location.hash = "archives";
    return;
  }
  show("wacz");
  $("tab-wacz").hidden = false;
  if (wacz.archive?.id !== archiveId) {
    wacz.archive = archive;
    wacz.report = undefined;
    wacz.rows = [];
    wacz.selected = undefined;
    wacz.records = undefined;
    wacz.hash = waczHash(archiveId);
    $("wacz-tree").replaceChildren();
    $("wacz-head").replaceChildren();
    $("wacz-content").replaceChildren();
    drawWaczBar("検証しています…");
    try {
      wacz.report = await post(`/wacz/${enc(archiveId)}/validate`);
    } catch (err) {
      drawWaczBar(failedText(err));
      return;
    }
    drawWaczBar();
    wacz.rows = flattenTree(buildTree(wacz.report.entries));
    drawTree();
  }
  if (path !== undefined) await selectEntry(path, n);
};

const selectEntry = async (path, n) => {
  const entry = wacz.report.entries.find((e) => e.path === path);
  if (entry === undefined || !entry.present) return;
  wacz.selected = path;
  wacz.records = undefined;
  remember(path, n);
  drawTree();
  $("wacz-content").replaceChildren();
  try {
    if (isWarc(path)) {
      drawHead(entry, ["レコードの一覧"]);
      await loadRecords(path, 0);
    } else {
      drawHead(entry, []);
      await loadLines(path, 0);
      if (n !== undefined) await openLine(path, n);
    }
  } catch (err) {
    $("wacz-content").append(tag("p", failedText(err), "state bad"));
  }
};

/** 行の窓を足す。`next` があれば「続きを読む」を残す。 */
const loadLines = async (path, from) => {
  const id = wacz.archive.id;
  const page = await api(`/wacz/${enc(id)}/lines?path=${enc(path)}&from=${String(from)}&count=${String(WINDOW)}`);
  if (wacz.selected !== path) return; // 読んでいる間に別の entry へ移った
  const content = $("wacz-content");
  let list = $("wacz-lines");
  if (list === null) {
    list = document.createElement("ol");
    list.id = "wacz-lines";
    list.className = "vlines";
    content.append(list);
    if (page.gunzipped) $("wacz-head").append(tag("span", "gzip 展開", "muted"));
  }
  for (const line of page.lines) {
    const li = document.createElement("li");
    li.dataset.n = String(line.n);
    li.append(tag("span", String(line.n + 1), "n"), tag("span", lineLabel(line), line.binary ? "t muted" : "t"));
    li.onclick = () => void openLine(path, line.n);
    list.append(li);
  }
  $("wacz-more")?.remove();
  if (page.next !== null) {
    const more = button(`続きを読む（${String(page.next + 1)} 行目から ${String(WINDOW)} 行）`, () => {
      more.remove();
      void loadLines(path, page.next).catch((err) => content.append(tag("p", failedText(err), "state bad")));
    });
    more.id = "wacz-more";
    list.after(more);
  }
};

/** 1 行を丸ごと。fields は daemon が割ったもの —— こちらが付けた名前と、データが名乗った名前を色で分ける。 */
const openLine = async (path, n) => {
  const id = wacz.archive.id;
  for (const li of document.querySelectorAll("#wacz-lines li")) li.classList.toggle("sel", li.dataset.n === String(n));
  remember(path, n);
  const line = await api(`/wacz/${enc(id)}/line?path=${enc(path)}&n=${String(n)}`);
  if (wacz.selected !== path) return;
  const panel = document.createElement("div");
  panel.id = "wacz-line";
  panel.className = "vpart";
  const note = line.cut ? " · 4 MiB で切った" : line.binary ? " · binary" : "";
  panel.append(tag("div", `${String(n + 1)} 行目 · ${formatBytes(line.bytes)}${note}`, "vtag"));
  if (line.fields.length === 0) {
    panel.append(tag("pre", line.binary ? `(binary · ${formatBytes(line.bytes)})` : line.text, "vraw"));
  } else {
    const grid = document.createElement("div");
    grid.className = "vfields";
    for (const field of line.fields) {
      grid.append(tag("span", field.label, field.fromJson ? "k data" : "k"), tag("span", field.value, "v"));
    }
    panel.append(grid);
    const opener = recordOpener(line.fields);
    if (opener !== undefined) {
      panel.append(
        button(`このレコードを開く（${opener.path} の ${String(opener.offset)} から ${formatBytes(opener.length)}）`, () => {
          void openRecord(opener.path, opener.offset, opener.length).catch((err) =>
            panel.append(tag("p", failedText(err), "state bad")),
          );
        }),
      );
    }
  }
  const old = $("wacz-line");
  if (old !== null) old.replaceWith(panel);
  else ($("wacz-more") ?? $("wacz-lines")).after(panel);
  $("wacz-record")?.remove();
};

/** レコードの一覧の窓を足し、種別で絞れるようにする。 */
const loadRecords = async (path, from) => {
  const id = wacz.archive.id;
  const page = await api(`/wacz/${enc(id)}/records?path=${enc(path)}&from=${String(from)}&count=${String(WINDOW)}`);
  if (wacz.selected !== path) return;
  const prev = wacz.records ?? { rows: [], filter: undefined };
  wacz.records = { path, rows: [...prev.rows, ...page.records], next: page.next, total: page.total, filter: prev.filter };
  drawRecords();
};

const drawRecords = () => {
  const { rows, next, total, filter, path } = wacz.records;
  const content = $("wacz-content");
  content.replaceChildren();

  // 種別の絞り。数は読んだ窓の中の数（全体の数は total）。
  const counts = new Map();
  for (const row of rows) counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
  const chips = document.createElement("div");
  chips.className = "chips";
  const chip = (label, value) => {
    const b = button(label, () => {
      wacz.records.filter = value;
      drawRecords();
    });
    b.className = "chip" + (filter === value ? " on" : "");
    return b;
  };
  chips.append(chip(`すべて ${String(rows.length)}${next === null ? "" : `+`} / ${String(total)}`, undefined));
  for (const [type, count] of counts) chips.append(chip(`${typeName(type)} ${String(count)}`, type));
  chips.append(tag("span", "▪ 索引が指す · ▫ 索引に無い", "muted mono"));
  content.append(chips);

  const table = document.createElement("table");
  table.className = "vrecords";
  const head = document.createElement("tr");
  for (const text of ["", "種別", "状態", "content-type", "URI"]) head.append(tag("th", text));
  table.append(head);
  for (const row of rows) {
    if (filter !== undefined && row.type !== filter) continue;
    const cells = recordCells(row);
    const tr = document.createElement("tr");
    tr.append(
      cell(cells.indexed ? "▪" : "▫", "mono mark"),
      cell(cells.type),
      cell(cells.status, "mono num"),
      cell(cells.mime, "mono"),
      cell(cells.uri, "mono wide"),
    );
    tr.className = "head";
    tr.onclick = () => {
      for (const other of table.querySelectorAll("tr")) other.classList.toggle("sel", other === tr);
      void openRecord(path, row.offset, row.length).catch((err) => content.append(tag("p", failedText(err), "state bad")));
    };
    table.append(tr);
  }
  content.append(table);
  if (next !== null) {
    content.append(
      button(`続きを読む（${String(next + 1)} 件目から ${String(WINDOW)} 件・全 ${String(total)} 件）`, () => {
        void loadRecords(path, next).catch((err) => content.append(tag("p", failedText(err), "state bad")));
      }),
    );
  }
};

/** 1 レコード。見出しは文字、本文は text / raster の画像 / 大きさだけ。 */
const openRecord = async (path, offset, length) => {
  const id = wacz.archive.id;
  const query = `path=${enc(path)}&offset=${String(offset)}&length=${String(length)}`;
  const record = await api(`/wacz/${enc(id)}/record?${query}`);
  const panel = document.createElement("div");
  panel.id = "wacz-record";
  panel.className = "vpart";
  panel.append(tag("div", `レコード · ${path} の ${String(offset)} から ${formatBytes(length)}`, "vtag"));
  panel.append(tag("pre", record.warc.map((h) => `${h.name}: ${h.value}`).join("\n"), "vraw"));
  if (record.http !== undefined) {
    panel.append(
      tag("pre", [record.http.status, ...record.http.headers.map((h) => `${h.name}: ${h.value}`)].join("\n"), "vraw"),
    );
  }
  const body = record.body;
  if (body.kind === "text") {
    panel.append(tag("pre", body.content, "vraw body"));
    if (body.truncated) panel.append(tag("span", bodyLabel(body), "muted"));
  } else if (body.kind === "image") {
    // raster だけ。daemon が 415 で断るものはここに来ない。src は GET なので、署名は毎回サーバがもらう。
    const img = document.createElement("img");
    img.src = `/wacz/${enc(id)}/record/body?${query}`;
    img.alt = bodyLabel(body);
    img.className = "vimg";
    panel.append(img, tag("span", bodyLabel(body), "muted mono"));
  } else {
    panel.append(tag("span", bodyLabel(body), "muted mono"));
  }
  const old = $("wacz-record");
  if (old !== null) old.replaceWith(panel);
  else $("wacz-content").append(panel);
  panel.scrollIntoView({ block: "nearest" });
};

// ── 面の切り替え ───────────────────────────────────────────────────
const FACES = ["crawls", "start", "archives", "scripts", "wacz"];

const show = (face) => {
  for (const b of document.querySelectorAll("#tabs button")) {
    b.classList.toggle("on", b.dataset.face === face);
  }
  for (const name of FACES) $(`face-${name}`).hidden = name !== face;
  document.body.dataset.face = face; // 起こす面だけ、CSS が窓の高さに収める
};

/** URL が面を決める。`#wacz/…` は中身の面、それ以外は 3 つの面のどれか。 */
const route = () => {
  const target = parseWaczHash(location.hash);
  if (target !== undefined) {
    void openWacz(target);
    return;
  }
  const face = location.hash.slice(1);
  show(FACES.includes(face) && face !== "wacz" ? face : "crawls");
};

for (const b of document.querySelectorAll("#tabs button")) {
  b.onclick = () => {
    location.hash = b.dataset.face === "wacz" ? (wacz.hash ?? "archives") : b.dataset.face;
  };
}
window.addEventListener("hashchange", route);

// ── 読み込みの間隔 ─────────────────────────────────────────────────
/**
 * **走っている間だけ速く引く。** 1 往復 1 クエリなので、写しを持たなくても live に
 * 見える。走っていなければ 30 秒 —— 動いていないときは黙る。
 */
const pace = () => (crawls.some((c) => c.state === "running") ? 2_000 : 30_000);

/** 次の引きの予約。**1 つだけ** —— 起こした直後に引き直しても、引く輪が 2 本にならない。 */
let timer;

const refresh = async () => {
  try {
    const [c, a, s] = await Promise.all([
      api("/api/crawls"),
      api("/api/archives"),
      api("/api/scripts"),
    ]);
    crawls = c.crawls;
    archives = a.archives;
    drawCrawls();
    refreshOpened();
    drawArchives();
    drawScripts(s.scripts);
    drawPicks(s.scripts);
    trouble(undefined);
    $("pulse").textContent =
      `クロール ${String(crawls.length)} 本 ／ アーカイブ ${String(archives.length)} 本 ` +
      `（${new Date().toLocaleTimeString("ja-JP")} 現在、${String(pace() / 1000)} 秒ごと）`;
  } catch (err) {
    trouble(failedText(err));
    $("pulse").textContent = "取りに行けませんでした（上の表は最後に描けたもの）";
  }
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), pace());
};

const start = async () => {
  try {
    settings = await (await fetch("/healthz")).json();
    $("who").textContent =
      `${settings.subject} (${settings.organizations.join(", ")}) として見ています` +
      " —— 開発用の名乗りです";
  } catch {
    $("who").textContent = "この画面自身に届きません";
  }
  syncStart(); // 上限を知ってから、欄の下の行を出す
  await refresh();
  route();
};

void start();
