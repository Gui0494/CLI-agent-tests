/**
 * Unit tests for PlanStateManager
 */
import { PlanStateManager } from "../../src/memory/plan-state.js";

describe("PlanStateManager", () => {
  let pm: PlanStateManager;

  beforeEach(() => {
    pm = new PlanStateManager();
  });

  it("starts with no active plan", () => {
    expect(pm.getActivePlan()).toBeNull();
    expect(pm.getNextStep()).toBeNull();
  });

  it("creates a plan in draft status", () => {
    const plan = pm.createPlan("Test objective", [
      { description: "Step 1" },
      { description: "Step 2" },
    ]);
    expect(plan.status).toBe("draft");
    expect(plan.steps).toHaveLength(2);
    expect(plan.objective).toBe("Test objective");
  });

  it("approves a draft plan", () => {
    pm.createPlan("Test", [{ description: "Step 1" }]);
    expect(pm.approvePlan()).toBe(true);
    expect(pm.getActivePlan()!.status).toBe("approved");
  });

  it("cannot approve a non-draft plan", () => {
    pm.createPlan("Test", [{ description: "Step 1" }]);
    pm.approvePlan();
    expect(pm.approvePlan()).toBe(false); // already approved
  });

  it("starts an approved plan", () => {
    pm.createPlan("Test", [{ description: "Step 1" }]);
    pm.approvePlan();
    expect(pm.startPlan()).toBe(true);
    expect(pm.getActivePlan()!.status).toBe("in_progress");
  });

  it("cannot start a non-approved plan", () => {
    pm.createPlan("Test", [{ description: "Step 1" }]);
    expect(pm.startPlan()).toBe(false);
  });

  it("tracks step progress", () => {
    pm.createPlan("Test", [
      { description: "Step 1" },
      { description: "Step 2" },
    ]);
    pm.approvePlan();
    pm.startPlan();

    expect(pm.getNextStep()!.id).toBe("step-1");
    pm.startStep("step-1");
    expect(pm.getActivePlan()!.steps[0].status).toBe("in_progress");

    pm.completeStep("step-1", "Done!");
    expect(pm.getActivePlan()!.steps[0].status).toBe("completed");
    expect(pm.getActivePlan()!.steps[0].output).toBe("Done!");
    expect(pm.getNextStep()!.id).toBe("step-2");
  });

  it("auto-completes plan when all steps done", () => {
    pm.createPlan("Test", [{ description: "Step 1" }]);
    pm.approvePlan();
    pm.startPlan();
    pm.completeStep("step-1");
    expect(pm.getActivePlan()).toBeNull(); // plan moved to history
    expect(pm.getHistory()).toHaveLength(1);
    expect(pm.getHistory()[0].status).toBe("completed");
  });

  it("tracks progress percentage", () => {
    pm.createPlan("Test", [
      { description: "Step 1" },
      { description: "Step 2" },
      { description: "Step 3" },
      { description: "Step 4" },
    ]);
    pm.completeStep("step-1");
    pm.skipStep("step-2");
    const prog = pm.getProgress();
    expect(prog.completed).toBe(2);
    expect(prog.total).toBe(4);
    expect(prog.percentage).toBe(50);
  });

  it("fails a step with error", () => {
    pm.createPlan("Test", [{ description: "Step 1" }]);
    pm.failStep("step-1", "Something broke");
    expect(pm.getActivePlan()!.steps[0].status).toBe("failed");
    expect(pm.getActivePlan()!.steps[0].error).toBe("Something broke");
  });

  it("fails entire plan", () => {
    pm.createPlan("Test", [{ description: "Step 1" }]);
    pm.failPlan("fatal error");
    expect(pm.getActivePlan()).toBeNull();
    expect(pm.getHistory()[0].status).toBe("failed");
  });
});
