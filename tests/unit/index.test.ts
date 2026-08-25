import { HARNESS_DIRECTORY, harnessPackageMetadata } from "../../src/index.js";

describe("package metadata", () => {
  it("reserves .harness as the project-local installation directory", () => {
    expect(HARNESS_DIRECTORY).toBe(".harness");
    expect(harnessPackageMetadata).toEqual({
      directory: ".harness",
      name: "agentic-harness",
    });
  });
});
