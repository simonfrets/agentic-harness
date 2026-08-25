import { HarnessError } from "../../../src/harness/harness-error.js";
import { loadHarnessRuleSet } from "../../../src/harness/load-harness-rule-set.js";
import { RuleResolutionError } from "../../../src/rules/rule-error.js";
import { buildHarnessProject } from "../../helpers/harness-project.js";
import { captureError } from "../../helpers/expect-error.js";
import { ruleBundleYaml } from "../../helpers/rule-yaml.js";
import { removeTempDirectories } from "../../helpers/temp-directory.js";

afterEach(() => {
  removeTempDirectories();
});

describe("loadHarnessRuleSet", () => {
  it("refuses a project with no harness rules directory", () => {
    const root = buildHarnessProject();

    expect(() => loadHarnessRuleSet({ projectRoot: root })).toThrow(
      /is not installed/
    );
  });

  it("refuses a harness rules directory that holds no bundles", () => {
    const root = buildHarnessProject({
      files: { ".harness/rules/.gitkeep": "" },
    });

    const error = captureError(
      () => loadHarnessRuleSet({ projectRoot: root }),
      HarnessError
    );

    expect(error.kind).toBe("invalid-config");
  });

  it("layers custom bundles over shipped bundles", () => {
    const root = buildHarnessProject({
      rules: {
        "base.yaml": ruleBundleYaml({
          bundleId: "harness-base",
          ruleId: "base.one",
          instruction: "Shipped instruction.",
        }),
      },
      customRules: {
        "team.yaml": ruleBundleYaml({
          bundleId: "team",
          ruleId: "base.one",
          instruction: "Team instruction.",
          overrides: true,
        }),
      },
    });

    const ruleSet = loadHarnessRuleSet({ projectRoot: root });

    expect(ruleSet.rules).toHaveLength(1);
    expect(ruleSet.rules[0]?.instruction).toBe("Team instruction.");
    expect(ruleSet.rules[0]?.origin).toBe("project");
    expect(ruleSet.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("propagates an unresolved duplicate rule id", () => {
    const root = buildHarnessProject({
      rules: {
        "base.yaml": ruleBundleYaml({
          bundleId: "harness-base",
          ruleId: "base.one",
        }),
      },
      customRules: {
        "team.yaml": ruleBundleYaml({ bundleId: "team", ruleId: "base.one" }),
      },
    });

    expect(() => loadHarnessRuleSet({ projectRoot: root })).toThrow(
      RuleResolutionError
    );
  });
});
