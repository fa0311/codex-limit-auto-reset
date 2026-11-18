import { afterEach, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  initialize: vi.fn(),
  refreshAccount: vi.fn(),
  readCredits: vi.fn(),
  consumeCredit: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../src/codex-client.ts", () => ({ createCodexClient: () => client }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
  process.exitCode = 0;
});

it.each([
  "initialize",
  "check",
] as const)("records a safe terminal %s failure and closes the client", async (operation) => {
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
});
