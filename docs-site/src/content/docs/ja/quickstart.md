---
title: クイックスタート
description: 画面を起こす（ふだんは capture-ledger の dev:up が起こす）、名乗りに許可を付ける、出た文から直す
---

## ふだんは dev:up が起こす

dashboard は、単体では何も見せません。
読む相手（台帳の API と開発用 issuer）と、検証と中身に答える daemon が要ります。
それをまとめて起こすのが [capture-ledger](https://github.com/uraitakahito/capture-ledger)（どの URL を撮るかを決め、撮れたものを記録する台帳）の `dev:up` で、この画面もその一部として起こされます。

```sh
cd ../capture-ledger
pnpm run dev:up       # 終わると画面の URL を出す
open http://127.0.0.1:7080/
```

`dev:up` は、この repo が capture-ledger の隣（`../dashboard`）に在るものとして起こします。
別の場所に置いたなら `pnpm run dev:up --dashboard <path>` です。
スタックの起こし方の全体は、capture-ledger の[クイックスタート](https://uraitakahito.github.io/capture-ledger/ja/quickstart/)に在ります。

| したいこと | capture-ledger で打つもの |
| --- | --- |
| 画面だけを起こし直す | `pnpm run dev:up --from dashboard` |
| 何が立っているかを見る | `pnpm run dev:status` |
| 止める | `pnpm run dev:down`（ホストで動かしたものも止める） |

## 画面だけを直すとき

画面を直すだけなら、この repo で起こします。
依存を持たないので、install は要りません。

```sh
npm run dev           # http://127.0.0.1:7080/
```

台帳の API と issuer は立っている必要があります（`dev:up` が起こしたもので足ります）。
「検証」と「中身」には daemon も要ります。
台帳のスタックを起こしたくなければ、[サンドボックス](/development/#サンドボックスで開く)で開けます。
`npm run sandbox` が、台帳の代役と本物の daemon をコンテナで起こし、画面を 7081 で開きます。

`public/` の変更は、ブラウザを読み直すだけで効きます（サーバは要求のたびにディスクから読みます）。
`src/` を変えたら起こし直してください。
`dev:up` が起こした画面が 7080 を握っているなら、`npm run dev` はそう言って終わります（下の表）。
並べて動かすなら、口をずらします（`DASHBOARD_PORT=7081 npm run dev`）。

## 名乗りに許可を付ける

画面は、既定ではこの機械のユーザー名で台帳に名乗ります（[設定](/configuration/)の `DASHBOARD_SUBJECT`）。
その名前に、組織のクロールの許可が要ります。

```sh
cd ../capture-ledger
pnpm run fga:grant submitter "$(whoami)" acme   # 1 度だけ
```

capture-ledger のクイックスタートをたどったなら、そこで済んでいます。
許可が無いと、画面の上に赤で `not found` と出て、一覧は空のままです。
台帳は、許可の無い名乗りにクロールの一覧を空で返し、目録には 404 を返します。
画面はその 404 を受けて、一覧を描かずに止まります。

## 出た文から直す

| どこに | 出る文 | 直し方 |
| --- | --- | --- |
| 画面の上（赤） | `not found` | 名乗りに許可が無い。上の `fga:grant` |
| 画面の上（赤） | `… に届かない (…)。capture-ledger で pnpm run oidc:issuer は動いているか?` | 開発用 issuer が立っていない。`dev:up` で起こす |
| 画面の上（赤） | `… が名乗りを断った (…)。…` | issuer が名乗りを断った。issuer の端末を見る |
| 画面の上（赤） | `… に届かない (…)。capture-ledger で pnpm run api は動いているか?` | 台帳の API が立っていない。`dev:up` で起こす |
| 検証の欄・中身の面 | `… に届かない (…)。capture-ledger で pnpm run dev:up --from validator は済んでいるか?` | daemon が立っていない。言われたとおりに打つ |
| 名乗りの欄 | `この画面自身に届きません` | 画面のサーバが止まっている。起こし直す |
| 足元 | `取りに行けませんでした（上の表は最後に描けたもの）` | 理由は画面の上の赤い文。表は最後に描けたものを残している |
| 目録の面（赤） | `目録が空です。…` | 走らせるスクリプトが台帳に無い。赤い文の中のコマンドで取り込む |
| 起こす面の「起こす」の下 | `404 —— not found` | 名乗りに起こす許可が無い。上の `fga:grant` |
| 起こす面の「起こす」の下 | `404 —— Route POST:/api/crawls not found` | 台帳がクロールの投げ先（Windmill）を知らない。`dev:up` のスタックなら在る |
| クロールの面（移る） | 走行中の行に印 | 409。走っているのは全体で 1 本まで。印の付いた行が終わるのを待つ |
| 端末 | `127.0.0.1:7080 は、既に動いているこの画面です (pid …)。` | 開くだけでよい。起こし直すなら `pnpm run dev:up --from dashboard` |
| 端末 | `127.0.0.1:7080 は別のものが握っています …` | `pnpm run dev:status` で正体を見て、`pnpm run dev:down` で片付ける |

画面は、失敗しても表を消しません。
空の表は「見えるものが無い」と読めてしまい、「取りに行けない」と区別が付かないからです。
