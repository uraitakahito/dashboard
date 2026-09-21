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

## 3 つの面

| 面           | 何が並ぶか                                                              |
| ------------ | ----------------------------------------------------------------------- |
| クロール     | 1 行 = 1 本。状態・撮れた数・見つけた数・WACZ の数・run と replay への行き先 |
| アーカイブ   | 見えている WACZ。行から replay へ                                       |
| 目録         | ページの中で走らせるもの。**空なら赤で言う**                            |

行をクリックすると、取れなかった URL と理由が出る（そのときだけ `/api/crawls/:id` を引く）。

### state だけでは足りない

実機の 68 本の内訳は、`succeeded / max_depth` が 41・`failed` が 22・`succeeded /
completed` が 4、そして **`succeeded` なのに `stopReason` が `failed` の行が 1**。
`state` だけを描くと 42 本を取り違えるので、完走と打ち切りを分けて言い、知らない
`stopReason` は括弧に入れてそのまま見せる。規則は `public/format.js` に切り出して
試験で固定してある（ブラウザが読むのと**同じファイル**なので、写しが腐らない）。

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
| `pnpm run dev`   | 画面を配り、`/api/*` を台帳へ中継する                       |
| `pnpm run check` | JS として読めるか ＋ 外と話さない部分の試験（`node --test`） |

## 台帳の口を、そのまま使う

中継するだけで、**画面のロジックはサーバに置かない** —— 置いた瞬間に「台帳が
知っていることの写し」が生まれる。読んでいるのは
`GET /api/crawls`・`GET /api/crawls/:id`・`GET /api/archives`・`GET /api/scripts`・`GET /api/me`。

中継するのは、台帳が CORS を返さないため（`OPTIONS /api/archives` は 404）。
ブラウザから直に叩く道が塞がっているので、同一オリジンにする。

## 公開しない

`127.0.0.1` にだけ bind する。http なのは、**https のページから `127.0.0.1` を叩くと
Chrome の Private Network Access が止める**ため（seaweedfs の `scripts/ui.sh` に実測の
記録がある）。GitHub Pages に置く道はそこで閉じている。

## ライセンス

Unlicense（`LICENSE`）。
