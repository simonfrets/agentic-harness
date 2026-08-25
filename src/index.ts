export const HARNESS_DIRECTORY = ".harness" as const;

export interface HarnessPackageMetadata {
  readonly directory: typeof HARNESS_DIRECTORY;
  readonly name: "agentic-harness";
}

export const harnessPackageMetadata = {
  directory: HARNESS_DIRECTORY,
  name: "agentic-harness",
} as const satisfies HarnessPackageMetadata;

export {
  BUILT_IN_AGENT_IDS,
  agentIdSchema,
  isBuiltInAgentId,
  mapBuiltInAgents,
} from "./agents/agent-id.js";
export type { AgentId, BuiltInAgentId } from "./agents/agent-id.js";

export { loadRuleBundle } from "./rules/load-rule-bundle.js";
export type { LoadRuleBundleOptions } from "./rules/load-rule-bundle.js";
export {
  RuleResolutionError,
  RuleValidationError,
  formatRuleIssue,
  formatRuleIssues,
} from "./rules/rule-error.js";
export {
  RULE_SET_HASH_VERSION,
  canonicalRule,
  canonicalRuleSet,
  canonicalStringify,
  compareCodeUnits,
  hashRuleSet,
  normalizeText,
} from "./rules/hash-rule-set.js";
export type { CanonicalObject, CanonicalValue } from "./rules/hash-rule-set.js";
export {
  RULE_ORIGIN_PRECEDENCE,
  resolveRuleSet,
} from "./rules/resolve-rule-set.js";
export type {
  ResolvedRule,
  ResolvedRuleSet,
  RuleOrigin,
  RuleSource,
} from "./rules/resolve-rule-set.js";
export type { RuleIssue, RuleSourceLocation } from "./rules/rule-error.js";
export {
  DEFAULT_CHECK_TIMEOUT_MS,
  MAX_CHECK_TIMEOUT_MS,
  MIN_CHECK_TIMEOUT_MS,
  MISSING_SCRIPT_BEHAVIOURS,
  PHASES,
  PROJECT_SCRIPT_NAMES,
  SEVERITIES,
  checkSchema,
  ruleBundleSchema,
  ruleSchema,
} from "./rules/rule-schema.js";
export type {
  CommandCheck,
  MissingScriptBehaviour,
  Phase,
  ProjectScriptCheck,
  ProjectScriptName,
  Rule,
  RuleBundle,
  RuleCheck,
  Severity,
} from "./rules/rule-schema.js";

export {
  HOOK_NAMES,
  HOOK_RUNNERS,
  PACKAGE_MANAGERS,
  VALIDATION_MODES,
  packageManagerSchema,
  portableProjectProfileSchema,
  projectProfileSchema,
  toPortableProjectProfile,
} from "./project/project-profile-schema.js";
export { discoverProjectProfile } from "./project/discover-project-profile.js";
export type { DiscoverProjectProfileOptions } from "./project/discover-project-profile.js";
export {
  LOCKFILE_PACKAGE_MANAGERS,
  PackageManagerAmbiguityError,
  detectLockfilePackageManagers,
  parseDeclaredPackageManager,
  resolvePackageManager,
} from "./project/package-manager.js";
export type {
  HookEntrypoint,
  PackageManager,
  PortableProjectProfile,
  ProjectProfile,
  ValidationMode,
} from "./project/project-profile-schema.js";

export {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_KILL_SIGNAL,
  DEFAULT_MAX_OUTPUT_BYTES,
  EMPTY_COMMAND_OUTPUT,
  commandSucceeded,
  describeCommand,
  describeCommandResult,
  toSpawnFailure,
} from "./processes/command-runner.js";
export {
  ENVIRONMENT_ALLOWLIST,
  NODE_COMMAND_RUNNER_DEFAULTS,
  buildChildEnvironment,
  createNodeCommandRunner,
  nodeCommandRunner,
} from "./processes/node-command-runner.js";
export type { NodeCommandRunnerOptions } from "./processes/node-command-runner.js";
export type {
  CommandOutput,
  CommandRequest,
  CommandResult,
  CommandRunner,
  CommandSpec,
  ExitedCommandResult,
  SignaledCommandResult,
  SpawnFailedCommandResult,
  TimedOutCommandResult,
} from "./processes/command-runner.js";
