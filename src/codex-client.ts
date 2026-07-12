import { execa } from "execa";
import split2 from "split2";
import type { RpcMessage } from "./codex-schemas.ts";
import { accountSchema, consumeCreditSchema, rateLimitCreditsSchema, rpcMessageSchema } from "./codex-schemas.ts";

const REQUEST_TIMEOUT_MS = 10_000;

type PendingRequest = {
  readonly reject: (reason?: unknown) => void;
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
  let exitError: Error | undefined;
  const pending = new Map<number, PendingRequest>();

  const rejectAll = (error: unknown) => {
    exitError = error instanceof Error ? error : Error(String(error));
    const requests = [...pending.values()];
    pending.clear();
    requests.forEach(({ reject }) => {
      reject(exitError);
    });
  };

  messages.on("data", (message: RpcMessage) => {
    if (message.type === "response") {
      const request = pending.get(message.id);
      if (!request) {
        return;
      }
      pending.delete(message.id);
      request.resolve(message.result);
    }
  });
  messages.on("error", rejectAll);
  void subprocess.then((result) => {
    rejectAll(Error(`Codex app-server exited: ${result.shortMessage}`));
  });

  const request = async (method: string, params?: unknown) => {
    if (exitError) {
      throw exitError;
    }
    const id = nextId;
    nextId += 1;
    const deferred = Promise.withResolvers<unknown>();
    pending.set(id, deferred);
    const timeout = setTimeout(() => {
      pending.delete(id);
      deferred.reject(Error(`Codex app-server request timed out: ${method}`));
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
    const response = await request("account/read", { refreshToken: true });
    const account = accountSchema.parse(response);
    if (account.account?.type !== "chatgpt") {
      throw Error("Codex CLI is not authenticated with ChatGPT");
    }
  };

  const readCredits = async () => {
    const response = await request("account/rateLimits/read");
    return rateLimitCreditsSchema.parse(response);
  };

  const consumeCredit = async (creditId: string, idempotencyKey: string) => {
    const response = await request("account/rateLimitResetCredit/consume", { creditId, idempotencyKey });
    return consumeCreditSchema.parse(response);
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
