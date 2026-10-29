/**
 * 新しいクロールの画面の部品。**dashboard から切り出してあるのは、ここだけ試験から呼べるようにするため。**
 *
 * ブラウザは `/start.js` として読み、試験は `node --test` から import する ——
 * 同じファイルを両方が読むので、写しが腐ることがない。
 *
 * **起点の URL は検査しない。** 読めない URL は台帳が 400 で言う。規則を 2 か所に持つと、
 * 片方だけが変わった日に、dashboard が通すのに台帳が断る（または逆）形になる。
 */

/** 走らせるものの欄が、何も選んでいない形（台帳にスクリプトが無く、その場の JS も無い）。 */
const NOTHING_CHOSEN = {
  catalog: [],
  picked: [],
  defaults: [],
  inline: { name: "", phase: "behavior", source: "" },
};

/**
 * 起点の欄から、ホスト名の集合。**台帳と同じく `new URL(…).hostname`** —— 小文字になり、IDN は
 * punycode になり、ポートは落ちる。読めない行は数えない（台帳が 400 で言う）。
 */
export const seedHosts = (text) =>
  new Set(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && URL.canParse(line))
      .map((line) => new URL(line).hostname),
  );

/**
 * そのスクリプトを、この起点で選べるか。**札（`sites`）が無ければいつでも**、あれば札のどれかが起点の
 * ホストにあるとき（完全一致。`example.com` と `www.example.com` は別）。台帳（capture-ledger
 * v0.61.0）の決まりの写しで、正は台帳 —— 合わない物を名指せば、台帳が 400 で断る。
 */
export const onSeed = (script, hosts) =>
  script.sites.length === 0 || script.sites.some((site) => hosts.has(site));

/**
 * ふつうに押したか（左のボタンだけ・修飾キーなし）。チェックの横の「読む」は、このときだけ右の列で開く。
 * それ以外はブラウザに任せる（href はスクリプトの画面なので、別のタブで開くなど）。
 */
export const plainClick = (event) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * 起点と台帳の既定（`enabled`）で決まる顔ぶれ —— 台帳が `scripts` を省いた頼みに選ぶ物と同じ。並びは台帳の並び。
 * 既定に入らないスクリプト（`enabled: false`。カタログの `default: false`）は、起点に合っても入らない。
 */
export const defaultIds = (scripts, hosts) =>
  scripts.filter((script) => script.enabled && onSeed(script, hosts)).map((script) => script.id);

/**
 * 走らせるもの（台帳の `scripts`）。**既定のまま —— 選んだ物が既定の顔ぶれ（`defaultIds`）と同じで、
 * その場の JS が空 —— なら送らない**（`undefined`）。台帳も起点から同じ物を選ぶので、省いても走る物は
 * 変わらない。省くのは、台帳にスクリプトが無いときと、起点に合う物が無いときの 400 を台帳に言わせるため。
 *
 * 送るときは、その場の JS を先に、選んだスクリプトを台帳の並び（`catalog` の順）で。全部外せば `[]` ——
 * 「何も走らせない」。source は削らない —— 台帳が打つ sha256 は、書いたバイト列の物。名前は前後の
 * 空白だけ落とす。綴りは検査しない（台帳が 400 で言う）。
 */
export const scriptsOf = ({ catalog, picked, defaults, inline }) => {
  const written = inline.source.trim() !== "";
  const asDefault = picked.length === defaults.length && defaults.every((id) => picked.includes(id));
  if (!written && asDefault) return undefined;
  return [
    ...(written
      ? [{ inline: { name: inline.name.trim(), phase: inline.phase, source: inline.source } }]
      : []),
    ...catalog.filter((id) => picked.includes(id)).map((id) => ({ catalog: id })),
  ];
};

/** 起点の欄から、送る起点。空行を落とすだけ（URL は検査しない）。 */
const seedsOf = (text) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

/** 動きと、画面の言い方。並びは選ぶ欄の並び。 */
export const ACTIONS = [
  ["follow", "撮って辿る"],
  ["capture", "撮るだけ"],
  ["skip", "落とす"],
];
const VERB = Object.fromEntries(ACTIONS);

/**
 * 型（よく使う並び）。**どれも「撮って辿る」を 1 本持つ** —— 起点が撮って辿るに当たらないと、台帳が
 * 400 で断る。行は `{ action, pattern }` で、表はこの形を描き、送るときに台帳の形（鍵が 1 つの object）にする。
 */
export const PRESETS = {
  site: [{ action: "follow", pattern: "same-site" }],
  siteAndOneHop: [
    { action: "follow", pattern: "same-site" },
    { action: "capture", pattern: "any" },
  ],
  host: [{ action: "follow", pattern: "same-host" }],
  any: [{ action: "follow", pattern: "any" }],
};

/**
 * 落とす行は**いちばん上**に足す。上から当て、最初に当たった規則が勝つので、広い「撮って辿る」の下に
 * 置くと覆われて二度と当たらない（台帳が 400 で断る）。
 */
export const addSkipRow = (rows) => [{ action: "skip", pattern: "" }, ...rows];

/** ふつうの行はいちばん下に。下の行ほど、上に当たらなかった物だけを受ける（外へ 1 歩、など）。 */
export const addRow = (rows) => [...rows, { action: "capture", pattern: "" }];

/** `i` 行目（0 から）を `delta` だけ動かす。端を越えるなら動かさない（同じ配列を返す）。 */
export const moveRow = (rows, i, delta) => {
  const j = i + delta;
  if (j < 0 || j >= rows.length) return rows;
  const next = [...rows];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

export const removeRow = (rows, i) => rows.filter((_, k) => k !== i);

/** 表の行から台帳の `rules`。当てる物は前後の空白だけ落とす（読めるかは台帳が言う）。 */
export const rulesOf = (rows) => rows.map(({ action, pattern }) => ({ [action]: pattern.trim() }));

/**
 * 欄から台帳へ送る body。起点は空行を落とすだけ。
 *
 * 「このページだけ」（`follow` が null）なら `maxDepth: 0` を足す。「リンクを辿る」なら規則の並びを
 * 必ず送り、深さと枚数は書いたときだけ送る —— 空なら台帳の既定に任せ、既定の数を dashboard に写さない。
 * 走らせるものは `scriptsOf`。
 */
export const startBody = (text, follow, run = NOTHING_CHOSEN) => {
  const scripts = scriptsOf(run);
  return {
    seeds: seedsOf(text),
    ...(follow === null
      ? { maxDepth: 0 }
      : {
          ...(follow.maxDepth.trim() !== "" && { maxDepth: Number(follow.maxDepth) }),
          ...(follow.maxPages.trim() !== "" && { maxPages: Number(follow.maxPages) }),
          rules: rulesOf(follow.rows),
        }),
    ...(scripts !== undefined && { scripts }),
  };
};

/**
 * 台帳の確かめの口（`GET /api/crawl-rules/check`）の query。起点は空行を落とし、規則は「動き:当てる物」で
 * 並べる（当てる物の `:` は、台帳が最初の 1 つで切るので構わない）。
 */
export const checkQuery = (text, rows) =>
  new URLSearchParams([
    ...seedsOf(text).map((seed) => ["seed", seed]),
    ...rows.map(({ action, pattern }) => ["rule", `${action}:${pattern.trim()}`]),
  ]).toString();

const KIND = { scope: "範囲", domain: "ドメイン（その下も）", prefix: "前方一致" };

/**
 * 確かめの答えから、行ごとの印（`{ text, bad }`）。**答えの行の数が表と違えば印を出さない** —— 表を
 * 変えた直後で、答えが前の表の物だから。
 */
export const marksOf = (answer, rowCount) => {
  if (answer === undefined || answer.rules.length !== rowCount) {
    return Array.from({ length: rowCount }, () => ({ text: "", bad: false }));
  }
  return answer.rules.map((rule) => {
    if (rule.kind === "invalid") {
      return { text: "読めません（小文字のホスト名・http(s) の URL・範囲の名前のどれか）", bad: true };
    }
    if (rule.coveredBy !== undefined) {
      return {
        text: `${String(rule.coveredBy)} 行目に覆われて当たりません。上へ移してください`,
        bad: true,
      };
    }
    return { text: KIND[rule.kind] ?? rule.kind, bad: false };
  });
};

/** 当てる物を文に。範囲の `same-site` は、起点のサイトの名前で言う。 */
const phraseOf = (rule, sites) => {
  if (rule.kind === "invalid") return `「${rule.pattern}」（読めない）`;
  if (rule.kind === "domain") return `${rule.pattern} とその下`;
  if (rule.kind === "prefix") return `${rule.pattern} で始まる URL`;
  switch (rule.pattern) {
    case "same-origin":
      return "起点と同じ origin";
    case "same-host":
      return "起点と同じホスト";
    case "same-site":
      return sites.length === 0 ? "起点と同じサイト" : `${sites.join("・")} の中`;
    default:
      return "どこでも";
  }
};

/**
 * 送る前に「何を辿るか」を言い直す文（`{ text, bad }`）。台帳の確かめの答えから組むので、言い方は台帳が
 * 読んだ形のまま（前方一致は正規化した URL）。始められない理由があれば最後に並べ、`bad` にする。
 */
export const summaryOf = (answer, follow) => {
  const sites = [
    ...new Set(answer.seeds.filter((seed) => seed.valid).map((seed) => seed.site)),
  ];
  const lines = answer.rules.map((rule) => {
    const phrase = phraseOf(rule, sites);
    const verb = VERB[rule.action];
    return rule.kind === "scope" && rule.pattern === "any"
      ? `${String(rule.rule)} 行目 どこでも${verb}`
      : // 英字で終わる物（URL・origin）と「は」の間は空ける（この repo の書き方）
        `${String(rule.rule)} 行目 ${phrase}${/[!-~]$/.test(phrase) ? " " : ""}は${verb}`;
  });
  const depth = follow.maxDepth.trim() === "" ? "台帳の既定の深さ" : `${follow.maxDepth.trim()} 段`;
  const pages = follow.maxPages.trim() === "" ? "台帳の既定の枚数" : `${follow.maxPages.trim()} 枚`;
  const problems = [
    ...answer.rules.flatMap((rule) =>
      rule.kind === "invalid"
        ? [`${String(rule.rule)} 行目の当てる物が読めません。`]
        : rule.coveredBy !== undefined
          ? [`${String(rule.rule)} 行目は ${String(rule.coveredBy)} 行目に覆われて当たりません。`]
          : [],
    ),
    ...answer.seeds.flatMap((seed) =>
      !seed.valid
        ? [`起点 ${seed.url} は http(s) の URL ではありません。`]
        : seed.followed
          ? []
          : [`起点 ${seed.url} は撮って辿る行に当たりません。`],
    ),
  ];
  const told =
    answer.rules.length === 0
      ? "規則がありません。"
      : `上の行から当てます。${lines.join("、")}。どれにも当たらないリンクは落とします。`;
  return {
    text: `${told}${depth}・${pages}まで。${problems.join("")}${problems.length > 0 ? "このままでは始められません。" : ""}`,
    bad: problems.length > 0 || answer.rules.length === 0,
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
 * `status` が 0 なのは、dashboard のサーバ自身に届かなかったとき（fetch が投げた）。
 */
export const startAnswer = (status, answer) => {
  const id = typeof answer.crawlId === "string" ? `（crawl ${answer.crawlId.slice(0, 8)}）` : "";
  if (status === 202) return { kind: "ok", text: `始めました${id}。一覧の行に印を付けました。` };
  if (status === 409) {
    return { kind: "run", text: `走行中のクロールがあります${id}。終わるまで次は始められません。` };
  }
  const said = answer.message ?? answer.error ?? "答えに文がありません";
  if (status === 0) return { kind: "bad", text: `dashboard 自身に届きません（${said}）` };
  // 台帳が名指した物（知らないスクリプトの id・重ね・辿らない起点・規則の行）。文の後、hint の前に
  const named = Array.isArray(answer.ids)
    ? answer.ids
    : Array.isArray(answer.seeds)
      ? answer.seeds
      : Array.isArray(answer.rules)
        ? answer.rules.map((r) =>
            r.coveredBy === undefined
              ? `${String(r.rule)} 行目（${String(r.pattern)}）`
              : `${String(r.rule)} 行目（${String(r.coveredBy)} 行目に覆われる）`,
          )
        : [];
  const ids = named.length === 0 ? "" : `: ${named.join(", ")}`;
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
 * 上限は `/healthz` の `writeLimit`（dashboard が知らなければ Infinity を渡し、門に任せる）。
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

/**
 * スクリプト 1 本を、その場の JS の下敷きにする（スクリプトの画面の「下敷きにする」）。**替えるのは 2 つの
 * 形だけ** —— `__bh.opts["<id>"]` と `__bh.report("<id>"` の id を `inline-<名前>` に。台帳は
 * その場の JS を `inline-<名前>` の id で走らせるので、替えないと設定も報告も元の id のまま届く。
 *
 * ほかの綴り（ログの文字列・コメントの地の文・`__bh.` の無い `opts["…"]`・別の id）は触らない。
 * 替えた行の番号（1 から）を返す。名前の綴りは検査しない（台帳が 400 で言う）。
 */
export const asTemplate = (source, fromId, name) => {
  const to = `inline-${name}`;
  const forms = [
    [`__bh.opts["${fromId}"]`, `__bh.opts["${to}"]`],
    [`__bh.report("${fromId}"`, `__bh.report("${to}"`],
  ];
  const changed = [];
  const lines = source.split("\n").map((line, i) => {
    const out = forms.reduce((text, [from, into]) => text.split(from).join(into), line);
    if (out !== line) changed.push(i + 1);
    return out;
  });
  return { source: lines.join("\n"), changed };
};
