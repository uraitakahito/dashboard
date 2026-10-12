---
title: 開発
description: 依存の線、検査と試験が見るもの・見ないもの、台帳を起こさずに確かめる手、docs を直す、リリース
---

## 依存の線

**画面（repo の根）は依存を持ちません。**
在るのは node の http サーバ 1 本と、ブラウザで素のまま走る JS だけです。
bundler も framework も通さないので、画面のためには install も lockfile も audit も要りません（[capture-scripts](https://github.com/uraitakahito/capture-scripts) と同じ判断）。
分割したくなるほど育ったら、そのとき入れます。

依存が在るのは `docs-site/`（このサイトの原稿。Astro + Starlight）だけで、npm の別 project にしてあります。
lockfile も audit も Dependabot もそこに閉じ、root に `node_modules` を作りません。

| 打つもの | 何をするか |
| --- | --- |
| `npm run dev` | 画面を配り、`/api/*` を台帳へ、`/wacz/*` を daemon へ中継する |
| `npm run check` | push の前に走らせる、画面の検査の全部。中身と並びは `package.json` の `check`（CI の `ci.yml` が走らせるのも同じ） |
| `npm run site:check` | docs を build し、docs と repo のずれを見る（先に `npm ci --prefix docs-site`） |

root の script は `pnpm run` で打っても同じです（[capture-ledger](https://github.com/uraitakahito/capture-ledger) の `dev:up` は、この画面を `pnpm run dev` で起こします）。
`check` に `site:check` は入れていません。
`check` が install なしで走ることも、画面の性質の一部だからです。

## 試験が見るもの、見ないもの

試験（`test/`、`node --test`）が見るのは、外と話さない部分だけです。
経路の読み、引数の組み替え、署名が外に出ないこと、状態と数の描き方などです。
そういう部分は、試験から直接呼べるように `src/wacz.mjs` や `public/format.js` のようなファイルに切り出してあります。
`public/` のものは、ブラウザが読むのと同じファイルを試験も読むので、写しが腐りません。

**中継と名乗りは、CI では見ません。**
台帳と issuer が立っていないと確かめられないので、証拠は手で当てて PR に貼ります。

## 台帳を起こさずに確かめる

画面を本物の daemon に当てて確かめたいが、台帳とスタックは起こしたくないときの手です。

1. 偽の台帳を、空いている口（たとえば 7071）に立てる。
   答えるのは、画面が読む台帳の口（どれを読むかは `public/app.js` の `api(` の呼び出し）と、署名の口（`POST /api/archives/:id/url`）だけでよい。
   署名の口は、手元の WACZ（撮ったページをまとめたアーカイブ）の `file://` の URL を `{"url": …}` で返す。
   daemon は `file://` も読みます。
2. 2 つ目の画面を、偽の台帳に向けて立てる。

   ```sh
   DASHBOARD_PORT=7081 DASHBOARD_LEDGER_URL=http://127.0.0.1:7071 npm run dev
   ```

   画面は台帳へ行く前に名乗りを取るので、issuer にも届く必要があります。
   issuer が立っていなければ、偽の台帳に `POST /token`（`{"access_token": "…"}` を返す）も答えさせ、`DASHBOARD_ISSUER_URL` もそこへ向けます。
3. `http://127.0.0.1:7081/` を開いて、アーカイブの行の「検証」や「開く」を押す。

headless Chrome の `--dump-dom` で読もうとすると、終わりません。
画面が一覧を引き続けるからです（止めたときには DOM は出ています）。
自動で押すなら puppeteer のような、ページを操作する道具を使います。

## docs を直す

```sh
npm ci --prefix docs-site   # 1 度だけ
npm run site:dev            # その場で見る
npm run site:check          # push の前に
```

- **`astro build` は守りにならない。**
  `.md` のページは、描画の中で何が落ちても Starlight が握り潰して終了コード 0 になります。
  だから `site:check` は build と `scripts/check-doc-refs.mjs` を一緒に走らせ、CI（`site.yml`）も同じものを走らせます。
  何を見ているかは、そのファイルの冒頭に書いてあります。
- **図（mermaid）は、ブラウザで見る。**
  図はブラウザの側で描くので、構文を間違えても build は通ります。
  図を変えたら `npm run site:dev` で開いて、図が描けていて「Syntax error」が出ていないことを見ます。
  build したものを見るなら `npm run site:build && npm run site:preview` です。
  preview は裏に回って `http://localhost:4321/dashboard/` で配り続けるので、見終えたら `cd docs-site && npx astro preview stop` で止めます。
- **en と ja は同じ PR で直す。**
  対の検査が比べるのはファイル名だけで、中身は見ません。
  逐語訳でなくてよく、同じ事実をそれぞれの言葉で書きます。
- **本文のリンクは `[x](/page/)` と書く。**
  base（`/dashboard`）と `/ja` は `docs-site/src/plugins/hast-rebase-links.ts` が付けます。
  frontmatter の中のリンクだけはそこを通らないので、`/dashboard/…` と書きます。
- **日本語は、句読点の後で改行する。**
  文の途中で改行すると、表示で字の間に空白が出ます。

## リリースと公開

1. 変更は枝で作り、main へ PR を出して squash でマージする。
2. マージした main の commit に、手で注釈タグを打つ（`vX.Y.Z — 要約`）。
   版はタグだけです。
   `package.json` の `version` は版ではありません。
3. タグの push で、`docs.yml` が docs を GitHub Pages に公開する。

main にマージしただけでは、Pages は変わりません。
公開する docs を、出した版の docs にするためです（github-pages の環境も、`v*` のタグからの配備だけを許します）。
公開し直すときは、タグを指して `gh workflow run docs.yml --ref vX.Y.Z` です。

docs-site の依存は、Dependabot が週に 1 度、1 本の PR にまとめて上げます。
既知の脆弱性は、`audit.yml` が毎日 lockfile を見ます。
