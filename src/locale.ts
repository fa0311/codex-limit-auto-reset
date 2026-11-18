import { z } from "zod";
import { parseEnvironment } from "./config.ts";

const localeSchema = z.object({
  LOCAL: z.string().min(1).default("en"),
  TIMEZONE: z.string().min(1).default("UTC"),
});

export const parseLocale = (environment: NodeJS.ProcessEnv) => parseEnvironment(localeSchema, environment);

type Locale = ReturnType<typeof parseLocale>;

export const formatExpiry = (expiresAt: number | null, locale: Locale) =>
  expiresAt === null ? "never" : new Date(expiresAt * 1000).toLocaleString(locale.LOCAL, { timeZone: locale.TIMEZONE });
