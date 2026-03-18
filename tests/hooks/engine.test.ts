/**
 * Unit tests for HookEngine
 */
import { HookEngine, HookEvent, HookAction, HookContext } from "../../src/hooks/engine.js";
import { Mode } from "../../src/agent/modes.js";

describe("HookEngine", () => {
  let engine: HookEngine;
  const ctx: HookContext = { mode: Mode.ACT, command: "echo hello" };

  beforeEach(() => {
    engine = new HookEngine({ defaultTimeoutMs: 2000 });
  });

  it("returns ALLOW when no hooks registered", async () => {
    const result = await engine.emit(HookEvent.PRE_SHELL, ctx);
    expect(result.action).toBe(HookAction.ALLOW);
  });

  it("executes hook and returns its result", async () => {
    engine.register("test", HookEvent.PRE_SHELL, () => ({
      action: HookAction.WARN,
      reason: "test warning",
    }));
    const result = await engine.emit(HookEvent.PRE_SHELL, ctx);
    expect(result.action).toBe(HookAction.WARN);
    expect(result.reason).toBe("test warning");
  });

  it("runs hooks in priority order", async () => {
    const order: number[] = [];
    engine.register("low", HookEvent.PRE_SHELL, () => {
      order.push(1);
      return { action: HookAction.ALLOW };
    }, 10);
    engine.register("high", HookEvent.PRE_SHELL, () => {
      order.push(2);
      return { action: HookAction.ALLOW };
    }, 1);
    await engine.emit(HookEvent.PRE_SHELL, ctx);
    expect(order).toEqual([2, 1]); // priority 1 runs before 10
  });

  it("returns most restrictive result", async () => {
    engine.register("allow", HookEvent.PRE_SHELL, () => ({ action: HookAction.ALLOW }), 1);
    engine.register("warn", HookEvent.PRE_SHELL, () => ({ action: HookAction.WARN, reason: "caution" }), 2);
    const result = await engine.emit(HookEvent.PRE_SHELL, ctx);
    expect(result.action).toBe(HookAction.WARN);
  });

  it("short-circuits on BLOCK", async () => {
    const fn = jest.fn(() => ({ action: HookAction.ALLOW }));
    engine.register("blocker", HookEvent.PRE_SHELL, () => ({
      action: HookAction.BLOCK,
      reason: "blocked",
    }), 1);
    engine.register("after", HookEvent.PRE_SHELL, fn, 2);
    const result = await engine.emit(HookEvent.PRE_SHELL, ctx);
    expect(result.action).toBe(HookAction.BLOCK);
    expect(fn).not.toHaveBeenCalled();
  });

  it("records audit log", async () => {
    engine.register("audited", HookEvent.PRE_SHELL, () => ({ action: HookAction.ALLOW }));
    await engine.emit(HookEvent.PRE_SHELL, ctx);
    const log = engine.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].hookName).toBe("audited");
    expect(log[0].event).toBe(HookEvent.PRE_SHELL);
  });

  it("handles hook errors with failMode=block", async () => {
    const eng = new HookEngine({ failMode: "block" });
    eng.register("crasher", HookEvent.PRE_SHELL, () => {
      throw new Error("crash");
    });
    const result = await eng.emit(HookEvent.PRE_SHELL, ctx);
    expect(result.action).toBe(HookAction.BLOCK);
    expect(result.reason).toContain("crash");
  });

  it("handles hook errors with failMode=warn", async () => {
    const eng = new HookEngine({ failMode: "warn" });
    eng.register("crasher", HookEvent.PRE_SHELL, () => {
      throw new Error("crash");
    });
    const result = await eng.emit(HookEvent.PRE_SHELL, ctx);
    expect(result.action).toBe(HookAction.WARN);
  });

  it("can unregister hooks", async () => {
    engine.register("temp", HookEvent.PRE_SHELL, () => ({
      action: HookAction.BLOCK,
      reason: "should not run",
    }));
    engine.unregister("temp");
    const result = await engine.emit(HookEvent.PRE_SHELL, ctx);
    expect(result.action).toBe(HookAction.ALLOW);
  });

  it("can disable/enable hooks", async () => {
    engine.register("toggle", HookEvent.PRE_SHELL, () => ({
      action: HookAction.BLOCK,
      reason: "blocked",
    }));
    engine.setEnabled("toggle", false);
    let result = await engine.emit(HookEvent.PRE_SHELL, ctx);
    expect(result.action).toBe(HookAction.ALLOW);

    engine.setEnabled("toggle", true);
    result = await engine.emit(HookEvent.PRE_SHELL, ctx);
    expect(result.action).toBe(HookAction.BLOCK);
  });

  it("only runs hooks for matching event", async () => {
    engine.register("shell-only", HookEvent.PRE_SHELL, () => ({
      action: HookAction.BLOCK,
      reason: "blocked",
    }));
    const result = await engine.emit(HookEvent.POST_EDIT, ctx);
    expect(result.action).toBe(HookAction.ALLOW);
  });
});
