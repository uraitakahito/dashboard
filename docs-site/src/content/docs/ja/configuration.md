---
title: 設定
description: .env は要らない。変えるのは「誰として見るか」と「どこを見るか」だけ —— 環境変数の表と、読む順
---

## .env は要らない

既定値だけで動きます。
`.env.example` の行は全部コメントで、生きた行が 1 つもありません。
写すのは、「誰として見るか」か「どこを見るか」を変えるときだけです。

```sh
cp -n .env.example .env    # 要る行のコメントを外す
```

[capture-ledger](https://github.com/uraitakahito/capture-ledger)（クロールを起こし、撮れたものを記録する台帳）と違うのは、ここには既定値を持てない値が 1 つも無いからです。
capture-ledger は、OpenFGA（認可のサービス）の id のように「走らせてみないと決まらない値」を必須で持つので、`.env` が要ります。
こちらが持つのは名乗り（誰として見るか）と宛先だけで、アクセストークンは要るときに issuer から取得し、宛先は loopback の決め打ちで足ります。
秘密は 1 つもありません。

## 環境変数

| 名前 | 既定値 | 何を決めるか |
| --- | --- | --- |
| `DASHBOARD_PORT` | `7080` | 画面の待受。loopback（`127.0.0.1`）にだけ bind する |
| `DASHBOARD_LEDGER_URL` | `http://127.0.0.1:7070` | 台帳の API |
| `DASHBOARD_ISSUER_URL` | `http://127.0.0.1:9099` | 開発用 issuer。capture-ledger の `pnpm run oidc:issuer` が立てるもの |
| `DASHBOARD_SUBJECT` | この機械のユーザー名 | 誰として見るか。この名前に許可が要る（[クイックスタート](/quickstart/)） |
| `DASHBOARD_ORGANIZATIONS` | `acme` | 名乗る組織（カンマ区切り） |
| `DASHBOARD_REPLAY_URL` | `http://127.0.0.1:8899` | アーカイブの行の「replay ↗」の行き先 |
| `DASHBOARD_WINDMILL_URL` | `http://127.0.0.1:8000` | クロールの行の「run ↗」の行き先 |
| `DASHBOARD_WINDMILL_WORKSPACE` | `crawler` | 「run ↗」が開く Windmill の workspace |
| `DASHBOARD_VALIDATOR_URL` | `http://127.0.0.1:7180` | 検証と中身に答える [wacz-validator](https://github.com/uraitakahito/wacz-validator)（WACZ を規則ごとに検証する検証器）の daemon |

この表は、`src/server.mjs` と `.env.example` と突き合わされます（`npm run site:check`）。
変数を足すときは、3 か所とも直します。

### 名乗りは便利さで、守りではない

画面は `DASHBOARD_SUBJECT` と `DASHBOARD_ORGANIZATIONS` の名前で、開発用 issuer の `POST /token` からアクセストークンを取得します。
開発用 issuer は、頼まれれば誰の名前でも出します。
ここで名前を変えれば、その名前として見えるものが見えます。
だからこの画面は境界ではなく、loopback の外に出しません。

### 行き先は、画面が組み立てない

replay と Windmill の行き先は、配備の事実です。
台帳が返すのは `objectKey` と run の id だけなので、どこで開くかはサーバが 1 か所で決め、`/healthz` で画面に配ります（[中継の口](/routes/)）。

## 読む順

`npm run dev` は、`.env`・`.env.local` の順に読みます（在れば。無くても止まりません）。

- 同じ名前が両方に在れば、後から読む `.env.local` が勝ちます。
- 端末で渡した変数は、どちらのファイルよりも勝ちます。
  `DASHBOARD_PORT=7081 npm run dev` のように、その場だけ変えられます。

## 空は「無い」と同じ

`NAME=` と値を書かずに置くと、既定値になります（POSIX の `${VAR:-word}` と同じ側）。
crawler の他の repo と同じ意味に揃えてあります。
値を書かないなら、行ごとコメントにしてください。

## 7080 であって 7000 ではない

macOS の ControlCenter（AirPlay Receiver）が `*:7000` を握っています。
`127.0.0.1:7000` に bind できてしまうので気づきにくいのですが、`localhost:7000` が `::1` へ解決されると AirPlay に当たります。
port から持ち主を引く道具（capture-ledger の `dev:status`・`dev:down`）も、毎回「別のものが握っている」と言うことになります。
だから台帳（7070）の隣の 7080 を取っています。
