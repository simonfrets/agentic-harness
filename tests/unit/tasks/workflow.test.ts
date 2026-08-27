import {
  ACTIVE_STATES,
  TERMINAL_STATE,
  allowedTransitions,
  completedStages,
  currentStage,
  isInterruptedState,
  isWorkflowState,
  nextWorkflowState,
  pendingStages,
} from "../../../src/tasks/workflow.js";
import {
  INTERRUPTED_STATES,
  WORKFLOW_STATES,
} from "../../../src/tasks/task-schema.js";
import { buildTask } from "../../helpers/tasks.js";

describe("the pipeline", () => {
  it("treats every state but the last as one work can be interrupted in", () => {
    expect([...ACTIVE_STATES]).toEqual([
      "draft",
      "specified",
      "awaiting_approval",
      "implementing",
      "cleaning",
      "architecture_review",
      "hardening",
      "qa",
    ]);
    expect(ACTIVE_STATES).not.toContain(TERMINAL_STATE);
  });

  it("chains the states in the documented order", () => {
    expect(WORKFLOW_STATES.map(nextWorkflowState)).toEqual([
      "specified",
      "awaiting_approval",
      "implementing",
      "cleaning",
      "architecture_review",
      "hardening",
      "qa",
      "completed",
      null,
    ]);
  });

  it("separates pipeline states from interrupted ones", () => {
    expect(isWorkflowState("qa")).toBe(true);
    expect(isWorkflowState("blocked")).toBe(false);
    expect(isInterruptedState("failed")).toBe(true);
    expect(isInterruptedState("qa")).toBe(false);
  });
});

describe("allowedTransitions", () => {
  it("lets an active state go forward, or to either interrupted state", () => {
    expect(allowedTransitions(buildTask({ state: "cleaning" }))).toEqual([
      "architecture_review",
      "blocked",
      "failed",
    ]);
  });

  it("leaves a completed task with nowhere to go", () => {
    expect(allowedTransitions(buildTask({ state: "completed" }))).toEqual([]);
  });

  it("never lets an active state skip the stage after it", () => {
    for (const state of ACTIVE_STATES) {
      const allowed = allowedTransitions(buildTask({ state }));
      const forward = allowed.filter((target) => !isInterruptedState(target));

      expect(forward).toEqual([nextWorkflowState(state)]);
    }
  });

  it("recovers a blocked task to where it stopped, or to earlier rework", () => {
    // QA that fails has to be able to reach the coder again; nothing may skip
    // forward past the stage the task was interrupted in.
    expect(
      allowedTransitions(
        buildTask({ state: "blocked", interruptedFrom: "hardening" })
      )
    ).toEqual([
      "draft",
      "specified",
      "awaiting_approval",
      "implementing",
      "cleaning",
      "architecture_review",
      "hardening",
      "failed",
    ]);
  });

  it("lets a blocked task be given up on but not a failed one be re-blocked", () => {
    const blocked = allowedTransitions(
      buildTask({ state: "blocked", interruptedFrom: "qa" })
    );
    const failed = allowedTransitions(
      buildTask({ state: "failed", interruptedFrom: "qa" })
    );

    expect(blocked).toContain("failed");
    expect(failed).not.toContain("blocked");
    expect(failed).not.toContain("failed");
  });

  it("never lets recovery reach completed, or any stage past the interruption", () => {
    // `interruptedFrom` is validated as an active stage, so this loop is the
    // whole domain of it: there is no ninth value a hand-edited `tasks.yaml`
    // could name to widen the slice past the stage the task stopped in. It
    // used to accept all eleven states, and `completed` opened the pipeline.
    for (const stoppedIn of ACTIVE_STATES) {
      for (const interrupted of INTERRUPTED_STATES) {
        const allowed = allowedTransitions(
          buildTask({ state: interrupted, interruptedFrom: stoppedIn })
        );

        expect(allowed).not.toContain(TERMINAL_STATE);
        expect(allowed.filter((target) => !isInterruptedState(target))).toEqual(
          ACTIVE_STATES.slice(0, ACTIVE_STATES.indexOf(stoppedIn) + 1)
        );
      }
    }
  });
});

describe("resuming", () => {
  it("reports a stopped task as standing at the stage it was interrupted in", () => {
    const task = buildTask({
      state: "blocked",
      interruptedFrom: "architecture_review",
    });

    expect(currentStage(task)).toBe("architecture_review");
    expect(completedStages(task)).toEqual([
      "draft",
      "specified",
      "awaiting_approval",
      "implementing",
      "cleaning",
    ]);
    // The interrupted stage is pending: being in it is not finishing it.
    expect(pendingStages(task)).toEqual([
      "architecture_review",
      "hardening",
      "qa",
      "completed",
    ]);
  });

  it("has nothing left to do once a task is completed", () => {
    const task = buildTask({ state: "completed" });

    expect(pendingStages(task)).toEqual([]);
    expect(completedStages(task)).toEqual([...WORKFLOW_STATES]);
  });

  it("counts a stage as pending again when a task is sent back for rework", () => {
    const task = buildTask({ state: "implementing" });

    expect(completedStages(task)).not.toContain("qa");
    expect(pendingStages(task)).toContain("qa");
  });

  it("falls back to the start of the pipeline rather than skipping work", () => {
    // A hand-edited file can say `blocked` without saying where from. Resuming
    // at the beginning re-runs work; resuming at the end would skip it.
    const task = buildTask({ state: "failed", interruptedFrom: null });

    expect(currentStage(task)).toBe("draft");
    expect(completedStages(task)).toEqual([]);
  });
});
