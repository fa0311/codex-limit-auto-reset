import { describe, expect, it, vi } from "vitest";
import { checkCredits } from "../src/check.ts";
import type { ConsumeCredit, RateLimitCredits } from "../src/codex-schemas.ts";
import { CodexError } from "../src/errors.ts";
import { createLogger } from "../src/log.ts";

// retry() pauses between attempts; the tests do not wait for it.
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => {}) }));

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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
    const [first, retried] = f.client.consumeCredit.mock.calls;
    expect(first).toEqual(["credit-1", expect.stringMatching(uuid)]);
    expect(retried).toEqual(first);
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
    });
    expect(f.lines.join("\n")).not.toContain("secret-auth-value");
    expect(
      f.events().filter((event) => event.event === "credit_redemption_result" && event.outcome === "reset"),
    ).toHaveLength(1);
  });

  it.each(["nothingToReset", "noCredit", "alreadyRedeemed"] as const)(
    "does not label %s as a reset",
    async (outcome) => {
      const f = fixture();
      f.client.consumeCredit.mockResolvedValue({ outcome });
      await checkCredits(f.client, 360, f.log, () => now);
      expect(f.events().filter((event) => event.event === "credit_redemption_result")).toHaveLength(1);
      expect(f.events().find((event) => event.event === "credit_redemption_result").outcome).toBe(outcome);
      expect(f.events().filter((event) => event.outcome === "reset")).toHaveLength(0);
    },
  );

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
    expect(f.client.consumeCredit.mock.calls).toEqual([["due", expect.stringMatching(uuid)]]);
    expect(f.events().at(-1)).toMatchObject({ event: "next_check", delay_ms: 2 * hour });
  });

  it("emits a daily next_check event when there are no eligible credits", async () => {
    const f = fixture([]);
    expect(await checkCredits(f.client, 360, f.log, () => now)).toBe(24 * hour);
    expect(f.client.consumeCredit).not.toHaveBeenCalled();
    expect(f.events()).toHaveLength(1);
    expect(f.events()[0]).toMatchObject({ event: "next_check", delay_ms: 24 * hour });
  });

  it("uses a new idempotency key for each later attempt on the same credit", async () => {
    const f = fixture();
    f.client.consumeCredit.mockResolvedValue({ outcome: "nothingToReset" });
    await checkCredits(f.client, 360, f.log, () => now);
    await checkCredits(f.client, 360, f.log, () => now);
    const keys = f.client.consumeCredit.mock.calls.map(([, key]) => key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("classifies an app-server error and does not repeat a request it will never accept", async () => {
    const f = fixture();
    f.client.consumeCredit.mockRejectedValue(new CodexError("rpc_error", "consume failed (-32600): no", false));
    await expect(checkCredits(f.client, 360, f.log, () => now)).rejects.toThrow("All attempts failed");
    expect(f.client.consumeCredit).toHaveBeenCalledOnce();
    expect(f.events()).toEqual([
      expect.objectContaining({ event: "credit_redemption_attempt", attempt: 1 }),
      expect.objectContaining({
        event: "credit_redemption_error",
        level: "error",
        error_type: "rpc_error",
        detail: "consume failed (-32600): no",
      }),
    ]);
  });
});
