---
title: Routes
description: What the screen's server answers — /healthz, the pass-through to the ledger, the route that starts a crawl, and the /wacz/ routes into a WACZ. The Host check, which headers pass, and what failures look like
---

The screen's server only relays. The screen's logic lives in the browser (`public/`); all the
server does is provide a way to the ledger and the daemon, and serve the screen's files. The
moment logic lived on the server, there would be a copy of what the ledger knows, so it does
not.

| Route | Answered by |
| --- | --- |
| `GET /healthz` | the server itself (liveness, and the settings the screen needs) |
| `POST /api/crawls` | the ledger (the one and only route that writes) |
| `/api/*` (the rest) | passed through to the ledger (GET only) |
| `/wacz/:id/…` | signed by the ledger, then answered by the daemon |
| anything else | the files in `public/` |

The routing is in `src/server.mjs`; parsing and rewriting the `/wacz/` routes is in
`src/wacz.mjs`.

Every route refuses with a 403 unless the request's `Host` is `127.0.0.1:<port>` or
`localhost:<port>`. That stops a page from another site from reading this screen as if it were
its own origin, by pointing its domain name at 127.0.0.1 (DNS rebinding).

## /healthz

Returns liveness and the settings the screen needs.

```json
{
  "ok": true,
  "subject": "alice",
  "organizations": ["acme"],
  "replayOrigin": "http://127.0.0.1:8899",
  "windmillOrigin": "http://127.0.0.1:8000",
  "windmillWorkspace": "crawler"
}
```

The screen reads it when it opens, to learn who it is looking as and where the deep links go.
It does not live under `/api/`: that is where the ledger is passed through, and mixing this
server's answers in would make it unclear who answered.

## /api/* — passed through to the ledger

The ledger does not return CORS (Cross-Origin Resource Sharing, which lets pages from another
origin call it) headers (`OPTIONS /api/archives` is a 404). Since the browser
cannot call it directly, the server relays it to make it same-origin.

- The path and query go through unchanged, as a GET. Any other method is a 405 (the only route
  that writes is `POST /api/crawls` below).
- The access token is attached as `Authorization: Bearer`. If the server does not have one yet, it
  first gets one from the development issuer.
- **On a 401 it gets a new token and retries once.** It does not track the token's lifetime:
  restarting the issuer changes its keys, so a clock that says "still valid" cannot be trusted.
  A 401 says both "expired" and "the keys changed" in the same way.
- The ledger's status, `content-type` and body are returned as they are.

Which ledger routes are read is decided by the screen (`public/app.js`); the server does not
choose. It keeps no list of allowed routes.

## POST /api/crawls — the route that starts a crawl

This is the one route of the screen's server that writes. The form on the crawls view
([Screens](/screens/)) uses it. The server does not check the contents: it hands the body that
passed the checks below to the ledger's `POST /api/crawls` as it is, and returns the answer as
it is. The ledger is the one that checks and decides the seed URLs and the policy (depth, page
limit, which scripts run).

- **Only JSON from this screen's own page gets through.** If the `Origin` is not this screen it
  is a 403, if the `content-type` is not JSON it is a 415, and a body over 64 KiB is a 413. This
  stops a page from another site from making your browser send the POST (CSRF). It does not
  rely on Chrome's Private Network Access.
- The access token is attached, and a 401 retried, the same way as for `/api/*` above.

| The ledger's answer | When |
| --- | --- |
| 202 `{"crawlId": …}` | accepted (it does not wait for the crawl to finish) |
| 400 `{"error": …}` | a seed URL that cannot be read, an empty script catalog (with a `hint`), and so on |
| 404 | the identity may not start crawls (`{"error":"not found"}`), or the ledger has nowhere to send crawls configured and does not serve the route at all |
| 409 `{"error": …, "crawlId": …}` | a crawl is already running (one at a time, overall); `crawlId` is the one in the way |

The checks are `writeRefusal` in `src/lib.mjs`, which the tests call directly.

## /wacz/:id/… — routes into a WACZ

These routes validate a WACZ (the archive format that packs captured pages into one ZIP) and
read inside it. The WARC files in it (which record the captured requests and responses in order)
and its indexes are read one window at a time.

| The screen calls | Sent to the daemon | Returns |
| --- | --- | --- |
| `POST /wacz/:id/validate` | `POST /validate` | the validation report |
| `GET /wacz/:id/lines?path=&from=&count=` | `POST /lines` | a window of lines |
| `GET /wacz/:id/line?path=&n=` | `POST /line` | one whole line, and its fields |
| `GET /wacz/:id/records?path=&from=&count=` | `POST /records` | the records, walking the WARC from the start |
| `GET /wacz/:id/record?path=&offset=&length=` | `POST /record` | one record (WARC headers, HTTP, body) |
| `GET /wacz/:id/record/body?path=&offset=&length=` | `POST /record/body` | the image itself; raster only, with `nosniff` and `sandbox`, 415 otherwise |

This table is checked against `OPS` in `src/wacz.mjs` (`npm run site:check`). To add a route,
change `OPS`, `paramsFor` and this table.

- **Every route takes the same two steps.** Get a signature from the ledger's
  `POST /api/archives/:id/url`, then hand that URL to the daemon (why in that order is in
  [Inspecting a WACZ](/wacz/)).
- **The screen calls GET; the daemon gets POST.** `<img src>` is a GET too, so the image itself
  can be fetched with a GET. Only validation is a POST from the screen as well (it runs only when
  you press it).
- The body sent to the daemon is `{ "source": { "kind": "uri", "uri": "<signed URL>" }, …arguments }`.
  Validation's only argument is `locale`.

## Headers that pass

Which headers of the upstream answer (the ledger's or the daemon's) pass through is an
allowlist, `PASS_HEADERS` in `src/server.mjs`. The daemon's `date` and `connection` are not mixed
into the screen's response. The image itself passes as bytes, together with the marks the daemon
put on it (`nosniff`, `sandbox`, `no-store`).

## What failures look like

A failure says what is missing. "You may not see it" and "it is not running" are never mixed.

| Status | When | Body |
| --- | --- | --- |
| 400 | an argument of a `/wacz/` route is missing or not a number; the ledger is not asked | `{"error":"from is required"}` |
| 403 | the `Host` is not this screen's (any route); on the route that writes, also when the `Origin` is not this screen | `{"error":"この画面の Host ではない"}` and so on |
| 405 | wrong method: on a `/wacz/` route (validation is POST, the rest GET), or on `/api/*` (GET only, except the route that writes) | `POST だけ`, `GET だけ` and so on, with an `Allow` header |
| 413 | the body sent to the route that writes is over 64 KiB | `{"error":"本文が 65536 バイトを超えた"}` |
| 415 | the `content-type` sent to the route that writes is not JSON | `{"error":"JSON だけを受ける"}` |
| as the ledger said | the ledger refused (such as a 404 for an archive you may not view) | the ledger's body |
| 502 | the issuer, the ledger or the daemon cannot be reached, or the issuer refused the identity | `{"error":"… に届かない (…)。…"}`, with one sentence on how to fix it |
| 404 | a file that is not in `public/`, or an extension that is not served | `not found` |

If the upstream breaks off while the answer is being streamed, the headers have already been
written, so the server closes the connection.
