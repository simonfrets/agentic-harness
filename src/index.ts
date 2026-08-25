export const HARNESS_DIRECTORY = ".harness" as const;

export interface HarnessPackageMetadata {
  readonly directory: typeof HARNESS_DIRECTORY;
  readonly name: "agentic-harness";
}

export const harnessPackageMetadata = {
  directory: HARNESS_DIRECTORY,
  name: "agentic-harness",
} as const satisfies HarnessPackageMetadata;
