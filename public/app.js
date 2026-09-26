/**
 * 画面。**素の JS**（bundler も framework も通さない）。
 *
 * 読むのは台帳の口と、WACZ の中身へ行く `/wacz/` の口だけ。ここで畳むのは「どの面を
 * 出すか」と「どう描くか」で、何が起きたかは全部向こうが知っている。
 *
 * **撮った中身は他人が書いたもの。** 文字は `textContent`、画像は raster だけを
 * `<img>` で。生の HTML を差し込む API はこのファイルに無い（`check` が見張る）。
 */
import { judgedUnder, severityKind, stateOf, took, verdict } from "/format.js";
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

const runHref = (crawl) =>
  crawl.lastJob === null
    ? undefined
    : `${settings.windmillOrigin}/run/${crawl.lastJob.id}?workspace=${settings.windmillWorkspace}`;

/** 行を開くと、取れなかった URL と理由が出る。**開いたときだけ `:id` を引く。** */
const openDetail = async (crawl, after) => {
  const row = document.createElement("tr");
  row.className = "detail";
  const td = document.createElement("td");
  td.colSpan = 9;
  td.textContent = "読み込み中…";
  row.append(td);
  after.after(row);
  try {
    const one = await api(`/api/crawls/${crawl.crawlId}`);
    const failures = one.failures ?? [];
    td.textContent =
      failures.length === 0
        ? `取れなかったページはありません（種: ${one.seeds.join(", ")}）`
        : failures.map((f) => `${f.url} — ${f.reason ?? "理由なし"}`).join("\n");
    td.style.whiteSpace = "pre-wrap";
  } catch (err) {
    td.textContent = failedText(err);
  }
};

const drawCrawls = () => {
  const body = $("crawls");
  body.replaceChildren();
  $("crawls-empty").hidden = crawls.length > 0;
  for (const crawl of crawls) {
    const state = stateOf(crawl);
    const row = document.createElement("tr");
    row.className = "head";
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
    let open = false;
    row.onclick = (event) => {
      if (event.target instanceof HTMLAnchorElement) return;
      const next = row.nextElementSibling;
      if (open && next?.classList.contains("detail")) next.remove();
      else void openDetail(crawl, row);
      open = !open;
    };
    body.append(row);
  }
};

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
      `${judgedUnder(report).join(" ／ ")} ／ ${String(s.durationMs)} ms` +
        ` ／ WARC ${String(report.stats.warcRecordCount)} レコード` +
        ` ／ ${(report.stats.hosts ?? []).join(", ")}`,
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
const FACES = ["crawls", "archives", "scripts", "wacz"];

const show = (face) => {
  for (const b of document.querySelectorAll("#tabs button")) {
    b.classList.toggle("on", b.dataset.face === face);
  }
  for (const name of FACES) $(`face-${name}`).hidden = name !== face;
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
    drawArchives();
    drawScripts(s.scripts);
    trouble(undefined);
    $("pulse").textContent =
      `クロール ${String(crawls.length)} 本 ／ アーカイブ ${String(archives.length)} 本 ` +
      `（${new Date().toLocaleTimeString("ja-JP")} 現在、${String(pace() / 1000)} 秒ごと）`;
  } catch (err) {
    trouble(failedText(err));
    $("pulse").textContent = "取りに行けませんでした（上の表は最後に描けたもの）";
  }
  setTimeout(() => void refresh(), pace());
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
  await refresh();
  route();
};

void start();
