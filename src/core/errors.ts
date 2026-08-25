/**
 * Every failure the harness raises carries a stable code. The CLI maps codes to
 * process exit codes, and the shell layer branches on those numbers -- so codes
 * are part of the contract between the TypeScript and shell halves.
 */
export type HarnessErrorCode =
  | 'NO_HARNESS'
  | 'NO_TASKS_FILE'
  | 'SCHEMA_INVALID'
  | 'CONFIG_INVALID'
  | 'TASK_NOT_FOUND'
  | 'AGENT_NOT_FOUND'
  | 'RULE_INVALID'
  | 'LOCK_TIMEOUT'
  | 'GATE_FAILED'
  | 'ADAPTER_FAILED'
  | 'USAGE';

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;
  readonly detail: string | undefined;

  constructor(code: HarnessErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Exit codes. 20/30 mirror the adapter contract (reject / needs-human) so a
 * pipeline script can branch on them without parsing text.
 */
export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  GATE_FAILED: 10,
  REJECTED: 20,
  NEEDS_INPUT: 30,
} as const;

export function exitCodeFor(err: unknown): number {
  if (!(err instanceof HarnessError)) return EXIT.ERROR;
  switch (err.code) {
    case 'USAGE':
      return EXIT.USAGE;
    case 'GATE_FAILED':
      return EXIT.GATE_FAILED;
    default:
      return EXIT.ERROR;
  }
}
