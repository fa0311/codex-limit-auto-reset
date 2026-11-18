import { execa } from "execa";
import split2 from "split2";
import type { z } from "zod";
import type { RpcMessage } from "./codex-schemas.ts";
import { accountSchema, consumeCreditSchema, rateLimitCreditsSchema, rpcMessageSchema } from "./codex-schemas.ts";
import { CodexError, describeIssues } from "./errors.ts";

// Longer than app-server's own 10 second backend timeout, so its answer arrives before this one fires.
const REQUEST_TIMEOUT_MS = 30_000;

// JSON-RPC codes for a request the server will never accept; sending it again cannot help.
const INVALID_REQUEST_CODES = new Set([-32700, -32600, -32601, -32602]);

type PendingRequest = {
  readonly method: string;
  readonly reject: (reason: CodexError) => void;
  readonly resolve: (value: unknown) => void;
};

type CodexClientOptions = {
  readonly command: string;
  readonly clientInfo: {
    readonly name: string;
    readonly title: string;
    readonly version: string;
  };
};

const parseResult = <T extends z.ZodType>(schema: T, method: string, result: unknown): z.output<T> => {
  const parsed = schema.safeParse(result);
  if (!parsed.success) {
    throw new CodexError("invalid_response", `Unexpected ${method} response: ${describeIssues(parsed.error)}`, false);
  }
  return parsed.data;
};

export const createCodexClient = ({ command, clientInfo }: CodexClientOptions) => {
  const subprocess = execa(command, ["app-server", "--stdio"], {
    buffer: false,
    cleanup: true,
    reject: false,
    stderr: "inherit",
    stdin: "pipe",
    stdout: "pipe",
  });
  const stdin = subprocess.writable();
  const messages = subprocess.readable().pipe(split2((line: string) => rpcMessageSchema.parse(JSON.parse(line))));

  let nextId = 1;
  let failure: CodexError | undefined;
  const pending = new Map<number, PendingRequest>();

  const fail = (error: CodexError) => {
    // The first failure is the cause; whatever follows is a consequence of it.
    failure ??= error;
    const reason = failure;
    const requests = [...pending.values()];
    pending.clear();
    for (const { reject } of requests) {
      reject(reason);
    }
  };

  messages.on("data", (message: RpcMessage) => {
    // Notifications and server-initiated requests are not used.
    if (message.type === "request") {
      return;
    }
    const request = pending.get(message.id);
    if (!request) {
      return;
    }
    pending.delete(message.id);
    if (message.type === "response") {
      request.resolve(message.result);
      return;
    }
    const { code, message: reason } = message.error;
    request.reject(
      new CodexError("rpc_error", `${request.method} failed (${code}): ${reason}`, !INVALID_REQUEST_CODES.has(code)),
    );
  });
  // The raw parse error quotes the offending line, so it is replaced rather than passed on.
  messages.on("error", () => {
    fail(new CodexError("invalid_response", "Codex app-server sent a message that could not be parsed", false));
  });
  // A write fails only once the process is gone; its exit, reported below, says why.
  stdin.on("error", () => {});
  void subprocess.then((result) => {
    const reason = result.shortMessage ?? `exit code ${result.exitCode}`;
    fail(new CodexError("app_server_exited", `Codex app-server exited: ${reason}`, false));
  });

  const request = async (method: string, params?: unknown) => {
    if (failure) {
      throw failure;
    }
    const id = nextId;
    nextId += 1;
    const deferred = Promise.withResolvers<unknown>();
    pending.set(id, { method, ...deferred });
    const timeout = setTimeout(() => {
      pending.delete(id);
      deferred.reject(new CodexError("request_timeout", `Codex app-server request timed out: ${method}`, true));
    }, REQUEST_TIMEOUT_MS);
    stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    try {
      return await deferred.promise;
    } finally {
      clearTimeout(timeout);
    }
  };

  const initialize = async () => {
    await request("initialize", { clientInfo });
    stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
  };

  const refreshAccount = async () => {
    const method = "account/read";
    const account = parseResult(accountSchema, method, await request(method, { refreshToken: true }));
    if (account.account?.type !== "chatgpt") {
      throw new CodexError("not_authenticated", "Codex CLI is not authenticated with ChatGPT", false);
    }
  };

  const readCredits = async () => {
    const method = "account/rateLimits/read";
    return parseResult(rateLimitCreditsSchema, method, await request(method));
  };

  /** `idempotencyKey` identifies one redemption attempt: reuse it to retry that attempt, never for a later one. */
  const consumeCredit = async (creditId: string, idempotencyKey: string) => {
    const method = "account/rateLimitResetCredit/consume";
    return parseResult(consumeCreditSchema, method, await request(method, { creditId, idempotencyKey }));
  };

  return {
    close: () => {
      subprocess.kill();
    },
    consumeCredit,
    initialize,
    readCredits,
    refreshAccount,
  };
};

export type CodexClient = ReturnType<typeof createCodexClient>;
