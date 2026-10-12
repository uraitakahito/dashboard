---
title: Development
description: Where the dependencies stop, what the checks and tests see and do not see, checking without the ledger, editing these docs, releasing
---

## Where the dependencies stop

**The screen (the repository root) has no dependencies.** It is one Node http server and
JavaScript that runs as-is in the browser. Nothing goes through a bundler or a framework, so the
screen needs no install, no lockfile and no audit (the same call as
[capture-scripts](https://github.com/uraitakahito/capture-scripts)). If it grows enough to want
splitting up, that is the time to add them.

The only thing with dependencies is `docs-site/` (the source of this site, Astro + Starlight),
kept as a separate npm project. Its lockfile, audit and Dependabot stay inside it, and no
`node_modules` is created at the root.

| Run | What it does |
| --- | --- |
| `npm run dev` | serves the screen, relaying `/api/*` to the ledger and `/wacz/*` to the daemon |
| `npm run check` | every check for the screen to run before pushing; what it runs, and in which order, is `check` in `package.json` (the same thing CI's `ci.yml` runs) |
| `npm run site:check` | builds the docs and checks that they match the repository (after `npm ci --prefix docs-site`) |

The root scripts work the same with `pnpm run` (the `dev:up` of
[capture-ledger](https://github.com/uraitakahito/capture-ledger) starts the screen with `pnpm run dev`). `site:check` is deliberately not part of `check`: that `check` runs without
installing anything is part of the screen's nature too.

## What the tests see, and what they do not

The tests (`test/`, `node --test`) only cover the parts that do not talk to the outside: parsing
routes, rewriting arguments, keeping the signature from leaking, how states and numbers are
worded, and so on. Those parts are split out into files such as `src/wacz.mjs` and
`public/format.js` so that the tests can call them directly. The ones under `public/` are the
same files the browser reads, so there is no copy to rot.

**Relaying and identity are not checked in CI.** They cannot be confirmed without the ledger and
the issuer running, so the evidence is gathered by hand and pasted into the PR.

## Checking without the ledger

For when you want to try the screen against the real daemon without starting the ledger and the
stack.

1. Run a fake ledger on a free port (7071, say). It only has to answer the ledger routes the screen
   reads (which ones is decided by the `api(` calls in `public/app.js`) and the signing route
   (`POST /api/archives/:id/url`), which returns a `file://` URL of a local WACZ (the archive
   file the crawler produces) as `{"url": …}`. The daemon reads `file://` too.
2. Start a second screen pointed at the fake ledger.

   ```sh
   DASHBOARD_PORT=7081 DASHBOARD_LEDGER_URL=http://127.0.0.1:7071 npm run dev
   ```

   The screen gets its identity before it goes to the ledger, so it needs to reach an issuer
   too. If no issuer is running, let the fake ledger also answer `POST /token` (returning
   `{"access_token": "…"}`) and point `DASHBOARD_ISSUER_URL` at it.
3. Open `http://127.0.0.1:7081/` and press 検証 (validate) or 開く (open) on an archive row.

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
