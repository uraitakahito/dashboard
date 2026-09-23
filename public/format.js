/**
 * 数と状態の描き方。**画面から切り出してあるのは、ここだけ試験から呼べるようにするため。**
 *
 * ブラウザは `/format.js` として読み、試験は `node --test` から import する ——
 * 同じファイルを両方が読むので、写しが腐ることがない。
 */

/**
 * クロールの状態を、**言葉にする**。
 *
 * **`state` だけでは足りない。** 実機の内訳（68 本の時点）:
 *
 *   succeeded / max_depth  41   ← 「成功」だが打ち切り
 *   failed    / failed     22
 *   succeeded / completed   4   ← 本当に全部辿った
 *   succeeded / failed      1   ← 状態と理由が食い違う。**隠さない**
 *
 * 最後の 1 本が肝。`succeeded` を無条件に「成功」と描くと、その行だけが嘘になる。
 * 知らない `stopReason` は、括弧に入れてそのまま見せる。
 */
export const stateOf = (crawl) => {
  if (crawl.state === "running") return { text: "走行中", kind: "run" };
  if (crawl.state !== "succeeded") return { text: "失敗", kind: "bad" };
  if (crawl.stopReason === "completed") return { text: "完走", kind: "ok" };
  if (crawl.stopReason === "max_depth") return { text: "打ち切り (深さ)", kind: "warn" };
  if (crawl.stopReason === "max_pages") return { text: "打ち切り (枚数)", kind: "warn" };
  return { text: `成功 (${String(crawl.stopReason)})`, kind: "warn" };
};

/**
 * かかった時間。**走行中は「いままで」を出す** —— `finishedAt` が null なのは
 * 「まだ終わっていない」であって「時間が無い」ではない。
 *
 * @param {{ startedAt: string, finishedAt: string | null }} crawl
 * @param {number} now 試験が時刻を固定するために渡す。既定はいま。
 */
export const took = (crawl, now = Date.now()) => {
  const from = new Date(crawl.startedAt).getTime();
  const to = crawl.finishedAt === null ? now : new Date(crawl.finishedAt).getTime();
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 90) return `${String(seconds)}s`;
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
};

/**
 * issue の severity を、画面の色に写す。
 *
 * **知らない severity を「問題なし」に倒さない。** 増えたものを黙って緑で出すと、
 * 検証器が新しく言い始めたことが画面から消える。
 */
export const severityKind = (severity) => {
  if (severity === "error") return "bad";
  if (severity === "warning") return "warn";
  if (severity === "info") return "muted";
  return "warn";
};

/**
 * 検証の結果を 1 行で。**合格だけを見せない** —— 警告 0 と警告 3 は別の状態で、
 * どちらも「失敗 0」だから。
 */
export const verdict = (summary) => {
  if (summary.failed > 0) return { text: `失敗 ${summary.failed}`, kind: "bad" };
  if (summary.warnings > 0) return { text: `警告 ${summary.warnings}`, kind: "warn" };
  return { text: "問題なし", kind: "ok" };
};
