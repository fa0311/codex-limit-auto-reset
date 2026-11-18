import { z } from "zod";

// Wire format: codex-rs/app-server-protocol/src/rpc.rs (JSON-RPC without the "jsonrpc" field).
export const rpcMessageSchema = z.xor([
  z
    .object({
      id: z.int(),
      result: z.json(),
    })
    .transform((message) => ({
      ...message,
      type: "response" as const,
    })),
  z
    .object({
      id: z.int(),
      error: z.object({
        code: z.int(),
        message: z.string(),
      }),
    })
    .transform((message) => ({
      ...message,
      type: "error" as const,
    })),
  z
    .object({
      method: z.string(),
      params: z.json().optional(),
    })
    .transform((message) => ({
      ...message,
      type: "request" as const,
    })),
]);

// GetAccountResponse: account is a tagged enum ("apiKey" | "chatgpt" | "amazonBedrock" | "gcp") or null.
export const accountSchema = z.object({
  account: z.object({ type: z.string() }).nullable(),
});

// Unix timestamp in seconds.
const timestampSchema = z.int().transform((seconds) => new Date(seconds * 1000));

// GetAccountRateLimitsResponse.rateLimitResetCredits. A null summary means there is nothing to
// report. Null `credits` means only the count is known, because app-server's detail lookup failed.
export const rateLimitCreditsSchema = z.object({
  rateLimitResetCredits: z
    .object({
      availableCount: z.int(),
      credits: z
        .array(
          z.object({
            id: z.string().min(1),
            resetType: z.enum(["codexRateLimits", "unknown"]).catch("unknown"),
            status: z.enum(["available", "redeeming", "redeemed", "unknown"]).catch("unknown"),
            grantedAt: timestampSchema,
            expiresAt: timestampSchema.nullable(),
          }),
        )
        .nullable(),
    })
    .nullable()
    .transform((summary) => summary ?? { availableCount: 0, credits: [] }),
});
export type RateLimitCredits = z.output<typeof rateLimitCreditsSchema>;
export type Credit = NonNullable<RateLimitCredits["rateLimitResetCredits"]["credits"]>[number];

export const consumeCreditSchema = z.object({
  outcome: z.enum(["reset", "nothingToReset", "noCredit", "alreadyRedeemed"]),
});
export type ConsumeCredit = z.output<typeof consumeCreditSchema>;
