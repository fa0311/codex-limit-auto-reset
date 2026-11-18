import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { runCommand } from "./command.ts";

await runCommand(async (client, { locale, timeZone }) => {
  const { credits } = (await client.readCredits()).rateLimitResetCredits;
  const redeemable = (credits ?? [])
    .filter(
      (credit) =>
        credit.status === "available" &&
        credit.resetType === "codexRateLimits" &&
        (credit.expiresAt === null || credit.expiresAt.getTime() > Date.now()),
    )
    .sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity));
  const [next] = redeemable;
  if (!next) {
    console.log("No redeemable reset credits.");
    return;
  }
  console.table(
    redeemable.map((credit) => ({
      id: credit.id,
      status: credit.status,
      resetType: credit.resetType,
      expiresAt: credit.expiresAt?.toLocaleString(locale, { timeZone }) ?? "never",
    })),
  );

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question("Redeem the first credit now? (y/N) ");
  prompt.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("No credit was redeemed.");
    return;
  }
  const { outcome } = await client.consumeCredit(next.id, randomUUID());
  console.log(`Credit ${next.id}: ${outcome}`);
});
