import { runCommand } from "./command.ts";
import { formatExpiry, parseLocale } from "./locale.ts";

await runCommand(async (client) => {
  const locale = parseLocale(process.env);
  const { availableCount, credits } = (await client.readCredits()).rateLimitResetCredits;
  if (credits.length === 0) {
    console.log(
      availableCount > 0
        ? `${availableCount} reset credit(s) available, but their details could not be loaded. Try again shortly.`
        : "No reset credits.",
    );
    return;
  }
  console.table(
    credits.map((credit) => ({
      id: credit.id,
      status: credit.status,
      resetType: credit.resetType,
      expiresAt: formatExpiry(credit.expiresAt, locale),
    })),
  );
});
