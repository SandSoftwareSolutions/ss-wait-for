# @sandsoftwaresolutions/wait-for

[![CI](https://github.com/SandSoftwareSolutions/ss-wait-for/actions/workflows/ci.yml/badge.svg)](https://github.com/SandSoftwareSolutions/ss-wait-for/actions/workflows/ci.yml)

Wait until something is ready: a database after `docker compose up`, a dev server before the tests start, a port that must be free. With a time limit and an error that says what you were waiting for. No dependencies.

## Install

```bash
npm install @sandsoftwaresolutions/wait-for
```

Works with `import` and `require()`, and ships TypeScript types for both.

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

- `waitFor(check, options)` calls `check(attempt, { signal })` until it returns a **truthy** value (which is returned). A throw or rejection means "not yet". A check that is still busy when the time is up is cut off: the wait ends on time anyway, and `signal` is aborted so the check can stop (pass it to `fetch`, a socket, ...). A cancel through the `signal` option also reaches a check that is busy. The first try always gets up to a second, even with a smaller `timeoutMs`, so `timeoutMs: 0` means "try once".
- On a timeout (default 30 seconds) you get a `WaitTimeoutError`:
  `Gave up waiting for the database after 30000 ms (299 tries); last error: connection refused`, with `attempts` and `lastError` on the error. That message is worth gold in a CI log.
- `waitForHttp` does not follow redirects (you test the URL you gave) and does not read the body. `expectStatus` is a number, a list or a function. Each request has its own `requestTimeoutMs` (default 2 s), so a server that accepts but never answers does not stall the loop.
- `waitForPort` / `waitForPortClosed` try a TCP connection; `host` defaults to `127.0.0.1`. A port outside 1-65535 rejects with a `RangeError`; a URL for `waitForHttp` that is not http(s) rejects with a `TypeError` right away instead of retrying until the timeout. All functions return a promise; none throws synchronously.
- `getFreePort()` asks the system for a free port. Another program can in theory take it before you use it; for tests that is rare enough.
- `signal` cancels any of them; `intervalMs` (default 100) is the pause between tries.
