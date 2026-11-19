export const AI_BATCH_MAX_CONCURRENCY = 5;
export const AI_BATCH_START_INTERVAL_MS = 1000;

export function getBatchConcurrency(
  kind: "deterministic" | "ai",
  targetCount: number,
) {
  return kind === "ai" ? Math.min(AI_BATCH_MAX_CONCURRENCY, targetCount) : 1;
}

export function getBatchRetryDelay(
  attempt: number,
  retryAfterMs?: number,
  jitterMs = 0,
) {
  return Math.max(retryAfterMs ?? 0, 1000 * 2 ** attempt) + jitterMs;
}
