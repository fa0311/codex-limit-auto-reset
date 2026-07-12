import { describe, expect, it } from "vitest";
import { consumeCreditSchema, rateLimitCreditsSchema, rpcMessageSchema } from "../src/codex-schemas.ts";

describe("rpcMessageSchema", () => {
  it("tags responses, errors, and notifications", () => {
    expect(rpcMessageSchema.parse({ id: 1, result: { userAgent: "codex" } })).toMatchObject({ type: "response" });
    expect(rpcMessageSchema.parse({ id: 1, error: { code: -32603, message: "boom" } })).toMatchObject({
      type: "error",
    });
    expect(rpcMessageSchema.parse({ method: "account/rateLimits/updated", params: {} })).toMatchObject({
      type: "request",
    });
  });
});

describe("rateLimitCreditsSchema", () => {
  const credit = {
    id: "RateLimitResetCredit_abc",
    resetType: "codexRateLimits",
    status: "available",
    grantedAt: 1_752_000_000,
    expiresAt: 1_753_000_000,
    title: null,
    description: null,
  };

  it("parses a full response", () => {
    const parsed = rateLimitCreditsSchema.parse({
      rateLimits: { limitId: "codex" },
      rateLimitsByLimitId: null,
      rateLimitResetCredits: { availableCount: 1, credits: [credit] },
    });
    expect(parsed.rateLimitResetCredits).toEqual({
      availableCount: 1,
      credits: [
        {
          id: "RateLimitResetCredit_abc",
          resetType: "codexRateLimits",
          status: "available",
          grantedAt: 1_752_000_000,
          expiresAt: 1_753_000_000,
        },
      ],
    });
  });

  it("normalizes a null summary and a null credits list to empty lists", () => {
    expect(rateLimitCreditsSchema.parse({ rateLimits: {}, rateLimitResetCredits: null })).toEqual({
      rateLimitResetCredits: { availableCount: 0, credits: [] },
    });
    expect(
      rateLimitCreditsSchema.parse({ rateLimits: {}, rateLimitResetCredits: { availableCount: 2, credits: null } }),
    ).toEqual({ rateLimitResetCredits: { availableCount: 2, credits: [] } });
  });

  it("keeps a never-expiring credit as null", () => {
    const parsed = rateLimitCreditsSchema.parse({
      rateLimits: {},
      rateLimitResetCredits: { availableCount: 1, credits: [{ ...credit, expiresAt: null }] },
    });
    expect(parsed.rateLimitResetCredits.credits[0]?.expiresAt).toBeNull();
  });

  it("maps a status or resetType from a newer server to unknown", () => {
    const parsed = rateLimitCreditsSchema.parse({
      rateLimits: {},
      rateLimitResetCredits: {
        availableCount: 1,
        credits: [{ ...credit, status: "brandNewStatus", resetType: "brandNewType" }],
      },
    });
    expect(parsed.rateLimitResetCredits.credits[0]).toMatchObject({ status: "unknown", resetType: "unknown" });
  });
});

describe("consumeCreditSchema", () => {
  it.each(["reset", "nothingToReset", "noCredit", "alreadyRedeemed"] as const)("parses outcome %s", (outcome) => {
    expect(consumeCreditSchema.parse({ outcome })).toEqual({ outcome });
  });
});
