import { HarnessError } from "../../../src/harness/harness-error.js";
import {
  listHarnessTemplateFiles,
  readHarnessTemplateFile,
  harnessTemplateRoot,
} from "../../../src/install/harness-templates.js";
import { captureError } from "../../helpers/expect-error.js";
import {
  createTempDirectory,
  removeTempDirectories,
} from "../../helpers/temp-directory.js";

afterEach(() => {
  removeTempDirectories();
});

const packageRoot = process.cwd();

describe("listHarnessTemplateFiles", () => {
  it("lists exactly the shipped template files", () => {
    expect(
      listHarnessTemplateFiles(packageRoot).map((file) => file.installedPath)
    ).toEqual([
      ".gitignore",
      "rules/base.yaml",
      "rules/custom/README.md",
      "rules/git.yaml",
      "rules/typescript.yaml",
    ]);
  });

  it("renames the undotted gitignore template to its installed name", () => {
    const gitignore = listHarnessTemplateFiles(packageRoot).find(
      (file) => file.installedPath === ".gitignore"
    );

    // npm drops a file named `.gitignore` from the published tarball, so the
    // template has to ship undotted and be renamed on the way in.
    expect(gitignore?.templatePath).toBe("gitignore");
  });

  it("refuses a package that has no templates directory", () => {
    const empty = createTempDirectory("agentic-harness-no-templates-");
    const error = captureError(
      () => listHarnessTemplateFiles(empty),
      HarnessError
    );

    expect(error.kind).toBe("invalid-config");
    expect(error.message).toContain("templates");
  });
});

describe("readHarnessTemplateFile", () => {
  it("reads a template by its template path", () => {
    const contents = readHarnessTemplateFile(packageRoot, {
      templatePath: "rules/base.yaml",
      installedPath: "rules/base.yaml",
    });

    expect(contents).toContain("id: harness-base");
  });
});

describe("harnessTemplateRoot", () => {
  it("points at the harness template tree inside the package", () => {
    expect(harnessTemplateRoot("/pkg")).toMatch(/templates.\.harness$/);
  });
});
