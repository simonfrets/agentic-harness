import {
  ACTIVE_STATES,
  INTERRUPTED_STATES,
  STATE_AGENTS,
  TERMINAL_STATE,
  WORKFLOW_STATES,
} from "./task-schema.js";
import type {
  ActiveState,
  Task,
  TaskState,
  WorkflowState,
} from "./task-schema.js";

/**
 * Re-exported rather than defined here: `interruptedFrom` has to be validated
 * as an active stage and `agentId` as the owner of the state it sits in, so
 * both have to exist beside the schema. This is still where the pipeline is
 * reasoned about.
 */
export { ACTIVE_STATES, STATE_AGENTS, TERMINAL_STATE };

export const isWorkflowState = (state: TaskState): state is WorkflowState =>
  (WORKFLOW_STATES as readonly TaskState[]).includes(state);

export const isActiveState = (state: TaskState): state is ActiveState =>
  (ACTIVE_STATES as readonly TaskState[]).includes(state);

export const isInterruptedState = (state: TaskState): boolean =>
  (INTERRUPTED_STATES as readonly TaskState[]).includes(state);

/**
 * Where in the pipeline a task stands.
 *
 * A blocked or failed task is not nowhere: it is stopped at the stage it was
 * interrupted in, and that is the stage a resumed run has to pick up. A task
 * whose `interruptedFrom` is somehow missing is treated as being at the start,
 * which re-runs work rather than skipping it.
 *
 * The stage can only ever be an active one, because that is all the schema
 * accepts. That is what bounds every slice below by a stage the task could
 * really have stopped in.
 */
export const currentStage = (task: Task): WorkflowState => {
  if (isWorkflowState(task.state)) {
    return task.state;
  }

  return task.interruptedFrom ?? WORKFLOW_STATES[0];
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
