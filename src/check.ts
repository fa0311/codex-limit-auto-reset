import { randomUUID } from "node:crypto";
import type { CodexClient } from "./codex-client.ts";
import { describeError } from "./errors.ts";
import type { Logger } from "./log.ts";
import { retry } from "./retry.ts";

const RESCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;
type Client = Pick<CodexClient, "refreshAccount" | "readCredits" | "consumeCredit">;

export const checkCredits = async (
  client: Client,
  redeemBeforeMinutes: number,
  log: Logger,
  now: () => number = Date.now,
): Promise<number> => {
  const redeemBeforeMs = redeemBeforeMinutes * 60_000;

  await retry(() => client.refreshAccount());
  const allCredits = await retry(() => client.readCredits());
  const credits = allCredits.rateLimitResetCredits.credits.flatMap((credit) => {
    if (credit.status === "available" && credit.resetType === "codexRateLimits") {
      if (credit.expiresAt && credit.expiresAt * 1000 > now()) {
        return [{ id: credit.id, expiresAtMs: credit.expiresAt * 1000 }];
      }
    }
    return [];
  });
  const creditsToReset = credits.filter((credit) => credit.expiresAtMs - redeemBeforeMs <= now());

  for (const credit of creditsToReset) {
    // One key per redemption attempt, shared by its retries only, as the app-server protocol asks.
    const idempotencyKey = randomUUID();
    let attempt = 0;
    const { outcome } = await retry(async () => {
      attempt += 1;
      log({ event: "credit_redemption_attempt", credit_id: credit.id, attempt });
      try {
        return await client.consumeCredit(credit.id, idempotencyKey);
      } catch (error) {
        log({ event: "credit_redemption_error", credit_id: credit.id, attempt, ...describeError(error) });
        throw error;
      }
    });
    log({ event: "credit_redemption_result", credit_id: credit.id, attempt, outcome });
  }

  const resetTimes = credits
    .filter((credit) => creditsToReset.every((c) => c.id !== credit.id))
    .map((credit) => credit.expiresAtMs - redeemBeforeMs - now());
  const nextCheckInMs = Math.min(...resetTimes, RESCAN_INTERVAL_MS);
  log({ event: "next_check", delay_ms: nextCheckInMs });
  return nextCheckInMs;
};
