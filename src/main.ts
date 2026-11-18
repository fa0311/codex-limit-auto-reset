import { setTimeout as sleep } from "node:timers/promises";
import { createBackoff } from "./backoff.ts";
import { parseConfig } from "./config.ts";
import { CodexError } from "./errors.ts";
import { createWorker } from "./worker.ts";

// The worker's history: one JSON object per line on stdout.
const record = (level: "info" | "warn" | "error", event: string, fields: object = {}) => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields }));
};

// A failure this tool recognises is recorded with its message. Anything else may quote a payload,
// so it goes to stderr, next to app-server's own diagnostics, and the record only names its kind.
const recordFailure = (event: "check_failed" | "worker_failed", error: unknown) => {
  if (error instanceof CodexError) {
    record("error", event, { error_type: error.name, detail: error.message });
    return;
  }
  console.error(error);
  record("error", event, { error_type: error instanceof Error ? error.name : "UnknownError" });
};

// As PID 1 in a container Node ignores SIGTERM unless it is handled, so `docker stop` would hang.
// The listeners stay registered: execa re-raises a signal once nothing else is listening for it.
const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdown.abort();
  });
}

try {
  const config = parseConfig(process.env);
  const worker = createWorker({ command: config.codexBin, redeemBeforeMs: config.redeemBeforeMs });
  worker.events.on("redeeming", (creditId) => {
    record("info", "credit_redemption_attempt", { credit_id: creditId });
  });
  worker.events.on("redeemed", (creditId, outcome) => {
    record("info", "credit_redemption_result", { credit_id: creditId, outcome });
  });
  worker.events.on("detailsUnavailable", (availableCount) => {
    record("warn", "credit_details_unavailable", { available_count: availableCount });
  });

  // A failed check is repeated as a whole, sooner than the schedule would have it.
  const backoff = createBackoff({ initialMs: 60 * 1000, maxMs: 15 * 60 * 1000 });
  while (true) {
    const delayMs = await (async () => {
      try {
        const nextCheckInMs = await worker.check();
        backoff.reset();
        return nextCheckInMs;
      } catch (error) {
        // Ctrl-C reaches app-server too and stops it mid-request, which is not a failure.
        shutdown.signal.throwIfAborted();
        recordFailure("check_failed", error);
        return backoff.next();
      }
    })();
    shutdown.signal.throwIfAborted();
    record("info", "next_check", { delay_ms: delayMs });
    await sleep(delayMs, undefined, { signal: shutdown.signal });
  }
} catch (error) {
  if (!shutdown.signal.aborted) {
    recordFailure("worker_failed", error);
    process.exitCode = 1;
  }
}
