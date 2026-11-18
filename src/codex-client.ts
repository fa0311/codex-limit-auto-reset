import { createInterface } from "node:readline";
import { execa } from "execa";
import { z } from "zod";
import { clientInfo } from "./client-info.ts";
import { accountSchema, consumeCreditSchema, rateLimitCreditsSchema, rpcMessageSchema } from "./codex-schemas.ts";
import type { CodexError } from "./errors.ts";
import {
  AppServerExitedError,
  InvalidResponseError,
  NotAuthenticatedError,
  RequestTimeoutError,
  RpcError,
} from "./errors.ts";

// Longer than the 10 seconds app-server itself allows the backend, so that its answer arrives first.
const REQUEST_TIMEOUT_MS = 30_000;

type PendingRequest = {
  readonly method: string;
  readonly reject: (reason: CodexError) => void;
  readonly resolve: (value: unknown) => void;
};

const parseResult = <T extends z.ZodType>(schema: T, method: string, result: unknown) => {
  const parsed = schema.safeParse(result);
  if (!parsed.success) {
    throw new InvalidResponseError(`Unexpected ${method} response\n${z.prettifyError(parsed.error)}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
};

/** Starts `codex app-server`, completes the handshake, and stops the process when disposed. */
export const createCodexClient = async (command: string) => {
  const subprocess = execa(command, ["app-server", "--stdio"], {
    buffer: false,
    reject: false,
    stderr: "inherit",
    stdin: "pipe",
    stdout: "pipe",
  });
  using cleanup = new DisposableStack();
  cleanup.defer(() => {
    subprocess.kill();
  });

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

  const read = async () => {
    for await (const line of createInterface({ input: subprocess.stdout })) {
      const message = rpcMessageSchema.parse(JSON.parse(line));
      // Notifications and server-initiated requests are not used.
      if (message.type === "request") {
        continue;
      }
      const request = pending.get(message.id);
      if (!request) {
        continue;
      }
      pending.delete(message.id);
      if (message.type === "response") {
        request.resolve(message.result);
      } else {
        request.reject(new RpcError(`${request.method} failed (${message.error.code}): ${message.error.message}`));
      }
    }
  };
  read().catch((cause: unknown) => {
    fail(new InvalidResponseError("Codex app-server sent a message that could not be parsed", { cause }));
  });
  // A write fails only once the process is gone, and its exit, reported below, says why.
  subprocess.stdin.on("error", () => {});
  void subprocess.then((result) => {
    fail(new AppServerExitedError(`Codex app-server exited: ${result.shortMessage ?? `exit code ${result.exitCode}`}`));
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
      deferred.reject(new RequestTimeoutError(`Codex app-server request timed out: ${method}`));
    }, REQUEST_TIMEOUT_MS);
    subprocess.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    try {
      return await deferred.promise;
    } finally {
      clearTimeout(timeout);
    }
  };

  await request("initialize", { clientInfo });
  subprocess.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);

  const closer = cleanup.move();
  return {
    /** Refreshes the login and fails unless it is a ChatGPT account, the only kind with reset credits. */
    refreshAccount: async () => {
      const method = "account/read";
      const { account } = parseResult(accountSchema, method, await request(method, { refreshToken: true }));
      if (account?.type !== "chatgpt") {
        throw new NotAuthenticatedError("Codex CLI is not authenticated with ChatGPT");
      }
    },
    readCredits: async () => {
      const method = "account/rateLimits/read";
      return parseResult(rateLimitCreditsSchema, method, await request(method));
    },
    /** `idempotencyKey` identifies one redemption attempt: a later attempt on the same credit needs a new one. */
    consumeCredit: async (creditId: string, idempotencyKey: string) => {
      const method = "account/rateLimitResetCredit/consume";
      return parseResult(consumeCreditSchema, method, await request(method, { creditId, idempotencyKey }));
    },
    [Symbol.dispose]: () => {
      closer.dispose();
    },
  };
};

export type CodexClient = Awaited<ReturnType<typeof createCodexClient>>;
