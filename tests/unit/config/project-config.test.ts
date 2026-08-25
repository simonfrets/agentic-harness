import { loadProjectConfig } from "../../../src/config/project-config.js";
import { HarnessError } from "../../../src/harness/harness-error.js";
import { captureError } from "../../helpers/expect-error.js";

const load = (text: string) =>
  loadProjectConfig(text, { source: "config/project.yaml" });

describe("loadProjectConfig", () => {
  it("defaults to running the project's own scripts alongside the harness", () => {
    expect(load("version: 1\n")).toEqual({
      version: 1,
      validationMode: "native-plus-harness",
      packageManager: null,
    });
  });

  it("lets a project drop one side of validation without editing a rule", () => {
    expect(
      load("version: 1\nvalidationMode: harness-only\n").validationMode
    ).toBe("harness-only");
  });

  it("pins a package manager to resolve an ambiguous repository", () => {
    expect(load("version: 1\npackageManager: pnpm\n").packageManager).toBe(
      "pnpm"
    );
  });

  it("rejects an unknown validation mode", () => {
    const error = captureError(
      () => load("version: 1\nvalidationMode: whatever\n"),
      HarnessError
    );

    expect(error.kind).toBe("invalid-config");
    expect(error.details.join("\n")).toContain("validationMode");
  });

  it("rejects a package manager the harness cannot drive", () => {
    const error = captureError(
      () => load("version: 1\npackageManager: make\n"),
      HarnessError
    );

    expect(error.details.join("\n")).toContain("packageManager");
  });

  it("rejects a config from a future schema version", () => {
    const error = captureError(() => load("version: 2\n"), HarnessError);

    expect(error.kind).toBe("invalid-config");
  });
});
