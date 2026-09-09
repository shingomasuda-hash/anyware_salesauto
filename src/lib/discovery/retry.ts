/**
 * Provider API 呼び出しの再試行。
 * 429 / 5xx / タイムアウト等の一時的失敗のみ、指数バックオフ + ジッターで再試行する。
 * 無限リトライはしない（maxAttempts で必ず打ち切る）。
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

/** 一時的なエラー（再試行する価値がある）か */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof ProviderHttpError) {
    return err.status === 429 || err.status === 408 || err.status >= 500;
  }
  if (err instanceof Error) {
    return /timeout|aborted|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network/i.test(err.message);
  }
  return false;
}

export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  // フルジッター: 同時実行時にリトライが同期しないようにする
  return Math.round(Math.random() * exponential);
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !isRetryableError(err)) throw err;
      const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs);
      options.onRetry?.(attempt, delay, err);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
