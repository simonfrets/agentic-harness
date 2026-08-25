import { explainRules } from "./commands/explain-rules.js";
import { runGate } from "./commands/run-gate.js";
import { validateRules } from "./commands/validate-rules.js";
import type { CliCommandRegistry } from "./run-cli.js";

/**
 * The commands this build provides.
 *
 * `init` and `doctor` are absent until the installer exists; an absent command
 * reports itself as unavailable rather than being registered as a stub that
 * would look like it worked.
 */
export const createDefaultCliCommands = (): CliCommandRegistry => ({
  gate: runGate,
  "rules explain": explainRules,
  "rules validate": validateRules,
});
