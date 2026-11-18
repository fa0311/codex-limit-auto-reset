import { z } from "zod";

const configSchema = z.object({
  RESET_REMAINING_PERCENT: z.coerce.number().min(0).max(20).optional(),
  USAGE_POLL_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  STATE_FILE: z.string().min(1).optional(),
  CODEX_BIN: z.string().min(1).default("codex"),
  REDEEM_BEFORE_MINUTES: z.coerce.number().int().min(1).default(360),
});

export const parseConfig = (environment: NodeJS.ProcessEnv) => configSchema.parse(environment);
