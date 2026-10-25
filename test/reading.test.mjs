/**
 * スクリプトの画面（読む所）の部品（`public/reading.js`）。URL の読み書き・行の数え方・見出しの文。
 *
 * 画面そのもの（一覧・本文・押した行）は `app.js` に在り、試験は import しない。代役で開いて見る。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  labelOf,
  linesOf,
  metaOf,
  optionsText,
  parseReading,
  readingHash,
  standingOf,
  TYPES_HASH,
} from "../public/reading.js";

test("URL は書いて読むと元に戻る（版を省く・版・版と sha の頭と行・型の 4 つの形）", () => {
  const forms = [
    { id: "autoscroll" },
    { id: "autoscroll", version: 2 },
    { id: "autoscroll", version: 1, sha: "c9956819ffea", line: 33 },
  ];
  for (const target of forms) {
    const back = parseReading(readingHash(target));
    assert.deepEqual(
      Object.fromEntries(Object.entries(back).filter(([, v]) => v !== undefined)),
      target,
    );
  }
  assert.equal(readingHash({ line: 12 }), "#scripts/types/host.d.ts:12");
  assert.deepEqual(parseReading(readingHash({})), { line: undefined });
  assert.equal(readingHash({}), TYPES_HASH);
});

test("/ と空白を含む id は % にして載せ、読むと元の id に戻る", () => {
  const hash = readingHash({ id: "a/b c", version: 3 });
  assert.equal(hash, "#scripts/a%2Fb%20c@3");
  assert.equal(parseReading(hash).id, "a/b c");
});

test("受け皿の型と、id が types のスクリプトを取り違えない", () => {
  assert.deepEqual(parseReading("#scripts/types/host.d.ts:12"), { line: 12 });
  assert.equal(parseReading("#scripts/types").id, "types");
  // id の中の / は % になるので、型の URL にはならない
  assert.equal(parseReading(readingHash({ id: "types/host.d.ts" })).id, "types/host.d.ts");
  // 型の URL に似ているが型ではない path は、id としても読まない
  assert.equal(parseReading("#scripts/types/other.d.ts"), undefined);
});

test("合わない形は undefined（壊れた %・版の無い sha・ほかの画面の URL）", () => {
  assert.equal(parseReading("#scripts/%E0"), undefined);
  assert.equal(parseReading("#scripts/autoscroll~c9956819ffea"), undefined);
  assert.equal(parseReading("#scripts/autoscroll@1~XYZ"), undefined);
  assert.equal(parseReading("#wacz/1234/behaviors/custom.jsonl:2"), undefined);
  assert.equal(parseReading("#scripts"), undefined);
  assert.equal(parseReading("#scripts/"), undefined);
});

test("sha の頭は版があるときだけ載せる（版の無い URL は既定の版を指し、確かめる相手が無い）", () => {
  assert.equal(readingHash({ id: "autofetch", sha: "6aa6f4459d92" }), "#scripts/autofetch");
});

test("行は改行で数え、最後の改行の後ろの空の 1 行は数えない", () => {
  assert.equal(linesOf("a\nb\n").length, 2);
  assert.equal(linesOf("a\nb").length, 2);
  assert.deepEqual(linesOf(""), [""]);
  assert.deepEqual(linesOf("a\n\n"), ["a", ""]);
});

test("見出しの文: 数は 3 桁ずつ、型は phase を持たない", () => {
  const doc = {
    phase: "behavior",
    source: "x\n".repeat(55),
    bytes: 2695,
    sha256: "c9956819ffeadf3aa1cd138247330e1662372c2d47d4416bfefd4848e1bedc03",
    createdAt: "2026-10-14T12:26:38.656Z",
  };
  assert.deepEqual(metaOf(doc), [
    "behavior",
    "55 行",
    "2,695 バイト",
    "sha256 c9956819ffea…",
    "2026-10-14 取り込み",
  ]);
  const { phase: _phase, ...types } = doc;
  assert.equal(metaOf(types)[0], "55 行");
});

test("渡す値が空なら「既定のまま」と言い、あればそのまま見せる", () => {
  assert.equal(optionsText({}), "設定 {}（既定のまま。値はコードの中）");
  assert.equal(optionsText(undefined), "設定 {}（既定のまま。値はコードの中）");
  assert.equal(optionsText({ maxSteps: 60 }), '設定 {"maxSteps":60}');
});

test("既定の顔ぶれとの関係を 3 通りに言う（既定の版・ほかの版が既定・無効）", () => {
  assert.deepEqual(standingOf({ version: 2, enabled: true, sites: [] }, 2), { text: "既定で走る版", kind: "ok" });
  assert.deepEqual(standingOf({ version: 1, enabled: true, sites: [] }, 2), {
    text: "既定で走るのは v2",
    kind: "muted",
  });
  assert.deepEqual(standingOf({ version: 1, enabled: false, sites: [] }, 2), {
    text: "無効（既定では走らない）",
    kind: "warn",
  });
});

test("サイト用のスクリプトの既定の版は、起点が札のホストにあるときだけ既定で走ると言う", () => {
  assert.deepEqual(standingOf({ version: 1, enabled: true, sites: ["example.com", "www.example.com"] }, 1), {
    text: "起点に example.com・www.example.com があれば既定で走る版",
    kind: "ok",
  });
});

test("読む窓のタブの名前は id と版（型は host.d.ts）。URL から読んだ物をそのまま渡せる", () => {
  assert.equal(labelOf(parseReading("#scripts/autoscroll@2")), "autoscroll v2");
  assert.equal(labelOf(parseReading("#scripts/autofetch")), "autofetch");
  assert.equal(labelOf(parseReading(TYPES_HASH)), "host.d.ts");
});
