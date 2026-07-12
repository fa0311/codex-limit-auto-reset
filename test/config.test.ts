import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.ts";

describe("parseConfig", () => {
  it("applies defaults when nothing is set", () => {
    expect(parseConfig({})).toEqual({ CODEX_BIN: "codex", REDEEM_BEFORE_MINUTES: 360 });
  });

  it("parses values from the environment", () => {
    expect(parseConfig({ CODEX_BIN: "/usr/local/bin/codex", REDEEM_BEFORE_MINUTES: "1" })).toEqual({
      CODEX_BIN: "/usr/local/bin/codex",
      REDEEM_BEFORE_MINUTES: 1,
    });
  });

  it("rejects an invalid REDEEM_BEFORE_MINUTES", () => {
    expect(() => parseConfig({ REDEEM_BEFORE_MINUTES: "0" })).toThrow();
    expect(() => parseConfig({ REDEEM_BEFORE_MINUTES: "abc" })).toThrow();
  });
});
