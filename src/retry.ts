import { setTimeout as sleep } from "node:timers/promises";
import { CodexError } from "./errors.ts";

// Pauses between attempts; one more attempt than there are pauses.
const RETRY_DELAYS_MS = [2_000, 8_000];

export const retry = async <T>(fn: () => Promise<T>): Promise<T> => {
  const errors: unknown[] = [];
  for (const delayMs of [...RETRY_DELAYS_MS, undefined]) {
    try {
      return await fn();
    } catch (error) {
      errors.push(error);
      if (delayMs === undefined || (error instanceof CodexError && !error.retryable)) {
        break;
      }
      await sleep(delayMs);
    }
  }
  throw new AggregateError(errors, "All attempts failed");
};
