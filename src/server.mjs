#!/usr/bin/env node
/**
 * crawler の開発用の画面を配り、台帳の API を中継する。
 *
 *   pnpm run dev        # http://127.0.0.1:7080/
 *
 * ## この repo は秘密を持たない
 *
 * 台帳に示すアクセストークンは、開発用 issuer の `POST /token` からその場で取得する
 * （capture-ledger の `pnpm run oidc:token` が中でやっているのと同じこと）。
 * `.env` に書くのは「誰として見るか」だけで、鍵もトークンも置き場が無い ——
 * **漏れる物が無いので、漏らさない工夫も要らない。**
 *
 * **そのぶん、これは境界ではない。** 開発用 issuer は頼まれれば誰の名前でも
 * トークンを出すので、ここの「名乗り」は便利さであって、守りではない。画面は
 * それを隠さずに書く（capture-ledger の picker が同じ理由で同じことをしている）。
 *
 * ## なぜ中継するのか
 *
 * 台帳は CORS を返さない（`OPTIONS /api/archives` は 404。実測）。ブラウザから
 * 直に叩く道は塞がっているので、同一オリジンにするために通す。**ここに画面の
 * ロジックは置かない** —— 置いた瞬間に「台帳が知っていることの写し」が生まれる。
 *
 * ## 書く口は 1 本
 *
 * 書くのは `POST /api/crawls`（クロールを起こす）だけで、中身は検査せずに台帳へ渡す。
 * 起点の URL も方針も、決めるのは台帳。代わりに門を通す —— 全部の口で Host を見て
 * （DNS rebinding）、書く口ではこの画面のページからの JSON だけを受ける（CSRF）。
 * 門の判定は `lib.mjs` に在り、試験から直接呼べる。
 *
 * ## 7080 であって 7000 ではない
 *
 * macOS の ControlCenter (AirPlay Receiver) が `*:7000` を握っている（実測）。
 * `127.0.0.1:7000` に bind すること自体はできてしまうが、**`localhost:7000` が
 * `::1` へ解決されると AirPlay に当たる** し、port から持ち主を引く道具
 * (capture-ledger の `dev:status` / `dev:down`) は毎回「別のものが握っている」と
 * 言い続けることになる。空いている隣 (台帳が 7070) を取る。
 *
 * ## http・loopback・公開しない
 *
 * https のページから `127.0.0.1` を叩くと Chrome の Private Network Access が
 * 止める（seaweedfs の `scripts/ui.sh` に実測の記録がある）。だから画面自身を
 * loopback の http で配る。外に出さない。
 */
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { userInfo } from "node:os";

import { contentType, hostAllowed, optional, safePath, writeRefusal } from "./lib.mjs";
import { BadRequest, paramsFor, parseWaczRoute, viaSignedUrl } from "./wacz.mjs";

const PUBLIC = fileURLToPath(new URL("../public", import.meta.url));

const PORT = Number(optional("DASHBOARD_PORT", "7080"));
const LEDGER = optional("DASHBOARD_LEDGER_URL", "http://127.0.0.1:7070");
const ISSUER = optional("DASHBOARD_ISSUER_URL", "http://127.0.0.1:9099");
const SUBJECT = optional("DASHBOARD_SUBJECT", userInfo().username);
/**
 * 深いリンクの行き先。**画面はこれを組み立てない** —— 台帳が返すのは `objectKey` と
 * `lastJob.id` だけで、どこで開くかは配備の事実。1 か所で決めて `/healthz` で配る。
 */
const REPLAY = optional("DASHBOARD_REPLAY_URL", "http://127.0.0.1:8899");
const WINDMILL = optional("DASHBOARD_WINDMILL_URL", "http://127.0.0.1:8000");
const WORKSPACE = optional("DASHBOARD_WINDMILL_WORKSPACE", "crawler");
/** WACZ を検証する daemon。**鍵を持たない** —— 台帳が署名した URL だけを読む。 */
const VALIDATOR = optional("DASHBOARD_VALIDATOR_URL", "http://127.0.0.1:7180");
const ORGANIZATIONS = optional("DASHBOARD_ORGANIZATIONS", "acme")
  .split(",")
  .map((org) => org.trim())
  .filter((org) => org !== "");

/** アクセストークン。取得できたら覚えておくが、**寿命は数えない**（下の理由）。 */
let token;

const HOW_TO_START_ISSUER = "capture-ledger で pnpm run oidc:issuer は動いているか?";

const mint = async () => {
  let res;
  try {
    res = await fetch(`${ISSUER}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: SUBJECT, organizations: ORGANIZATIONS }),
    });
  } catch (err) {
    // **届かないのと、断られたのは別。** 素の `fetch failed` はどちらも同じ顔で出る
    // ので、立っていないほうを名指しする（反証で実際にこの顔を踏んだ）。
    throw new Error(
      `${ISSUER} に届かない (${err instanceof Error ? err.message : String(err)})。` +
        HOW_TO_START_ISSUER,
    );
  }
  if (!res.ok) {
    throw new Error(`${ISSUER} が名乗りを断った (${String(res.status)})。` + HOW_TO_START_ISSUER);
  }
  token = (await res.json()).access_token;
};

/**
 * 台帳へ中継する。
 *
 * **時計で測らず、401 で取得し直す。** 寿命（既定 1 時間）を数える形にすると、
 * issuer を起こし直した日に落ちる —— 起動のたびに鍵が変わるので、まだ有効なはずの
 * トークンが静かに通らなくなる。401 は、その両方（期限切れ・鍵替わり）を同じ形で言う。
 */
const toLedger = async (path, method = "GET", body = undefined) => {
  if (token === undefined) await mint();
  const send = async () => {
    try {
      // 401 で取得し直したときも、同じ body を送り直す（文字列なので何度でも読める）
      return await fetch(LEDGER + path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        ...(body !== undefined && { body }),
      });
    } catch (err) {
      // **何が居ないかを言う。** 素の `fetch failed` は、台帳が落ちているのか
      // 宛先を間違えているのかを区別しない。
      throw new Error(
        `${LEDGER} に届かない (${err instanceof Error ? err.message : String(err)})。` +
          "capture-ledger で pnpm run api は動いているか?",
      );
    }
  };
  let res = await send();
  if (res.status === 401) {
    await mint();
    res = await send();
  }
  return res;
};

/**
 * daemon に POST する。**鍵ではなく URL を渡す**ので、向こうは何も持たない。
 * 届かなければ、何が居ないかを名指しする。
 */
const toDaemon = async (path, body) => {
  try {
    return await fetch(`${VALIDATOR}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `${VALIDATOR} に届かない (${err instanceof Error ? err.message : String(err)})。` +
        "capture-ledger で pnpm run dev:up --from validator は済んでいるか?",
    );
  }
};

/**
 * 上流の答えを流す。通すヘッダは allowlist —— daemon の `date` や `connection` を
 * 画面の応答に混ぜない。画像の実体（`/record/body`）は bytes のまま、印
 * （`nosniff` · `sandbox` · `no-store`）ごと通す。
 */
const PASS_HEADERS = ["content-type", "content-length", "x-content-type-options", "content-security-policy", "cache-control"];

const pass = async (reply, upstream) => {
  const headers = {};
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  headers["content-type"] ??= "application/json; charset=utf-8";
  reply.writeHead(upstream.status, headers);
  if (upstream.body === null) {
    reply.end();
    return;
  }
  await pipeline(Readable.fromWeb(upstream.body), reply);
};

/** 台帳の答えを、状態と content-type と本文のまま返す。 */
const relay = async (reply, res) => {
  reply.writeHead(res.status, {
    "content-type": res.headers.get("content-type") ?? "application/json; charset=utf-8",
  });
  reply.end(await res.text());
};

const sendJson = (reply, status, body) => {
  reply.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  reply.end(JSON.stringify(body));
};

/**
 * 書く口が受ける本文の上限。起点の URL と、その場で書いた JS が入る。目録の TS は大きい物でも
 * 数 KB なので、手で書く JS ならこれで足りる。超えたら 413（台帳まで行かない）。
 */
const WRITE_LIMIT = 64 * 1024;

class TooLarge extends Error {}

/**
 * 本文を読む。上限を超えたら**溜めるのをやめ**、読み切ってから TooLarge で断る ——
 * 途中で接続を切ると、413 を書く相手が居なくなる。
 */
const readBody = (request, limit) =>
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

/** 失敗は、**何が居ないか**を言う。「見えない」と「立っていない」を混ぜない。 */
const failed = (reply, err) => {
  // 流している途中で切れたら、もう頭は書けない。閉じるだけ。
  if (reply.headersSent) {
    reply.destroy();
    return;
  }
  const status = err instanceof BadRequest ? 400 : err instanceof TooLarge ? 413 : 502;
  sendJson(reply, status, { error: err instanceof Error ? err.message : String(err) });
};

const server = createServer((request, reply) => {
  const url = request.url ?? "/";

  // **どの口も、この画面の Host でなければ答えない**（DNS rebinding。`lib.mjs` の注）。
  // dev:up の準備の確かめは `http://127.0.0.1:<口>/healthz` を引くので、ここを通る。
  if (!hostAllowed(request.headers.host, PORT)) {
    sendJson(reply, 403, { error: "この画面の Host ではない" });
    return;
  }

  // 生存と、画面が要る設定。**`/api/` の下には置かない** —— あちらは台帳へ素通しする
  // 場所で、こちらの答えを混ぜると「どちらが答えたのか」が読めなくなる。
  if (url === "/healthz") {
    reply.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    reply.end(
      JSON.stringify({
        ok: true,
        subject: SUBJECT,
        organizations: ORGANIZATIONS,
        replayOrigin: REPLAY,
        windmillOrigin: WINDMILL,
        windmillWorkspace: WORKSPACE,
      }),
    );
    return;
  }

  /**
   * WACZ の中身へ行く口（検証・行の窓・1 行・レコードの一覧・1 レコード・画像の実体）。
   *
   * **署名付き URL をここから外に出さない。** 応答にもログにも載せない ——
   * 載せると認可で閉じた意味が消える（期限内なら、URL を持つ者は誰でも読める）。
   * 署名は範囲ごとに取り直す（1 本 7 ms・実測）。取っておくと、この画面が
   * 300 秒有効な鍵を持つことになる。
   *
   * 順番に意味がある: 先に台帳へ訊くので、**見てよい archive でなければ
   * daemon まで行かない**。絞るのは認可を持っている側。
   */
  const route = parseWaczRoute(url);
  if (route !== undefined) {
    const expected = route.op === "validate" ? "POST" : "GET";
    if (request.method !== expected) {
      reply.writeHead(405, { allow: expected, "content-type": "text/plain; charset=utf-8" });
      reply.end(`${expected} だけ\n`);
      return;
    }
    void (async () => {
      const params = paramsFor(route.op, route.params); // 壊れた引数は署名をもらう前に 400
      const upstream = await viaSignedUrl(
        {
          toLedger,
          call: (href) => toDaemon(`/${route.op}`, { source: { kind: "uri", uri: href }, ...params }),
        },
        route.archiveId,
      );
      await pass(reply, upstream);
    })().catch((err) => {
      failed(reply, err);
    });
    return;
  }

  /**
   * クロールを起こす。**ただ 1 本の書く口**で、中身は検査しない —— 起点の URL も方針も
   * 台帳が検査して決め、答え（202・400・404・409）をそのまま返す。門だけはここで見る。
   */
  if (url === "/api/crawls" && request.method === "POST") {
    const refusal = writeRefusal(request.headers, PORT);
    if (refusal !== undefined) {
      sendJson(reply, refusal.status, { error: refusal.error });
      return;
    }
    void readBody(request, WRITE_LIMIT)
      .then((body) => toLedger("/api/crawls", "POST", body))
      .then((res) => relay(reply, res))
      .catch((err) => {
        failed(reply, err);
      });
    return;
  }

  if (url.startsWith("/api/")) {
    // 読む口は GET だけ。ほかの method を GET として通すと、書けたように見えてしまう。
    if (request.method !== "GET") {
      reply.writeHead(405, { allow: "GET", "content-type": "text/plain; charset=utf-8" });
      reply.end("GET だけ（書く口は POST /api/crawls）\n");
      return;
    }
    void toLedger(url)
      .then((res) => relay(reply, res))
      .catch((err) => {
        failed(reply, err);
      });
    return;
  }

  const path = safePath(PUBLIC, url);
  const type = path === undefined ? undefined : contentType(path);
  if (path === undefined || type === undefined) {
    reply.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    reply.end("not found\n");
    return;
  }
  void readFile(path)
    .then((body) => {
      reply.writeHead(200, { "content-type": type });
      reply.end(body);
    })
    .catch(() => {
      reply.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      reply.end("not found\n");
    });
});

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  return result.status === 0 ? (result.stdout ?? "").trim() : "";
};

/**
 * 港が塞がっていたら、**誰が握っているかを言ってから**終わる。
 *
 * 素の `EADDRINUSE` は node の stack trace で出るだけで、`dev:up` が起こした
 * この画面自身が握っているのか、無関係なものなのかを言わない —— 実際に
 * 2026-09-21 にそれで止まった（`container-compose down` はホストのプロセスを
 * 消さないので、スタックを落とした後も画面だけが残る）。
 *
 * **自分と同じものが握っているなら、それは失敗ではない。** 開けばよい。
 */
const portTaken = () => {
  const pid = run("lsof", ["-nP", `-iTCP:${String(PORT)}`, "-sTCP:LISTEN", "-t"]).split("\n")[0];
  const command = pid === "" ? "" : run("ps", ["-p", pid, "-o", "command="]);
  const cwd =
    pid === ""
      ? ""
      : (run("lsof", ["-a", "-d", "cwd", "-p", pid, "-Fn"])
          .split("\n")
          .find((line) => line.startsWith("n")) ?? "").slice(1);
  const mine = command.includes("src/server.mjs") && cwd !== "" && resolve(cwd) === resolve(ROOT);

  process.stderr.write(
    mine
      ? `127.0.0.1:${String(PORT)} は、既に動いているこの画面です (pid ${pid})。\n` +
          `  開くだけ: open http://127.0.0.1:${String(PORT)}/\n` +
          "  起こし直すなら: cd ../capture-ledger && pnpm run dev:up --from dashboard\n"
      : `127.0.0.1:${String(PORT)} は別のものが握っています${pid === "" ? "" : ` (pid ${pid})`}。\n` +
          (command === "" ? "" : `  ${command}\n`) +
          "  何が立っているか: cd ../capture-ledger && pnpm run dev:status\n" +
          "  片付け:           cd ../capture-ledger && pnpm run dev:down\n",
  );
  process.exit(1);
};

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") portTaken();
  throw err;
});

// **loopback にだけ bind する。** この画面は台帳のトークンを持つので、
// 届く相手はこの機械の中だけでよい。
server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(
    `dashboard http://127.0.0.1:${String(PORT)}/  ` +
      `台帳: ${LEDGER}  名乗り: ${SUBJECT} (${ORGANIZATIONS.join(", ")})\n` +
      "開発用の名乗りです —— issuer は頼まれれば誰の名前でもトークンを出します。\n",
  );
});
