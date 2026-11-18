import { setTimeout as sleep } from "node:timers/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexError } from "../src/errors.ts";
import { retry } from "../src/retry.ts";

vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => {}) }));

beforeEach(() => {
  vi.mocked(sleep).mockClear();
});

describe("retry", () => {
  it("returns the first success without waiting", async () => {
    await expect(retry(async () => "ok")).resolves.toBe("ok");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("backs off between attempts and gives up after the third", async () => {
    const fn = vi.fn(async () => {
      throw Error("boom");
    });
    const failure = await retry(fn).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(3);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(vi.mocked(sleep).mock.calls).toEqual([[2_000], [8_000]]);
  });

  it("recovers when a later attempt succeeds", async () => {
    const fn = vi.fn(async () => "ok");
    fn.mockRejectedValueOnce(new CodexError("request_timeout", "timed out", true));
    await expect(retry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not repeat an attempt that cannot succeed", async () => {
    const fn = vi.fn(async () => {
      throw new CodexError("not_authenticated", "logged out", false);
    });
    await expect(retry(fn)).rejects.toThrow("All attempts failed");
    expect(fn).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });
});
