/**
 * A failure this tool recognises. Its message is composed here or written by app-server for
 * display, never copied from a payload, so it can be recorded as is.
 */
export class CodexError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class AppServerExitedError extends CodexError {}
export class InvalidConfigError extends CodexError {}
export class InvalidResponseError extends CodexError {}
export class NotAuthenticatedError extends CodexError {}
export class RequestTimeoutError extends CodexError {}
export class RpcError extends CodexError {}
