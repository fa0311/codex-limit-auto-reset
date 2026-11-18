import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodexClient } from "../src/codex-client.ts";
import {
  AppServerExitedError,
  InvalidResponseError,
  NotAuthenticatedError,
  RequestTimeoutError,
  RpcError,
} from "../src/errors.ts";

// The client is exercised against a real subprocess: a scripted stand-in for `codex app-server`.
const fakeCodex = fileURLToPath(new URL("fixtures/fake-codex.mjs", import.meta.url));
const open = (scenario: object) => {
  vi.stubEnv("FAKE_CODEX_SCENARIO", JSON.stringify(scenario));
  return createCodexClient(fakeCodex);
};

const credits = {
  availableCount: 1,
  credits: [
    {
      id: "RateLimitResetCredit_abc",
      resetType: "codexRateLimits",
      status: "available",
      grantedAt: 1_752_000_000,
      expiresAt: 1_753_000_000,
    },
  ],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("createCodexClient", () => {
  it("answers each request with its own response, whichever arrives first", async () => {
    using client = await open({ credits, consume: ["nothingToReset"], delayMs: { "account/rateLimits/read": 50 } });
    const [read, consumed] = await Promise.all([client.readCredits(), client.consumeCredit("id", "key")]);
    expect(read.rateLimitResetCredits.availableCount).toBe(1);
    expect(consumed).toEqual({ outcome: "nothingToReset" });
  });

  it("accepts a ChatGPT login", async () => {
    using client = await open({});
    await expect(client.refreshAccount()).resolves.toBeUndefined();
  });

  it.each([
    ["logged out", null],
    ["logged in with an API key", { type: "apiKey" }],
  ])("refuses to go on when Codex is %s", async (_state, account) => {
    using client = await open({ account });
    await expect(client.refreshAccount()).rejects.toThrow(NotAuthenticatedError);
  });

  it("rejects with the error app-server returns", async () => {
    using client = await open({ rateLimitsError: { code: -32603, message: "failed to fetch rate limits" } });
    const failure = await client.readCredits().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RpcError);
    expect(failure).toHaveProperty("message", "account/rateLimits/read failed (-32603): failed to fetch rate limits");
  });

  it("names the field, not its value, when a response does not have the expected shape", async () => {
    using client = await open({ credits: { availableCount: "secret-value", credits: null } });
    const failure = await client.readCredits().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InvalidResponseError);
    expect(failure).toHaveProperty("message", expect.stringContaining("rateLimitResetCredits.availableCount"));
    expect(failure).toHaveProperty("message", expect.not.stringContaining("secret-value"));
  });

  it("gives up on a request that is never answered", async () => {
    using client = await open({ misbehave: { "account/rateLimits/read": "hang" } });
    vi.useFakeTimers();
    const reading = client.readCredits();
    const expectation = expect(reading).rejects.toThrow(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(30_000);
    await expectation;
  });

  it("fails this and every later request once app-server's output cannot be parsed", async () => {
    using client = await open({ misbehave: { "account/rateLimits/read": "garbage" } });
    const failure = await client.readCredits().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InvalidResponseError);
    expect(failure).toHaveProperty("message", expect.not.stringContaining("this is not JSON"));
    await expect(client.refreshAccount()).rejects.toBe(failure);
  });

  it("fails this and every later request once app-server exits", async () => {
    using client = await open({ misbehave: { "account/rateLimits/read": "exit" } });
    const failure = await client.readCredits().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppServerExitedError);
    await expect(client.refreshAccount()).rejects.toBe(failure);
  });

  it("fails to open when the Codex CLI cannot be started", async () => {
    await expect(createCodexClient("/nonexistent/codex")).rejects.toThrow(AppServerExitedError);
  });
});
