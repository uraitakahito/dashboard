/**
 * クロールの面の「起こす」欄の部品。**画面から切り出してあるのは、ここだけ試験から呼べるようにするため。**
 *
 * ブラウザは `/start.js` として読み、試験は `node --test` から import する ——
 * 同じファイルを両方が読むので、写しが腐ることがない。
 *
 * **起点の URL は検査しない。** 読めない URL は台帳が 400 で言う。規則を 2 か所に持つと、
 * 片方だけが変わった日に、画面が通すのに台帳が断る（または逆）形になる。
 */

/**
 * 欄から台帳へ送る body。空行を落とすだけ。
 *
 * 「このページだけ」なら `maxDepth: 0` を足す。「リンクを辿る」なら何も足さない ——
 * 深さも枚数も台帳の既定に任せ、既定の数を画面に写さない。
 */
export const startBody = (text, onlyThisPage) => ({
  seeds: text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== ""),
  ...(onlyThisPage && { maxDepth: 0 }),
});

/**
 * 答えを 1 行で言う。**台帳の文は言い換えない** —— `message` を先に、無ければ `error` を拾い、
 * `hint` があれば添える。
 *
 * `message` が先なのは、Fastify が自分で返す答え（route が無い 404、schema の 400）が
 * `error: "Not Found"` と `message: "Route POST:/api/crawls not found"` の両方を持ち、
 * 言いたいことは `message` の側に在るから。台帳が自分で書く答えは `error` だけ。
 *
 * `status` が 0 なのは、この画面のサーバ自身に届かなかったとき（fetch が投げた）。
 */
export const startAnswer = (status, answer) => {
  const id = typeof answer.crawlId === "string" ? `（crawl ${answer.crawlId.slice(0, 8)}）` : "";
  if (status === 202) return { kind: "ok", text: `起こしました${id}。一覧の行に印を付けました。` };
  if (status === 409) {
    return { kind: "run", text: `走行中のクロールがあります${id}。終わるまで次は起こせません。` };
  }
  const said = answer.message ?? answer.error ?? "答えに文がありません";
  if (status === 0) return { kind: "bad", text: `この画面自身に届きません（${said}）` };
  const hint = typeof answer.hint === "string" ? `（${answer.hint}）` : "";
  return { kind: "bad", text: `${String(status)} —— ${said}${hint}` };
};
