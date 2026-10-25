---
title: 開発
description: 依存の線、検査と試験が見るもの・見ないもの、サンドボックスで開く、docs を直す、画面の絵を撮り直す、リリース
---

## 依存の線

**dashboard（repo の根）は npm の依存を持ちません。**
在るのは node の http サーバ 1 本と、ブラウザで素のまま走る JS だけです。
framework は通さないので、dashboard のためには install も lockfile も audit も要りません（[capture-scripts](https://github.com/uraitakahito/capture-scripts) と同じ判断）。
分割したくなるほど育ったら、そのとき入れます。
**例外は `public/vendor/shiki.js` の 1 ファイルです。**
目録の色付けを 1 ファイルに束ねて commit した物で（[同梱した色付け](#同梱した色付け)）、dashboard はそれを読むだけなので、install は今も要りません。

依存が在るのは 2 つで、どちらも npm の別 project にしてあります。
`docs-site/`（このサイトの原稿。Astro + Starlight と、画面の絵を撮る道具）と、`highlighter/`（`public/vendor/shiki.js` を作る元）です。
lockfile も audit も Dependabot もそこに閉じ、root に `node_modules` を作りません。

| 打つもの | 何をするか |
| --- | --- |
| `npm run dev` | 画面（`public/`）を配り、`/api/*` を台帳へ、`/wacz/*` を daemon へ中継する |
| `npm run check` | push の前に走らせる、dashboard の検査の全部。中身と並びは `package.json` の `check`（CI の `ci.yml` が走らせるのも同じ） |
| `npm run site:check` | docs を build し、docs と repo のずれを見る（先に `npm ci --prefix docs-site`） |
| `npm run vendor` | `highlighter/` の lockfile から `public/vendor/`（束と、束ねた物の license の本文）を作り直す |
| `npm run vendor:check` | 作り直して、commit した物と 1 バイトでも違えば落ちる（CI の `vendor.yml` が走らせる） |

root の script は `pnpm run` で打っても同じです（[capture-ledger](https://github.com/uraitakahito/capture-ledger) の `dev:up` は、dashboard を `pnpm run dev` で起こします）。
`check` に `site:check` は入れていません。
`check` が install なしで走ることも、dashboard の性質の一部だからです。

## 同梱した色付け

目録の画面は、`public/vendor/shiki.js` で source に色を付けます。
[Shiki](https://shiki.style) を、TypeScript の文法と 2 つの配色（GitHub Light High Contrast と GitHub Dark Default）だけにして、esbuild で束ねた物です（何を入れるかは `highlighter/entry.mjs`）。
束は詰めてあるので、差分を読んでレビューできません。
読むのは lockfile と `highlighter/build.mjs` にして、束がそこから作った物どおりかは `vendor.yml` に見させます。

- **`public/vendor/` を手で直さない。**
  書くのは `npm run vendor` です。Shiki の版を上げたら走らせます。
- **`highlighter/` への Dependabot の PR は、`package.json` と lockfile しか変えない。**
  なので `vendor.yml` が赤になります。その枝で `npm run vendor` を走らせ、作り直した物を commit してから入れます。
- **束ねる物に MIT 以外が混ざると、作り直しが止まる**（`highlighter/build.mjs`）。そのときは何も書きません。
  束ねた物の license の本文は `public/vendor/shiki.LICENSES.txt` に在ります。
- **色は、画面の地に対して測る。**
  `test/highlight.test.mjs` が `public/app.css` の `--ground` を読み、目録のファイルで使う色が明暗とも 4.5:1 以上かを見ます。地や配色を替えれば、測り直しになります。
- **`npm run check` は `innerHTML` を `public/` の下の全部で探す。** 束も含みます。
- **色付けは worker で走る**（`public/highlight-worker.js`）。
  Shiki は最初の 1 本で文法を組むので、画面を描く thread で走らせると 100 ms を優に超えて止まります。
  色は描いてある行に、1 コマに数 ms ずつ塗ります。

## 試験が見るもの、見ないもの

試験（`test/`、`node --test`）が見るのは、外と話さない部分だけです。
経路の読み、引数の組み替え、署名が外に出ないこと、状態と数の描き方などです。
そういう部分は、試験から直接呼べるように `src/wacz.mjs` や `public/format.js` のようなファイルに切り出してあります。
`public/` のものは、ブラウザが読むのと同じファイルを試験も読むので、写しが腐りません。

**中継と名乗りは、CI では見ません。**
台帳と issuer が立っていないと確かめられないので、証拠は手で当てて PR に貼ります。

## サンドボックスで開く

台帳のスタックを起こさずに、dashboard を全部の状態で開く手です。
相手（台帳の代役と、本物の検証の daemon）はコンテナで、dashboard は host で動きます。

1. この repo の隣（`../wacz-validator`）に [wacz-validator](https://github.com/uraitakahito/wacz-validator) を置く。
   daemon の image は、その Dockerfile の daemon の段から建てます。
2. 起こして、開く。

   ```sh
   npm run sandbox       # 初回は daemon の image を建ててから起こす
   open http://127.0.0.1:7081/
   ```

3. 片付ける。
   dashboard は Ctrl-C で止まり、コンテナは `npm run sandbox:down` で止まります。

口は `dev:up` が起こすものとずらしてあるので、並べて動かせます（口は `sandbox/sandbox.env`）。
dashboard が読む設定は `sandbox/sandbox.env` だけで、あなたの `.env` は読みません。
コンテナの組み立ては、`docker-compose.yml` の頭に書いてあります。

何を見せるかは、台本（`sandbox/scenario.json`）と標本の WACZ（撮ったページをまとめたアーカイブ。`sandbox/samples/`）が決めます。
標本は、検証の結論が分かっている corpus から写したものです。
出どころと、それぞれが受けるはずの結論は `sandbox/samples/SOURCE.md` に在ります。

| したいこと | すること |
| --- | --- |
| 見せるものを変える | 台本を書き換える。代役は要求のたびに読むので、起こし直さずに画面に出る |
| 目録が空のときを見る | 台本の `"emptyCatalog"` を `true` にする。目録の画面には受け皿の型だけが残る |
| 目録を変える | 台本の `catalog` を書き換える。1 版に 1 つで、`sandbox/catalog/` のファイル（capture-scripts v0.2.1 のスクリプトと受け皿の型の写し）を名指す。`sha256` と `bytes` は代役が台帳と同じくファイルから数え、一覧は有効な各 id の最新版。autoscroll v2 は同じファイルで `options` だけが違う版。`sites`（札）のある版はサイト用の台本で、既定で走るのは起点のどれかが札のホストにあるときだけ。見本の `example-title`（札 `example.com`）のファイルは `sandbox/sites/` に在る（capture-scripts には無い）。`hostTypes` は受け皿の型で、消すと型を取り込んでいない台帳になる。写しは `check:terms` から外してある（別の repo の言葉で、直すと行番号が実物とずれる） |
| 別の WACZ を並べる | `SANDBOX_WACZ_DIR=<dir> npm run sandbox`（相対なら、この repo から。例: `../wacz-validator/samples`）。代役と daemon の両方に同じ置き場が入る |
| wacz-validator の更新を daemon に入れる | `npm run sandbox:build`。`npm run sandbox` は、image が無いときにしか建てない |
| 新しいクロールの画面を試す | 新しいクロールの画面から始める。代役は受けた行を台本の `submit.runsSeconds` 秒だけ走らせてから完走にする。走っている間にもう 1 度押すと 409、読めない URL は 400。走らせるもの（目録のチェックとその場の JS）も台帳と同じ形で受け、知らない目録の id・同じ id の重ね・名前の綴り・起点に合わないサイト用の台本の名指し・既定が空（目録が空か、全部が別のサイト用）は台帳と同じ文で 400。行を開くと走らせたものが出る。チェックの横の「読む」は右の列に開く（代役の autoscroll は v2 で設定つき、example-title は起点に example.com が無いと押せないが読める） |
| 走らせたものの在る行を見る | 台本のクロールに `scripts` を書く（その場の物は `inline` つき）。同梱の台本には、その場の JS で完走した行と、compile の段で落ちた行が在る。代役も台帳と同じく、1 本の詳しい所には source を載せず、「欄に戻す」は名前の口（`/api/crawls/:id/inline/:name`）から取る。クロール `5b0c0008` の autoscroll の `sha256` はわざと目録の v1 と違えてあり、版の番号が使い回されたときに、クロールの「読む」が出す知らせを見られる |

代役にできないこともあります。

- **認可を真似ない。**
  名乗りは何でも通るので、許可が無いときの画面はここでは出ません。
- **replay ↗ と run ↗ の飛び先は、サンドボックスの外です。**
  開いても、代役の行は向こうに在りません。
- 検証の報告の版は `wacz-validator unknown` と出ます（image に `.git` を入れないため）。
- 画面の赤い文は、直し方に capture-ledger のコマンドを挙げます。
  サンドボックスでは、台帳は代役、daemon は `sandbox-validator` のコンテナと読み替えてください。
- 代役の答えの形は、台帳のコードから写したものです。
  台帳が欄を変えても、代役はついてきません（写した欄の集合は `test/sandbox.test.mjs` が固定しています）。
  本物との突き合わせは、`dev:up` のスタックでします。

headless Chrome の `--dump-dom` で読もうとすると、終わりません。
dashboard が一覧を引き続けるからです（止めたときには DOM は出ています）。
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
- **「名乗り」は、誰として見るかにだけ使う。**
  issuer が返す物はアクセストークンと書きます（英語版は access token）。
  2 つを混ぜた形は、`npm run check` の中の `scripts/check-terms.mjs` が見張ります。

## 画面の絵を撮り直す

[画面](/screens/)のページの絵は、`npm run docs:shots`（`docs-site/scripts/docs-shots.mjs`）が[サンドボックス](#サンドボックスで開く)を相手に撮った物です。
手で撮った絵は置きません。
CI では撮りません（代役のコンテナが要るので）。
撮るのは手元で、CI は撮った物を見張ります。

```sh
npm ci --prefix docs-site            # 1 度だけ（撮る道具は docs-site の依存）
npm run sandbox                      # 別の端末で。7081 が答えるまで待つ
npm run docs:shots                   # 全部。画素が前と同じ絵は書かない
npm run docs:shots -- start crawls   # 名指した絵だけ
```

- **dashboard を変えたら、撮り直してから PR にする。**
  dashboard（`public/`。束ねた色付けの `public/vendor/` も）、代役（`sandbox/`）、撮る道具のどれかを変えると、`site:check` が「絵の元が、撮ったときと違う」で落ちます。
  全部を撮り直すと、`shots.json` の控え（`source`）が今の中身の sha256 になり、絵は画素が変わった物だけが書かれます。
  見た目の変わらない直しなら、変わるのは控えだけです。
  控えを手で写して緑にしないこと —— 絵が古いまま残ります。
- **名指して撮っても、控えは変わらない。**
  控えを今に合わせるのは、全部を撮ったときだけです。
- **絵は lossless の WebP で、1 枚 40 KB・全部で 150 KB まで。**
  撮り直すたびに git に積もるからです。
  超えると `site:check` が落ちます。
  そのときは `docs-shots.mjs` の `SHOTS` で、写す箱を小さくするか、高さの上限（`maxHeight`）を下げます。
- **Chrome の版は決めてある**（`docs-shots.mjs` の `CHROME_BUILD`）。
  無ければ、道具が最初に `~/.cache/puppeteer` へ入れます。
  字の形は OS のフォントでも変わるので、撮るのは macOS です。
- **絵を足すときは、`SHOTS` に 1 つ足して撮り、ja・en の両方の screens.md に載せる。**
  置き場に在るのに `shots.json` に無い物と、`shots.json` に在るのにどちらかの screens.md が載せていない物は、`site:check` が落とします。
  番号の丸は絵の中に置き、字は数字だけにします。
  ja・en で同じ絵を使い、何を指すかは各言語の本文に書きます。

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
