import { z } from "zod";
import { InvalidConfigError } from "./errors.ts";

const configSchema = z
  .object({
    CODEX_BIN: z.string().min(1).default("codex"),
    REDEEM_BEFORE_MINUTES: z.coerce.number().int().min(1).default(360),
    LOCALE: z.string().min(1).default("en"),
    TIMEZONE: z.string().min(1).default("UTC"),
  })
  .transform((environment) => ({
    codexBin: environment.CODEX_BIN,
    redeemBeforeMs: environment.REDEEM_BEFORE_MINUTES * 60_000,
    locale: environment.LOCALE,
    timeZone: environment.TIMEZONE,
  }));

export type Config = z.output<typeof configSchema>;

export const parseConfig = (environment: NodeJS.ProcessEnv) => {
  const parsed = configSchema.safeParse(environment);
  if (!parsed.success) {
    throw new InvalidConfigError(`Invalid configuration\n${z.prettifyError(parsed.error)}`, { cause: parsed.error });
  }
  return parsed.data;
};
