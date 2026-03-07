export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors?: string[];
}

const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  shouldRetry?: (error: Error, attempt: number) => boolean
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY, ...config };
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      if (attempt >= cfg.maxAttempts) break;

      if (shouldRetry && !shouldRetry(err, attempt)) break;

      // Check if error is retryable
      if (cfg.retryableErrors && cfg.retryableErrors.length > 0) {
        const isRetryable = cfg.retryableErrors.some(
          (pattern) => err.message?.includes(pattern) || err.code === pattern
        );
        if (!isRetryable) break;
      }

      // Exponential backoff with jitter
      const delay = Math.min(
        cfg.baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500,
        cfg.maxDelayMs
      );
      await sleep(delay);
    }
  }

  throw lastError || new Error("All retry attempts failed");
}

export function isTransientError(err: any): boolean {
  if (!err) return false;

  // Timeout from child_process
  if (err.killed === true) return true;
  if (err.timedOut === true) return true;

  // Network/Socket errors
  if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT" || err.code === "ECONNREFUSED") return true;

  const msg = (err.message || "").toLowerCase();

  // Docker transient issues
  if (msg.includes("container not running") || msg.includes("timeout") || msg.includes("dead")) return true;

  // HTTP status
  if (msg.includes("429") || msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504")) return true;

  // Do NOT retry on clear syntax/logic/missing errors
  if (msg.includes("enoent") || msg.includes("not found") || msg.includes("syntax error") || err.code === "ENOENT") {
    return false;
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
