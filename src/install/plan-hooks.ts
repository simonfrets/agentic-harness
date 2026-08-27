import type { HooksConfig } from "../config/hooks-config.js";
import { HarnessError } from "../harness/harness-error.js";
import { compareCodeUnits } from "../rules/hash-rule-set.js";
import type { HookEnvironment, PriorHook } from "./discover-hooks.js";
import type { HookRecord } from "./install-manifest.js";
import type { HookDispatcher } from "./hook-scripts.js";

export interface PlanHooksInput {
  readonly hooks: HooksConfig;
  readonly environment: HookEnvironment;
  /**
   * Hooks a previous install recorded. Once git dispatches through the
   * harness, this is the only remaining record of what was there before, so a
   * re-install reads it rather than looking at its own dispatchers and
   * concluding the project never had a hook.
   */
  readonly recorded: readonly HookRecord[];
}

const chainedByHook = (
  environment: HookEnvironment,
  recorded: readonly HookRecord[]
): ReadonlyMap<string, string | null> =>
  new Map(
    environment.dispatchedByHarness
      ? recorded.map((entry) => [entry.hook, entry.chained])
      : environment.priorHooks.map((prior: PriorHook) => [
          prior.hook,
          prior.path,
        ])
  );

/**
 * Decides which dispatchers to install and what each of them preserves.
 *
 * Pointing `core.hooksPath` at the harness makes every hook in the previous
 * directory stop running, not just the ones the harness manages. A hook the
 * harness has no gate for therefore gets a dispatcher that does nothing but
 * run the original: `commit-msg` disappearing because a tool was installed is
 * the same silent discard the `abort` policy exists to prevent, and it is the
 * easier one to miss.
 */
export const planHooks = (input: PlanHooksInput): readonly HookDispatcher[] => {
  const chained = chainedByHook(input.environment, input.recorded);
  const managed = input.hooks.hooks.filter((entry) => entry.enabled);

  if (
    input.hooks.onExistingHook === "abort" &&
    input.environment.priorHooks.length > 0
  ) {
    throw new HarnessError(
      "unsafe-hook-chain",
      `this project already has git hooks and \`onExistingHook\` is \`abort\`, so nothing was changed`,
      input.environment.priorHooks.map(
        (prior) => `${prior.path} would have to be chained`
      )
    );
  }

  const dispatchers: HookDispatcher[] = managed.map((entry) => ({
    kind: "gate",
    hook: entry.hook,
    phase: entry.phase,
    chained: chained.get(entry.hook) ?? null,
  }));

  const gated = new Set<string>(managed.map((entry) => entry.hook));

  for (const [hook, path] of chained) {
    if (!gated.has(hook) && path !== null) {
      dispatchers.push({ kind: "passthrough", hook, chained: path });
    }
  }

  return dispatchers.sort((a, b) => compareCodeUnits(a.hook, b.hook));
};
