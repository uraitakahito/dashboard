/**
 * 外と話さない部分の試験。
 *
 * **ここで見るのは「配ってよい path か」「知っている形式か」「門が通すか」だけ。** 中継も
 * 名乗りも http の口に在り、あれは動かさないと確かめられない（反証は手で当てる）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { contentType, hostAllowed, optional, safePath, writeRefusal } from "../src/lib.mjs";

const ROOT = resolve("/tmp/public");

test("空文字は「無い」と同じ —— 既定値に落ちる", () => {
  process.env.DASHBOARD_TEST_PROBE = "";
  assert.equal(optional("DASHBOARD_TEST_PROBE", "既定"), "既定");
  process.env.DASHBOARD_TEST_PROBE = "値";
  assert.equal(optional("DASHBOARD_TEST_PROBE", "既定"), "値");
  delete process.env.DASHBOARD_TEST_PROBE;
  assert.equal(optional("DASHBOARD_TEST_PROBE", "既定"), "既定");
});

test("ディレクトリの要求は index.html になる", () => {
  assert.equal(safePath(ROOT, "/"), resolve(ROOT, "index.html"));
});

test("根の外へ出ようとする path は、根の中へ畳まれる", () => {
  // **undefined にはならない。** `normalize` が `..` を根で食べるので、
  // 出来上がるのは根の中の（たいてい存在しない）path になり、読めずに 404 になる。
  // 「外に出られない」ことだけが約束で、「拒む」ことは約束していない。
  assert.equal(safePath(ROOT, "/../etc/passwd"), resolve(ROOT, "etc/passwd"));
  assert.equal(safePath(ROOT, "/a/../../etc/passwd"), resolve(ROOT, "etc/passwd"));
});

test("符号化された `..` も同じに畳まれる —— 文字列で探す形では破れる", () => {
  // `%2e%2e` は decodeURIComponent の後に `..` になる。**復号してから**正規化するので、
  // 符号化の違いはここで消える。生の文字列で `..` を探す形は、1 つ見落とすと破れる。
  assert.equal(safePath(ROOT, "/%2e%2e/%2e%2e/etc/passwd"), resolve(ROOT, "etc/passwd"));
});

test("壊れた符号化は開かない", () => {
  assert.equal(safePath(ROOT, "/%"), undefined);
});

test("query は path に混ぜない", () => {
  assert.equal(safePath(ROOT, "/app.js?v=2"), resolve(ROOT, "app.js"));
});

test("知らない拡張子は配らない —— 拡張子が無いものも", () => {
  assert.equal(contentType("/x/app.js"), "text/javascript; charset=utf-8");
  assert.equal(contentType("/x/.env"), undefined);
  assert.equal(contentType("/x/Makefile"), undefined);
});

test("Host はこの画面の口だけを通す（127.0.0.1 と localhost）", () => {
  assert.equal(hostAllowed("127.0.0.1:7080", 7080), true);
  assert.equal(hostAllowed("localhost:7080", 7080), true);
  // DNS rebinding: よその名前が 127.0.0.1 を指していても、Host には名前のほうが載る
  assert.equal(hostAllowed("evil.example:7080", 7080), false);
  assert.equal(hostAllowed("127.0.0.1:7081", 7080), false);
  assert.equal(hostAllowed("127.0.0.1", 7080), false);
  assert.equal(hostAllowed(undefined, 7080), false);
});

/** この画面のページが fetch で送る要求の頭（同じオリジン・JSON）。 */
const fromThisPage = {
  host: "127.0.0.1:7080",
  origin: "http://127.0.0.1:7080",
  "content-type": "application/json",
};

test("書く口は、この画面のページからの JSON を通す", () => {
  assert.equal(writeRefusal(fromThisPage, 7080), undefined);
  assert.equal(writeRefusal({ ...fromThisPage, "content-type": "application/json; charset=utf-8" }, 7080), undefined);
  assert.equal(
    writeRefusal({ host: "localhost:7080", origin: "http://localhost:7080", "content-type": "application/json" }, 7080),
    undefined,
  );
});

test("書く口は、ほかのオリジン・Origin の無い要求・JSON でない本文を断る", () => {
  assert.equal(writeRefusal({ ...fromThisPage, origin: "https://evil.example" }, 7080)?.status, 403);
  // curl や別の道具は Origin を付けない。書く口はこの画面のページのためだけに在る
  assert.equal(writeRefusal({ host: fromThisPage.host, "content-type": "application/json" }, 7080)?.status, 403);
  // 同じ 127.0.0.1 でも、口が違えば別のオリジン
  assert.equal(writeRefusal({ ...fromThisPage, origin: "http://127.0.0.1:7081" }, 7080)?.status, 403);
  // form が preflight なしで送れる形。JSON らしい中身でも、content-type で断る
  assert.equal(writeRefusal({ ...fromThisPage, "content-type": "text/plain" }, 7080)?.status, 415);
  assert.equal(writeRefusal({ ...fromThisPage, "content-type": undefined }, 7080)?.status, 415);
  assert.equal(writeRefusal({ ...fromThisPage, host: "evil.example:7080", origin: "http://evil.example:7080" }, 7080)?.status, 403);
});
