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
const minute = 60_000;

const credit = (id: string, expiresInMinutes: number) => ({
  id,
  resetType: "codexRateLimits",
  status: "available",
  grantedAt: Math.floor(Date.now() / 1000) - 3600,
  expiresAt: Math.floor(Date.now() / 1000) + expiresInMinutes * 60,
  title: null,
  description: null,
});

const temporary = { directory: "", requestsFile: "" };
beforeEach(async () => {
  temporary.directory = await mkdtemp(join(tmpdir(), "codex-limit-auto-reset-"));
  temporary.requestsFile = join(temporary.directory, "requests.jsonl");
});
afterEach(async () => {
  await rm(temporary.directory, { recursive: true });
});

const start = (entry: string, scenario: object, environment: Record<string, string> = {}) =>
  execa(process.execPath, [join(root, "src", entry)], {
    cwd: temporary.directory,
    env: {
      CODEX_BIN: fakeCodex,
      FAKE_CODEX_REQUESTS: temporary.requestsFile,
      FAKE_CODEX_SCENARIO: JSON.stringify(scenario),
      REDEEM_BEFORE_MINUTES: "60",
      ...environment,
    },
    reject: false,
  });

/** Runs the worker through its first check, then asks it to stop. */
const firstCheck = async (scenario: object, environment?: Record<string, string>) => {
  const worker = start("main.ts", scenario, environment);
  for await (const line of worker) {
    if (JSON.parse(line).event === "next_check") {
      worker.kill("SIGTERM");
    }
  }
  const { exitCode, stdout, stderr } = await worker;
  return { exitCode, stderr, records: stdout.split("\n").map((line) => JSON.parse(line)) };
};

const requests = async () =>
  (await readFile(temporary.requestsFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

describe("worker", () => {
  it("redeems a credit inside the window, then stops cleanly on SIGTERM", async () => {
    const { exitCode, stderr, records } = await firstCheck({
      credits: { availableCount: 2, credits: [credit("later", 600), credit("due", 30)] },
    });

    expect(records).toEqual([
      expect.objectContaining({ level: "info", event: "credit_redemption_attempt", credit_id: "due" }),
      expect.objectContaining({ level: "info", event: "credit_redemption_result", credit_id: "due", outcome: "reset" }),
      expect.objectContaining({ level: "info", event: "next_check" }),
    ]);
    // "later" becomes due 60 minutes before it expires, 540 minutes from now.
    expect(records.at(-1).delay_ms).toBeGreaterThan(535 * minute);
    expect(records.at(-1).delay_ms).toBeLessThanOrEqual(540 * minute);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect((await requests()).map(({ method }) => method)).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "account/rateLimits/read",
      "account/rateLimitResetCredit/consume",
    ]);
    expect((await requests()).at(-1).params).toEqual({ creditId: "due", idempotencyKey: expect.stringMatching(uuid) });
  });

  it("comes back for a credit that had nothing to reset", async () => {
    const { records } = await firstCheck({
      credits: { availableCount: 2, credits: [credit("due", 30), credit("also due", 40)] },
      consume: ["nothingToReset"],
    });
    expect(records).toEqual([
      expect.objectContaining({ event: "credit_redemption_attempt", credit_id: "due" }),
      expect.objectContaining({ event: "credit_redemption_result", credit_id: "due", outcome: "nothingToReset" }),
      expect.objectContaining({ event: "next_check" }),
    ]);
    // Half of the 30 minutes the credit has left.
    expect(records.at(-1).delay_ms).toBeGreaterThan(14 * minute);
    expect(records.at(-1).delay_ms).toBeLessThanOrEqual(15 * minute);
  });

  it("moves on to the next credit when one is already gone", async () => {
    const { records } = await firstCheck({
      credits: { availableCount: 2, credits: [credit("gone", 30), credit("usable", 40)] },
      consume: ["alreadyRedeemed", "reset"],
    });
    expect(records.map(({ event, credit_id, outcome }) => [event, credit_id, outcome])).toEqual([
      ["credit_redemption_attempt", "gone", undefined],
      ["credit_redemption_result", "gone", "alreadyRedeemed"],
      ["credit_redemption_attempt", "usable", undefined],
      ["credit_redemption_result", "usable", "reset"],
      ["next_check", undefined, undefined],
    ]);
  });

  it("asks again soon when app-server reports credits without their details", async () => {
    const { records } = await firstCheck({ credits: { availableCount: 2, credits: null } });
    expect(records).toEqual([
      expect.objectContaining({ level: "warn", event: "credit_details_unavailable", available_count: 2 }),
      expect.objectContaining({ event: "next_check", delay_ms: 10 * minute }),
    ]);
  });

  it.each([
    [
      "Codex is logged out",
      { account: null },
      { error_type: "NotAuthenticatedError", detail: "Codex CLI is not authenticated with ChatGPT" },
    ],
    [
      "app-server answers with an error",
      { rateLimitsError: { code: -32603, message: "failed to fetch rate limits" } },
      { error_type: "RpcError", detail: "account/rateLimits/read failed (-32603): failed to fetch rate limits" },
    ],
    ["app-server exits", { misbehave: { "account/read": "exit" } }, { error_type: "AppServerExitedError" }],
  ])("records the cause and keeps running when %s", async (_case, scenario, failure) => {
    const { exitCode, stderr, records } = await firstCheck(scenario);
    expect(records).toEqual([
      expect.objectContaining({ level: "error", event: "check_failed", ...failure }),
      expect.objectContaining({ event: "next_check", delay_ms: minute }),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("keeps running when the Codex CLI cannot be started", async () => {
    const { exitCode, stderr, records } = await firstCheck({}, { CODEX_BIN: join(temporary.directory, "missing") });
    expect(records).toEqual([
      expect.objectContaining({ event: "check_failed", error_type: "AppServerExitedError" }),
      expect.objectContaining({ event: "next_check", delay_ms: minute }),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("does not start with an invalid setting", async () => {
    const { exitCode, stdout } = await start("main.ts", {}, { REDEEM_BEFORE_MINUTES: "soon" });
    expect(JSON.parse(stdout)).toMatchObject({
      level: "error",
      event: "worker_failed",
      error_type: "InvalidConfigError",
      detail: expect.stringContaining("REDEEM_BEFORE_MINUTES"),
    });
    expect(exitCode).toBe(1);
    await expect(requests()).rejects.toThrow("ENOENT");
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

  it("cli says so when only the count is known", async () => {
    const { exitCode, stdout } = await start("cli.ts", { credits: { availableCount: 2, credits: null } });
    expect(stdout).toBe("2 reset credit(s) available, but app-server could not load their details.");
    expect(exitCode).toBe(0);
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
    expect(stderr).toBe("codex-limit-auto-reset: Codex CLI is not authenticated with ChatGPT");
    expect(exitCode).toBe(1);
  });
});
