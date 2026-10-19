export interface WaitOptions {
  /** Default 30000. */
  timeoutMs?: number;
  /** Pause between tries. Default 100. */
  intervalMs?: number;
  /** What you wait for; used in the error message. */
  description?: string;
  signal?: AbortSignal;
  now?: () => number;
}

export class WaitTimeoutError extends Error {
  readonly attempts: number;
  readonly lastError: unknown;
  readonly timeoutMs: number;
}

export function waitFor<T>(check: (attempt: number, context: { signal: AbortSignal }) => T | Promise<T>, options?: WaitOptions): Promise<Exclude<Awaited<T>, false | 0 | "" | null | undefined>>;
export function waitForPort(port: number, options?: WaitOptions & { host?: string }): Promise<boolean>;
export function waitForPortClosed(port: number, options?: WaitOptions & { host?: string }): Promise<boolean>;
export function waitForHttp(url: string, options?: WaitOptions & { expectStatus?: number | number[] | ((status: number) => boolean); requestTimeoutMs?: number }): Promise<Response>;
export function getFreePort(options?: { host?: string }): Promise<number>;
