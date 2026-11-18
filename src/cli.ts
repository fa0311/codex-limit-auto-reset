import { runCommand } from "./command.ts";

await runCommand(async (client, { locale, timeZone }) => {
  const { availableCount, credits } = (await client.readCredits()).rateLimitResetCredits;
  if (credits === null) {
    console.log(`${availableCount} reset credit(s) available, but app-server could not load their details.`);
    return;
  }
  if (credits.length === 0) {
    console.log("No reset credits.");
    return;
  }
  console.table(
    credits.map((credit) => ({
      id: credit.id,
      status: credit.status,
      resetType: credit.resetType,
      expiresAt: credit.expiresAt?.toLocaleString(locale, { timeZone }) ?? "never",
    })),
  );
});
