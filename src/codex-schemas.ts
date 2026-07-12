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

export type RpcMessage = z.infer<typeof rpcMessageSchema>;

// GetAccountResponse: account is a tagged enum ("apiKey" | "chatgpt" | "amazonBedrock") or null.
export const accountSchema = z.object({
  account: z.object({ type: z.string() }).nullable(),
});
export type Account = z.infer<typeof accountSchema>;

// GetAccountRateLimitsResponse.rateLimitResetCredits: summary and its credits list are both nullable.
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
            grantedAt: z.int(),
            expiresAt: z.int().nullable(),
          }),
        )
        .nullish()
        .transform((credits) => credits ?? []),
    })
    .nullish()
    .transform((summary) => summary ?? { availableCount: 0, credits: [] }),
});
export type RateLimitCredits = z.infer<typeof rateLimitCreditsSchema>;

export const consumeCreditSchema = z.object({
  outcome: z.enum(["reset", "nothingToReset", "noCredit", "alreadyRedeemed"]),
});
export type ConsumeCredit = z.infer<typeof consumeCreditSchema>;
