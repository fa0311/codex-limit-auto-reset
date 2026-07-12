import { PassThrough } from "node:stream";
import { execa } from "execa";
import { describe, expect, it, vi } from "vitest";
import { createCodexClient } from "../src/codex-client.ts";

vi.mock("execa", () => ({ execa: vi.fn() }));

const clientInfo = { name: "test_client", title: "Test Client", version: "0.0.0" };

const createHarness = () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let exitResolve: (result: { shortMessage: string }) => void = () => {};
  const exitPromise = new Promise<{ shortMessage: string }>((resolve) => {
    exitResolve = resolve;
  });
  const subprocess = Object.assign(exitPromise, {
    writable: () => stdin,
    readable: () => stdout,
    kill: () => {
      exitResolve({ shortMessage: "killed" });
    },
  });
  vi.mocked(execa).mockReturnValue(subprocess as never);

  const lines: string[] = [];
  let buffer = "";
  stdin.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    lines.push(...parts);
  });

  return {
    client: createCodexClient({ command: "codex", clientInfo }),
    exit: (shortMessage: string) => {
      exitResolve({ shortMessage });
    },
    line: async (index: number) =>
      await vi.waitFor(() => {
        const line = lines[index];
        expect(line).toBeDefined();
        return line as string;
      }),
    respond: (id: number, result: unknown) => {
      stdout.write(`${JSON.stringify({ id, result })}\n`);
    },
  };
};

const creditsResult = {
  rateLimits: { limitId: "codex" },
  rateLimitsByLimitId: null,
  rateLimitResetCredits: {
    availableCount: 1,
    credits: [
      {
        id: "RateLimitResetCredit_abc",
        resetType: "codexRateLimits",
        status: "available",
        grantedAt: 1_752_000_000,
        expiresAt: 1_753_000_000,
        title: null,
        description: null,
      },
    ],
  },
};

describe("createCodexClient", () => {
  it("sends initialize then the initialized notification", async () => {
    const harness = createHarness();
    const initialized = harness.client.initialize();
    expect(JSON.parse(await harness.line(0))).toEqual({ id: 1, method: "initialize", params: { clientInfo } });
    harness.respond(1, { userAgent: "codex/0.144.1" });
    await initialized;
    expect(await harness.line(1)).toBe('{"method":"initialized"}');
  });

  it("correlates responses to requests by id even out of order", async () => {
    const harness = createHarness();
    const reading = harness.client.readCredits();
    const consuming = harness.client.consumeCredit("RateLimitResetCredit_abc", "key-1");
    expect(await harness.line(0)).toBe('{"id":1,"method":"account/rateLimits/read"}');
    expect(JSON.parse(await harness.line(1))).toEqual({
      id: 2,
      method: "account/rateLimitResetCredit/consume",
      params: { creditId: "RateLimitResetCredit_abc", idempotencyKey: "key-1" },
    });
    harness.respond(2, { outcome: "nothingToReset" });
    harness.respond(1, creditsResult);
    expect(await consuming).toEqual({ outcome: "nothingToReset" });
    expect((await reading).rateLimitResetCredits.availableCount).toBe(1);
  });

  it("refreshAccount resolves for a chatgpt account", async () => {
    const harness = createHarness();
    const refreshing = harness.client.refreshAccount();
    expect(JSON.parse(await harness.line(0))).toEqual({
      id: 1,
      method: "account/read",
      params: { refreshToken: true },
    });
    harness.respond(1, { account: { type: "chatgpt", email: null, planType: "plus" }, requiresOpenaiAuth: false });
    await expect(refreshing).resolves.toBeUndefined();
  });

  it("refreshAccount rejects when logged out", async () => {
    const harness = createHarness();
    const refreshing = harness.client.refreshAccount();
    await harness.line(0);
    harness.respond(1, { account: null, requiresOpenaiAuth: true });
    await expect(refreshing).rejects.toThrow("not authenticated with ChatGPT");
  });

  it("times out a request that never receives a response", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const expectation = expect(harness.client.readCredits()).rejects.toThrow(
        "Codex app-server request timed out: account/rateLimits/read",
      );
      await vi.advanceTimersByTimeAsync(60_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects pending and future requests when the app-server exits", async () => {
    const harness = createHarness();
    const pending = harness.client.readCredits();
    await harness.line(0);
    harness.exit("crashed");
    await expect(pending).rejects.toThrow("Codex app-server exited: crashed");
    await expect(harness.client.readCredits()).rejects.toThrow("Codex app-server exited: crashed");
  });
});
