import { randomUUID } from "node:crypto";
import type { CodexClient } from "./codex-client.ts";
import { describeError } from "./errors.ts";
import type { Logger } from "./log.ts";
import { retry } from "./retry.ts";

const RESCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;
// How soon to ask again when app-server could not say when the credits expire.
const DETAILS_RETRY_INTERVAL_MS = 10 * 60 * 1000;
const MIN_RECHECK_INTERVAL_MS = 60 * 1000;
type Client = Pick<CodexClient, "refreshAccount" | "readCredits" | "consumeCredit">;

export const checkCredits = async (
  client: Client,
  redeemBeforeMinutes: number,
  log: Logger,
  now: () => number = Date.now,
): Promise<number> => {
  const redeemBeforeMs = redeemBeforeMinutes * 60_000;

  await retry(() => client.refreshAccount());
  const { rateLimitResetCredits: summary } = await retry(() => client.readCredits());
  const credits = summary.credits
    .flatMap((credit) => {
      if (credit.status === "available" && credit.resetType === "codexRateLimits") {
        if (credit.expiresAt && credit.expiresAt * 1000 > now()) {
          return [{ id: credit.id, expiresAtMs: credit.expiresAt * 1000 }];
        }
      }
      return [];
    })
    .sort((a, b) => a.expiresAtMs - b.expiresAtMs);
  const due = credits.filter((credit) => credit.expiresAtMs - redeemBeforeMs <= now());

  // app-server falls back to a bare count when its detail lookup fails, which hides every expiry time.
  const detailsUnavailable = summary.availableCount > 0 && summary.credits.length === 0;
  if (detailsUnavailable) {
    log({ event: "credit_details_unavailable", available_count: summary.availableCount });
  }

  const settled = new Set<string>();
  for (const credit of due) {
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
    if (outcome !== "nothingToReset") {
      settled.add(credit.id);
    }
    // A reset leaves nothing for the next credit to reset, and "nothing to reset" is true of them all.
    if (outcome === "reset" || outcome === "nothingToReset") {
      break;
    }
  }
  // A credit left in the window is still redeemable. It is tried again after half the time it has
  // left, so the attempts close in on its expiry without polling for the whole window.
  const retries = due
    .filter((credit) => !settled.has(credit.id))
    .map((credit) => Math.max(Math.floor((credit.expiresAtMs - now()) / 2), MIN_RECHECK_INTERVAL_MS));

  const upcoming = credits
    .filter((credit) => !due.includes(credit))
    .map((credit) => credit.expiresAtMs - redeemBeforeMs - now());
  const nextCheckInMs = Math.min(
    ...retries,
    ...upcoming,
    detailsUnavailable ? DETAILS_RETRY_INTERVAL_MS : RESCAN_INTERVAL_MS,
  );
  log({ event: "next_check", delay_ms: nextCheckInMs });
  return nextCheckInMs;
};
