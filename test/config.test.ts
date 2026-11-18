import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.ts";

describe("parseConfig", () => {
  it("applies defaults when nothing is set", () => {
    expect(parseConfig({})).toEqual({ CODEX_BIN: "codex", REDEEM_BEFORE_MINUTES: 360, USAGE_POLL_SECONDS: 60 });
  });

  it("parses values from the environment", () => {
    expect(parseConfig({ CODEX_BIN: "/usr/local/bin/codex", REDEEM_BEFORE_MINUTES: "1" })).toEqual({
      CODEX_BIN: "/usr/local/bin/codex",
      REDEEM_BEFORE_MINUTES: 1,
      USAGE_POLL_SECONDS: 60,
    });
  });

  it("rejects an invalid REDEEM_BEFORE_MINUTES", () => {
    expect(() => parseConfig({ REDEEM_BEFORE_MINUTES: "0" })).toThrow();
    expect(() => parseConfig({ REDEEM_BEFORE_MINUTES: "abc" })).toThrow();
  });
});

it("accepts opt-in usage monitoring including exhaustion-only zero", () => {
  expect(parseConfig({ RESET_REMAINING_PERCENT: "0", USAGE_POLL_SECONDS: "30" })).toMatchObject({
    RESET_REMAINING_PERCENT: 0,
    USAGE_POLL_SECONDS: 30,
  });
  for (const value of ["-1", "21", "NaN", "Infinity"])
    expect(() => parseConfig({ RESET_REMAINING_PERCENT: value })).toThrow();
  for (const value of ["0", "9", "3601", "1.5"]) expect(() => parseConfig({ USAGE_POLL_SECONDS: value })).toThrow();
});
