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
  const parse = (rateLimitResetCredits: unknown) =>
    rateLimitCreditsSchema.parse({ rateLimits: {}, rateLimitsByLimitId: null, rateLimitResetCredits })
      .rateLimitResetCredits;

  it("reads the timestamps, which are in seconds, as dates", () => {
    expect(parse({ availableCount: 1, credits: [credit] })).toEqual({
      availableCount: 1,
      credits: [
        {
          id: "RateLimitResetCredit_abc",
          resetType: "codexRateLimits",
          status: "available",
          grantedAt: new Date("2025-07-08T18:40:00.000Z"),
          expiresAt: new Date("2025-07-20T08:26:40.000Z"),
        },
      ],
    });
  });

  it("keeps a credit that never expires as null", () => {
    expect(parse({ availableCount: 1, credits: [{ ...credit, expiresAt: null }] }).credits?.[0]?.expiresAt).toBeNull();
  });

  it("tells a count without details apart from a count of none", () => {
    expect(parse({ availableCount: 2, credits: null })).toEqual({ availableCount: 2, credits: null });
    expect(parse({ availableCount: 0, credits: [] })).toEqual({ availableCount: 0, credits: [] });
  });

  it("reads a missing summary as no credits", () => {
    expect(parse(null)).toEqual({ availableCount: 0, credits: [] });
  });

  it("maps a status or resetType from a newer server to unknown", () => {
    const parsed = parse({ availableCount: 1, credits: [{ ...credit, status: "brandNew", resetType: "brandNew" }] });
    expect(parsed.credits?.[0]).toMatchObject({ status: "unknown", resetType: "unknown" });
  });
});

describe("consumeCreditSchema", () => {
  it.each(["reset", "nothingToReset", "noCredit", "alreadyRedeemed"] as const)("parses outcome %s", (outcome) => {
    expect(consumeCreditSchema.parse({ outcome })).toEqual({ outcome });
  });

  it("rejects an outcome this version does not know, rather than guessing what it means", () => {
    expect(() => consumeCreditSchema.parse({ outcome: "brandNew" })).toThrow();
  });
});
