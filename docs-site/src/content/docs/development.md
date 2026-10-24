---
title: Development
description: Where the dependencies stop, what the checks and tests see and do not see, opening the screen in the sandbox, editing these docs, re-taking the screenshots, releasing
---

## Where the dependencies stop

**The screen (the repository root) has no npm dependencies.** It is one Node http server and
JavaScript that runs as-is in the browser. Nothing goes through a framework, so the screen needs
no install, no lockfile and no audit (the same call as
[capture-scripts](https://github.com/uraitakahito/capture-scripts)). If it grows enough to want
splitting up, that is the time to add them. **The one exception is `public/vendor/shiki.js`,** the
coloring of the catalog view, bundled into a single file and committed (see
[The bundled coloring](#the-bundled-coloring)). The screen only reads it, so it still needs no
install.

Two things have dependencies, each kept as a separate npm project: `docs-site/` (the source of
this site, Astro + Starlight, and the tool that takes its screenshots) and `highlighter/` (what `public/vendor/shiki.js` is built from).
Their lockfiles, audits and Dependabot stay inside them, and no `node_modules` is created at the
root.

| Run | What it does |
| --- | --- |
| `npm run dev` | serves the screen, relaying `/api/*` to the ledger and `/wacz/*` to the daemon |
| `npm run check` | every check for the screen to run before pushing; what it runs, and in which order, is `check` in `package.json` (the same thing CI's `ci.yml` runs) |
| `npm run site:check` | builds the docs and checks that they match the repository (after `npm ci --prefix docs-site`) |
| `npm run vendor` | rebuilds `public/vendor/` (the bundle and the license texts of what it bundles) from the lockfile in `highlighter/` |
| `npm run vendor:check` | rebuilds, and fails if a single byte differs from what is committed (CI's `vendor.yml` runs it) |

The root scripts work the same with `pnpm run` (the `dev:up` of
[capture-ledger](https://github.com/uraitakahito/capture-ledger) starts the screen with `pnpm run dev`). `site:check` is deliberately not part of `check`: that `check` runs without
installing anything is part of the screen's nature too.

## The bundled coloring

The catalog view colors the source with `public/vendor/shiki.js`:
[Shiki](https://shiki.style) with only the TypeScript grammar and two themes (GitHub Light High
Contrast and GitHub Dark Default), bundled by esbuild (`highlighter/entry.mjs` names what goes in).
The bundle is minified, so its diff cannot be reviewed by reading it. Review the lockfile and
`highlighter/build.mjs` instead, and let `vendor.yml` check that the bundle is exactly what they
produce.

- **Do not edit `public/vendor/` by hand.** `npm run vendor` writes it. Run it after raising
  Shiki's version.
- **A Dependabot PR for `highlighter/` only changes `package.json` and the lockfile,** so
  `vendor.yml` fails on it. Run `npm run vendor` on that branch and commit the rebuilt files
  before merging.
- **The build stops if anything it bundles is not MIT** (`highlighter/build.mjs`), and then writes
  nothing. The license texts of everything bundled are in `public/vendor/shiki.LICENSES.txt`.
- **The colors are measured against the screen's backgrounds.** `test/highlight.test.mjs` reads
  `--ground` from `public/app.css` and requires every color the catalog's files use to reach
  4.5:1 in both schemes, so changing the background or the theme measures again.
- **`npm run check` looks for `innerHTML` under all of `public/`,** the bundle included.
- **The coloring runs in a worker** (`public/highlight-worker.js`): Shiki builds its grammar on
  first use, which would stop the page for well over 100 ms. The colors are painted onto the
  lines already drawn, a few milliseconds per frame.

## What the tests see, and what they do not

The tests (`test/`, `node --test`) only cover the parts that do not talk to the outside: parsing
routes, rewriting arguments, keeping the signature from leaking, how states and numbers are
worded, and so on. Those parts are split out into files such as `src/wacz.mjs` and
`public/format.js` so that the tests can call them directly. The ones under `public/` are the
same files the browser reads, so there is no copy to rot.

**Relaying and identity are not checked in CI.** They cannot be confirmed without the ledger and
the issuer running, so the evidence is gathered by hand and pasted into the PR.

## Opening the screen in the sandbox

A way to open the screen in every state without starting the ledger's stack. The other side (a
stand-in for the ledger, and the real validation daemon) runs in containers, and the screen runs
on the host.

1. Put [wacz-validator](https://github.com/uraitakahito/wacz-validator) next to this repository
   (`../wacz-validator`). The daemon's image is built from the daemon stage of its Dockerfile.
2. Bring it up and open it.

   ```sh
   npm run sandbox       # the first time, builds the daemon's image before starting
   open http://127.0.0.1:7081/
   ```

3. Clean up. Ctrl-C stops the screen, and `npm run sandbox:down` stops the containers.

Its ports are moved away from the ones `dev:up` uses, so both can run side by side (the ports are
in `sandbox/sandbox.env`). The screen reads only `sandbox/sandbox.env`, never your `.env`. How the
containers fit together is written at the top of `docker-compose.yml`.

What it shows is decided by the scenario (`sandbox/scenario.json`) and the sample WACZ files (the
archive files the crawler produces, in `sandbox/samples/`). The samples are copied from a corpus
whose validation results are known; where they come from, and the result each one should get, is
in `sandbox/samples/SOURCE.md`.

| To | Do |
| --- | --- |
| change what it shows | edit the scenario. The stand-in reads it on every request, so the change reaches the screen without restarting anything |
| see an empty catalog | set `"emptyCatalog"` to `true` in the scenario. The catalog face then lists only the receptacle types |
| change the catalog | edit the scenario's `catalog`: one entry per version, naming a file under `sandbox/catalog/` (copies of capture-scripts v0.2.1's scripts and receptacle types). The stand-in computes `sha256` and `bytes` from the file, as the ledger does, and its list is the newest enabled version of each id. autoscroll v2 is the same file with different `options`. A version with `sites` is a site script and runs by default only when a seed is on one of those hosts; the sample `example-title` (sites `example.com`) keeps its file under `sandbox/sites/` (it is not in capture-scripts). `hostTypes` is the receptacle types; remove it to see a ledger that has not imported them. The copies are left out of `check:terms`: they are another repository's words, and editing them would shift their line numbers |
| list other WACZ files | `SANDBOX_WACZ_DIR=<dir> npm run sandbox` (relative to this repository, for example `../wacz-validator/samples`). The stand-in and the daemon both get the same directory |
| put an updated wacz-validator into the daemon | `npm run sandbox:build`. `npm run sandbox` only builds the image when there is none |
| try the new crawl view | Start a crawl from the new crawl view. The stand-in runs each crawl it accepts for the scenario's `submit.runsSeconds` seconds, then completes it. Pressing again while it runs gives a 409; a URL that cannot be read gives a 400. It takes `scripts` (ticked catalog scripts and a script of your own) the way the ledger does, answers an unknown catalog id, the same id twice, a misspelt name, a site script that fits no seed, or an empty default (an empty catalog, or nothing that fits the seeds) with the ledger's 400, and lists what ran when you open the row. 読む (read) next to a checkbox opens the script in the right column (the stand-in's autoscroll is v2, with options; example-title cannot be ticked without an example.com seed, but can be read) |
| see rows with scripts | Give a crawl in the scenario a `scripts` list (a script written on the spot carries `inline`). The bundled scenario has a crawl that ran one and completed, and one that failed at the compile step. Like the ledger, the stand-in leaves the source out of a crawl's detail, and "put back in the form" fetches it from the route by name (`/api/crawls/:id/inline/:name`). The `sha256` of crawl `5b0c0008`'s autoscroll differs from catalog v1's on purpose, to show the warning a crawl's "read" link gives when a version number has been reused |

There are things the stand-in does not do:

- **It does not imitate authorization.** Any identity gets through, so the screens for a missing
  permission do not appear here.
- **replay ↗ and run ↗ lead outside the sandbox.** The stand-in's rows do not exist over there.
- The validation report says `wacz-validator unknown` (the image is built without `.git`).
- The red messages on the screen name capture-ledger commands as the fix. In the sandbox, read
  "the ledger" as the stand-in and "the daemon" as the `sandbox-validator` container.
- The shape of the stand-in's answers is copied from the ledger's code. When the ledger changes a
  field, the stand-in does not follow (`test/sandbox.test.mjs` pins the copied set of fields).
  Checking against the real thing happens on the `dev:up` stack.

Reading it with headless Chrome's `--dump-dom` never finishes, because the screen keeps fetching
its lists (the DOM is there by the time you stop it). To press buttons automatically, use a tool
that drives the page, such as puppeteer.

## Editing these docs

```sh
npm ci --prefix docs-site   # once
npm run site:dev            # see it as you edit
npm run site:check          # before pushing
```

- **`astro build` alone protects nothing.** In a `.md` page, whatever fails while rendering is
  swallowed by Starlight, and the build exits with 0. That is why `site:check` runs the build
  together with `scripts/check-doc-refs.mjs`, and CI (`site.yml`) runs the same thing. What it
  checks is written at the top of that file.
- **Look at diagrams (mermaid) in a browser.** They are drawn in the browser, so a syntax error
  still builds. After changing a diagram, open it with `npm run site:dev` and make sure it is
  drawn and no "Syntax error" appears. To look at the built site, run
  `npm run site:build && npm run site:preview`. The preview moves itself to the background and
  keeps serving `http://localhost:4321/dashboard/`, so stop it with
  `cd docs-site && npx astro preview stop` when you are done.
- **Change English and Japanese in the same PR.** The pairing check only compares file names, not
  contents. It does not need to be a literal translation: write the same facts in each language's
  own words.
- **Write links in the body as `[x](/page/)`.** The base (`/dashboard`) and `/ja` are added by
  `docs-site/src/plugins/hast-rebase-links.ts`. Links in the frontmatter do not go through it, so
  write those as `/dashboard/…`.
- **In Japanese, break lines after punctuation.** A line break in the middle of a sentence shows
  up as a space between characters.
- **In the Japanese pages, 名乗り means only who you look as.** What the issuer returns is an access
  token (アクセストークン). The forms that mixed the two up are watched by
  `scripts/check-terms.mjs`, which `npm run check` runs.

## Re-taking the screenshots

The pictures on the [Screens](/screens/) page are taken by `npm run docs:shots`
(`docs-site/scripts/docs-shots.mjs`) against the [sandbox](#opening-the-screen-in-the-sandbox). No
picture is taken by hand. CI does not take them (that needs the stand-in's containers): they are
taken locally, and CI watches what was taken.

```sh
npm ci --prefix docs-site            # once (the tool is a docs-site dependency)
npm run sandbox                      # in another terminal; wait until 7081 answers
npm run docs:shots                   # all of them; a picture whose pixels did not change is not written
npm run docs:shots -- start crawls   # only the named ones
```

- **After changing the screen, re-take the pictures before opening the PR.** Changing the screen
  (`public/`, the bundled coloring in `public/vendor/` included), the stand-in (`sandbox/`) or the
  tool makes `site:check` fail with 画面が、絵を撮ったときと違う (the screen differs from when the
  pictures were taken). Re-taking all of them sets the stamp in `shots.json` (`source`) to the
  sha256 of the current contents, and writes only the pictures whose pixels changed; a fix that
  changes nothing visible changes only the stamp. Do not copy the stamp by hand to turn it green:
  the pictures would stay stale.
- **Taking named pictures leaves the stamp alone.** Only a run that takes all of them brings it up
  to date.
- **The pictures are lossless WebP, at most 40 KB each and 150 KB in all,** because every re-take
  piles up in git. Going over makes `site:check` fail; then make the cropped box smaller, or lower
  its height limit (`maxHeight`), in `SHOTS` in `docs-shots.mjs`.
- **Chrome's version is pinned** (`CHROME_BUILD` in `docs-shots.mjs`). If it is missing, the tool
  first installs it into `~/.cache/puppeteer`. Glyphs also depend on the OS's fonts, so the
  pictures are taken on macOS.
- **To add a picture, add one entry to `SHOTS`, take it, and put it on both screens pages (ja and
  en).** `site:check` fails on a file in the folder that `shots.json` does not list, and on a
  picture in `shots.json` that either screens page leaves out. The number marks are drawn inside
  the picture and carry only digits, so both languages use the same picture, and each says in its
  own words what the marks point at.

## Releasing and publishing

1. Make changes on a branch, open a PR against main and squash-merge it.
2. Put an annotated tag on the merged main commit by hand (`vX.Y.Z — summary`). The tag is the
   only version; `version` in `package.json` is not one.
3. Pushing the tag makes `docs.yml` publish the docs to GitHub Pages.

Merging into main does not change Pages. The docs that are published are the docs of a released
version (the github-pages environment also only accepts deployments from `v*` tags). To publish
again, point at the tag: `gh workflow run docs.yml --ref vX.Y.Z`.

Dependabot updates docs-site's dependencies once a week, grouped into one PR. `audit.yml` checks
its lockfile for known vulnerabilities every day.
