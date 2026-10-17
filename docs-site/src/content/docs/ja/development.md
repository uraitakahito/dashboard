---
title: 開発
description: 依存の線、検査と試験が見るもの・見ないもの、サンドボックスで開く、docs を直す、リリース
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

## サンドボックスで開く

台帳のスタックを起こさずに、画面を全部の状態で開く手です。
相手（台帳の代役と、本物の検証の daemon）はコンテナで、画面は host で動きます。

1. この repo の隣（`../wacz-validator`）に [wacz-validator](https://github.com/uraitakahito/wacz-validator) を置く。
   daemon の image は、その Dockerfile の daemon の段から建てます。
2. 起こして、開く。

   ```sh
   npm run sandbox       # 初回は daemon の image を建ててから起こす
   open http://127.0.0.1:7081/
   ```

3. 片付ける。
   画面は Ctrl-C で止まり、コンテナは `npm run sandbox:down` で止まります。

口は `dev:up` が起こすものとずらしてあるので、並べて動かせます（口は `sandbox/sandbox.env`）。
画面が読む設定は `sandbox/sandbox.env` だけで、あなたの `.env` は読みません。
コンテナの組み立ては、`docker-compose.yml` の頭に書いてあります。

何を見せるかは、台本（`sandbox/scenario.json`）と標本の WACZ（撮ったページをまとめたアーカイブ。`sandbox/samples/`）が決めます。
標本は、検証の結論が分かっている corpus から写したものです。
出どころと、それぞれが受けるはずの結論は `sandbox/samples/SOURCE.md` に在ります。

| したいこと | すること |
| --- | --- |
| 見せるものを変える | 台本を書き換える。代役は要求のたびに読むので、起こし直さずに画面に出る |
| 目録が空のときを見る | 台本の `"emptyCatalog"` を `true` にする。目録の面には受け皿の型だけが残る |
| 目録を変える | 台本の `catalog` を書き換える。1 版に 1 つで、`sandbox/catalog/` のファイル（capture-scripts v0.2.1 のスクリプトと受け皿の型の写し）を名指す。`sha256` と `bytes` は代役が台帳と同じくファイルから数え、既定の顔ぶれは有効な各 id の最新版。autoscroll v2 は同じファイルで `options` だけが違う版。`hostTypes` は受け皿の型で、消すと型を取り込んでいない台帳になる。写しは `check:terms` から外してある（別の repo の言葉で、直すと行番号が実物とずれる） |
| 別の WACZ を並べる | `SANDBOX_WACZ_DIR=<dir> npm run sandbox`（相対なら、この repo から。例: `../wacz-validator/samples`）。代役と daemon の両方に同じ置き場が入る |
| wacz-validator の更新を daemon に入れる | `npm run sandbox:build`。`npm run sandbox` は、image が無いときにしか建てない |
| 起こす面を試す | 起こす面から起こす。代役は受けた行を台本の `submit.runsSeconds` 秒だけ走らせてから完走にする。走っている間にもう 1 度押すと 409、読めない URL は 400。走らせるもの（目録のチェックとその場の JS）も台帳と同じ形で受け、知らない目録の id・同じ id の重ね・名前の綴りは台帳と同じ文で 400。行を開くと走らせたものが出る |
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
- **「名乗り」は、誰として見るかにだけ使う。**
  issuer が返す物はアクセストークンと書きます（英語版は access token）。
  2 つを混ぜた形は、`npm run check` の中の `scripts/check-terms.mjs` が見張ります。

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
