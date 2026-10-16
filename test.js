import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { getFreePort, waitFor, waitForHttp, waitForPort, waitForPortClosed, WaitTimeoutError } from "./src/index.js";

test("returns the first truthy value, counting the attempts", async () => {
  const seen = [];
  const value = await waitFor((attempt) => { seen.push(attempt); return attempt >= 3 ? "ready" : false; }, { intervalMs: 5 });
  assert.equal(value, "ready");
  assert.deepEqual(seen, [1, 2, 3]);
});

test("a throw counts as not yet", async () => {
  let n = 0;
  assert.equal(await waitFor(async () => { if (++n < 3) throw new Error("not up"); return 42; }, { intervalMs: 5 }), 42);
});

test("gives up with a message that says what happened", async () => {
  const started = Date.now();
  await assert.rejects(
    waitFor(() => { throw new Error("connection refused"); }, { timeoutMs: 80, intervalMs: 10, description: "the database" }),
    (e) => e instanceof WaitTimeoutError && e.attempts >= 3 && e.lastError.message === "connection refused" && /Gave up waiting for the database after 80 ms/.test(e.message) && /last error: connection refused/.test(e.message)
  );
  assert.ok(Date.now() - started < 1000);
  await assert.rejects(waitFor(() => false, { timeoutMs: 0 }), WaitTimeoutError);
});

test("it can be cancelled", async () => {
  const controller = new AbortController();
  const reason = new Error("stop");
  setTimeout(() => controller.abort(reason), 30);
  await assert.rejects(waitFor(() => false, { timeoutMs: 5000, intervalMs: 10, signal: controller.signal }), (e) => e === reason);
});

test("bad arguments", async () => {
  await assert.rejects(waitFor("x"), TypeError);
  await assert.rejects(waitFor(() => 1, { intervalMs: 0 }), RangeError);
  assert.throws(() => waitForPort(0), RangeError);
});

test("waits for a port to open and to close", async () => {
  const port = await getFreePort();
  const server = createServer((req, res) => res.end("ok"));
  setTimeout(() => server.listen(port, "127.0.0.1"), 80);
  assert.equal(await waitForPort(port, { timeoutMs: 3000, intervalMs: 10 }), true);
  setTimeout(() => server.closeAllConnections?.() ?? server.close(), 50);
  setTimeout(() => server.close(), 50);
  assert.equal(await waitForPortClosed(port, { timeoutMs: 3000, intervalMs: 10 }), true);
  await assert.rejects(waitForPort(port, { timeoutMs: 100, intervalMs: 10 }), /to accept connections/);
});

test("waits for an HTTP URL to answer with an accepted status", async () => {
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    if (req.url === "/health") { res.statusCode = hits < 3 ? 503 : 200; return res.end("ok"); }
    if (req.url === "/moved") { res.statusCode = 302; res.setHeader("location", "/health"); return res.end(); }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await waitForHttp(`${base}/health`, { intervalMs: 10, timeoutMs: 3000 });
    assert.equal(response.status, 200);
    assert.ok(hits >= 3);
    assert.equal((await waitForHttp(`${base}/moved`, { expectStatus: 302, intervalMs: 10 })).status, 302);
    assert.equal((await waitForHttp(`${base}/nothing`, { expectStatus: [404, 410], intervalMs: 10 })).status, 404);
    assert.equal((await waitForHttp(`${base}/health`, { expectStatus: (s) => s === 200, intervalMs: 10 })).status, 200);
    await assert.rejects(waitForHttp(`${base}/nothing`, { timeoutMs: 100, intervalMs: 10 }), /answered 404/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("getFreePort gives different usable ports", async () => {
  const a = await getFreePort();
  assert.ok(a > 1023 && a < 65536);
  const server = createServer();
  await new Promise((r) => server.listen(a, "127.0.0.1", r));
  server.close();
});
