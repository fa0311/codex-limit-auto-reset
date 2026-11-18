#!/usr/bin/env node
// Stand-in for `codex app-server --stdio` in the end-to-end tests, scripted by FAKE_CODEX_SCENARIO:
//   account        result of account/read (default: a ChatGPT account); null means logged out
//   credits        rateLimitResetCredits of account/rateLimits/read
//   rateLimitsError  JSON-RPC error returned by account/rateLimits/read instead
//   consume        outcomes of successive consume calls; the last one repeats
// Every request line is appended to the file named by FAKE_CODEX_REQUESTS.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

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

for await (const line of createInterface({ input: process.stdin })) {
  if (process.env.FAKE_CODEX_REQUESTS) {
    appendFileSync(process.env.FAKE_CODEX_REQUESTS, `${line}\n`);
  }
  const { id, method } = JSON.parse(line);
  if (id === undefined) {
    continue;
  }
  const handler = handlers[method];
  send({ id, ...(handler ? handler() : { error: { code: -32601, message: `Unknown method: ${method}` } }) });
}
