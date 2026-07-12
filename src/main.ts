import { createCodexClient } from "./codex-client.ts";
import type { RateLimitCredits } from "./codex-schemas.ts";
import { parseConfig } from "./config.ts";
import { retry } from "./retry.ts";

const RESCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

const config = parseConfig(process.env);
const client = createCodexClient({
  command: config.CODEX_BIN,
  clientInfo: {
    name: "codex_limit_auto_reset",
    title: "Codex Limit Auto Reset",
    version: "0.1.0",
  },
});

const toAllowCredits = (rateLimits: RateLimitCredits) => {
  return rateLimits.rateLimitResetCredits.credits.flatMap((credit) => {
    if (credit.status === "available" && credit.resetType === "codexRateLimits") {
      if (credit.expiresAt && credit.expiresAt * 1000 > Date.now()) {
        return [{ id: credit.id, expiresAtMs: credit.expiresAt * 1000 }];
      }
    }
    return [];
  });
};

await client.initialize();

const check = async () => {
  const redeemBeforeMs = config.REDEEM_BEFORE_MINUTES * 60_000;

  await retry(() => client.refreshAccount());
  const allCredits = await retry(() => client.readCredits());
  const credits = toAllowCredits(allCredits);

  const creditsToReset = credits.filter((credit) => {
    const redeemAtMs = credit.expiresAtMs - redeemBeforeMs;
    return redeemAtMs <= Date.now();
  });

  for (const credit of creditsToReset) {
    const { outcome } = await retry(() => client.consumeCredit(credit.id, credit.id));
    console.log(`Credit ${credit.id}: ${outcome}`);
  }

  const resetTimes = credits
    .filter((credit) => creditsToReset.every((c) => c.id !== credit.id))
    .map((credit) => credit.expiresAtMs - redeemBeforeMs - Date.now());
  const nextCheckInMs = Math.min(...resetTimes, RESCAN_INTERVAL_MS);

  console.log(`Next check in ${nextCheckInMs / 1000} seconds`);
  return nextCheckInMs;
};

while (true) {
  const nextCheckInMs = await check();
  await new Promise((resolve) => setTimeout(resolve, nextCheckInMs));
}
