type BackoffOptions = {
  readonly initialMs: number;
  readonly maxMs: number;
};

/** Delays that double from `initialMs` up to `maxMs`, starting over after `reset()`. */
export const createBackoff = ({ initialMs, maxMs }: BackoffOptions) => {
  let failures = 0;
  return {
    next: () => {
      const delayMs = Math.min(initialMs * 2 ** failures, maxMs);
      failures += 1;
      return delayMs;
    },
    reset: () => {
      failures = 0;
    },
  };
};
