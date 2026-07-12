export const retry = async <T>(fn: () => Promise<T>): Promise<T> => {
  const errors: unknown[] = [];
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (err) {
      errors.push(err);
    }
  }
  throw new AggregateError(errors, "All attempts failed");
};
