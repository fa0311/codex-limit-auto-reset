import { createCodexClient } from "./codex-client.ts";
import { parseConfig } from "./config.ts";
import { parseLocale } from "./locale.ts";

const locale = parseLocale(process.env);
const config = parseConfig(process.env);
const client = createCodexClient({
  command: config.CODEX_BIN,
  clientInfo: {
    name: "codex_limit_auto_reset",
    title: "Codex Limit Auto Reset",
    version: "0.1.0",
  },
});

await client.initialize();

await client.refreshAccount();
const credits = await client.readCredits();
console.table(
  credits.rateLimitResetCredits.credits.map((credit) => ({
    id: credit.id,
    status: credit.status,
    resetType: credit.resetType,
    expiresAt:
      credit.expiresAt === null
        ? "never"
        : new Date(credit.expiresAt * 1000).toLocaleString(locale.LOCAL, { timeZone: locale.TIMEZONE }),
  })),
);
client.close();
