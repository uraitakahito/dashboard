---
title: Screens
description: What the four views show — crawls, archives, catalog and contents — how a crawl's state is worded, and how often the screen polls
---

The screen has four views. You switch with the tabs at the top, and the `#` in the URL decides
which view is shown (`#crawls`, `#archives`, `#scripts`). The contents tab only appears once you
enter it with 開く (open) on an archive row. The screen itself is in Japanese; the tab names are
クロール, アーカイブ, 目録 and 中身.

| View | What it lists |
| --- | --- |
| Crawls | one row per crawl: state, pages captured, pages discovered, number of WACZ files (the archive format that packs captured pages into one ZIP), time taken, link to the run; start a crawl from the form above it |
| Archives | the WACZ files you can see; from a row, validate, open the contents, or open in [replay](https://github.com/uraitakahito/replay) (which plays a WACZ back in the browser) |
| Catalog | the scripts that run inside the captured page; says so in red when it is empty |
| Contents | inside one WACZ; see [Inspecting a WACZ](/wacz/) |

The top of the screen says who you are looking as, and that it is a development identity. The
footer shows how many rows are listed and how often the lists are fetched again.

## The lists are one page of the ledger

The crawls and archives views list only the first page the ledger returns (newest first). The
screen does not fetch further pages. For archives, the ledger returns only the ones in that page
that your identity may view, so there can be fewer rows than a page holds. The counts in the
footer are the rows on screen, not everything the ledger has.

## Crawls

Each row is one crawl. It shows the state, the first 8 characters of the id, who started it and
for which organization, the first seed URL, pages captured, pages discovered, the number of
WACZ files and the time taken. "run ↗" at the right end opens the Windmill run in a new tab.

- **Pages captured and pages discovered are separate columns.** Pages discovered
  (`pagesDiscovered`) counts what was found by following links, so a crawl of depth 0 ends up as
  "captured 1, discovered 0". Shown as `1 / 0` in one cell, the numerator looks bigger than the
  denominator, and people trip over it.
- **For a running crawl, the time taken is "so far".** A missing finish time means "not finished
  yet", not "no time".
- **run ↗ is the run of the last level that was handed over.** The link is built from the id of
  `lastJob` that the ledger returns, plus the Windmill origin and workspace the server hands out
  through `/healthz`. Rows where the ledger has no `lastJob` get no link.
- **Click a row to see why it failed, what ran in the page, and the URLs that could not be
  fetched.** Only then does the screen fetch `/api/crawls/:id`. The ledger's `error` comes first,
  in its own words: a crawl that failed at the compile step captured nothing, so its list of failed
  pages is empty and would otherwise read like a success. Next is what ran, in the order it ran:
  catalog scripts with their version, and scripts written in the form marked その場 (written on
  the spot), each with a 欄に戻す (back to the form) button. Last are the pages that failed, as many
  as the ledger returns; if none did, it says so and lists the seed URLs.
- **An opened row stays open.** The table is rebuilt on every fetch, so the screen remembers the
  open rows by id and opens them again from the last answer. It fetches a row again only while the
  crawl is running or when its state has changed.

### Starting a crawl from the form above

The form above the table starts a crawl. Write the seed URLs one per line, choose このページだけ
(this page only) or リンクを辿る (follow links, the ledger's default), and press 起こす (start).
Under 走らせるもの (what runs), tick the catalog scripts that should run, and add a script of your
own if you need one.

- **It sends the seed URLs, whether the depth is 0, and what runs — the last only when it differs
  from the default.** このページだけ sends `maxDepth: 0`; リンクを辿る adds nothing (the depth and
  the page limit are the ledger's defaults). With every catalog script ticked and no script of your
  own, the form sends no `scripts`, so the ledger's default applies and an empty catalog is still a
  400. Otherwise it sends `scripts`: your script first, then the ticked catalog scripts in catalog
  order; unticking all of them sends `[]`, which runs nothing. The screen checks neither the URLs
  nor the script's name; the ledger says what is wrong with a 400, naming the ids it refused.
- **A script of your own is type-checked as strict TypeScript** at the first level's compile step,
  and a single error fails the crawl; open its row to read the diagnostics. Wrap it in an IIFE,
  give the elements you look up a type, and use `?.`; start it with `// @ts-nocheck` to skip the
  type check. Do not write `export`: the page then gets a syntax error and nothing runs.
  読み込みの後 (after load) runs once in the main frame; 遷移の前 (before navigation) runs in every
  frame on every navigation and has no `__bh`. ファイルを読む (read a file) loads a file into the
  form, in the browser only.
- **After a 202 the seed URLs are cleared and your script is kept,** since the usual next step is
  to fix it and run again.
- **The answer is one line under the form.** When the crawl is accepted, its row gets a mark
  (it is running, so the footer starts polling every 2 seconds). If a crawl is already running,
  the answer is a 409 and the row in the way gets the mark (the ledger runs one crawl at a time,
  overall). Anything else is shown in the ledger's own words.
- **The row gets a mark, and is not opened.** The mark is remembered by id and put back each time
  the table is redrawn.

It is sent through `POST /api/crawls` in [Routes](/routes/).

### The state is worded together with stopReason

`state` alone is not enough. `succeeded` mixes crawls that followed everything to the end with
crawls that stopped at the depth or page limit. The screen words them apart using `stopReason`
(完走 for completed, 打ち切り for stopped at a limit), and shows an unknown `stopReason` as it
is, in parentheses.

The wording rules are `stateOf` in `public/format.js`, pinned by `test/format.test.mjs`. The
tests read the same file the browser reads, so there is no copy to rot.

## Archives

The WACZ files you can see, newest capture first.

- **A `—` under 完全か (complete?) means "unknown".** The ledger's `waczComplete` is null for
  that row, which is not the same as 欠けあり (incomplete).
- **検証 (validate) only runs when you press it.** Opening the list does not run it. The result
  also stays in the row's 仕様どおりか (conforms?) cell, so after looking at several archives you
  can tell how each one did without pressing again. What the report shows is in
  [Inspecting a WACZ](/wacz/).
- **開く (open) enters the contents view** (`#wacz/<archiveId>`).
- **"replay ↗" opens it in replay.** The link is built from the replay origin the server hands
  out through `/healthz` and the `objectKey` the ledger returns.

## Catalog

The scripts that run inside the pages being captured: their id, version, the point in the page
where they run (`phase`), and the start of their sha256. The same list appears as checkboxes under
走らせるもの in the crawl form.

**An empty catalog is shown in red.** The capture server (BrowserHive) does not bring any scripts
of its own, so with an empty catalog nothing runs inside the page. Nothing scrolls and nothing
lazy-loads, yet the capture still succeeds and an archive still comes out. The red message
includes the command that imports the scripts with [capture-ledger](https://github.com/uraitakahito/capture-ledger) (the
ledger that starts crawls and records what came back).

## Polling

While at least one crawl is running, the lists are fetched every 2 seconds; otherwise every 30
seconds. Without keeping a copy, the screen still looks live while something runs, and stays
quiet when nothing does.

When a fetch fails, the screen keeps the last tables it could draw and shows the reason at the
top (see "Fix it from the message" in the [Quickstart](/quickstart/)).
