/**
 * plan-state.ts — Plan state manager for AurexAI CLI Agent
 *
 * Tracks the active plan, its steps, and completion status.
 *
 * Reference: docs/architecture-reference/specs/memory.md §3 PlanState
 */

import { v4 as uuidv4 } from "uuid";

// ─── Interfaces ──────────────────────────────────────────

export type PlanStatus = 'draft' | 'approved' | 'in_progress' | 'completed' | 'failed';
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';

export interface PlanStep {
  id: string;
  description: string;
  status: StepStatus;
  toolsNeeded: string[];
  output: string | null;
  error: string | null;
}

export interface Plan {
  id: string;
  objective: string;
  steps: PlanStep[];
  affectedFiles: string[];
  risks: string[];
  status: PlanStatus;
  createdAt: number;
  completedAt: number | null;
}

// ─── Plan State Manager ─────────────────────────────────

export class PlanStateManager {
  private activePlan: Plan | null = null;
  private history: Plan[] = [];

  /**
   * Create a new plan from an objective and steps.
   */
  createPlan(
    objective: string,
    steps: Array<{ description: string; toolsNeeded?: string[] }>,
    options?: { affectedFiles?: string[]; risks?: string[] }
  ): Plan {
    const plan: Plan = {
      id: uuidv4(),
      objective,
      steps: steps.map((s, i) => ({
        id: `step-${i + 1}`,
        description: s.description,
        status: 'pending' as StepStatus,
        toolsNeeded: s.toolsNeeded || [],
        output: null,
        error: null,
      })),
      affectedFiles: options?.affectedFiles || [],
      risks: options?.risks || [],
      status: 'draft',
      createdAt: Date.now(),
      completedAt: null,
    };

    this.activePlan = plan;
    return plan;
  }

  /**
   * Get the active plan.
   */
  getActivePlan(): Plan | null {
    return this.activePlan;
  }

  /**
   * Approve the active plan.
   */
  approvePlan(): boolean {
    if (!this.activePlan || this.activePlan.status !== 'draft') return false;
    this.activePlan.status = 'approved';
    return true;
  }

  /**
   * Start executing the plan.
   */
  startPlan(): boolean {
    if (!this.activePlan || this.activePlan.status !== 'approved') return false;
    this.activePlan.status = 'in_progress';
    return true;
  }

  /**
   * Mark a step as in-progress.
   */
  startStep(stepId: string): boolean {
    const step = this.findStep(stepId);
    if (!step || step.status !== 'pending') return false;
    step.status = 'in_progress';
    return true;
  }

  /**
   * Complete a step with output.
   */
  completeStep(stepId: string, output?: string): boolean {
    const step = this.findStep(stepId);
    if (!step) return false;
    step.status = 'completed';
    step.output = output || null;
    this.checkPlanCompletion();
    return true;
  }

  /**
   * Fail a step with error.
   */
  failStep(stepId: string, error: string): boolean {
    const step = this.findStep(stepId);
    if (!step) return false;
    step.status = 'failed';
    step.error = error;
    return true;
  }

  /**
   * Skip a step.
   */
  skipStep(stepId: string): boolean {
    const step = this.findStep(stepId);
    if (!step) return false;
    step.status = 'skipped';
    this.checkPlanCompletion();
    return true;
  }

  /**
   * Get the next pending step.
   */
  getNextStep(): PlanStep | null {
    if (!this.activePlan) return null;
    return this.activePlan.steps.find(s => s.status === 'pending') || null;
  }

  /**
   * Get progress as fraction.
   */
  getProgress(): { completed: number; total: number; percentage: number } {
    if (!this.activePlan) return { completed: 0, total: 0, percentage: 0 };
    const total = this.activePlan.steps.length;
    const completed = this.activePlan.steps.filter(
      s => s.status === 'completed' || s.status === 'skipped'
    ).length;
    return { completed, total, percentage: total > 0 ? (completed / total) * 100 : 0 };
  }

  /**
   * Fail the entire plan.
   */
  failPlan(_error?: string): void {
    if (!this.activePlan) return;
    this.activePlan.status = 'failed';
    this.activePlan.completedAt = Date.now();
    this.history.push(this.activePlan);
    this.activePlan = null;
  }

  /**
   * Clear the active plan.
   */
  clearPlan(): void {
    if (this.activePlan) {
      this.history.push(this.activePlan);
    }
    this.activePlan = null;
  }

  /**
   * Get plan history.
   */
  getHistory(): Plan[] {
    return [...this.history];
  }

  // ─── Private ───────────────────────────────────────────

  private findStep(stepId: string): PlanStep | null {
    return this.activePlan?.steps.find(s => s.id === stepId) || null;
  }

  private checkPlanCompletion(): void {
    if (!this.activePlan) return;
    const allDone = this.activePlan.steps.every(
      s => s.status === 'completed' || s.status === 'skipped'
    );
    if (allDone) {
      this.activePlan.status = 'completed';
      this.activePlan.completedAt = Date.now();
      this.history.push(this.activePlan);
      this.activePlan = null;
    }
  }
}
