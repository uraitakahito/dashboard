# dashboard

crawler の開発用の画面。**1 本のクロールを 1 行で見る。**

起こすのは [capture-ledger](https://github.com/uraitakahito/capture-ledger)、走らせるのは
[capture-scheduler](https://github.com/uraitakahito/capture-scheduler) の Windmill、置くのは
[seaweedfs](https://github.com/uraitakahito/seaweedfs)、読むのは
[replay](https://github.com/uraitakahito/replay) —— 人の頭の中では 1 本なのに、
画面が 4 枚に割れていた。ここはその 4 枚を跨いだ像を、台帳の API から組み立てて出す。

```sh
cp -n .env.example .env
pnpm run dev            # http://127.0.0.1:7080/
```

ふだんは capture-ledger の `pnpm run dev:up` が最後に起こすので、単体で打つのは
画面だけを直すときになる。

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

| 打つもの         | 何をするか                                   |
| ---------------- | -------------------------------------------- |
| `pnpm run dev`   | 画面を配り、`/api/*` を台帳へ中継する        |
| `pnpm run check` | JS として読めるか ＋ 外と話さない部分の試験  |

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
