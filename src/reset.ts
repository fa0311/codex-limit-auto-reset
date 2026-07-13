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

const validCredits = credits.rateLimitResetCredits.credits.filter(
  (credit) => credit.status === "available" && credit.resetType === "codexRateLimits",
);
const nearestResetCredit = validCredits.sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));

console.table(
  nearestResetCredit.map((credit) => ({
    id: credit.id,
    status: credit.status,
    resetType: credit.resetType,
    expiresAt:
      credit.expiresAt === null
        ? "never"
        : new Date(credit.expiresAt * 1000).toLocaleString(locale.LOCAL, { timeZone: locale.TIMEZONE }),
  })),
);

console.log(`Do you want to use the first credit? (y/n)`);
const input = await new Promise<boolean>((resolve) => {
  process.stdin.once("data", (data) => {
    resolve(data.toString().trim().toLowerCase() === "y");
  });
});
console.log(input);
if (input) {
  const creditId = nearestResetCredit.at(0)?.id;
  if (creditId) {
    await client.consumeCredit(creditId, creditId);
    console.log(`Used credit ${creditId}`);
  }
} else {
  console.log(`Credit not used`);
}

client.close();
