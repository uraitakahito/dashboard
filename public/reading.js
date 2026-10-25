/**
 * スクリプトの画面（読む所）の部品。**dashboard から切り出してあるのは、ここだけ試験から呼べるようにするため。**
 *
 * ブラウザは `/reading.js` として読み、試験は `node --test` から import する —— 同じファイルを
 * 両方が読むので、写しが腐ることがない。import を持たない（`/format.js` のような根からの path は、
 * node では fs の根になる）。読み込んだときに DOM に触らない。
 *
 * 読む物は 2 種類: スクリプトの 1 版（`GET /api/scripts/:id/versions/:version`）と、受け皿 `__bh` の型
 * （`GET /api/host-types`）。どちらも書いたままの TypeScript で、走った JS（アーカイブの
 * `behaviors/custom.jsonl`）とは行が合わない。
 */

/** 受け皿の型の URL。スクリプトの id は encodeURIComponent してから載せるので `/` を含まず、取り違えない */
export const TYPES_HASH = "#scripts/types/host.d.ts";

const num = (s) => (s === undefined ? undefined : Number(s));

/**
 * 読む物の URL。版を省けば「いま既定で走る版」。`sha` は「このクロールが走らせた物」の sha256 の頭で、
 * クロールの「読む」だけが付ける —— 版の番号は、消して足し直すと別の中身に使い回される。
 * `id` を省けば受け皿の型。
 */
export const readingHash = ({ id, version, sha, line }) =>
  (id === undefined
    ? TYPES_HASH
    : `#scripts/${encodeURIComponent(id)}` +
      (version === undefined ? "" : `@${String(version)}`) +
      (version === undefined || sha === undefined ? "" : `~${sha}`)) +
  (line === undefined ? "" : `:${String(line)}`);

/**
 * `#scripts/<id>[@<版>[~<sha の頭>]][:<行>]` と `#scripts/types/host.d.ts[:<行>]` を読む。
 * 合わなければ undefined。型は `{ line }` だけ（`id` が無い）。
 */
export const parseReading = (hash) => {
  const types = /^#scripts\/types\/host\.d\.ts(?::(\d+))?$/.exec(hash);
  if (types !== null) return { line: num(types[1]) };
  const m = /^#scripts\/([^/@:~]+)(?:@(\d+)(?:~([0-9a-f]{6,64}))?)?(?::(\d+))?$/.exec(hash);
  if (m === null) return undefined;
  try {
    return { id: decodeURIComponent(m[1]), version: num(m[2]), sha: m[3], line: num(m[4]) };
  } catch {
    return undefined; // 壊れた %xx
  }
};

/** 読む物の短い名前（新しいクロールの右の列のタブ）。`autoscroll v2`、型は `host.d.ts`。 */
export const labelOf = ({ id, version }) =>
  id === undefined ? "host.d.ts" : version === undefined ? id : `${id} v${String(version)}`;

/** 行に分ける。最後の改行の後ろの空の 1 行は数えない（wc -l と同じ。autoscroll.ts は 55 行） */
export const linesOf = (source) => {
  const lines = source.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
};

/** 3 桁ずつ区切る（画面のほかの数と同じ）。 */
const count = (n) => n.toLocaleString("en-US");

/**
 * 見出しの下の 1 行の、事実の部分。`behavior · 55 行 · 2,695 バイト · sha256 c9956819ffea… ·
 * 2026-10-14 取り込み`。型は phase を持たないので、その欄が無い。日付は手元の暦（画面のほかの時刻と同じ）。
 */
export const metaOf = (doc) => [
  ...(doc.phase === undefined ? [] : [doc.phase]),
  `${count(linesOf(doc.source).length)} 行`,
  `${count(doc.bytes)} バイト`,
  `sha256 ${doc.sha256.slice(0, 12)}…`,
  `${new Date(doc.createdAt).toLocaleDateString("sv-SE")} 取り込み`,
];

/**
 * 渡す値。**空は「既定のまま」と言う** —— `{}` だけを見せると、値が無いのか、既定がどこに在るのかが
 * 読めない。既定値はスクリプトのコードの中にしか無い（capture-scripts の約束）。
 */
export const optionsText = (options) =>
  Object.keys(options ?? {}).length === 0
    ? "設定 {}（既定のまま。値はコードの中）"
    : `設定 ${JSON.stringify(options)}`;

/**
 * この版と既定の顔ぶれの関係。`defaultVersion` は `GET /api/scripts` がその id に言う版（無ければ
 * undefined）。無効な版は、名指せば走るが、既定では走らない。サイト用のスクリプト（札のある版）が既定で
 * 走るのは、起点のどれかが札のホストにあるときだけ。
 */
export const standingOf = (doc, defaultVersion) => {
  if (doc.enabled === false) return { text: "無効（既定では走らない）", kind: "warn" };
  if (defaultVersion === doc.version) {
    return doc.sites.length === 0
      ? { text: "既定で走る版", kind: "ok" }
      : { text: `起点に ${doc.sites.join("・")} があれば既定で走る版`, kind: "ok" };
  }
  if (defaultVersion === undefined) return { text: "既定には入っていない", kind: "warn" };
  return { text: `既定で走るのは v${String(defaultVersion)}`, kind: "muted" };
};
