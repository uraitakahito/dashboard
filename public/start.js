/**
 * クロールの面の「起こす」欄の部品。**画面から切り出してあるのは、ここだけ試験から呼べるようにするため。**
 *
 * ブラウザは `/start.js` として読み、試験は `node --test` から import する ——
 * 同じファイルを両方が読むので、写しが腐ることがない。
 *
 * **起点の URL は検査しない。** 読めない URL は台帳が 400 で言う。規則を 2 か所に持つと、
 * 片方だけが変わった日に、画面が通すのに台帳が断る（または逆）形になる。
 */

/** 走らせるものの欄が、何も選んでいない形（目録が空で、その場の JS も無い）。 */
const NOTHING_CHOSEN = { catalog: [], picked: [], inline: { name: "", phase: "behavior", source: "" } };

/**
 * 走らせるもの（台帳の `scripts`）。**既定のまま —— 目録を全部選び、その場の JS が空 —— なら
 * 送らない**（`undefined`）。台帳の既定（有効な各 id の最新版）と、目録が空のときの 400 を生かす。
 *
 * 送るときは、その場の JS を先に、選んだ目録を目録の並び（`catalog` の順）で。全部外せば `[]` ——
 * 「何も走らせない」。source は削らない —— 台帳が打つ sha256 は、書いたバイト列の物。名前は前後の
 * 空白だけ落とす。綴りは検査しない（台帳が 400 で言う）。
 */
export const scriptsOf = ({ catalog, picked, inline }) => {
  const written = inline.source.trim() !== "";
  if (!written && picked.length === catalog.length) return undefined;
  return [
    ...(written
      ? [{ inline: { name: inline.name.trim(), phase: inline.phase, source: inline.source } }]
      : []),
    ...catalog.filter((id) => picked.includes(id)).map((id) => ({ catalog: id })),
  ];
};

/**
 * 欄から台帳へ送る body。起点は空行を落とすだけ。
 *
 * 「このページだけ」なら `maxDepth: 0` を足す。「リンクを辿る」なら何も足さない ——
 * 深さも枚数も台帳の既定に任せ、既定の数を画面に写さない。走らせるものは `scriptsOf`。
 */
export const startBody = (text, onlyThisPage, run = NOTHING_CHOSEN) => {
  const scripts = scriptsOf(run);
  return {
    seeds: text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
    ...(onlyThisPage && { maxDepth: 0 }),
    ...(scripts !== undefined && { scripts }),
  };
};

/**
 * 答えを 1 行で言う。**台帳の文は言い換えない** —— `message` を先に、無ければ `error` を拾い、
 * 名指した `ids` と `hint` があれば添える。
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
  // 台帳が名指した id（知らない目録の id・重ね）。文の後、hint の前に
  const ids = Array.isArray(answer.ids) ? `: ${answer.ids.join(", ")}` : "";
  const hint = typeof answer.hint === "string" ? `（${answer.hint}）` : "";
  return { kind: "bad", text: `${String(status)} —— ${said}${ids}${hint}` };
};

/**
 * 送る本文の大きさ（バイト）。**門と同じ数え方** —— 門は受けたバイトを数えるので、JSON にして
 * UTF-8 で数える（日本語は 1 字 3 バイト、改行の escape は 2 バイト）。
 */
export const bodyBytes = (body) => new TextEncoder().encode(JSON.stringify(body)).length;

/**
 * 欄の下の 1 行。行数は JS の、割合は送る本文の。**上限を超えたら押せない**（over）。
 * 上限は `/healthz` の `writeLimit`（画面が知らなければ Infinity を渡し、門に任せる）。
 */
export const sizeOf = (source, bytes, limit) => ({
  lines: source === "" ? 0 : source.split("\n").length,
  bytes,
  percent: Math.min(100, Math.round((bytes / limit) * 100)),
  over: bytes > limit,
});

/** 型の検査を外す印。ts-compile-service は 1 行目のこれを見て、構文だけを見る。 */
export const NOCHECK = "// @ts-nocheck";

/** 1 行目が印か。行頭と行末の空白は許す。2 行目より後の印は数えない。 */
export const hasNocheck = (source) => source.split("\n", 1)[0].trim() === NOCHECK;

/**
 * 「型を検査しない」のチェックに合わせて、1 行目の印を足し引きする。**ほかの行は触らない**
 * —— 見えている物が送る物で、台帳が打つ sha256 もこの source の物になる。
 */
export const withNocheck = (source, on) => {
  if (on === hasNocheck(source)) return source;
  if (on) return `${NOCHECK}\n${source}`;
  const end = source.indexOf("\n");
  return end === -1 ? "" : source.slice(end + 1);
};
