import type { ConsumeCredit } from "./codex-schemas.ts";

type CreditAttempt = { credit_id: string; attempt: number };
export type LogEvent =
  | ({ event: "credit_redemption_attempt" } & CreditAttempt)
  | ({ event: "credit_redemption_result"; outcome: ConsumeCredit["outcome"] } & CreditAttempt)
  | ({ event: "credit_redemption_error"; error_type: "operation_failed" } & CreditAttempt)
  | { event: "check_failed"; operation: "initialize" | "check"; error_type: "operation_failed" }
  | { event: "next_check"; delay_ms: number };

export type Logger = (event: LogEvent) => void;

export const createLogger =
  (write: (line: string) => void = console.log, now: () => Date = () => new Date()): Logger =>
  (event) => {
    write(
      JSON.stringify({
        timestamp: now().toISOString(),
        level: event.event === "credit_redemption_error" || event.event === "check_failed" ? "error" : "info",
        ...event,
      }),
    );
  };
