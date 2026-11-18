import { setTimeout as sleep } from "node:timers/promises";
import { checkCredits } from "./check.ts";
import { clientInfo } from "./client-info.ts";
import type { CodexClient } from "./codex-client.ts";
import { createCodexClient } from "./codex-client.ts";
import { parseConfig } from "./config.ts";
import { describeError } from "./errors.ts";
import { createLogger } from "./log.ts";

const log = createLogger();

// As PID 1 in a container Node ignores SIGTERM unless it is handled, so `docker stop` would hang.
// The listeners stay registered: execa re-raises a signal once nothing else is listening for it.
const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdown.abort();
  });
}

let client: CodexClient | undefined;
let operation: "initialize" | "check" = "initialize";
try {
  const config = parseConfig(process.env);
  client = createCodexClient({ command: config.CODEX_BIN, clientInfo });
  await client.initialize();
  operation = "check";
  while (!shutdown.signal.aborted) {
    const nextCheckInMs = await checkCredits(client, config.REDEEM_BEFORE_MINUTES, log);
    await sleep(nextCheckInMs, undefined, { signal: shutdown.signal });
  }
} catch (error) {
  // A shutdown interrupts the sleep, and Ctrl-C also stops app-server mid-request: neither is a failure.
  if (!shutdown.signal.aborted) {
    log({ event: "check_failed", operation, ...describeError(error) });
    process.exitCode = 1;
  }
} finally {
  client?.close();
}
