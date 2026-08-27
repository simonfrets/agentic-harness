import { z } from "zod";

import { agentIdSchema } from "../agents/agent-id.js";

/**
 * The pipeline states, in the order the workflow runs them.
 *
 * The order is load-bearing: `resolveTransitions` reads adjacency from this
 * array rather than from a hand-written edge list, so the sequence in
 * `docs/handoff/rule-enforcement.md` and the sequence the code enforces cannot
 * drift apart.
 */
export const WORKFLOW_STATES = [
  "draft",
  "specified",
  "awaiting_approval",
  "implementing",
  "cleaning",
  "architecture_review",
  "hardening",
  "qa",
  "completed",
] as const;

/**
 * The two states an interrupted task rests in.
 *
 * They are not stages: nothing is being worked on in either, and a task only
 * leaves one through a recovery transition back into the pipeline.
 */
export const INTERRUPTED_STATES = ["blocked", "failed"] as const;

export const TASK_STATES = [...WORKFLOW_STATES, ...INTERRUPTED_STATES] as const;

export const taskStateSchema = z.enum(TASK_STATES);

export type WorkflowState = (typeof WORKFLOW_STATES)[number];
export type InterruptedState = (typeof INTERRUPTED_STATES)[number];
export type TaskState = z.output<typeof taskStateSchema>;

const TASK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const taskIdSchema = z
  .string()
  .regex(
    TASK_ID_PATTERN,
    "task ids must be lower-case kebab-case, for example `add-login`"
  );

/**
 * A run id is a path segment: contexts live under
 * `.harness/state/runs/<run-id>/`. Restricting it to the same shape as a task
 * id is what stops a caller-supplied id from escaping that directory, and a
 * lower-cased `randomUUID()` already satisfies it.
 */
export const runIdSchema = z
  .string()
  .regex(
    TASK_ID_PATTERN,
    "run ids must be lower-case kebab-case, for example a uuid"
  );

const ABSOLUTE_OR_ESCAPING = /^\/|(?:^|\/)\.\.(?:\/|$)|\\/;

/**
 * A path recorded in `tasks.yaml`.
 *
 * `tasks.yaml` is committed and reviewed in a pull request, so an absolute
 * path in it would publish the machine that wrote it and would mean nothing on
 * the next one. A `..` segment is refused for the same reason a run id is
 * constrained: a recorded path is later resolved against the project root, and
 * one that escapes it points at a file the harness never owned.
 */
export const projectRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !ABSOLUTE_OR_ESCAPING.test(value),
    "must be a relative path inside the project, with `/` separators and no `..` segment"
  );

/** UTC instants only: two machines writing local times order a history wrong. */
export const timestampSchema = z.iso.datetime();

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/** Why a task was blocked or failed. Never a bare boolean. */
export const taskFailureSchema = z.strictObject({
  reason: z.string().min(1),
  details: z.array(z.string().min(1)).default([]),
});

/**
 * One recorded move between states.
 *
 * Every field the design requires a transition to store is present and
 * non-optional, because a record that may omit its rule-set hash or its
 * expected revision is not evidence of anything: the point of writing it down
 * is that a later reader can tell what the workflow believed at the time.
 */
export const transitionRecordSchema = z.strictObject({
  /** The task revision this transition produced. */
  revision: z.int().min(1),
  /** The revision its writer expected to find. A mismatch is rejected. */
  expectedRevision: z.int().min(1),
  /**
   * `from` equals `to` for exactly one kind of record: the approval of a
   * specification, which changes no state but does take a revision, so that
   * the history covers every revision the task has had.
   */
  from: taskStateSchema,
  to: taskStateSchema,
  /** Null where no agent owned the state, as `draft` never does. */
  fromAgent: agentIdSchema.nullable(),
  toAgent: agentIdSchema.nullable(),
  /** SHA-256 of the rule set resolved when the transition was taken. */
  ruleSetSha256: sha256Schema,
  gateReportIds: z.array(z.string().min(1)).default([]),
  artifactPaths: z.array(projectRelativePathSchema).default([]),
  at: timestampSchema,
  /** How many times the target state has now been entered. Starts at 1. */
  attempt: z.int().min(1),
  failure: taskFailureSchema.nullable().default(null),
  /** Where the target agent's isolated context was written. */
  contextPath: projectRelativePathSchema.nullable().default(null),
});

const taskShape = z.strictObject({
  id: taskIdSchema,
  title: z.string().min(1),
  state: taskStateSchema,
  /** Bumped by every transition. The concurrency token of the whole task. */
  revision: z.int().min(1),
  /** The run whose directory holds this task's agent contexts. */
  runId: runIdSchema,
  /** The agent that owns the current state, or null where none does. */
  agentId: agentIdSchema.nullable().default(null),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  /**
   * When the specification was approved, and by whom, or null for neither.
   *
   * The coder cannot start before explicit approval, so this is a stored fact
   * rather than something inferred from having reached `awaiting_approval`.
   * It is set by its own revision, so entering `implementing` can require that
   * approval already existed rather than accepting it from the same caller in
   * the same act. Re-entering the specification states clears it: an approval
   * granted for a specification that has since been rewritten approves
   * nothing.
   */
  approvedAt: timestampSchema.nullable().default(null),
  approvedBy: z.string().min(1).nullable().default(null),
  /** The state a blocked or failed task was interrupted in. */
  interruptedFrom: taskStateSchema.nullable().default(null),
  /** The context the current agent was handed. */
  contextPath: projectRelativePathSchema.nullable().default(null),
  history: z.array(transitionRecordSchema).default([]),
});

/**
 * An approval is one fact, so half of it is not a state the file may record.
 * Reading `approvedAt` without knowing who granted it would leave the audit
 * trail unable to answer the only question it exists for.
 */
export const taskSchema = taskShape.superRefine((task, ctx) => {
  if ((task.approvedAt === null) !== (task.approvedBy === null)) {
    ctx.addIssue({
      code: "custom",
      path: ["approvedBy"],
      message:
        "`approvedAt` and `approvedBy` are one fact: record both or neither",
    });
  }
});

export const TASK_FILE_VERSION = 1;

/**
 * A task id identifies a task, so two entries claiming one would make every
 * lookup depend on which the reader found first.
 */
export const taskFileSchema = z
  .strictObject({
    version: z.literal(TASK_FILE_VERSION),
    tasks: z.array(taskSchema).default([]),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();

    for (const [index, task] of file.tasks.entries()) {
      if (seen.has(task.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["tasks", index, "id"],
          message: `task \`${task.id}\` is declared more than once`,
        });
      }

      seen.add(task.id);
    }
  });

export type TaskFailure = z.output<typeof taskFailureSchema>;
export type TransitionRecord = z.output<typeof transitionRecordSchema>;
export type Task = z.output<typeof taskSchema>;
export type TaskFile = z.output<typeof taskFileSchema>;
