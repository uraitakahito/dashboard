/**
 * 画面。**素の JS**（bundler も framework も通さない）。
 *
 * 読むのは台帳の口だけ。ここで畳むのは「どの面を出すか」と「どう描くか」で、
 * 何が起きたかは全部向こうが知っている。
 */
import { stateOf, took } from "/format.js";

const $ = (id) => document.getElementById(id);

/** `/healthz` が配る、この配備の事実。深いリンクの行き先はここから来る。 */
let settings = {};

const api = async (path) => {
  const res = await fetch(path);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `${path} → ${String(res.status)}`);
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

const cell = (text, className) => {
  const td = document.createElement("td");
  td.textContent = text;
  if (className !== undefined) td.className = className;
  return td;
};

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
    td.textContent = err instanceof Error ? err.message : String(err);
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

// ── アーカイブ ─────────────────────────────────────────────────────
const drawArchives = (archives) => {
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

// ── 面の切り替え ───────────────────────────────────────────────────
const show = (face) => {
  for (const button of document.querySelectorAll("#tabs button")) {
    button.classList.toggle("on", button.dataset.face === face);
  }
  for (const name of ["crawls", "archives", "scripts"]) {
    $(`face-${name}`).hidden = name !== face;
  }
  location.hash = face;
};

for (const button of document.querySelectorAll("#tabs button")) {
  button.onclick = () => {
    show(button.dataset.face);
  };
}

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
    drawCrawls();
    drawArchives(a.archives);
    drawScripts(s.scripts);
    trouble(undefined);
    $("pulse").textContent =
      `クロール ${String(crawls.length)} 本 ／ アーカイブ ${String(a.archives.length)} 本 ` +
      `（${new Date().toLocaleTimeString("ja-JP")} 現在、${String(pace() / 1000)} 秒ごと）`;
  } catch (err) {
    trouble(err instanceof Error ? err.message : String(err));
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
  show(location.hash.slice(1) || "crawls");
  await refresh();
};

void start();
