---
title: Configuration
description: No .env is needed. All you can change is who you look as and where to look — the environment variables and the order they are read in
---

## No .env needed

The defaults are enough. Every line in `.env.example` is a comment; there is not a single live
line. Copy it only when you want to change who you look as, or where to look.

```sh
cp -n .env.example .env    # then uncomment the lines you need
```

The difference from [capture-ledger](https://github.com/uraitakahito/capture-ledger) (the ledger
that starts crawls and records what came back) is that nothing here lacks a sensible default.
capture-ledger requires values that are only known after something has run, such as the ids of
OpenFGA (the authorization service), so it needs a `.env`. The dashboard only has an identity and
destinations: the access token for that identity is fetched from the issuer when needed, and the
destinations are fixed loopback addresses. There are no secrets.

## Environment variables

| Name | Default | What it decides |
| --- | --- | --- |
| `DASHBOARD_PORT` | `7080` | The dashboard's port. It binds to loopback (`127.0.0.1`) only |
| `DASHBOARD_LEDGER_URL` | `http://127.0.0.1:7070` | The ledger's API |
| `DASHBOARD_ISSUER_URL` | `http://127.0.0.1:9099` | The development issuer, the one capture-ledger's `pnpm run oidc:issuer` starts |
| `DASHBOARD_SUBJECT` | this machine's user name | Who you look as. This name needs permission (see the [Quickstart](/quickstart/)) |
| `DASHBOARD_ORGANIZATIONS` | `acme` | The organizations to claim, comma-separated |
| `DASHBOARD_REPLAY_URL` | `http://127.0.0.1:8899` | Where "replay ↗" on an archive row goes |
| `DASHBOARD_WINDMILL_URL` | `http://127.0.0.1:8000` | Where "run ↗" on a crawl row goes |
| `DASHBOARD_WINDMILL_WORKSPACE` | `crawler` | The Windmill workspace "run ↗" opens |
| `DASHBOARD_VALIDATOR_URL` | `http://127.0.0.1:7180` | The daemon of [wacz-validator](https://github.com/uraitakahito/wacz-validator) (which checks a WACZ rule by rule) that answers validation and contents |

This table is checked against `src/server.mjs` and `.env.example` (`npm run site:check`). When
you add a variable, change all three.

### The identity is a convenience, not a protection

The dashboard gets its access token from the development issuer's `POST /token`, using the names in
`DASHBOARD_SUBJECT` and `DASHBOARD_ORGANIZATIONS`. The development issuer hands out a token for
any name it is asked for. Change the name here and you see what that name may see. That is why
the dashboard is not a boundary, and why it never leaves loopback.

### The dashboard does not build destinations

Where replay and Windmill live is a fact of the deployment. The ledger only returns an
`objectKey` and a run id, so the server decides in one place where to open them and hands that
to the browser through `/healthz` (see [Routes](/routes/)).

## Order of reading

`npm run dev` reads `.env` and then `.env.local` (if they exist; a missing file does not stop
it).

- If a name is in both, `.env.local`, read later, wins.
- A variable you pass in the shell wins over both files, so you can change something just for
  one run: `DASHBOARD_PORT=7081 npm run dev`.

## Empty means unset

`NAME=` with no value falls back to the default (the same side as POSIX `${VAR:-word}`), which
matches the other crawler repositories. If you do not want to set a value, comment the whole line
out.

## 7080, not 7000

macOS's ControlCenter (AirPlay Receiver) holds `*:7000`. Binding to `127.0.0.1:7000` still
works, which makes it easy to miss, but when `localhost:7000` resolves to `::1` it reaches
AirPlay. The tools that look up a port's owner (capture-ledger's `dev:status` and `dev:down`)
would also keep reporting "something else holds it". So the dashboard takes 7080, next to the
ledger's 7070.
