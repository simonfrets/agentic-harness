import { INTERRUPTED_STATES, WORKFLOW_STATES } from "./task-schema.js";
import type { Task, TaskState, WorkflowState } from "./task-schema.js";

/** The one state a task never leaves. */
export const TERMINAL_STATE = "completed" as const;

/**
 * The pipeline states a task can still be working in.
 *
 * `completed` is excluded because nothing is in progress there, which is what
 * makes "every active state may transition to `blocked` or `failed`" a rule
 * about eight states rather than nine.
 */
export const ACTIVE_STATES: readonly WorkflowState[] = WORKFLOW_STATES.filter(
  (state) => state !== TERMINAL_STATE
);

export const isWorkflowState = (state: TaskState): state is WorkflowState =>
  (WORKFLOW_STATES as readonly TaskState[]).includes(state);

export const isInterruptedState = (state: TaskState): boolean =>
  (INTERRUPTED_STATES as readonly TaskState[]).includes(state);

/**
 * Where in the pipeline a task stands.
 *
 * A blocked or failed task is not nowhere: it is stopped at the state it was
 * interrupted in, and that is the stage a resumed run has to pick up. A task
 * whose `interruptedFrom` is somehow missing is treated as being at the start,
 * which re-runs work rather than skipping it.
 */
export const currentStage = (task: Task): WorkflowState => {
  if (isWorkflowState(task.state)) {
    return task.state;
  }

  const interrupted = task.interruptedFrom;

  if (interrupted !== null && isWorkflowState(interrupted)) {
    return interrupted;
  }

  return WORKFLOW_STATES[0];
};

const stageIndex = (state: WorkflowState): number =>
  WORKFLOW_STATES.indexOf(state);

/** The state that follows one in the pipeline, or null at the end of it. */
export const nextWorkflowState = (state: WorkflowState): WorkflowState | null =>
  WORKFLOW_STATES[stageIndex(state) + 1] ?? null;

/**
 * The stages this task has already been through.
 *
 * Derived from where the task stands rather than from its history, so that a
 * task sent back for rework reports the stages after that point as pending
 * again - which is the answer a resumed run needs, and the one a scan of
 * "states this task has ever entered" would get wrong.
 */
export const completedStages = (task: Task): readonly WorkflowState[] => {
  const upto =
    task.state === TERMINAL_STATE
      ? WORKFLOW_STATES.length
      : stageIndex(currentStage(task));

  return WORKFLOW_STATES.slice(0, upto);
};

/**
 * The stages still to run, starting with the one the task is in.
 *
 * The current stage is pending because being in it is not the same as having
 * finished it: a run stopped halfway through `implementing` resumes there.
 */
export const pendingStages = (task: Task): readonly WorkflowState[] =>
  task.state === TERMINAL_STATE
    ? []
    : WORKFLOW_STATES.slice(stageIndex(currentStage(task)));

/**
 * Every state this task may move to next.
 *
 * The pipeline edges are read from `WORKFLOW_STATES` rather than written out
 * again, so the sequence the design fixes and the sequence the code enforces
 * are the same array.
 *
 * Recovery out of `blocked` or `failed` may target the interrupted stage or
 * any stage before it, and nothing after. That is what makes rework possible -
 * QA that fails has to be able to reach the coder again - without letting a
 * task skip a stage it has never run. It is also why recovery cannot reach
 * `completed`: an interrupted task always stopped at an active state, so every
 * target is at or before that one.
 */
export const allowedTransitions = (task: Task): readonly TaskState[] => {
  if (task.state === TERMINAL_STATE) {
    return [];
  }

  if (isWorkflowState(task.state)) {
    const next = nextWorkflowState(task.state);

    return [...(next === null ? [] : [next]), ...INTERRUPTED_STATES];
  }

  const recovery = WORKFLOW_STATES.slice(0, stageIndex(currentStage(task)) + 1);

  // A blocked task may still be given up on. A failed one is already there.
  return task.state === "blocked" ? [...recovery, "failed"] : recovery;
};
