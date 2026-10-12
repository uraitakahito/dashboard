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
| Crawls | one row per crawl: state, pages captured, pages discovered, number of WACZ files (the archive format that packs captured pages into one ZIP), time taken, link to the run |
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
- **Click a row to see the URLs that could not be fetched, and why.** Only then does the screen
  fetch `/api/crawls/:id`. It lists what the ledger returns, which is not necessarily every page
  that failed. If nothing failed, it says so and lists the seed URLs.

### The state is worded together with stopReason

`state` alone is not enough. `succeeded` mixes crawls that followed everything to the end with
crawls that stopped at the depth or page limit. The screen words them apart using `stopReason`
(完走 for completed, 打ち切り for stopped at a limit), and shows an unknown `stopReason` as it
is, in parentheses.

In an example from the real stack on 2026-09-21, of 68 crawls, 41 were `succeeded` /
`max_depth`, 22 were `failed`, 4 were `succeeded` / `completed`, and 1 row was `succeeded` with a
`stopReason` of `failed`. Drawing `state` alone would get 42 of them wrong.

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
where they run (`phase`), and the start of their sha256.

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
