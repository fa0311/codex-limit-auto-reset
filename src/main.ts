import { checkCredits } from "./check.ts";
import { createCodexClient } from "./codex-client.ts";
import { parseConfig } from "./config.ts";
import { createLogger } from "./log.ts";

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
  await client.initialize();
  operation = "check";
  while (true) {
    const nextCheckInMs = await checkCredits(client, config.REDEEM_BEFORE_MINUTES, log);
    await new Promise((resolve) => setTimeout(resolve, nextCheckInMs));
  }
} catch {
  // Avoid dumping raw errors, which may include authentication or RPC payloads.
  log({ event: "check_failed", operation, error_type: "operation_failed" });
  process.exitCode = 1;
} finally {
  client?.close();
}
