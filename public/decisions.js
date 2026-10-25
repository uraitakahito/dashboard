/**
 * クロールの行を開いたときの「規則が何を決めたか」。台帳の `GET /api/crawls/:id/decisions` の答えを
 * 数え直すだけで、判断は持たない（決めたのも残したのも台帳）。ブラウザは `/decisions.js` として読み、
 * 試験は `node --test` から import する。
 */

/**
 * 規則ごとの数。**段を跨いで足す**（台帳の行は段 × 規則 × ホスト名で、数はその段の別々の URL）。
 * 0 回の規則も行にする —— 当たらない規則は、書いた人の意図と違うことを言っている合図。どれにも
 * 当たらずに落とした物（規則 0）があれば、最後の行に。
 */
export const ruleTallies = (rules, decisions) => {
  const sum = (rule) =>
    decisions.filter((row) => row.rule === rule).reduce((n, row) => n + row.links, 0);
  const tallies = rules.map((rule, i) => {
    const [action, pattern] = Object.entries(rule)[0] ?? ["", ""];
    return { rule: i + 1, action, pattern, links: sum(i + 1) };
  });
  const unmatched = sum(0);
  return unmatched === 0 ? tallies : [...tallies, { rule: 0, action: "skip", pattern: "", links: unmatched }];
};

/**
 * 落とした物。規則で落とした物と、どれにも当たらなかった物と、robots.txt で取らなかったページを、
 * ホスト名ごとに（段を跨いで足し、例は最初の 1 本）。辿った物と撮るだけの物は入れない。
 */
export const dropsOf = (decisions, robots) => {
  const rows = new Map();
  for (const row of decisions) {
    if (row.action !== "skip") continue;
    const key = `${String(row.rule)} ${row.hostname}`;
    const at = rows.get(key);
    if (at === undefined) {
      rows.set(key, { why: row.rule, hostname: row.hostname, links: row.links, sample: row.samples[0] ?? "" });
    } else {
      at.links += row.links;
    }
  }
  return [
    ...rows.values(),
    ...robots.map((row) => ({ why: "robots", hostname: row.hostname, links: row.pages, sample: row.samples[0] ?? "" })),
  ];
};

/**
 * Windmill の走らせる画面に、引数を入れて開く URL。**引数は hash に JSON で置く** —— Windmill（1.806）は
 * 走らせる画面の引数を `#<名前>=<JSON>` で持ち、開けばそれで埋まる（実測。query では埋まらない）。
 * id は全部を渡す（前の 8 字だと、同じ字で始まるクロールが 2 本あれば script が止まる）。
 */
export const inspectHref = (origin, workspace, crawlId) =>
  `${origin}/scripts/get/f/waggle/inspect_crawl?workspace=${encodeURIComponent(workspace)}` +
  `#crawl=${encodeURIComponent(JSON.stringify(crawlId))}`;
