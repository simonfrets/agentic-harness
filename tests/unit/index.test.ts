import * as harness from "../../src/index.js";
import { HARNESS_DIRECTORY, harnessPackageMetadata } from "../../src/index.js";

/**
 * The published surface of the package. Listing it explicitly turns an
 * accidental removal or rename into a failing test rather than a silent
 * breaking change for consumers.
 */
const PUBLIC_API = [
  "BUILT_IN_AGENT_IDS",
  "CLI_COMMANDS",
  "CLI_EXIT_CODES",
  "DEFAULT_CHECK_TIMEOUT_MS",
  "DEFAULT_COMMAND_TIMEOUT_MS",
  "DEFAULT_KILL_GRACE_MS",
  "DEFAULT_KILL_SIGNAL",
  "DEFAULT_MAX_OUTPUT_BYTES",
  "EMPTY_COMMAND_OUTPUT",
  "ENVIRONMENT_ALLOWLIST",
  "HARNESS_DIRECTORY",
  "HARNESS_ERROR_KINDS",
  "HARNESS_PATHS",
  "HOOK_NAMES",
  "HOOK_RUNNERS",
  "HarnessError",
  "LOCKFILE_PACKAGE_MANAGERS",
  "MAX_CHECK_TIMEOUT_MS",
  "MIN_CHECK_TIMEOUT_MS",
  "MISSING_SCRIPT_BEHAVIOURS",
  "NODE_COMMAND_RUNNER_DEFAULTS",
  "PACKAGE_MANAGERS",
  "PHASES",
  "PROJECT_SCRIPT_NAMES",
  "PackageManagerAmbiguityError",
  "RULE_ORIGIN_PRECEDENCE",
  "RULE_SET_HASH_VERSION",
  "RuleResolutionError",
  "RuleValidationError",
  "SEVERITIES",
  "VALIDATION_MODES",
  "agentIdSchema",
  "buildChildEnvironment",
  "buildPackageManagerCommand",
  "canonicalRule",
  "canonicalRuleSet",
  "canonicalStringify",
  "checkSchema",
  "commandSucceeded",
  "compareCodeUnits",
  "compileAgentPolicy",
  "createDefaultCliCommands",
  "createDefaultReportId",
  "createDeterministicReportId",
  "createNodeCommandRunner",
  "describeCommand",
  "describeCommandResult",
  "detectLockfilePackageManagers",
  "discoverProjectProfile",
  "exitCodeForHarnessError",
  "formatPhaseGateReport",
  "formatRuleIssue",
  "formatRuleIssues",
  "formatRuleSetExplanation",
  "formatRuleSetSummary",
  "harnessPackageMetadata",
  "harnessPath",
  "hashRuleSet",
  "isBuiltInAgentId",
  "loadHarnessRuleSet",
  "loadRuleBundle",
  "loadRuleDirectory",
  "mapBuiltInAgents",
  "nodeCommandRunner",
  "normalizeText",
  "packageManagerSchema",
  "parseCliArguments",
  "parseDeclaredPackageManager",
  "portableProjectProfileSchema",
  "projectProfileSchema",
  "readPackageVersion",
  "resolvePackageManager",
  "resolveProjectRoot",
  "resolveProjectScript",
  "resolveRuleSet",
  "ruleBundleSchema",
  "ruleSchema",
  "runCli",
  "runPhaseGates",
  "toPortableProjectProfile",
  "toSpawnFailure",
] as const;

describe("package metadata", () => {
  it("reserves .harness as the project-local installation directory", () => {
    expect(HARNESS_DIRECTORY).toBe(".harness");
    expect(harnessPackageMetadata).toEqual({
      directory: ".harness",
      name: "agentic-harness",
    });
  });
});

describe("public API surface", () => {
  it("exports exactly the documented bindings", () => {
    expect(Object.keys(harness).sort()).toEqual([...PUBLIC_API]);
  });

  it("resolves every exported binding to a defined value", () => {
    const surface: Record<string, unknown> = harness;

    for (const name of PUBLIC_API) {
      expect(surface[name]).toBeDefined();
    }
  });
});
