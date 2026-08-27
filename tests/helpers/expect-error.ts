type ErrorConstructor<E extends Error> = abstract new (...args: never[]) => E;

/**
 * Runs something that must fail and returns the error it threw.
 *
 * Assertions on the captured error then sit in the test body rather than
 * inside a `catch`, which `jest/no-conditional-expect` forbids because an
 * expectation that never runs would look like a passing test.
 */
export const captureError = <E extends Error>(
  run: () => unknown,
  kind: ErrorConstructor<E>
): E => {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof kind) {
      return error;
    }

    throw error;
  }

  throw new Error(`expected a ${kind.name} to be thrown`);
};

export const captureRejection = async <E extends Error>(
  run: () => Promise<unknown>,
  kind: ErrorConstructor<E>
): Promise<E> => {
  try {
    await run();
  } catch (error: unknown) {
    if (error instanceof kind) {
      return error;
    }

    throw error;
  }

  throw new Error(`expected a rejection with a ${kind.name}`);
};
