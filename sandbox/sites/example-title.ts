/**
 * example.com の頁で、題を報告する。代役で「サイト用の台本」を見せるための見本で、
 * capture-scripts には無い（札は scenario.json の catalog に書く）。
 *
 * 決まりはクロールの単位なので、リンクを辿って別のホストへ出た頁でも走る —— 冒頭で見分けて、
 * ほかの頁では何もしないで終わる。
 */
(() => {
  if (location.hostname !== "example.com") return;
  globalThis.__bh.report("example-title", { title: document.title });
})();
