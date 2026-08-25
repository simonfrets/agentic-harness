import { z } from 'zod';

/** The six-stage default pipeline. Projects may reorder or trim it. */
export const DEFAULT_PIPELINE = [
  'specifier',
  'coder',
  'cleaner',
  'architect',
  'hardener',
  'qa',
] as const;

export const TASK_STATUSES = [
  'draft',
  'specifying',
  'spec-accepted',
  'coding',
  'cleaning',
  'architecture-review',
  'hardening',
  'qa',
  'done',
  'blocked',
] as const;

export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const gateResultSchema = z.enum(['pass', 'fail', 'skip']);
export type GateResult = z.infer<typeof gateResultSchema>;

export const handoffSchema = z.object({
  from: z.string(),
  to: z.string(),
  at: z.string(),
  summary: z.string(),
  /** The handing-off agent's self-declared checklist, verified by gates. */
  checklist: z.record(z.boolean()).default({}),
  /** Set when a downstream agent bounces the task back. */
  reason: z.string().optional(),
});
export type Handoff = z.infer<typeof handoffSchema>;

export const taskSchema = z.object({
  id: z.string().regex(/^T-\d{3,}$/, 'task ids look like T-001'),
  title: z.string().min(1),
  intent: z.string().default(''),
  status: taskStatusSchema.default('draft'),
  /** The agent currently holding the task. */
  owner: z.string(),
  branch: z.string().optional(),
  /** Path to the Gherkin spec, relative to `.harness/`. */
  spec: z.string().optional(),
  artifacts: z.array(z.string()).default([]),
  gates: z.record(gateResultSchema).default({}),
  handoffs: z.array(handoffSchema).default([]),
  notes: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Task = z.infer<typeof taskSchema>;

export const tasksFileSchema = z.object({
  version: z.literal(1).default(1),
  pipeline: z.array(z.string()).min(1).default([...DEFAULT_PIPELINE]),
  tasks: z.array(taskSchema).default([]),
});
export type TasksFile = z.infer<typeof tasksFileSchema>;
