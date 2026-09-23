/**
 * 中身の面の純関数。木の罫線は waxlens（`render/tree.ts`）と同じ入力・同じ期待。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bodyLabel,
  buildTree,
  entryMarker,
  expectedLabel,
  flattenTree,
  formatBytes,
  isWarc,
  lineLabel,
  parseWaczHash,
  recordCells,
  recordOpener,
  waczHash,
} from "../public/wacz-view.js";

const entry = (path, over = {}) => ({ path, present: true, expectedBy: [], issues: [], ...over });

test("flat な path を §5.1 の木に組み、罫線を付ける（waxlens と同じ期待）", () => {
  const rows = flattenTree(
    buildTree([entry("archive/data.warc.gz"), entry("datapackage.json"), entry("pages/pages.jsonl")]),
  );
  assert.deepEqual(
    rows.map((r) => r.connector + r.name),
    ["├── archive", "│   └── data.warc.gz", "├── datapackage.json", "└── pages", "    └── pages.jsonl"],
  );
});

test("中間のディレクトリは entry を持たず、葉だけが持つ", () => {
  const rows = flattenTree(buildTree([entry("archive/data.warc.gz")]));
  assert.equal(rows.find((r) => r.name === "archive")?.isDir, true);
  assert.equal(rows.find((r) => r.name === "archive")?.entry, undefined);
  assert.equal(rows.find((r) => r.name === "data.warc.gz")?.entry?.path, "archive/data.warc.gz");
});

test("印: 無い entry は理由つき、指摘は最悪の severity で", () => {
  assert.deepEqual(entryMarker(entry("x", { present: false, expectedBy: ["wacz-spec", "datapackage"] })), {
    glyph: "(無い — §5.2 が要求)",
    tone: "error",
  });
  assert.equal(entryMarker(entry("x", { issues: [{ severity: "warning" }, { severity: "error" }] })).glyph, "✗");
  assert.equal(entryMarker(entry("x", { issues: [{ severity: "info" }] })).glyph, "");
  assert.equal(entryMarker(undefined).glyph, "");
});

test("大きさは 1024 で刻む", () => {
  assert.equal(formatBytes(938), "938 B");
  assert.equal(formatBytes(404697), "395.2 KiB");
  assert.equal(formatBytes(6338608), "6.0 MiB");
});

test("なぜ要るかは、両方なら両方言う", () => {
  assert.equal(expectedLabel([], undefined), "—");
  assert.equal(expectedLabel(["datapackage"], undefined), "datapackage が宣言");
  assert.equal(expectedLabel(["datapackage", "wacz-spec"], "5.2.1"), "datapackage が宣言、§5.2.1 が要求");
});

test("行の言い方: 切れた行は印と本来の大きさ、binary は大きさだけ", () => {
  assert.equal(lineLabel({ text: "abc", cut: false, binary: false, bytes: 3 }), "abc");
  assert.equal(
    lineLabel({ text: "head", cut: true, binary: false, bytes: 404696 }),
    "head …（395.2 KiB。一覧は 2 KiB まで）",
  );
  assert.equal(lineLabel({ text: "", cut: false, binary: true, bytes: 9930 }), "(binary · 9.7 KiB)");
});

test("レコードの列: 種別は日本語、無いものは空", () => {
  assert.deepEqual(
    recordCells({ type: "response", status: 200, mime: "image/jpeg", uri: "https://x/a.jpg", indexed: true }),
    { type: "応答", status: "200", mime: "image/jpeg", uri: "https://x/a.jpg", indexed: true },
  );
  assert.deepEqual(
    recordCells({ type: "metadata", contentType: "application/warc-fields", uri: "https://x/", indexed: false }),
    { type: "記録", status: "", mime: "application/warc-fields", uri: "https://x/", indexed: false },
  );
  assert.equal(recordCells({ type: "revisit", indexed: false }).type, "revisit");
});

test("本文の言い方", () => {
  assert.equal(bodyLabel({ kind: "image", mime: "image/png", byteLength: 2048 }), "image/png · 2.0 KiB");
  assert.equal(bodyLabel({ kind: "binary", byteLength: 10 }), "(binary · 10 B)");
  assert.equal(bodyLabel({ kind: "text", content: "x", truncated: true }), "…（64 KiB で切った）");
});

test("索引の行の fields から、開くレコードの位置を取る", () => {
  const fields = [
    { label: "key", value: "k", fromJson: false },
    { label: "offset", value: "2176252", fromJson: true },
    { label: "length", value: "10791", fromJson: true },
    { label: "filename", value: "data.warc.gz", fromJson: true },
  ];
  assert.deepEqual(recordOpener(fields), { path: "archive/data.warc.gz", offset: 2176252, length: 10791 });
  assert.equal(recordOpener(fields.filter((f) => f.label !== "filename")), undefined);
  assert.equal(recordOpener([{ label: "line", value: "plain", fromJson: false }]), undefined);
});

test("面の URL は行まで指せて、読み戻せる", () => {
  const hash = waczHash("3a34dd38-1f05", "indexes/index.cdxj", 66);
  assert.equal(hash, "#wacz/3a34dd38-1f05/indexes%2Findex.cdxj:66");
  assert.deepEqual(parseWaczHash(hash), { archiveId: "3a34dd38-1f05", path: "indexes/index.cdxj", n: 66 });
  assert.deepEqual(parseWaczHash("#wacz/abc"), { archiveId: "abc", path: undefined, n: undefined });
  assert.equal(parseWaczHash("#archives"), undefined);
  assert.equal(isWarc("archive/data.warc.gz"), true);
  assert.equal(isWarc("indexes/index.cdxj"), false);
});
