# dashboard

crawler の開発用の画面。**1 本のクロールを 1 行で見る。**

起こすのは [capture-ledger](https://github.com/uraitakahito/capture-ledger)、走らせるのは
[capture-scheduler](https://github.com/uraitakahito/capture-scheduler) の Windmill、置くのは
[seaweedfs](https://github.com/uraitakahito/seaweedfs)、読むのは
[replay](https://github.com/uraitakahito/replay) —— 人の頭の中では 1 本なのに、
画面が 4 枚に割れていた。ここはその 4 枚を跨いだ像を、台帳の API から組み立てて出す。

```sh
pnpm run dev            # http://127.0.0.1:7080/
```

**`.env` は要らない。** 既定値だけで動く —— `.env.example` の行は**全部コメント**で、
生きた行が 1 つも無い。写すのは「誰として見るか」か「どこを見るか」を変えるときだけ。

capture-ledger と違うのは、**ここに既定値を持てない値が 1 つも無い**から。あちらは
OpenFGA の id のように「走らせてみないと決まらない値」を必須で持つので `.env` が要る
（それも `.env.local` に道具が書く）。こちらが持つのは名乗りと宛先だけで、名乗りは
起動のたびに issuer から取り、宛先は loopback の決め打ちで足りる。

ふだんは capture-ledger の `pnpm run dev:up` が **15 段目**として起こすので、単体で打つのは
画面だけを直すときになる。止めるのも向こうの `pnpm run dev:down`（ホストの 3 本目として
面倒を見てくれる）。

7000 ではなく **7080** なのは、macOS の ControlCenter (AirPlay Receiver) が `*:7000` を
握っているため（実測）。`127.0.0.1:7000` に bind できてしまうので気づきにくいが、
`localhost:7000` が `::1` へ解決されると AirPlay に当たる。

## 4 つの面

| 面           | 何が並ぶか                                                              |
| ------------ | ----------------------------------------------------------------------- |
| クロール     | 1 行 = 1 本。状態・撮れた数・見つけた数・WACZ の数・run と replay への行き先 |
| アーカイブ   | 見えている WACZ。行から **検証**（下）、**中身**（下）、replay へ       |
| 目録         | ページの中で走らせるもの。**空なら赤で言う**                            |
| 中身         | WACZ 1 本の中。木・行・1 行・WARC のレコード。アーカイブの行の「開く」で入る |

行をクリックすると、取れなかった URL と理由が出る（そのときだけ `/api/crawls/:id` を引く）。

### WACZ の中身

アーカイブの行の「開く」で、その 1 本の面に入る（`#wacz/<archiveId>`。選んだ entry と行まで
URL に載るので、`#wacz/…/indexes%2Findex.cdxj:66` のように指せる）。

開くと検証が走り、左の木は報告の `entries` から組む —— waxlens（wacz-validator の tui）と
**同じ入力・同じ罫線**。右は選んだ entry の詳細（大きさ・STORE / DEFLATE・なぜ要るか・
その entry への指摘）と中身:

- **行**: 200 行ずつの窓。長い行は横で切る。`next` があれば「続きを読む」
- **1 行**: 行を押すと丸ごと（4 MiB まで）。CDXJ と JSONL は daemon が field に割って返す
  （`readLine` の `fields`。**画面は割り方を持たない**）。索引の行なら「このレコードを開く」
- **レコードの一覧**: `.warc.gz` を選ぶとこちら。WARC を頭から歩いた 1 件 1 行で、
  種別で絞れる。▪ は索引（CDXJ）が指すレコード、▫ は索引に無いもの —— BrowserHive が
  残す「撮らなかった・撮れなかった」記録（`WARC-Type: metadata`）はここでしか見えない
- **1 レコード**: WARC の見出し・HTTP の状態行と見出し・本文。本文は文字か、raster の画像
  （PNG / JPEG / GIF / WebP / AVIF）か、大きさだけ

**撮った中身は他人が書いたもの。** 文字は `textContent`、画像は raster だけを `<img>` で
（daemon が `nosniff` と `sandbox` を付け、SVG と HTML は 415 で断る）。生の HTML を
差し込む API はこの画面に無く、`pnpm run check` が見張る。

### state だけでは足りない

実機の 68 本の内訳は、`succeeded / max_depth` が 41・`failed` が 22・`succeeded /
completed` が 4、そして **`succeeded` なのに `stopReason` が `failed` の行が 1**。
`state` だけを描くと 42 本を取り違えるので、完走と打ち切りを分けて言い、知らない
`stopReason` は括弧に入れてそのまま見せる。規則は `public/format.js` に切り出して
試験で固定してある（ブラウザが読むのと**同じファイル**なので、写しが腐らない）。

### 撮れたものが仕様どおりか

アーカイブの行の「検証」で、[wacz-validator](https://github.com/uraitakahito/wacz-validator)
の報告が開く。合格・警告・失敗の数、rule ごとの指摘（仕様へのリンクつき）、
ZIP の entry の一覧。結果は行にも残る。

**鍵はどこにも増えない。** 渡すのは台帳が署名した URL 1 本で、検証する daemon は
store の資格情報を持たない。順番にも意味があって、**先に台帳へ訊く** ——
見てよい archive でなければ 404 になり、daemon までは行かない。絞るのは認可を
持っている側。

署名付き URL は**ここから外に出さない**（応答にもログにも載せない）。報告に載る
`source` は daemon が query を落とした identity なので、そのまま返してよい。

**文は 1 つも持たない。** message も日本語も spec の節も daemon が解決して返す ——
画面がルールを言い換えると、検証器が言い始めたことと静かにずれる。

### 走っている間だけ速く引く

`running` が 1 本でもあれば 2 秒ごと、無ければ 30 秒ごと。1 往復 1 クエリなので、
写しを持たなくても live に見える —— **動いていないときは黙る**。

## この repo は秘密を持たない

台帳へ名乗るトークンは、開発用 issuer の `POST /token` から**起動のたびに取る**
（capture-ledger の `pnpm run oidc:token` が中でやっているのと同じこと）。
`.env` に書くのは「誰として見るか」と「どこを見るか」だけで、鍵も token も置き場が無い。

**そのぶん、これは境界ではない。** 開発用 issuer は頼まれれば誰の名前でもトークンを
出すので、ここの「名乗り」は便利さであって守りではない。画面もそう書いてある。

寿命は数えず、**401 を受けたら取り直す**。issuer を起こし直すと鍵ごと変わるので、
「まだ有効なはず」の時計は当てにならない。

## 依存を持たない

node の標準ライブラリだけで建っている。bundler も framework も通さないので、
pnpm も lockfile も audit も要らない（[capture-scripts](https://github.com/uraitakahito/capture-scripts)
と同じ判断）。分割したくなるほど育ったら、そのとき入れる。

| 打つもの         | 何をするか                                                  |
| ---------------- | ----------------------------------------------------------- |
| `pnpm run dev`   | 画面を配り、`/api/*` を台帳へ、`/wacz/*` を daemon へ中継する |
| `pnpm run check` | JS として読めるか ＋ 外と話さない部分の試験（`node --test`） |

## 台帳の口を、そのまま使う

中継するだけで、**画面のロジックはサーバに置かない** —— 置いた瞬間に「台帳が
知っていることの写し」が生まれる。`/api/*` は台帳へそのまま通す。読んでいるのは
`GET /api/crawls`・`GET /api/crawls/:id`・`GET /api/archives`・`GET /api/scripts`・`GET /api/me`。

WACZ の中身へ行く口は `/wacz/<archiveId>/…` に集めてある（`src/wacz.mjs`）。6 本とも
同じ 2 段 —— 台帳の `POST /api/archives/:id/url` で署名をもらい、その URL を daemon に
渡す。画面が呼ぶのは GET（`<img src>` も GET）で、daemon へは POST に組み替える。

| 画面が呼ぶ                                        | daemon へ           | 返す                                    |
| ------------------------------------------------- | ------------------- | --------------------------------------- |
| `POST /wacz/:id/validate`                         | `POST /validate`    | 検証の報告                              |
| `GET /wacz/:id/lines?path=&from=&count=`          | `POST /lines`       | 行の窓（1 行 2 KiB まで・500 行まで）    |
| `GET /wacz/:id/line?path=&n=`                     | `POST /line`        | 1 行を丸ごと（4 MiB まで）と、割った fields |
| `GET /wacz/:id/records?path=&from=&count=`        | `POST /records`     | WARC を頭から歩いたレコードの一覧       |
| `GET /wacz/:id/record?path=&offset=&length=`      | `POST /record`      | 1 レコード（見出し・HTTP・本文）        |
| `GET /wacz/:id/record/body?path=&offset=&length=` | `POST /record/body` | 画像の実体。raster だけ、`nosniff` と `sandbox` つき。他は 415 |

通すヘッダは allowlist（`content-type`・`content-length`・`x-content-type-options`・
`content-security-policy`・`cache-control`）。daemon の `date` や `connection` は混ぜない。

中継するのは、台帳が CORS を返さないため（`OPTIONS /api/archives` は 404）。
ブラウザから直に叩く道が塞がっているので、同一オリジンにする。

## 公開しない

`127.0.0.1` にだけ bind する。http なのは、**https のページから `127.0.0.1` を叩くと
Chrome の Private Network Access が止める**ため（seaweedfs の `scripts/ui.sh` に実測の
記録がある）。GitHub Pages に置く道はそこで閉じている。

## ライセンス

Unlicense（`LICENSE`）。
