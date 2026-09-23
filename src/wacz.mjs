/**
 * WACZ の中身へ行く口。`/wacz/<archiveId>/<op>` を読み、台帳に署名をもらい、daemon に渡す。
 *
 * 6 本とも同じ 2 段 —— **台帳に署名をもらう → daemon に渡す** —— で、署名はこの
 * ファイルの外に出ない。画面が呼ぶのは GET（`<img src>` も GET）で、daemon へは
 * POST に組み替える。`/api/` は台帳の素通しだけに戻した（server.mjs 自身が
 * 「こちらの答えを混ぜない」と書いているので、daemon 行きの口はここに集める）。
 *
 *   POST /wacz/<id>/validate                              → POST /validate
 *   GET  /wacz/<id>/lines?path=&from=&count=              → POST /lines
 *   GET  /wacz/<id>/line?path=&n=                         → POST /line
 *   GET  /wacz/<id>/records?path=&from=&count=            → POST /records
 *   GET  /wacz/<id>/record?path=&offset=&length=          → POST /record
 *   GET  /wacz/<id>/record/body?path=&offset=&length=     → POST /record/body（bytes）
 *
 * ここに在るのは経路の読みと組み替えだけ。**画面のロジックは置かない。**
 */

/** 画面が組み立てた引数が足りない・数でない。400 で返す。 */
export class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.name = "BadRequest";
  }
}

const ROUTE = /^\/wacz\/([^/?]+)\/(validate|lines|line|records|record(?:\/body)?)(?:\?(.*))?$/;

/**
 * `/wacz/<archiveId>/<op>?…` を読む。合わなければ undefined。
 * 数は数に（無ければ undefined、数でなければ NaN —— paramsFor が断る）、path は decode して返す。
 */
export const parseWaczRoute = (url) => {
  const m = ROUTE.exec(url);
  if (m === null) return undefined;
  let archiveId;
  try {
    archiveId = decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
  const q = new URLSearchParams(m[3] ?? "");
  const num = (name) => (q.has(name) ? Number(q.get(name)) : undefined);
  const path = q.get("path");
  return {
    archiveId,
    op: m[2],
    params: {
      path: path === null || path === "" ? undefined : path,
      from: num("from"),
      count: num("count"),
      n: num("n"),
      offset: num("offset"),
      length: num("length"),
    },
  };
};

/**
 * op ごとに daemon へ渡す引数（source を除く）を組む。足りなければ BadRequest。
 * **署名をもらう前に検査する** —— 引数が壊れているのに台帳へ行かない。
 */
export const paramsFor = (op, params) => {
  const need = (name) => {
    const value = params[name];
    if (value === undefined || Number.isNaN(value)) throw new BadRequest(`${name} is required`);
    return value;
  };
  switch (op) {
    case "validate":
      return { locale: "ja" };
    case "lines":
    case "records":
      return { path: need("path"), from: need("from"), count: need("count") };
    case "line":
      return { path: need("path"), n: need("n") };
    case "record":
    case "record/body":
      return { path: need("path"), offset: need("offset"), length: need("length") };
    default:
      throw new BadRequest(`unknown op: ${op}`);
  }
};

/**
 * 署名をもらい、daemon に渡し、答えを返す。**署名はこの関数の外に出ない** ——
 * 応答にもログにも、失敗の文にも載せない（call が URL 入りの例外を投げても伏せる）。
 * 見えない archive なら、台帳の応答（404）をそのまま返す。
 *
 * 順番に意味がある: 先に台帳へ訊くので、**見てよい archive でなければ daemon まで
 * 行かない**。絞るのは認可を持っている側。
 */
export const viaSignedUrl = async ({ toLedger, call }, archiveId) => {
  const signed = await toLedger(`/api/archives/${encodeURIComponent(archiveId)}/url`, "POST");
  if (!signed.ok) return signed;
  const { url: href } = await signed.json();
  try {
    return await call(href);
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    throw new Error(text.replaceAll(href, "(署名付き URL)"));
  }
};
