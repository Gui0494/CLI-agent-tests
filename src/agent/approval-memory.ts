/**
 * approval-memory.ts — Approval memory for AurexAI CLI Agent
 *
 * Tracks granted approvals by permission class and scope.
 *
 * Reference: docs/architecture-reference/prompts/approval-flow.md
 */

import { PermissionClass } from "../security/permissions.js";

// ─── Approval Scope ──────────────────────────────────────

export enum ApprovalScope {
  ONCE         = 'once',
  THIS_TASK    = 'this-task',
  THIS_SESSION = 'this-session',
}

// ─── Interfaces ──────────────────────────────────────────

interface ApprovalEntry {
  permissionClass: PermissionClass;
  scope: ApprovalScope;
  taskId: string;
  grantedAt: number;
}

// ─── ApprovalMemory ──────────────────────────────────────

export class ApprovalMemory {
  private approvals: ApprovalEntry[] = [];

  /**
   * Check if a permission class is already approved for this context.
   */
  isApproved(permClass: PermissionClass, taskId: string): boolean {
    return this.approvals.some(a =>
      a.permissionClass === permClass &&
      (
        a.scope === ApprovalScope.THIS_SESSION ||
        (a.scope === ApprovalScope.THIS_TASK && a.taskId === taskId)
        // ONCE approvals are consumed immediately and never matched here
      )
    );
  }

  /**
   * Record an approval.
   */
  approve(permClass: PermissionClass, scope: ApprovalScope, taskId: string): void {
    // ONCE scope: don't store (it's used immediately and discarded)
    if (scope === ApprovalScope.ONCE) return;

    this.approvals.push({
      permissionClass: permClass,
      scope,
      taskId,
      grantedAt: Date.now(),
    });
  }

  /**
   * Clear all approvals for a specific task.
   */
  clearTask(taskId: string): void {
    this.approvals = this.approvals.filter(a =>
      !(a.scope === ApprovalScope.THIS_TASK && a.taskId === taskId)
    );
  }

  /**
   * Clear all approvals (session end).
   */
  clearAll(): void {
    this.approvals = [];
  }

  /**
   * Get active approvals summary.
   */
  getActiveApprovals(): Array<{ permissionClass: PermissionClass; scope: ApprovalScope }> {
    return this.approvals.map(a => ({
      permissionClass: a.permissionClass,
      scope: a.scope,
    }));
  }
}
