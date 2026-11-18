import type { Credit } from "./codex-schemas.ts";

const DAILY_SCAN_MS = 24 * 60 * 60 * 1000;
const MIN_RECHECK_MS = 60 * 1000;

/** The credits the worker redeems on its own: usable, for Codex limits, and expiring. Soonest first. */
export const expiringCredits = (credits: Credit[], now: number) =>
  credits
    .flatMap((credit) =>
      credit.status === "available" &&
      credit.resetType === "codexRateLimits" &&
      credit.expiresAt !== null &&
      credit.expiresAt.getTime() > now
        ? [{ id: credit.id, expiresAt: credit.expiresAt.getTime() }]
        : [],
    )
    .sort((a, b) => a.expiresAt - b.expiresAt);

export type ExpiringCredit = ReturnType<typeof expiringCredits>[number];

/** Whether the credit is inside its redeem window. */
export const isDue = (credit: ExpiringCredit, now: number, redeemBeforeMs: number) =>
  credit.expiresAt - redeemBeforeMs <= now;

/**
 * How long until one of these credits needs attention. A credit that is not due yet needs it when
 * it becomes due. One that is already due was left unredeemed, and is tried again after half the
 * time it has left, so that the attempts close in on its expiry without polling the whole window.
 */
export const nextCheckDelay = (credits: ExpiringCredit[], now: number, redeemBeforeMs: number) =>
  Math.min(
    DAILY_SCAN_MS,
    ...credits.map((credit) =>
      isDue(credit, now, redeemBeforeMs)
        ? Math.max(Math.floor((credit.expiresAt - now) / 2), MIN_RECHECK_MS)
        : credit.expiresAt - redeemBeforeMs - now,
    ),
  );
