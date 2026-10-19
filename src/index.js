import { createServer, connect } from "node:net";

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Thrown when the wait ran out. `lastError` is the last thing that went wrong, `attempts` how often it was tried. */
export class WaitTimeoutError extends Error {
  constructor(message, { attempts, lastError, timeoutMs }) {
    super(message);
    this.name = "WaitTimeoutError";
    this.attempts = attempts;
    this.lastError = lastError;
    this.timeoutMs = timeoutMs;
  }
}

const MAX_TIMER = 2 ** 31 - 1;
const FIRST_TRY_MS = 1000; // the first try always gets this long, so `timeoutMs: 0` still means 'try once' for a port or a URL
class CutOff extends Error {}

// One try of the check. A check that never finishes is cut off when the deadline passes, its `signal` is aborted so it can stop
// what it is doing (a request, a socket), and a cancel through the caller's signal is passed on at once.
async function tryOnce(check, attempt, remainingMs, signal) {
  const controller = new AbortController();
  const run = Promise.resolve().then(() => check(attempt, { signal: controller.signal }));
  run.catch(() => {}); // if the race is already over, a later failure of the check is nobody's business
  let timer;
  let onAbort;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new CutOff("the check did not finish in time");
      controller.abort(error);
      reject(error);
    }, Math.min(Math.max(remainingMs, 0), MAX_TIMER));
  });
  const cancelled = new Promise((_, reject) => {
    onAbort = () => {
      controller.abort(signal.reason);
      reject(signal.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([run, limit, cancelled]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    limit.catch(() => {});
    cancelled.catch(() => {});
  }
}

/**
 * Tries `check(attempt, { signal })` again and again until it returns a truthy value, which is then returned. A throw or a rejection
 * counts as "not yet", and so does a check that is still busy when the time is up (its `signal` is aborted then). Gives up after
 * `timeoutMs` (default 30000) with a WaitTimeoutError that names what you were waiting for (`description`), how often it tried,
 * and the last error. `intervalMs` (default 100) is the pause between tries; `signal` cancels. The first try may take up to a second
 * even when `timeoutMs` is smaller, so `timeoutMs: 0` means 'try once'.
 */
export async function waitFor(check, { timeoutMs = 30_000, intervalMs = 100, description = "the condition", signal, now = Date.now } = {}) {
  if (typeof check !== "function") throw new TypeError("wait-for: check must be a function");
  if (!(timeoutMs >= 0) || !(intervalMs > 0) || !Number.isFinite(intervalMs)) throw new RangeError("wait-for: timeoutMs must be 0 or more and intervalMs a number more than 0");
  const deadline = now() + timeoutMs;
  let attempts = 0;
  let lastError;
  for (;;) {
    signal?.throwIfAborted();
    attempts++;
    try {
      const value = await tryOnce(check, attempts, attempts === 1 ? Math.max(deadline - now(), FIRST_TRY_MS) : deadline - now(), signal);
      if (value) return value;
      lastError = undefined;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      // A try that was cut off by the deadline does not hide what the earlier tries said (for example "answered 503").
      if (!(error instanceof CutOff && lastError)) lastError = error;
    }
    const left = deadline - now();
    if (left <= 0) {
      const why = lastError ? `; last error: ${lastError.message ?? lastError}` : "";
      throw new WaitTimeoutError(`Gave up waiting for ${description} after ${timeoutMs} ms (${attempts} tries)${why}`, { attempts, lastError, timeoutMs });
    }
    await sleep(Math.min(intervalMs, left), signal);
  }
}

function canConnect(port, host, connectTimeoutMs) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(connectTimeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function checkPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("wait-for: port must be between 1 and 65535");
}

/** Waits until something accepts connections on `port` (a database, a dev server). Returns when it does. */
export async function waitForPort(port, { host = "127.0.0.1", ...options } = {}) {
  checkPort(port);
  return waitFor(() => canConnect(port, host, 1000), { description: `${host}:${port} to accept connections`, ...options });
}

/** Waits until nothing listens on `port` any more (a server that is shutting down). */
export async function waitForPortClosed(port, { host = "127.0.0.1", ...options } = {}) {
  checkPort(port);
  return waitFor(async () => !(await canConnect(port, host, 1000)), { description: `${host}:${port} to close`, ...options });
}

/**
 * Waits until a URL answers with an accepted status (default: any 2xx). Returns the `Response` (body not read).
 * Redirects are not followed, so you test the URL you gave. `expectStatus` can be a number, a list, or a function.
 * A URL that cannot work (not http or https, or not a URL at all) is an error at once, not after the timeout.
 */
export async function waitForHttp(url, { expectStatus = (s) => s >= 200 && s < 300, requestTimeoutMs = 2000, ...options } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(`wait-for: "${url}" is not a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new TypeError(`wait-for: only http and https URLs can be waited for, not ${parsed.protocol}`);
  const accepted = typeof expectStatus === "function" ? expectStatus : (s) => [].concat(expectStatus).includes(s);
  return waitFor(async (_attempt, { signal }) => {
    // The request ends after requestTimeoutMs, when the wait is cancelled, or when the wait runs out of time.
    const request = new AbortController();
    const stop = () => request.abort();
    signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, requestTimeoutMs);
    try {
      const response = await fetch(url, { redirect: "manual", signal: request.signal });
      if (accepted(response.status)) return response;
      await response.body?.cancel();
      throw new Error(`answered ${response.status}`);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    }
  }, { description: `${url} to answer`, ...options });
}

/** A free TCP port on the machine: ask the system for one, close it, and return the number (for test servers). */
export function getFreePort({ host = "127.0.0.1" } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
