import type { CliStreams } from "../../src/cli/run-cli.js";

export interface RecordedStreams {
  readonly streams: CliStreams;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

/** Collects what the CLI writes, so no test has to touch a real stream. */
export const createRecordedStreams = (): RecordedStreams => {
  const out: string[] = [];
  const err: string[] = [];

  return {
    streams: {
      stdout: {
        write: (text: string): void => {
          out.push(text);
        },
      },
      stderr: {
        write: (text: string): void => {
          err.push(text);
        },
      },
    },
    stdout: (): string => out.join(""),
    stderr: (): string => err.join(""),
  };
};
