import { describe, expect, it } from "vitest";
import type { Credit } from "../src/codex-schemas.ts";
import { expiringCredits, isDue, nextCheckDelay } from "../src/schedule.ts";

const now = 1_800_000_000_000;
const minute = 60 * 1000;
const hour = 60 * minute;
const window = 6 * hour;

const credit = (id: string, expiresIn: number | null, overrides: Partial<Credit> = {}): Credit => ({
  id,
  resetType: "codexRateLimits",
  status: "available",
  grantedAt: new Date(now - hour),
  expiresAt: expiresIn === null ? null : new Date(now + expiresIn),
  ...overrides,
});

describe("expiringCredits", () => {
  it("orders the credits by expiry, soonest first", () => {
    const credits = [credit("later", 2 * hour), credit("sooner", hour)];
    expect(expiringCredits(credits, now)).toEqual([
      { id: "sooner", expiresAt: now + hour },
      { id: "later", expiresAt: now + 2 * hour },
    ]);
  });

  it.each([
    ["never expires", credit("x", null)],
    ["has expired", credit("x", -1)],
    ["expires this instant", credit("x", 0)],
    ["is being redeemed", credit("x", hour, { status: "redeeming" })],
    ["is redeemed", credit("x", hour, { status: "redeemed" })],
    ["has a status this version does not know", credit("x", hour, { status: "unknown" })],
    ["resets something this version does not know", credit("x", hour, { resetType: "unknown" })],
  ])("leaves out a credit that %s", (_reason, excluded) => {
    expect(expiringCredits([excluded], now)).toEqual([]);
  });
});

describe("isDue", () => {
  it("is true from the start of the redeem window", () => {
    expect(isDue({ id: "x", expiresAt: now + window + 1 }, now, window)).toBe(false);
    expect(isDue({ id: "x", expiresAt: now + window }, now, window)).toBe(true);
    expect(isDue({ id: "x", expiresAt: now + minute }, now, window)).toBe(true);
  });
});

describe("nextCheckDelay", () => {
  it("is a day when no credit needs attention sooner", () => {
    expect(nextCheckDelay([], now, window)).toBe(24 * hour);
    expect(nextCheckDelay([{ id: "x", expiresAt: now + 40 * hour }], now, window)).toBe(24 * hour);
  });

  it("is the time until the first credit becomes due", () => {
    const credits = [
      { id: "first", expiresAt: now + 8 * hour },
      { id: "second", expiresAt: now + 20 * hour },
    ];
    expect(nextCheckDelay(credits, now, window)).toBe(2 * hour);
  });

  it("is half the time a due credit has left", () => {
    expect(nextCheckDelay([{ id: "x", expiresAt: now + 6 * hour }], now, window)).toBe(3 * hour);
    expect(nextCheckDelay([{ id: "x", expiresAt: now + 10 * minute }], now, window)).toBe(5 * minute);
  });

  it("is never shorter than a minute", () => {
    expect(nextCheckDelay([{ id: "x", expiresAt: now + 90 * 1000 }], now, window)).toBe(minute);
    expect(nextCheckDelay([{ id: "x", expiresAt: now + 1 }], now, window)).toBe(minute);
  });

  it("is the soonest of the due and the waiting credits", () => {
    const due = { id: "due", expiresAt: now + 4 * hour };
    const waiting = { id: "waiting", expiresAt: now + window + 30 * minute };
    expect(nextCheckDelay([due, waiting], now, window)).toBe(30 * minute);
    expect(nextCheckDelay([due, { id: "waiting", expiresAt: now + 12 * hour }], now, window)).toBe(2 * hour);
  });
});
