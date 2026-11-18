import type { ConsumeCredit } from "./codex-schemas.ts";
import type { ErrorType } from "./errors.ts";

type CreditAttempt = { credit_id: string; attempt: number };
type Failure = { error_type: ErrorType; detail?: string };
export type LogEvent =
  | ({ event: "credit_redemption_attempt" } & CreditAttempt)
  | ({ event: "credit_redemption_result"; outcome: ConsumeCredit["outcome"] } & CreditAttempt)
  | ({ event: "credit_redemption_error" } & CreditAttempt & Failure)
  | ({ event: "check_failed"; operation: "initialize" | "check" } & Failure)
  | { event: "credit_details_unavailable"; available_count: number }
  | { event: "next_check"; delay_ms: number };

export type Logger = (event: LogEvent) => void;

const LEVELS: Partial<Record<LogEvent["event"], "warn" | "error">> = {
  check_failed: "error",
  credit_details_unavailable: "warn",
  credit_redemption_error: "error",
};

export const createLogger =
  (write: (line: string) => void = console.log, now: () => Date = () => new Date()): Logger =>
  (event) => {
    write(
      JSON.stringify({
        timestamp: now().toISOString(),
        level: LEVELS[event.event] ?? "info",
        ...event,
      }),
    );
  };
