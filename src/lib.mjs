/**
 * サーバが使う、外と話さない部分。**ここだけは試験から直接呼べる。**
 *
 * http の口（`server.mjs`）に混ぜないのは、混ぜた部分が「動かしてみないと
 * 分からない」側に入ってしまうため。path の組み立てと content-type と門の判定は、
 * 動かさずに確かめられる。
 */
import { normalize, resolve, sep } from "node:path";

/**
 * 環境変数の読み口。**空文字は「無い」と同じに扱う**（POSIX の `${VAR:-word}` 側）。
 *
 * crawler の他の repo と同じ意味に揃えてある —— `??` は未設定のときしか既定値に
 * しないので、`NAME=` と書いた人が、名前の出ないエラーを遠くで踏む。
 */
export const optional = (name, fallback) => {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
};

/** 配る content-type。**知らない拡張子は配らない**（undefined を返す）。 */
const TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".json", "application/json; charset=utf-8"],
]);

export const contentType = (path) => {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? undefined : TYPES.get(path.slice(dot));
};

/**
 * URL から、配ってよい絶対 path を作る。
 *
 * **外へ出る要求は、拒むのではなく根の中へ畳まれる。** `normalize` が `..` を根で
 * 食べるので、`/../etc/passwd` は `<root>/etc/passwd` になり、読めずに 404 で終わる。
 * 復号してから正規化するので、`%2e%2e` のような符号化の違いもここで消える ——
 * 生の文字列で `..` を探す形は、1 つ見落とした時点で破れる。
 *
 * 最後の `startsWith` は二重の守り。**いまの組み立てでは到達しない**（`.` を前に
 * 付けて根から解くので、必ず根の中に入る）。残してあるのは、この組み立てが
 * 「簡単にできる」と言って書き換えられる類のものだから。
 */
export const safePath = (root, url) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return undefined; // 壊れた符号化。開かない。
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const full = resolve(root, `.${normalize(pathname)}`);
  return full === root || full.startsWith(root + sep) ? full : undefined;
};

/**
 * Host が、dashboard の口か。**全部の口で見る** —— DNS rebinding（よそのドメインの名前を
 * 127.0.0.1 に向け直す手）で、別のサイトのページが dashboard を自分のオリジンとして読むのを
 * 止める。書く口だけを守っても、読む口から一覧が漏れる。
 */
export const hostAllowed = (host, port) =>
  host === `127.0.0.1:${String(port)}` || host === `localhost:${String(port)}`;

/**
 * 書く口の門。dashboard のページからの JSON だけを通す。断るなら `{ status, error }` を返す。
 *
 * Origin を見るのは CSRF（別のサイトのページに、利用者のブラウザから POST させる手）のため。
 * JSON に限るのは、form が preflight なしで送れる形（text/plain など）を締め出すため。
 * Chrome の Private Network Access には頼らない —— 版で振る舞いが変わる。
 */
export const writeRefusal = (headers, port) => {
  if (!hostAllowed(headers.host, port)) return { status: 403, error: "dashboard の Host ではない" };
  if (headers.origin !== `http://${String(headers.host)}`) {
    return { status: 403, error: "dashboard のページからの要求ではない" };
  }
  const type = (headers["content-type"] ?? "").split(";")[0].trim();
  if (type !== "application/json") return { status: 415, error: "JSON だけを受ける" };
  return undefined;
};

/**
 * 書く口が受ける本文の上限。起点の URL と、その場で書いた JS が入る。**capture-ledger の
 * `POST /api/crawls` の上限（`src/api/crawls.ts` の `CRAWL_BODY_LIMIT`）と同じ 1 MiB** —— 片方だけを
 * 変えると、dashboard が通すのに台帳が 413、の形になる。dashboard は `/healthz` の `writeLimit` で知り、
 * 送る前に止める。超えたら 413（台帳まで行かない）。
 */
export const WRITE_LIMIT = 1024 * 1024;

export class TooLarge extends Error {}

/**
 * 本文を読む。上限を超えたら**溜めるのをやめ**、読み切ってから TooLarge で断る ——
 * 途中で接続を切ると、413 を書く相手が居なくなる。
 */
export const readBody = (request, limit) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > limit) reject(new TooLarge(`本文が ${String(limit)} バイトを超えた`));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
