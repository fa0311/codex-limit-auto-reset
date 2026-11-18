import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// These tests run the real entry points against a scripted stand-in for `codex app-server`.
const root = fileURLToPath(new URL("..", import.meta.url));
const fakeCodex = join(root, "test/fixtures/fake-codex.mjs");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const credit = (id: string, expiresInMinutes: number) => ({
  id,
  resetType: "codexRateLimits",
  status: "available",
  grantedAt: Math.floor(Date.now() / 1000) - 3600,
  expiresAt: Math.floor(Date.now() / 1000) + expiresInMinutes * 60,
  title: null,
  description: null,
});

let directory: string;
let requestsFile: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "codex-limit-auto-reset-"));
  requestsFile = join(directory, "requests.jsonl");
});
afterEach(async () => {
  await rm(directory, { recursive: true });
});

const start = (entry: string, scenario: object, environment: Record<string, string> = {}) =>
  execa(process.execPath, [join(root, "src", entry)], {
    cwd: directory,
    env: {
      CODEX_BIN: fakeCodex,
      FAKE_CODEX_REQUESTS: requestsFile,
      FAKE_CODEX_SCENARIO: JSON.stringify(scenario),
      REDEEM_BEFORE_MINUTES: "60",
      ...environment,
    },
    reject: false,
  });

const events = (stdout: string) => stdout.split("\n").map((line) => JSON.parse(line));
const requests = async () =>
  (await readFile(requestsFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

describe("worker", () => {
  it("redeems a credit inside the window, then stops cleanly on SIGTERM", async () => {
    const worker = start("main.ts", {
      credits: { availableCount: 2, credits: [credit("due", 30), credit("later", 600)] },
    });
    for await (const line of worker) {
      if (JSON.parse(line).event === "next_check") {
        worker.kill("SIGTERM");
      }
    }
    const { exitCode, stdout, stderr } = await worker;

    expect(events(stdout)).toEqual([
      expect.objectContaining({ event: "credit_redemption_attempt", credit_id: "due", attempt: 1 }),
      expect.objectContaining({ event: "credit_redemption_result", credit_id: "due", outcome: "reset" }),
      expect.objectContaining({ event: "next_check" }),
    ]);
    // "later" becomes due 60 minutes before it expires, 540 minutes from now.
    const { delay_ms } = events(stdout).at(-1);
    expect(delay_ms).toBeGreaterThan(535 * 60_000);
    expect(delay_ms).toBeLessThanOrEqual(540 * 60_000);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect((await requests()).map(({ method }) => method)).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "account/rateLimits/read",
      "account/rateLimitResetCredit/consume",
    ]);
  });

  it("stops at once, saying so, when Codex is logged out", async () => {
    const { exitCode, stdout } = await start("main.ts", { account: null });
    expect(events(stdout)).toEqual([
      expect.objectContaining({ event: "check_failed", operation: "check", error_type: "not_authenticated" }),
    ]);
    expect(exitCode).toBe(1);
    expect((await requests()).filter(({ method }) => method === "account/read")).toHaveLength(1);
  });

  it("reports an app-server error instead of waiting for a timeout", async () => {
    const { exitCode, stdout } = await start("main.ts", {
      rateLimitsError: { code: -32600, message: "codex account authentication required to read rate limits" },
    });
    expect(events(stdout)).toEqual([
      expect.objectContaining({
        event: "check_failed",
        operation: "check",
        error_type: "rpc_error",
        detail: "account/rateLimits/read failed (-32600): codex account authentication required to read rate limits",
      }),
    ]);
    expect(exitCode).toBe(1);
  });

  it("reports a Codex CLI that cannot be started", async () => {
    const { exitCode, stdout, stderr } = await start("main.ts", {}, { CODEX_BIN: join(directory, "missing-codex") });
    expect(events(stdout)).toEqual([
      expect.objectContaining({ event: "check_failed", operation: "initialize", error_type: "app_server_exited" }),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
  });
});

describe("commands", () => {
  const scenario = {
    credits: { availableCount: 2, credits: [credit("later", 600), credit("sooner", 30)] },
    consume: ["nothingToReset"],
  };

  it("cli lists the credits without redeeming any", async () => {
    const { exitCode, stdout } = await start("cli.ts", scenario);
    expect(stdout).toContain("sooner");
    expect(stdout).toContain("later");
    expect(exitCode).toBe(0);
    expect((await requests()).map(({ method }) => method)).not.toContain("account/rateLimitResetCredit/consume");
  });

  it("reset redeems the credit that expires first once confirmed", async () => {
    const command = start("reset.ts", scenario);
    command.stdin.end("y\n");
    const { exitCode, stdout } = await command;
    expect(stdout).toContain("Credit sooner: nothingToReset");
    expect(exitCode).toBe(0);
    expect((await requests()).at(-1)).toMatchObject({
      method: "account/rateLimitResetCredit/consume",
      params: { creditId: "sooner", idempotencyKey: expect.stringMatching(uuid) },
    });
  });

  it("reset redeems nothing unless confirmed", async () => {
    const command = start("reset.ts", scenario);
    command.stdin.end("\n");
    const { exitCode, stdout } = await command;
    expect(stdout).toContain("No credit was redeemed.");
    expect(exitCode).toBe(0);
    expect((await requests()).map(({ method }) => method)).not.toContain("account/rateLimitResetCredit/consume");
  });

  it("explains a failure in one line", async () => {
    const { exitCode, stderr } = await start("cli.ts", { account: null });
    expect(stderr).toBe("Error: Codex CLI is not authenticated with ChatGPT");
    expect(exitCode).toBe(1);
  });
});
