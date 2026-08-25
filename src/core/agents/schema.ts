import { z } from 'zod';

/**
 * Reasoning effort. The adapters map this onto whatever their vendor calls it;
 * agents declare intent, not vendor flags.
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;
export const effortSchema = z.enum(EFFORT_LEVELS);
export type Effort = z.infer<typeof effortSchema>;

const checklistItemSchema = z
  .union([
    z.string(),
    z.object({ id: z.string(), description: z.string().optional() }),
  ])
  // A bare string is shorthand: the id doubles as its own description.
  .transform((item) =>
    typeof item === 'string'
      ? { id: item, description: item }
      : { id: item.id, description: item.description ?? item.id },
  );

export const agentSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'agent names are lowercase kebab-case'),
  description: z.string().default(''),
  /** Model per adapter, e.g. `{ claude: opus, codex: gpt-5 }`. */
  model: z.record(z.string()).default({}),
  effort: effortSchema.default('medium'),
  tools: z.array(z.string()).default([]),
  /**
   * Globs this agent is allowed to write. The handoff gate diffs the worktree
   * against this list, which is what makes the boundary real rather than
   * a request in a prompt.
   */
  writeScope: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([]),
  /** Prompt body path, relative to `.harness/`. */
  prompt: z.string(),
  acceptsFrom: z.array(z.string()).default([]),
  handoffTo: z.string().optional(),
  checklist: z.array(checklistItemSchema).default([]),
});

export type AgentDefinition = z.infer<typeof agentSchema>;
export type ChecklistItem = AgentDefinition['checklist'][number];
