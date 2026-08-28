/**
 * Module hooks that let a spawned Node process import this package's
 * TypeScript sources.
 *
 * Node strips types from a `.ts` file on its own, but it resolves specifiers
 * literally, and every source here imports its neighbours as `./thing.js`
 * because `tsconfig.json` uses NodeNext. Nothing in `src/` is emitted as
 * JavaScript before the suite runs, so those specifiers resolve to files that
 * do not exist yet.
 *
 * The alternative was compiling the package into a temporary directory before
 * every test that needs a second process, which is a build step inside a test
 * and a second copy of the toolchain's configuration. This maps the one
 * specifier shape that fails instead, and only after the real resolver has
 * already refused it, so a genuinely missing module still fails as itself.
 */

const JAVASCRIPT_EXTENSION = ".js";
const TYPESCRIPT_EXTENSION = ".ts";

export const resolve = async (specifier, context, nextResolve) => {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      !specifier.startsWith(".") ||
      !specifier.endsWith(JAVASCRIPT_EXTENSION)
    ) {
      throw error;
    }

    return nextResolve(
      `${specifier.slice(0, -JAVASCRIPT_EXTENSION.length)}${TYPESCRIPT_EXTENSION}`,
      context
    );
  }
};
