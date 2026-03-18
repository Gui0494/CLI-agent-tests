/**
 * Unit tests for ApprovalMemory
 */
import { ApprovalMemory, ApprovalScope } from "../../src/agent/approval-memory.js";
import { PermissionClass } from "../../src/security/permissions.js";

describe("ApprovalMemory", () => {
  let mem: ApprovalMemory;

  beforeEach(() => {
    mem = new ApprovalMemory();
  });

  it("starts with no approvals", () => {
    expect(mem.isApproved(PermissionClass.WRITE_LOCAL, "task-1")).toBe(false);
    expect(mem.getActiveApprovals()).toHaveLength(0);
  });

  it("ONCE scope is not stored", () => {
    mem.approve(PermissionClass.WRITE_LOCAL, ApprovalScope.ONCE, "task-1");
    expect(mem.isApproved(PermissionClass.WRITE_LOCAL, "task-1")).toBe(false);
    expect(mem.getActiveApprovals()).toHaveLength(0);
  });

  it("THIS_TASK scope applies to same task", () => {
    mem.approve(PermissionClass.WRITE_LOCAL, ApprovalScope.THIS_TASK, "task-1");
    expect(mem.isApproved(PermissionClass.WRITE_LOCAL, "task-1")).toBe(true);
    expect(mem.isApproved(PermissionClass.WRITE_LOCAL, "task-2")).toBe(false);
  });

  it("THIS_SESSION scope applies to any task", () => {
    mem.approve(PermissionClass.SHELL_SAFE, ApprovalScope.THIS_SESSION, "task-1");
    expect(mem.isApproved(PermissionClass.SHELL_SAFE, "task-1")).toBe(true);
    expect(mem.isApproved(PermissionClass.SHELL_SAFE, "task-2")).toBe(true);
  });

  it("clearTask removes task-scoped approvals", () => {
    mem.approve(PermissionClass.WRITE_LOCAL, ApprovalScope.THIS_TASK, "task-1");
    mem.approve(PermissionClass.SHELL_SAFE, ApprovalScope.THIS_SESSION, "task-1");
    mem.clearTask("task-1");
    expect(mem.isApproved(PermissionClass.WRITE_LOCAL, "task-1")).toBe(false);
    // Session-scoped should survive
    expect(mem.isApproved(PermissionClass.SHELL_SAFE, "task-1")).toBe(true);
  });

  it("clearAll removes everything", () => {
    mem.approve(PermissionClass.WRITE_LOCAL, ApprovalScope.THIS_TASK, "task-1");
    mem.approve(PermissionClass.SHELL_SAFE, ApprovalScope.THIS_SESSION, "task-1");
    mem.clearAll();
    expect(mem.isApproved(PermissionClass.WRITE_LOCAL, "task-1")).toBe(false);
    expect(mem.isApproved(PermissionClass.SHELL_SAFE, "task-1")).toBe(false);
  });

  it("different permission classes are independent", () => {
    mem.approve(PermissionClass.WRITE_LOCAL, ApprovalScope.THIS_SESSION, "task-1");
    expect(mem.isApproved(PermissionClass.WRITE_LOCAL, "task-1")).toBe(true);
    expect(mem.isApproved(PermissionClass.SHELL_SAFE, "task-1")).toBe(false);
  });
});
