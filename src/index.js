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

/**
 * Tries `check(attempt)` again and again until it returns a truthy value, which is then returned. A throw or a rejection counts
 * as "not yet". Gives up after `timeoutMs` (default 30000) with a WaitTimeoutError that names what you were waiting for
 * (`description`), how often it tried, and the last error. `intervalMs` (default 100) is the pause between tries; `signal` cancels.
 */
export async function waitFor(check, { timeoutMs = 30_000, intervalMs = 100, description = "the condition", signal, now = Date.now } = {}) {
  if (typeof check !== "function") throw new TypeError("wait-for: check must be a function");
  if (!(timeoutMs >= 0) || !(intervalMs > 0)) throw new RangeError("wait-for: timeoutMs must be 0 or more and intervalMs more than 0");
  const deadline = now() + timeoutMs;
  let attempts = 0;
  let lastError;
  for (;;) {
    signal?.throwIfAborted();
    attempts++;
    try {
      const value = await check(attempts);
      if (value) return value;
      lastError = undefined;
    } catch (error) {
      lastError = error;
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

/** Waits until something accepts connections on `port` (a database, a dev server). Returns when it does. */
export function waitForPort(port, { host = "127.0.0.1", ...options } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("wait-for: port must be between 1 and 65535");
  return waitFor(() => canConnect(port, host, 1000), { description: `${host}:${port} to accept connections`, ...options });
}

/** Waits until nothing listens on `port` any more (a server that is shutting down). */
export function waitForPortClosed(port, { host = "127.0.0.1", ...options } = {}) {
  return waitFor(async () => !(await canConnect(port, host, 1000)), { description: `${host}:${port} to close`, ...options });
}

/**
 * Waits until a URL answers with an accepted status (default: any 2xx). Returns the `Response` (body not read).
 * Redirects are not followed, so you test the URL you gave. `expectStatus` can be a number, a list, or a function.
 */
export function waitForHttp(url, { expectStatus = (s) => s >= 200 && s < 300, requestTimeoutMs = 2000, ...options } = {}) {
  const accepted = typeof expectStatus === "function" ? expectStatus : (s) => [].concat(expectStatus).includes(s);
  return waitFor(async () => {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(requestTimeoutMs) });
    if (accepted(response.status)) return response;
    await response.body?.cancel();
    throw new Error(`answered ${response.status}`);
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
