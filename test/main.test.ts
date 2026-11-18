import { afterEach, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  initialize: vi.fn(),
  refreshAccount: vi.fn(),
  readCredits: vi.fn(),
  consumeCredit: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../src/codex-client.ts", () => ({ createCodexClient: () => client }));
// retry() pauses between attempts; the tests do not wait for it.
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => {}) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
  process.exitCode = 0;
});

it.each(["initialize", "check"] as const)(
  "records a safe terminal %s failure and closes the client",
  async (operation) => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    client.initialize.mockResolvedValue(undefined);
    client.refreshAccount.mockRejectedValue(new Error("secret-refresh-token"));
    if (operation === "initialize") client.initialize.mockRejectedValue(new Error("secret-access-token"));
    await import("../src/main.ts");
    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output.mock.calls[0]?.[0])).toMatchObject({
      event: "check_failed",
      operation,
      level: "error",
      error_type: "operation_failed",
    });
    expect(JSON.stringify(output.mock.calls)).not.toContain("secret-");
    expect(client.close).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  },
);

it("says why the worker stopped when the cause is known", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  // Imported here, not at the top: main.ts must see the same class after the module reset.
  const { CodexError } = await import("../src/errors.ts");
  client.initialize.mockResolvedValue(undefined);
  client.refreshAccount.mockRejectedValue(new CodexError("not_authenticated", "Codex CLI is not authenticated", false));
  await import("../src/main.ts");
  expect(JSON.parse(output.mock.calls[0]?.[0])).toMatchObject({
    event: "check_failed",
    operation: "check",
    error_type: "not_authenticated",
    detail: "Codex CLI is not authenticated",
  });
  expect(client.refreshAccount).toHaveBeenCalledOnce();
  expect(process.exitCode).toBe(1);
});

it("names the invalid setting without starting app-server", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("REDEEM_BEFORE_MINUTES", "soon");
  await import("../src/main.ts");
  expect(JSON.parse(output.mock.calls[0]?.[0])).toMatchObject({
    event: "check_failed",
    operation: "initialize",
    error_type: "invalid_config",
    detail: expect.stringContaining("REDEEM_BEFORE_MINUTES"),
  });
  expect(client.initialize).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});
