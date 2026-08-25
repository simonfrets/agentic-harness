import { z } from 'zod';

import { DEFAULT_PIPELINE } from '../tasks/schema';

const adapterSchema = z.object({
  /** Executable name or absolute path. Overridable so CI can point at a shim. */
  bin: z.string(),
  defaultModel: z.string().default(''),
  /** Extra arguments appended to every invocation. */
  args: z.array(z.string()).default([]),
});

const gatesSchema = z.object({
  /** Diff the worktree against the agent's declared write_scope. */
  writeScope: z.boolean().default(true),
  /** Run the blocking rules that apply to the handing-off agent. */
  rules: z.boolean().default(true),
  /** Require paired tests and red-before-green receipts. */
  tdd: z.boolean().default(true),
});

const tddSchema = z.object({
  srcPrefixes: z.array(z.string()).default(['src']),
  testPrefixes: z.array(z.string()).default(['tests']),
  coverageFloor: z.number().min(0).max(100).default(80),
  /** Fail a handoff while any touched function exceeds this CRAP score. */
  crapCeiling: z.number().positive().default(30),
});

export const configSchema = z.object({
  version: z.literal(1).default(1),
  /** Adapter used when neither the CLI nor the agent specifies one. */
  adapter: z.string().default('claude'),
  pipeline: z.array(z.string()).min(1).default([...DEFAULT_PIPELINE]),
  adapters: z
    .record(adapterSchema)
    .default({
      claude: { bin: 'claude', defaultModel: 'sonnet', args: [] },
      codex: { bin: 'codex', defaultModel: 'gpt-5-codex', args: [] },
    }),
  gates: gatesSchema.default({}),
  tdd: tddSchema.default({}),
  /** Shell command run when a task reaches `done`. Empty disables it. */
  notify: z.object({ command: z.string().default('') }).default({}),
});

export type HarnessConfig = z.infer<typeof configSchema>;
export type AdapterConfig = z.infer<typeof adapterSchema>;
