import { describe, expect, it, vi } from "vitest";
import { checkCredits } from "../src/check.ts";
import type { ConsumeCredit, RateLimitCredits } from "../src/codex-schemas.ts";
import { createLogger } from "../src/log.ts";

const now = 1_800_000_000_000;
const hour = 60 * 60 * 1000;
const credit = (id: string, offset: number, status = "available") => ({
  id,
  expiresAt: (now + offset) / 1000,
  grantedAt: (now - hour) / 1000,
  resetType: "codexRateLimits" as const,
  status: status as "available" | "redeemed",
});
const fixture = (credits = [credit("credit-1", hour)]) => {
  const lines: string[] = [];
  const client = {
    refreshAccount: vi.fn(async () => {}),
    readCredits: vi.fn(
      async (): Promise<RateLimitCredits> => ({
        rateLimitResetCredits: { availableCount: credits.length, credits },
      }),
    ),
    consumeCredit: vi.fn(async (_id: string, _key: string): Promise<ConsumeCredit> => ({ outcome: "reset" })),
  };
  const log = createLogger(
    (line) => lines.push(line),
    () => new Date(now),
  );
  return { client, log, lines, events: () => lines.map((line) => JSON.parse(line)) };
};

describe("redemption event history", () => {
  it("records one confirmed reset after a transient failure, preserving the idempotency key", async () => {
    const f = fixture();
    f.client.consumeCredit.mockRejectedValueOnce(new Error("token=secret-auth-value"));
    expect(await checkCredits(f.client, 360, f.log, () => now)).toBe(24 * hour);
    expect(f.client.consumeCredit.mock.calls).toEqual([
      ["credit-1", "credit-1"],
      ["credit-1", "credit-1"],
    ]);
    expect(f.events().map((event) => event.event)).toEqual([
      "credit_redemption_attempt",
      "credit_redemption_error",
      "credit_redemption_attempt",
      "credit_redemption_result",
      "next_check",
    ]);
    expect(f.events()[3]).toEqual({
      timestamp: new Date(now).toISOString(),
      level: "info",
      event: "credit_redemption_result",
      credit_id: "credit-1",
      attempt: 2,
      outcome: "reset",
      reason: "expiry",
    });
    expect(f.lines.join("\n")).not.toContain("secret-auth-value");
    expect(
      f.events().filter((event) => event.event === "credit_redemption_result" && event.outcome === "reset"),
    ).toHaveLength(1);
  });

  it.each([
    "nothingToReset",
    "noCredit",
    "alreadyRedeemed",
  ] as const)("does not label %s as a reset", async (outcome) => {
    const f = fixture();
    f.client.consumeCredit.mockResolvedValue({ outcome });
    await checkCredits(f.client, 360, f.log, () => now);
    expect(f.events().filter((event) => event.event === "credit_redemption_result")).toHaveLength(1);
    expect(f.events().find((event) => event.event === "credit_redemption_result").outcome).toBe(outcome);
    expect(f.events().filter((event) => event.outcome === "reset")).toHaveLength(0);
  });

  it("records all failed attempts without inventing a result or dumping the error", async () => {
    const f = fixture();
    f.client.consumeCredit.mockRejectedValue({
      name: "secret-name",
      message: "secret-token",
      response: { auth: "secret-auth" },
    });
    await expect(checkCredits(f.client, 360, f.log, () => now)).rejects.toThrow("All attempts failed");
    expect(
      f
        .events()
        .filter((event) => event.event === "credit_redemption_error")
        .map((event) => event.attempt),
    ).toEqual([1, 2, 3]);
    expect(f.events().filter((event) => event.event === "credit_redemption_result")).toHaveLength(0);
    expect(f.lines.join("\n")).not.toContain("secret-");
  });

  it("retains the redemption window and schedules the next eligible credit", async () => {
    const f = fixture([
      credit("due", hour),
      credit("future", 8 * hour),
      credit("expired", -hour),
      credit("used", hour, "redeemed"),
    ]);
    expect(await checkCredits(f.client, 360, f.log, () => now)).toBe(2 * hour);
    expect(f.client.consumeCredit.mock.calls).toEqual([["due", "due"]]);
    expect(f.events().at(-1)).toMatchObject({ event: "next_check", delay_ms: 2 * hour });
  });

  it("emits a daily next_check event when there are no eligible credits", async () => {
    const f = fixture([]);
    expect(await checkCredits(f.client, 360, f.log, () => now)).toBe(24 * hour);
    expect(f.client.consumeCredit).not.toHaveBeenCalled();
    expect(f.events()).toHaveLength(1);
    expect(f.events()[0]).toMatchObject({ event: "next_check", delay_ms: 24 * hour });
  });
});

const usageOptions = () => ({
  remainingPercent: 10,
  pollIntervalSeconds: 60,
  recovery: { pendingCreditId: null as string | null },
  saveRecovery: vi.fn(async () => {}),
});
const withUsage = (f: ReturnType<typeof fixture>, usedPercent: number, secondary?: number) => {
  f.client.readCredits.mockResolvedValue({
    rateLimitResetCredits: { availableCount: 2, credits: [credit("later", 48 * hour), credit("sooner", 24 * hour)] },
    rateLimits: {
      limitId: "codex",
      primary: { usedPercent },
      ...(secondary === undefined ? {} : { secondary: { usedPercent: secondary } }),
    },
  });
};

it.each([
  [90, undefined],
  [10, 99],
  [101, undefined],
])("uses only the earliest credit at low allowance (%s, %s)", async (primary, secondary) => {
  const f = fixture();
  withUsage(f, primary, secondary);
  const options = usageOptions();
  f.client.consumeCredit.mockImplementation(async () => {
    expect(options.recovery.pendingCreditId).toBe("sooner");
    expect(options.saveRecovery).toHaveBeenCalledOnce();
    return { outcome: "reset" };
  });
  expect(await checkCredits(f.client, 360, f.log, () => now, options)).toBe(60_000);
  expect(f.client.consumeCredit.mock.calls).toEqual([["sooner", "sooner"]]);
  expect(f.events()).toContainEqual(
    expect.objectContaining({ event: "credit_redemption_result", reason: "low_usage" }),
  );
});

it("does not spend for healthy, missing, elapsed, or model-specific limits", async () => {
  for (const rateLimits of [
    undefined,
    null,
    { primary: { usedPercent: 89 } },
    { limitId: "model-specific", primary: { usedPercent: 100 } },
    { primary: { usedPercent: 100, resetsAt: now / 1000 - 1 } },
  ]) {
    const f = fixture([credit("future", 24 * hour)]);
    f.client.readCredits.mockResolvedValue({
      rateLimitResetCredits: { availableCount: 1, credits: [credit("future", 24 * hour)] },
      ...(rateLimits === undefined ? {} : { rateLimits }),
    });
    await checkCredits(f.client, 360, f.log, () => now, usageOptions());
    expect(f.client.consumeCredit).not.toHaveBeenCalled();
  }
});

it("does not monitor usage unless opted in", async () => {
  const f = fixture();
  withUsage(f, 100);
  await checkCredits(f.client, 360, f.log, () => now);
  expect(f.client.consumeCredit).not.toHaveBeenCalled();
});

it("waits for observed recovery before using a second credit, including after restart", async () => {
  const f = fixture();
  withUsage(f, 100);
  const options = usageOptions();
  await checkCredits(f.client, 360, f.log, () => now, options);
  // The consumed card has disappeared but usage still shows the exhausted window.
  f.client.readCredits.mockResolvedValue({
    rateLimitResetCredits: { availableCount: 1, credits: [credit("later", 48 * hour)] },
    rateLimits: { primary: { usedPercent: 100 } },
  });
  const restored = { ...usageOptions(), recovery: JSON.parse(JSON.stringify(options.recovery)) };
  await checkCredits(f.client, 360, f.log, () => now, restored);
  expect(f.client.consumeCredit).toHaveBeenCalledTimes(1);
  withUsage(f, 1);
  await checkCredits(f.client, 360, f.log, () => now, restored);
  expect(restored.recovery.pendingCreditId).toBeNull();
  withUsage(f, 95);
  await checkCredits(f.client, 360, f.log, () => now, restored);
  expect(f.client.consumeCredit).toHaveBeenCalledTimes(2);
});

it("retries the same pending card after an uncertain failure without selecting another", async () => {
  const f = fixture();
  withUsage(f, 100);
  const options = usageOptions();
  options.recovery.pendingCreditId = "later";
  await checkCredits(f.client, 360, f.log, () => now, options);
  expect(f.client.consumeCredit.mock.calls).toEqual([["later", "later"]]);
});

it("uses at most one card when expiration and usage triggers overlap", async () => {
  const f = fixture([credit("first", hour), credit("second", 2 * hour)]);
  const snapshot = await f.client.readCredits();
  f.client.readCredits.mockResolvedValue({ ...snapshot, rateLimits: { primary: { usedPercent: 100 } } });
  await checkCredits(f.client, 360, f.log, () => now, usageOptions());
  expect(f.client.consumeCredit.mock.calls).toEqual([["first", "first"]]);
});

it("allows non-expiring cards for low usage but not expiry-only checks", async () => {
  const f = fixture();
  f.client.readCredits.mockResolvedValue({
    rateLimitResetCredits: { availableCount: 1, credits: [{ ...credit("forever", hour), expiresAt: null }] },
    rateLimits: { primary: { usedPercent: 95 } },
  });
  await checkCredits(f.client, 360, f.log, () => now);
  expect(f.client.consumeCredit).not.toHaveBeenCalled();
  await checkCredits(f.client, 360, f.log, () => now, usageOptions());
  expect(f.client.consumeCredit.mock.calls).toEqual([["forever", "forever"]]);
});

it("does not redeem if writing the checkpoint fails", async () => {
  const f = fixture();
  withUsage(f, 100);
  const options = usageOptions();
  options.saveRecovery.mockRejectedValue(new Error("disk full"));
  await expect(checkCredits(f.client, 360, f.log, () => now, options)).rejects.toThrow("disk full");
  expect(f.client.consumeCredit).not.toHaveBeenCalled();
});
