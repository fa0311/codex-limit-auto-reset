import { clientInfo } from "./client-info.ts";
import type { CodexClient } from "./codex-client.ts";
import { createCodexClient } from "./codex-client.ts";
import { parseConfig } from "./config.ts";
import { CodexError } from "./errors.ts";

/** Runs a one-shot command against an authenticated app-server, which is always stopped afterwards. */
export const runCommand = async (run: (client: CodexClient) => Promise<void>) => {
  let client: CodexClient | undefined;
  try {
    const config = parseConfig(process.env);
    client = createCodexClient({ command: config.CODEX_BIN, clientInfo });
    await client.initialize();
    await client.refreshAccount();
    await run(client);
  } catch (error) {
    console.error(error instanceof CodexError ? `Error: ${error.message}` : error);
    process.exitCode = 1;
  } finally {
    client?.close();
  }
};
