import { homedir } from "node:os";
import { join } from "node:path";
import { checkCredits } from "./check.ts";
import { createCodexClient } from "./codex-client.ts";
import { parseConfig } from "./config.ts";
import { createLogger } from "./log.ts";
import { loadRecoveryState, saveRecoveryState } from "./recovery-state.ts";

const log = createLogger();
let client: ReturnType<typeof createCodexClient> | undefined;
let operation: "initialize" | "check" = "initialize";
try {
  const config = parseConfig(process.env);
  client = createCodexClient({
    command: config.CODEX_BIN,
    clientInfo: {
      name: "codex_limit_auto_reset",
      title: "Codex Limit Auto Reset",
      version: "0.1.0",
    },
  });
  const statePath =
    config.STATE_FILE ??
    join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "codex-limit-auto-reset", "recovery.json");
  const recovery =
    config.RESET_REMAINING_PERCENT === undefined ? { pendingCreditId: null } : await loadRecoveryState(statePath);
  const usage = {
    ...(config.RESET_REMAINING_PERCENT === undefined ? {} : { remainingPercent: config.RESET_REMAINING_PERCENT }),
    pollIntervalSeconds: config.USAGE_POLL_SECONDS,
    recovery,
    saveRecovery: () => saveRecoveryState(statePath, recovery),
  };
  await client.initialize();
  operation = "check";
  while (true) {
    const nextCheckInMs = await checkCredits(client, config.REDEEM_BEFORE_MINUTES, log, Date.now, usage);
    await new Promise((resolve) => setTimeout(resolve, nextCheckInMs));
  }
} catch {
  // Avoid dumping raw errors, which may include authentication or RPC payloads.
  log({ event: "check_failed", operation, error_type: "operation_failed" });
  process.exitCode = 1;
} finally {
  client?.close();
}
