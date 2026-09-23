#!/usr/bin/env node
/**
 * crawler の開発用の画面を配り、台帳の API を中継する。
 *
 *   pnpm run dev        # http://127.0.0.1:7000/
 *
 * ## この repo は秘密を持たない
 *
 * 台帳へ名乗るトークンは、開発用 issuer の `POST /token` からその場で取る
 * （capture-ledger の `pnpm run oidc:token` が中でやっているのと同じこと）。
 * `.env` に書くのは「誰として見るか」だけで、鍵も token も置き場が無い ——
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
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { userInfo } from "node:os";

import { contentType, optional, safePath } from "./lib.mjs";

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

/** 名乗り。取れたら覚えておくが、**寿命は数えない**（下の理由）。 */
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
 * **時計で測らず、401 で取り直す。** 寿命（既定 1 時間）を数える形にすると、
 * issuer を起こし直した日に落ちる —— 起動のたびに鍵が変わるので、まだ有効なはずの
 * トークンが静かに通らなくなる。401 は、その両方（期限切れ・鍵替わり）を同じ形で言う。
 */
const toLedger = async (path, method = "GET") => {
  if (token === undefined) await mint();
  const send = async () => {
    try {
      return await fetch(LEDGER + path, {
        method,
        headers: { authorization: `Bearer ${token}` },
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

/** 受け取った JSON。**大きさに上限を置く** —— 受け口は誰でも叩けるので。 */
const readJson = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

/** 失敗は、**何が居ないか**を言う。「見えない」と「立っていない」を混ぜない。 */
const failed = (reply, err) => {
  reply.writeHead(502, { "content-type": "application/json; charset=utf-8" });
  reply.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
};

const server = createServer((request, reply) => {
  const url = request.url ?? "/";

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
   * WACZ を 1 本検証する。
   *
   * **署名付き URL をここから外に出さない。** 応答にもログにも載せない ——
   * 載せると認可で閉じた意味が消える（期限内なら、URL を持つ者は誰でも読める）。
   *
   * 順番に意味がある: 先に台帳へ訊くので、**見てよい archive でなければ
   * daemon まで行かない**。絞るのは認可を持っている側。
   */
  if (url === "/api/validate" && request.method === "POST") {
    void (async () => {
      const { archiveId } = await readJson(request);
      if (typeof archiveId !== "string" || archiveId === "") {
        reply.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        reply.end(JSON.stringify({ error: "archiveId is required" }));
        return;
      }

      // ① 署名をもらう。見えない archive なら、ここで 404 が返る。
      const signed = await toLedger(`/api/archives/${encodeURIComponent(archiveId)}/url`, "POST");
      if (!signed.ok) {
        reply.writeHead(signed.status, {
          "content-type": signed.headers.get("content-type") ?? "application/json; charset=utf-8",
        });
        reply.end(await signed.text());
        return;
      }
      const { url: href } = await signed.json();

      // ② daemon に渡す。鍵ではなく URL を渡すので、向こうは何も持たない。
      const report = await fetch(`${VALIDATOR}/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: { kind: "uri", uri: href }, locale: "ja" }),
      }).catch((err) => {
        throw new Error(
          `${VALIDATOR} に届かない (${err instanceof Error ? err.message : String(err)})。` +
            "capture-ledger で pnpm run dev:up --from validator は済んでいるか?",
        );
      });
      reply.writeHead(report.status, {
        "content-type": report.headers.get("content-type") ?? "application/json; charset=utf-8",
      });
      reply.end(await report.text());
    })().catch((err) => {
      failed(reply, err);
    });
    return;
  }

  if (url.startsWith("/api/")) {
    void toLedger(url)
      .then(async (res) => {
        reply.writeHead(res.status, {
          "content-type": res.headers.get("content-type") ?? "application/json; charset=utf-8",
        });
        reply.end(await res.text());
      })
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
