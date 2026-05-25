export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < opts.attempts - 1) await sleep(opts.baseDelayMs * 2 ** i);
    }
  }
  throw lastErr;
}
