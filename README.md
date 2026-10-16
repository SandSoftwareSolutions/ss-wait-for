# @sandsoftwaresolutions/wait-for

[![CI](https://github.com/SandSoftwareSolutions/ss-wait-for/actions/workflows/ci.yml/badge.svg)](https://github.com/SandSoftwareSolutions/ss-wait-for/actions/workflows/ci.yml)

Wait until something is ready: a database after `docker compose up`, a dev server before the tests start, a port that must be free. With a time limit and an error that says what you were waiting for. No dependencies.

## Install

```bash
npm install @sandsoftwaresolutions/wait-for
```

## Usage

```js
import { waitFor, waitForPort, waitForHttp, waitForPortClosed, getFreePort } from "@sandsoftwaresolutions/wait-for";

await waitForPort(5432, { timeoutMs: 60_000 });                    // Postgres accepts connections
await waitForHttp("http://localhost:3000/health");                 // answers with a 2xx
await waitForHttp(url, { expectStatus: [200, 204] });
await waitFor(async () => (await db.query("select 1")), { description: "the database", intervalMs: 250 });

const port = await getFreePort();                                  // for a test server
```

## Details

- `waitFor(check, options)` calls `check(attempt)` until it returns a **truthy** value (which is returned). A throw or rejection means "not yet".
- On a timeout (default 30 seconds) you get a `WaitTimeoutError`:
  `Gave up waiting for the database after 30000 ms (299 tries); last error: connection refused`, with `attempts` and `lastError` on the error. That message is worth gold in a CI log.
- `waitForHttp` does not follow redirects (you test the URL you gave) and does not read the body. `expectStatus` is a number, a list or a function. Each request has its own `requestTimeoutMs` (default 2 s), so a server that accepts but never answers does not stall the loop.
- `waitForPort` / `waitForPortClosed` try a TCP connection; `host` defaults to `127.0.0.1`.
- `getFreePort()` asks the system for a free port. Another program can in theory take it before you use it; for tests that is rare enough.
- `signal` cancels any of them; `intervalMs` (default 100) is the pause between tries.
