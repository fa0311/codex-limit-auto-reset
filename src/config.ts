import { z } from "zod";
import { CodexError, describeIssues } from "./errors.ts";

const configSchema = z.object({
  CODEX_BIN: z.string().min(1).default("codex"),
  REDEEM_BEFORE_MINUTES: z.coerce.number().int().min(1).default(360),
});

export const parseEnvironment = <T extends z.ZodType>(schema: T, environment: NodeJS.ProcessEnv): z.output<T> => {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    throw new CodexError("invalid_config", `Invalid configuration: ${describeIssues(parsed.error)}`, false);
  }
  return parsed.data;
};

export const parseConfig = (environment: NodeJS.ProcessEnv) => parseEnvironment(configSchema, environment);
