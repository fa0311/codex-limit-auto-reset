import { z } from "zod";

const localeSchema = z.object({
  LOCAL: z.string().min(1).default("en"),
  TIMEZONE: z.string().min(1).default("UTC"),
});

export const parseLocale = (environment: NodeJS.ProcessEnv) => localeSchema.parse(environment);
