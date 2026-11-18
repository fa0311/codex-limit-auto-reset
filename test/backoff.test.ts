import { describe, expect, it } from "vitest";
import { createBackoff } from "../src/backoff.ts";

describe("createBackoff", () => {
  it("doubles from the initial delay up to the maximum", () => {
    const backoff = createBackoff({ initialMs: 1_000, maxMs: 5_000 });
    expect([backoff.next(), backoff.next(), backoff.next(), backoff.next(), backoff.next()]).toEqual([
      1_000, 2_000, 4_000, 5_000, 5_000,
    ]);
  });

  it("starts over after a reset", () => {
    const backoff = createBackoff({ initialMs: 1_000, maxMs: 5_000 });
    backoff.next();
    backoff.next();
    backoff.reset();
    expect(backoff.next()).toBe(1_000);
  });

  it("keeps separate counts for separate instances", () => {
    const first = createBackoff({ initialMs: 1_000, maxMs: 5_000 });
    const second = createBackoff({ initialMs: 1_000, maxMs: 5_000 });
    first.next();
    first.next();
    expect(second.next()).toBe(1_000);
  });
});
