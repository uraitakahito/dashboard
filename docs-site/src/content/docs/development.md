---
title: Development
description: Where the dependencies stop, what the checks and tests see and do not see, opening the screen in the sandbox, editing these docs, releasing
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
| change what it shows | edit the scenario. The stand-in reads it on every request, so the screen changes on its next fetch |
| see an empty catalog | set `"emptyCatalog"` to `true` in the scenario |
| list other WACZ files | `SANDBOX_WACZ_DIR=<dir> npm run sandbox` (relative to this repository, for example `../wacz-validator/samples`). The stand-in and the daemon both get the same directory |
| put an updated wacz-validator into the daemon | `npm run sandbox:build`. `npm run sandbox` only builds the image when there is none |

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
