import type { z } from "zod";

export type ErrorType =
  | "app_server_exited"
  | "invalid_config"
  | "invalid_response"
  | "not_authenticated"
  | "request_timeout"
  | "rpc_error"
  // Anything this tool did not raise itself. Its message is never logged.
  | "operation_failed";

const DETAIL_MAX_LENGTH = 300;

/** A failure raised by this tool. The message is safe to log: it never carries a raw payload. */
export class CodexError extends Error {
  override readonly name = "CodexError";
  readonly type: Exclude<ErrorType, "operation_failed">;
  readonly retryable: boolean;

  constructor(type: Exclude<ErrorType, "operation_failed">, message: string, retryable: boolean) {
    super(message);
    this.type = type;
    this.retryable = retryable;
  }
}

/** Zod issues as `path: message`. Zod messages name the expected and received types, not the values. */
export const describeIssues = (error: z.ZodError) =>
  error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");

export const describeError = (error: unknown): { error_type: ErrorType; detail?: string } => {
  // retry() reports every attempt; the last one is why it gave up.
  const cause = error instanceof AggregateError ? error.errors.at(-1) : error;
  if (cause instanceof CodexError) {
    const detail = cause.message.replace(/\s+/g, " ").trim();
    return {
      error_type: cause.type,
      detail: detail.length > DETAIL_MAX_LENGTH ? `${detail.slice(0, DETAIL_MAX_LENGTH)}…` : detail,
    };
  }
  return { error_type: "operation_failed" };
};
