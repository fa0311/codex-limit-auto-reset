import type { createCodexClient } from "./codex-client.ts";
import type { RateLimitCredits } from "./codex-schemas.ts";
import type { Logger } from "./log.ts";
import type { RecoveryState } from "./recovery-state.ts";
import { retry } from "./retry.ts";

const RESCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;
type Client = Pick<ReturnType<typeof createCodexClient>, "refreshAccount" | "readCredits" | "consumeCredit">;
export type UsageOptions = {
  remainingPercent?: number;
  pollIntervalSeconds?: number;
  recovery?: RecoveryState;
  saveRecovery?: () => Promise<void>;
};

// Only the main Codex allowance can trigger a full reset, not model-specific limits.
const remainingUsage = (response: RateLimitCredits, now: number): number | undefined => {
  const snapshot = response.rateLimitsByLimitId?.codex ?? response.rateLimits;
  if (!snapshot || (snapshot.limitId != null && snapshot.limitId !== "codex")) return undefined;
  const remaining = [snapshot.primary, snapshot.secondary].flatMap((window) =>
    window && (window.resetsAt == null || window.resetsAt * 1000 > now) ? [Math.max(0, 100 - window.usedPercent)] : [],
  );
  return remaining.length ? Math.min(...remaining) : undefined;
};

export const checkCredits = async (
  client: Client,
  redeemBeforeMinutes: number,
  log: Logger,
  now: () => number = Date.now,
  usage: UsageOptions = {},
): Promise<number> => {
  const monitoring = usage.remainingPercent !== undefined;
  const pollMs = (usage.pollIntervalSeconds ?? 60) * 1000;
  const recovery = usage.recovery ?? { pendingCreditId: null };
  await retry(() => client.refreshAccount());
  const response = await retry(() => client.readCredits());
  const remaining = remainingUsage(response, now());
  const low = monitoring && remaining !== undefined && remaining <= (usage.remainingPercent ?? 0);
  const credits = response.rateLimitResetCredits.credits
    .filter(
      (credit) =>
        credit.status === "available" &&
        credit.resetType === "codexRateLimits" &&
        (credit.expiresAt === null || credit.expiresAt * 1000 > now()),
    )
    .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) || a.id.localeCompare(b.id));

  // Checkpoint before sending: even a lost reply or process restart must not spend the next card.
  if (monitoring && recovery.pendingCreditId !== null) {
    if (remaining !== undefined && remaining > (usage.remainingPercent ?? 0)) {
      recovery.pendingCreditId = null;
      await usage.saveRecovery?.();
    } else if (!credits.some((credit) => credit.id === recovery.pendingCreditId)) {
      log({ event: "usage_recovery_pending", credit_id: recovery.pendingCreditId });
      log({ event: "next_check", delay_ms: pollMs });
      return pollMs;
    }
  }

  const due = credits.find(
    (credit) => credit.expiresAt !== null && credit.expiresAt * 1000 - redeemBeforeMinutes * 60_000 <= now(),
  );
  const selected =
    recovery.pendingCreditId !== null
      ? credits.find((credit) => credit.id === recovery.pendingCreditId)
      : low
        ? credits[0]
        : due;
  const reason = low ? "low_usage" : "expiry";
  if (selected) {
    if (monitoring) {
      recovery.pendingCreditId = selected.id;
      await usage.saveRecovery?.();
    }
    let attempt = 0;
    const { outcome } = await retry(async () => {
      attempt += 1;
      log({ event: "credit_redemption_attempt", credit_id: selected.id, attempt, reason });
      try {
        return await client.consumeCredit(selected.id, selected.id);
      } catch (error) {
        log({
          event: "credit_redemption_error",
          credit_id: selected.id,
          attempt,
          reason,
          error_type: "operation_failed",
        });
        throw error;
      }
    });
    log({ event: "credit_redemption_result", credit_id: selected.id, attempt, reason, outcome });
    // Definitive non-redemption outcomes can be checked again on the next scheduled scan.
    if (monitoring && (outcome === "nothingToReset" || outcome === "noCredit")) {
      recovery.pendingCreditId = null;
      await usage.saveRecovery?.();
    }
  }

  const resetTimes = credits
    .filter((credit) => credit.id !== selected?.id && credit.expiresAt !== null)
    .map((credit) => Math.max(pollMs, (credit.expiresAt ?? 0) * 1000 - redeemBeforeMinutes * 60_000 - now()));
  const nextCheckInMs = Math.min(...resetTimes, monitoring ? pollMs : RESCAN_INTERVAL_MS);
  log({ event: "next_check", delay_ms: nextCheckInMs });
  return nextCheckInMs;
};
