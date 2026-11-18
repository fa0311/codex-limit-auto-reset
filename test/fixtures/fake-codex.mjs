#!/usr/bin/env node
// Stand-in for `codex app-server --stdio` in the tests, scripted by FAKE_CODEX_SCENARIO:
//   account          result of account/read (default: a ChatGPT account); null means logged out
//   credits          rateLimitResetCredits of account/rateLimits/read
//   rateLimitsError  JSON-RPC error returned by account/rateLimits/read instead
//   consume          outcomes of successive consume calls; the last one repeats
//   delayMs          { [method]: milliseconds to wait before answering }
//   misbehave        { [method]: "hang" | "garbage" | "exit" } instead of answering
// Every request line is appended to the file named by FAKE_CODEX_REQUESTS.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

const scenario = JSON.parse(process.env.FAKE_CODEX_SCENARIO ?? "{}");
const outcomes = [...(scenario.consume ?? ["reset"])];
const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const handlers = {
  initialize: () => {
    // The real server interleaves notifications like this one with its responses.
    send({ method: "remoteControl/status/changed", params: { status: "disabled" }, emittedAtMs: Date.now() });
    return { result: { userAgent: "fake-codex/0.0.0" } };
  },
  "account/read": () => ({
    result: {
      account: scenario.account === undefined ? { type: "chatgpt", email: null, planType: "plus" } : scenario.account,
      requiresOpenaiAuth: true,
    },
  }),
  "account/rateLimits/read": () =>
    scenario.rateLimitsError
      ? { error: scenario.rateLimitsError }
      : {
          result: {
            rateLimits: { limitId: "codex" },
            rateLimitsByLimitId: null,
            rateLimitResetCredits: scenario.credits ?? null,
          },
        },
  "account/rateLimitResetCredit/consume": () => ({
    result: { outcome: outcomes.length > 1 ? outcomes.shift() : outcomes[0] },
  }),
};

const answer = async ({ id, method }) => {
  await sleep(scenario.delayMs?.[method] ?? 0);
  switch (scenario.misbehave?.[method]) {
    case "hang":
      return;
    case "garbage":
      process.stdout.write("this is not JSON\n");
      return;
    case "exit":
      process.exit(3);
  }
  const handler = handlers[method];
  send({ id, ...(handler ? handler() : { error: { code: -32601, message: `Unknown method: ${method}` } }) });
};

for await (const line of createInterface({ input: process.stdin })) {
  if (process.env.FAKE_CODEX_REQUESTS) {
    appendFileSync(process.env.FAKE_CODEX_REQUESTS, `${line}\n`);
  }
  const request = JSON.parse(line);
  if (request.id !== undefined) {
    void answer(request);
  }
}
