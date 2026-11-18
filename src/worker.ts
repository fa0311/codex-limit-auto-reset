import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { CodexClient } from "./codex-client.ts";
import { createCodexClient } from "./codex-client.ts";
import type { ConsumeCredit } from "./codex-schemas.ts";
import type { ExpiringCredit } from "./schedule.ts";
import { expiringCredits, isDue, nextCheckDelay } from "./schedule.ts";

// How soon to ask again when app-server could not say when the credits expire.
const DETAILS_RETRY_MS = 10 * 60 * 1000;

type WorkerEvents = {
  redeeming: [creditId: string];
  redeemed: [creditId: string, outcome: ConsumeCredit["outcome"]];
  detailsUnavailable: [availableCount: number];
};

type WorkerOptions = {
  readonly command: string;
  readonly redeemBeforeMs: number;
};

export const createWorker = ({ command, redeemBeforeMs }: WorkerOptions) => {
  const events = new EventEmitter<WorkerEvents>();

  /** Redeems the first of the due credits that the server accepts. Resolves with those still redeemable. */
  const redeem = async (client: CodexClient, due: ExpiringCredit[]): Promise<ExpiringCredit[]> => {
    const [credit, ...rest] = due;
    if (!credit) {
      return [];
    }
    events.emit("redeeming", credit.id);
    // One key per attempt, as the protocol asks: a later attempt on this credit must not replay this answer.
    const { outcome } = await client.consumeCredit(credit.id, randomUUID());
    events.emit("redeemed", credit.id, outcome);
    switch (outcome) {
      // The usage is reset, so the other credits have nothing left to reset in this check.
      case "reset":
        return rest;
      // The credit is kept, and the answer would be the same for the others.
      case "nothingToReset":
        return due;
      // The credit is gone.
      case "noCredit":
      case "alreadyRedeemed":
        return redeem(client, rest);
    }
  };

  /** Runs one check against a fresh app-server. Resolves with the time to wait before the next check. */
  const check = async () => {
    using client = await createCodexClient(command);
    await client.refreshAccount();
    const { availableCount, credits } = (await client.readCredits()).rateLimitResetCredits;
    if (credits === null && availableCount > 0) {
      events.emit("detailsUnavailable", availableCount);
      return DETAILS_RETRY_MS;
    }

    const expiring = expiringCredits(credits ?? [], Date.now());
    const due = expiring.filter((credit) => isDue(credit, Date.now(), redeemBeforeMs));
    const unredeemed = await redeem(client, due);
    const waiting = expiring.filter((credit) => !due.includes(credit));
    return nextCheckDelay([...unredeemed, ...waiting], Date.now(), redeemBeforeMs);
  };

  return { check, events };
};
