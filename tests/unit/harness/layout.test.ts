import { join } from "node:path";

import {
  HARNESS_DIRECTORY,
  HARNESS_PATHS,
  harnessPath,
} from "../../../src/harness/layout.js";

describe("harness layout", () => {
  it("reserves .harness as the installation directory", () => {
    expect(HARNESS_DIRECTORY).toBe(".harness");
  });

  it("keeps every managed path relative to the harness directory", () => {
    for (const path of Object.values(HARNESS_PATHS)) {
      expect(path.startsWith("/")).toBe(false);
      expect(path.startsWith(".harness")).toBe(false);
    }
  });

  it("joins segments beneath the harness directory of a project", () => {
    expect(harnessPath("/tmp/project", HARNESS_PATHS.rules, "base.yaml")).toBe(
      join("/tmp/project", ".harness", "rules", "base.yaml")
    );
  });

  it("resolves the harness directory itself when given no segments", () => {
    expect(harnessPath("/tmp/project")).toBe(join("/tmp/project", ".harness"));
  });
});
