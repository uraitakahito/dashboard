---
title: 中継の口
description: 画面のサーバが答える口 —— /healthz、台帳への素通し、クロールを起こす口、WACZ の中身へ行く /wacz/ の口。Host の門、通すヘッダと、失敗の形
---

画面のサーバは中継しかしません。
画面のロジックはブラウザの側（`public/`）に在り、サーバが持つのは、台帳と daemon への道と、画面のファイルを配ることだけです。
置いた瞬間に「台帳が知っていることの写し」が生まれるので、ロジックはサーバに置きません。

| 口 | 答えるもの |
| --- | --- |
| `GET /healthz` | サーバ自身（生存と、画面が要る設定） |
| `POST /api/crawls` | 台帳へ（書く口はこれ 1 本） |
| `/api/*`（ほか） | 台帳へ素通し（GET だけ） |
| `/wacz/:id/…` | 台帳に署名をもらい、daemon へ |
| それ以外 | `public/` のファイル |

口の振り分けは `src/server.mjs` に、`/wacz/` の口の読みと組み替えは `src/wacz.mjs` に在ります。

どの口も、要求の `Host` が `127.0.0.1:<口>` か `localhost:<口>` でなければ 403 で断ります。
よそのドメインの名前を 127.0.0.1 に向け直す手（DNS rebinding）で、別のサイトのページがこの画面を自分のオリジンとして読むのを止めるためです。

## /healthz

生存と、画面が要る設定を返します。

```json
{
  "ok": true,
  "subject": "alice",
  "organizations": ["acme"],
  "replayOrigin": "http://127.0.0.1:8899",
  "windmillOrigin": "http://127.0.0.1:8000",
  "windmillWorkspace": "crawler"
}
```

画面は開いたときにこれを読み、誰として見ているかと、深いリンクの行き先を知ります。
`/api/` の下には置きません。
あちらは台帳へ素通しする場所で、こちらの答えを混ぜると、どちらが答えたのかが読めなくなります。

## /api/* —— 台帳へ素通し

台帳は CORS（Cross-Origin Resource Sharing。別のオリジンのページからの要求を許す仕組み）の答えを返しません（`OPTIONS /api/archives` は 404）。
ブラウザから直に叩く道が塞がっているので、同一オリジンにするために通します。

- path と query はそのままで、台帳へは GET で通します。
  GET 以外は 405 です（書く口は下の `POST /api/crawls` だけ）。
- アクセストークンを `Authorization: Bearer` で付けます。
  まだ持っていなければ、先に開発用 issuer から取得します。
- **401 を受けたら、取得し直して 1 度だけやり直す。**
  寿命は数えません。
  issuer を起こし直すと鍵ごと変わるので、「まだ有効なはず」の時計は当てになりません。
  401 は、期限切れも鍵替わりも同じ形で言います。
- 台帳の答えは、状態と `content-type` と本文をそのまま返します。

どの口を読むかは画面（`public/app.js`）が決め、サーバは選びません。
口の一覧（allowlist）は持っていません。

## POST /api/crawls —— クロールを起こす口

画面のサーバが持つ、ただ 1 本の書く口です。
クロールの面の欄（[画面](/screens/)）が使います。
中身は検査せず、門を通った本文をそのまま台帳の `POST /api/crawls` へ渡し、答えをそのまま返します。
起点の URL も方針（深さ・枚数・走らせるスクリプト）も、検査して決めるのは台帳です。

- **この画面のページからの JSON だけを通す。**
  `Origin` がこの画面でなければ 403、`content-type` が JSON でなければ 415、本文が 64 KiB を超えたら 413 です。
  別のサイトのページに、利用者のブラウザから POST させる手（CSRF）を止めるためです。
  Chrome の Private Network Access には頼りません。
- アクセストークンの付け方と、401 でのやり直しは、上の `/api/*` と同じです。

| 台帳の答え | いつ |
| --- | --- |
| 202 `{"crawlId": …}` | 受理した（完了は待たない） |
| 400 `{"error": …}` | 読めない起点の URL や、目録が空のとき（`hint` つき）など |
| 404 | 名乗りに起こす許可が無い（`{"error":"not found"}`）か、台帳にクロールの投げ先の設定が無く、口ごと無い |
| 409 `{"error": …, "crawlId": …}` | 走行中のクロールがある（全体で 1 本）。`crawlId` が塞いでいる 1 本 |

門の判定は `src/lib.mjs` の `writeRefusal` に在り、試験から直接呼べます。

## /wacz/:id/… —— WACZ の中身へ行く口

WACZ（撮ったページを 1 つの ZIP にまとめたアーカイブ）を検証し、中を読む口です。
中の WARC（撮った要求と応答を順に記録するファイル）や索引は、窓に分けて読みます。

| 画面が呼ぶ | daemon へ | 返すもの |
| --- | --- | --- |
| `POST /wacz/:id/validate` | `POST /validate` | 検証の報告 |
| `GET /wacz/:id/lines?path=&from=&count=` | `POST /lines` | 行の窓 |
| `GET /wacz/:id/line?path=&n=` | `POST /line` | 1 行を丸ごとと、割った fields |
| `GET /wacz/:id/records?path=&from=&count=` | `POST /records` | WARC を頭から歩いたレコードの一覧 |
| `GET /wacz/:id/record?path=&offset=&length=` | `POST /record` | 1 レコード（WARC の見出し・HTTP・本文） |
| `GET /wacz/:id/record/body?path=&offset=&length=` | `POST /record/body` | 画像の実体。raster だけで、`nosniff` と `sandbox` つき。他は 415 |

この表は、`src/wacz.mjs` の `OPS` と突き合わされます（`npm run site:check`）。
口を足すときは、`OPS` と `paramsFor` とこの表の 3 か所を直します。

- **どの口も同じ 2 段。**
  台帳の `POST /api/archives/:id/url` で署名をもらい、その URL を daemon に渡します（順番の意味は [WACZ を見る](/wacz/)）。
- **画面が呼ぶのは GET、daemon へは POST。**
  `<img src>` も GET なので、画像の実体も GET で呼べるようにしてあります。
  検証だけは画面からも POST です（押したときだけ走らせる）。
- daemon へ送る本文は `{ "source": { "kind": "uri", "uri": "<署名付き URL>" }, …引数 }` です。
  検証の引数は `locale` だけです。

## 通すヘッダ

上流（台帳か daemon）の答えから通すヘッダは allowlist で、`src/server.mjs` の `PASS_HEADERS` が決めます。
daemon の `date` や `connection` は、画面の応答に混ぜません。
画像の実体は bytes のまま、daemon が付けた印（`nosniff`・`sandbox`・`no-store`）ごと通します。

## 失敗の形

失敗は、何が居ないかを言います。
「見えない」と「立っていない」を混ぜません。

| 状態 | いつ | 本文 |
| --- | --- | --- |
| 400 | `/wacz/` の口の引数が足りない、または数でない。台帳へは行かない | `{"error":"from is required"}` |
| 403 | `Host` がこの画面の口でない（どの口も）。書く口では、`Origin` がこの画面でないときも | `{"error":"この画面の Host ではない"}` など |
| 405 | method が違う。`/wacz/` の口（検証は POST、他は GET）と、`/api/*`（GET だけ。書く口を除く） | `POST だけ`・`GET だけ` など（`Allow` ヘッダつき） |
| 413 | 書く口の本文が 64 KiB を超えた | `{"error":"本文が 65536 バイトを超えた"}` |
| 415 | 書く口の `content-type` が JSON でない | `{"error":"JSON だけを受ける"}` |
| 台帳のまま | 台帳が断った（見てよくない archive の 404 など） | 台帳の本文 |
| 502 | issuer・台帳・daemon に届かない、または issuer が名乗りを断った | `{"error":"… に届かない (…)。…"}`。直し方の 1 文つき |
| 404 | `public/` に無いファイル、または配らない拡張子 | `not found` |

答えを流している途中で上流が切れたら、頭はもう書けないので、接続を閉じます。
