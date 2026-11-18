import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.ts";
import { InvalidConfigError } from "../src/errors.ts";

describe("parseConfig", () => {
  it("applies defaults when nothing is set", () => {
    expect(parseConfig({})).toEqual({
      codexBin: "codex",
      redeemBeforeMs: 360 * 60_000,
      locale: "en",
      timeZone: "UTC",
    });
  });

  it("reads the settings from the environment", () => {
    const environment = {
      CODEX_BIN: "/usr/local/bin/codex",
      REDEEM_BEFORE_MINUTES: "1",
      LOCALE: "ja-JP",
      TIMEZONE: "Asia/Tokyo",
    };
    expect(parseConfig(environment)).toEqual({
      codexBin: "/usr/local/bin/codex",
      redeemBeforeMs: 60_000,
      locale: "ja-JP",
      timeZone: "Asia/Tokyo",
    });
  });

  it.each(["0", "1.5", "abc", ""])("rejects REDEEM_BEFORE_MINUTES=%s, naming the setting", (value) => {
    const parse = () => parseConfig({ REDEEM_BEFORE_MINUTES: value });
    expect(parse).toThrow(InvalidConfigError);
    expect(parse).toThrow("REDEEM_BEFORE_MINUTES");
  });
});
