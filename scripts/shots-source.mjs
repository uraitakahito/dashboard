/**
 * docs の「画面」の絵が古くなったかを測る物差し。撮る側（`docs-site/scripts/docs-shots.mjs`）と
 * 見張る側（`scripts/check-doc-refs.mjs` の規則 7）が、同じこの関数を使う —— 2 か所に書くと、片方だけが
 * 変わった日に、撮り直しても緑にならない（または、古いのに緑になる）。
 *
 * 見るのは、絵の中身を決めるファイル: 画面（`public/`）・代役（`sandbox/`）・撮る道具。git が追跡する
 * 物だけを、path の順に読む（作業中の、追跡していないファイルは数えない）。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 絵の中身を決めるファイル（repo の根からの path）。 */
export const SHOT_SOURCES = ["public", "sandbox", "docs-site/scripts/docs-shots.mjs"];

/** `SHOT_SOURCES` の中身の sha256。ファイルごとの sha256 を、path と並べてもう 1 度まとめる。 */
export const shotsSource = (root) => {
  const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--", ...SHOT_SOURCES], {
    encoding: "utf8",
  })
    .split("\0")
    .filter((file) => file !== "")
    .sort();
  const all = createHash("sha256");
  for (const file of files) {
    const one = createHash("sha256").update(readFileSync(join(root, file))).digest("hex");
    all.update(`${file}\0${one}\n`);
  }
  return all.digest("hex");
};
