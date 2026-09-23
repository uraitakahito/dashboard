/**
 * 中身の面の純関数。**ブラウザが読むのと同じファイル**を `node --test` が読む（写しが腐らない）。
 *
 * 木の組み方と罫線は waxlens（wacz-validator の tui、`render/tree.ts`）と同じ入力・同じ
 * 出力。試験入力も向こうと同じものを置いてある。1 行を field に割るのは daemon の
 * 仕事（`readLine` の `fields`）で、ここには無い。
 */

// ── 木 ─────────────────────────────────────────────────────────────
/** flat な entries を "/" で分割して木にする（path で決定的に並べる）。 */
export const buildTree = (entries) => {
  const root = { name: "", path: "", isDir: true, children: [] };
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of sorted) {
    const segs = entry.path.split("/").filter(Boolean);
    let cur = root;
    segs.forEach((seg, i) => {
      const isLast = i === segs.length - 1;
      let child = cur.children.find((c) => c.name === seg);
      if (child === undefined) {
        child = { name: seg, path: segs.slice(0, i + 1).join("/"), isDir: !isLast, children: [] };
        if (isLast) child.entry = entry;
        cur.children.push(child);
      }
      cur = child;
    });
  }
  return root;
};

/** 木を描く順（深さ優先）の行に。各行に §5.1 の罫線 prefix を付ける。 */
export const flattenTree = (root) => {
  const rows = [];
  const walk = (node, prefix) => {
    node.children.forEach((child, i) => {
      const last = i === node.children.length - 1;
      rows.push({
        connector: prefix + (last ? "└── " : "├── "),
        name: child.name,
        path: child.path,
        isDir: child.isDir,
        entry: child.entry,
      });
      if (child.isDir) walk(child, prefix + (last ? "    " : "│   "));
    });
  };
  walk(root, "");
  return rows;
};

const worst = (issues) => {
  if (issues.some((i) => i.severity === "error")) return "error";
  if (issues.some((i) => i.severity === "warning")) return "warning";
  return undefined;
};

/** present:false の file が「なぜ期待されるか」を一語で。§5.2 MUST を datapackage より優先。 */
const missingReason = (entry) => {
  if (entry.expectedBy.includes("wacz-spec")) return "§5.2 が要求";
  if (entry.expectedBy.includes("datapackage")) return "datapackage が宣言";
  return "無い";
};

/** file の最悪 severity（と present）からマーカーを決める。dir は none。 */
export const entryMarker = (entry) => {
  if (entry === undefined) return { glyph: "", tone: "none" };
  if (!entry.present) return { glyph: `(無い — ${missingReason(entry)})`, tone: "error" };
  const tone = worst(entry.issues);
  if (tone === "error") return { glyph: "✗", tone: "error" };
  if (tone === "warning") return { glyph: "⚠", tone: "warning" };
  return { glyph: "", tone: "none" };
};

// ── 言い方 ─────────────────────────────────────────────────────────
export const formatBytes = (n) => {
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GiB`;
};

/** ZIP の圧縮方式コード → 表示名（0=STORE / 8=DEFLATE / 他=?）。 */
export const codecName = (method) => (method === 0 ? "STORE" : method === 8 ? "DEFLATE" : "?");

/** expectedBy → 「なぜ要るか」。両方該当も表現する。空（= ZIP に実在するだけ）は "—"。 */
export const expectedLabel = (expectedBy, section) => {
  const parts = [];
  if (expectedBy.includes("datapackage")) parts.push("datapackage が宣言");
  if (expectedBy.includes("wacz-spec")) parts.push(`§${section ?? "5.2"} が要求`);
  return parts.length > 0 ? parts.join("、") : "—";
};

/** WARC はレコードの一覧で開く。 */
export const isWarc = (path) => path.endsWith(".warc.gz") || path.endsWith(".warc");

/** 一覧の 1 行の言い方。binary は大きさだけ、cut は末尾に印。 */
export const lineLabel = (line) => {
  if (line.binary) return `(binary · ${formatBytes(line.bytes)})`;
  return line.cut ? `${line.text} …（${formatBytes(line.bytes)}。一覧は 2 KiB まで）` : line.text;
};

const TYPE_NAMES = { response: "応答", request: "要求", metadata: "記録", warcinfo: "warcinfo" };

/** レコードの種別の言い方。知らない種別はそのまま。 */
export const typeName = (type) => TYPE_NAMES[type] ?? type;

/** 一覧の 1 レコードの列（種別・状態・content-type・URI）。 */
export const recordCells = (row) => ({
  type: typeName(row.type),
  status: row.status === undefined ? "" : String(row.status),
  mime: row.mime ?? row.contentType ?? "",
  uri: row.uri ?? "",
  indexed: row.indexed,
});

/** 本文の言い方（text は本文そのものなので、ここでは扱わない）。 */
export const bodyLabel = (body) => {
  if (body.kind === "image") return `${body.mime} · ${formatBytes(body.byteLength)}`;
  if (body.kind === "binary") return `(binary${body.mime === undefined ? "" : ` · ${body.mime}`} · ${formatBytes(body.byteLength)})`;
  return body.truncated ? "…（64 KiB で切った）" : "";
};

/**
 * 索引（CDXJ）の 1 行の fields から、開くレコードの位置を取る。
 * `filename` は `archive/` からの相対（WACZ の慣習）。揃っていなければ undefined。
 */
export const recordOpener = (fields) => {
  const value = (label) => fields.find((f) => f.label === label)?.value;
  const filename = value("filename");
  const offset = Number(value("offset"));
  const length = Number(value("length"));
  if (filename === undefined || !Number.isInteger(offset) || !Number.isInteger(length) || length <= 0) return undefined;
  return { path: `archive/${filename}`, offset, length };
};

/** 面の URL。`#wacz/<archiveId>` に、選んだ entry と行を足せる。 */
export const waczHash = (archiveId, path, n) =>
  `#wacz/${encodeURIComponent(archiveId)}` +
  (path === undefined ? "" : `/${encodeURIComponent(path)}`) +
  (n === undefined ? "" : `:${String(n)}`);

/** `#wacz/<archiveId>[/<path>[:<n>]]` を読む。合わなければ undefined。 */
export const parseWaczHash = (hash) => {
  const m = /^#wacz\/([^/]+)(?:\/([^:]+)(?::(\d+))?)?$/.exec(hash);
  if (m === null) return undefined;
  try {
    return {
      archiveId: decodeURIComponent(m[1]),
      path: m[2] === undefined ? undefined : decodeURIComponent(m[2]),
      n: m[3] === undefined ? undefined : Number(m[3]),
    };
  } catch {
    return undefined;
  }
};
