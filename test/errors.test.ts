import { describe, expect, it } from "vitest";
import { CodexError, describeError } from "../src/errors.ts";

describe("describeError", () => {
  it("reports the type and message of this tool's own errors", () => {
    expect(describeError(new CodexError("request_timeout", "timed out: account/read", true))).toEqual({
      error_type: "request_timeout",
      detail: "timed out: account/read",
    });
  });

  it("reports why retry() gave up: the last attempt", () => {
    const attempts = [Error("first"), new CodexError("rpc_error", "account/read failed (-32603): boom", true)];
    expect(describeError(new AggregateError(attempts, "All attempts failed"))).toEqual({
      error_type: "rpc_error",
      detail: "account/read failed (-32603): boom",
    });
  });

  it("never reports the message of an error it did not raise", () => {
    expect(describeError(Error("token=secret"))).toEqual({ error_type: "operation_failed" });
    expect(describeError({ message: "token=secret" })).toEqual({ error_type: "operation_failed" });
    expect(describeError(new AggregateError([Error("token=secret")]))).toEqual({ error_type: "operation_failed" });
  });

  it("keeps the detail to one bounded line", () => {
    const { detail } = describeError(new CodexError("rpc_error", `first\nsecond ${"x".repeat(500)}`, true));
    expect(detail).toMatch(/^first second x+…$/);
    expect(detail).toHaveLength(301);
  });
});
