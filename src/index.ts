import { HARNESS_DIRECTORY } from "./harness/layout.js";

export interface HarnessPackageMetadata {
  readonly directory: typeof HARNESS_DIRECTORY;
  readonly name: "agentic-harness";
}

export const harnessPackageMetadata = {
  directory: HARNESS_DIRECTORY,
  name: "agentic-harness",
} as const satisfies HarnessPackageMetadata;

export {
  HARNESS_DIRECTORY,
  HARNESS_PATHS,
  harnessPath,
} from "./harness/layout.js";
export { HARNESS_ERROR_KINDS, HarnessError } from "./harness/harness-error.js";
export type { HarnessErrorKind } from "./harness/harness-error.js";
export { readPackageVersion } from "./harness/package-version.js";
export { resolveProjectRoot } from "./harness/resolve-project-root.js";
export type { ResolveProjectRootOptions } from "./harness/resolve-project-root.js";
export { loadHarnessRuleSet } from "./harness/load-harness-rule-set.js";
export type { LoadHarnessRuleSetOptions } from "./harness/load-harness-rule-set.js";

export {
  BUILT_IN_AGENT_IDS,
  agentIdSchema,
  isBuiltInAgentId,
  mapBuiltInAgents,
} from "./agents/agent-id.js";
export type { AgentId, BuiltInAgentId } from "./agents/agent-id.js";
export {
  MODEL_PROFILES,
  agentDefinitionSchema,
  agentToolsSchema,
  loadAgentDefinition,
  modelProfileSchema,
} from "./agents/agent-definition.js";
export type {
  AgentDefinition,
  AgentTools,
  ModelProfile,
} from "./agents/agent-definition.js";

export { loadYamlConfig } from "./config/load-yaml-config.js";
export type { LoadYamlConfigOptions } from "./config/load-yaml-config.js";
export {
  loadProjectConfig,
  projectConfigSchema,
} from "./config/project-config.js";
export type { ProjectConfig } from "./config/project-config.js";
export {
  EXISTING_HOOK_POLICIES,
  existingHookPolicySchema,
  hooksConfigSchema,
  loadHooksConfig,
  managedHookSchema,
} from "./config/hooks-config.js";
export type {
  ExistingHookPolicy,
  HooksConfig,
  ManagedHook,
} from "./config/hooks-config.js";

export { loadRuleBundle } from "./rules/load-rule-bundle.js";
export { loadRuleDirectory } from "./rules/load-rule-directory.js";
export type { LoadRuleDirectoryOptions } from "./rules/load-rule-directory.js";
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

export { compileAgentPolicy } from "./prompts/compile-agent-policy.js";
export type { CompileAgentPolicyInput } from "./prompts/compile-agent-policy.js";

export {
  buildPackageManagerCommand,
  resolveProjectScript,
} from "./gates/resolve-project-script.js";
export type {
  ProjectScriptResolution,
  ResolveProjectScriptInput,
} from "./gates/resolve-project-script.js";
export {
  createDefaultReportId,
  createDeterministicReportId,
  runPhaseGates,
} from "./gates/run-phase-gates.js";
export type {
  GateResult,
  GateStatus,
  PhaseGateReport,
  PhaseGateStatus,
  RunPhaseGatesOptions,
} from "./gates/run-phase-gates.js";

export {
  harnessTemplateRoot,
  listHarnessTemplateFiles,
  readHarnessTemplateFile,
} from "./install/harness-templates.js";
export type { HarnessTemplateFile } from "./install/harness-templates.js";

export { CLI_COMMANDS, parseCliArguments } from "./cli/parse-cli-arguments.js";
export type {
  CliCommand,
  CliInvocation,
  CliParseResult,
} from "./cli/parse-cli-arguments.js";
export { CLI_EXIT_CODES, exitCodeForHarnessError } from "./cli/exit-codes.js";
export { runCli } from "./cli/run-cli.js";
export type {
  CliCommandHandler,
  CliCommandRegistry,
  CliContext,
  CliStream,
  CliStreams,
  RunCliOptions,
} from "./cli/run-cli.js";
export { createDefaultCliCommands } from "./cli/default-commands.js";
export { formatPhaseGateReport } from "./cli/format-gate-report.js";
export {
  formatRuleSetExplanation,
  formatRuleSetSummary,
} from "./cli/format-rule-set.js";
