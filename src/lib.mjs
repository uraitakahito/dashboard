/**
 * サーバが使う、外と話さない部分。**ここだけは試験から直接呼べる。**
 *
 * http の口（`server.mjs`）に混ぜないのは、混ぜた部分が「動かしてみないと
 * 分からない」側に入ってしまうため。path の組み立てと content-type は、
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
