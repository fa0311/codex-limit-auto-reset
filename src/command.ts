import type { CodexClient } from "./codex-client.ts";
import { createCodexClient } from "./codex-client.ts";
import type { Config } from "./config.ts";
import { parseConfig } from "./config.ts";
import { CodexError } from "./errors.ts";

/** Runs a one-shot command against a logged-in app-server, which is stopped afterwards. */
export const runCommand = async (run: (client: CodexClient, config: Config) => Promise<void>) => {
  try {
    const config = parseConfig(process.env);
    using client = await createCodexClient(config.codexBin);
    await client.refreshAccount();
    await run(client, config);
  } catch (error) {
    console.error(error instanceof CodexError ? `codex-limit-auto-reset: ${error.message}` : error);
    process.exitCode = 1;
  }
};
