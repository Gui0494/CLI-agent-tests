/**
 * Integration test for the critical tool execution path:
 * run_node_tool request → isToolAllowed() → hooks → handler → honestyGuard
 */
import { HookEngine, HookEvent, HookAction, HookContext } from "../../src/hooks/engine.js";
import { preShellHook } from "../../src/hooks/rules/pre-shell.js";
import { workspaceSandboxHook } from "../../src/hooks/rules/workspace-sandbox.js";
import { handleExec, ExecArgs } from "../../src/cli/tool-handlers.js";
import { createAppContext } from "../../src/context.js";
import { Mode } from "../../src/agent/modes.js";

function createMockExecutor(exitCode = 0, stdout = "ok", stderr = "") {
    return {
        run: jest.fn().mockResolvedValue({ stdout, stderr, exitCode, timedOut: false }),
    };
}

describe("Tool execution flow integration", () => {
    let engine: HookEngine;

    beforeEach(() => {
        // Create a fresh engine for each test (bypass singleton)
        engine = new HookEngine({ defaultTimeoutMs: 2000 });
    });

    describe("handleExec with hooks", () => {
        it("allows safe commands through PRE_SHELL hook", async () => {
            const appContext = createAppContext();
            const executor = createMockExecutor();

            // The real preShellHook classifies commands via blocklist
            // "echo hello" should be allowed
            const result = await handleExec(
                { cmd: "echo hello" },
                executor,
                appContext
            );

            expect(result.ok).toBe(true);
            expect(executor.run).toHaveBeenCalledWith("echo hello");
        });

        it("blocks commands when hook returns BLOCK", async () => {
            const appContext = createAppContext();
            const executor = createMockExecutor();

            // Register a blocking hook on the global engine
            // (handleExec uses getHookEngine() which is the singleton)
            const { getHookEngine } = await import("../../src/hooks/engine.js");
            const globalEngine = getHookEngine();
            globalEngine.register("test-blocker", HookEvent.PRE_SHELL, () => ({
                action: HookAction.BLOCK,
                reason: "test block",
            }), 1);

            try {
                const result = await handleExec(
                    { cmd: "dangerous command" },
                    executor,
                    appContext
                );

                expect(result.ok).toBe(false);
                expect(result.error).toContain("Blocked");
                expect(executor.run).not.toHaveBeenCalled();
            } finally {
                globalEngine.unregister("test-blocker");
            }
        });

        it("classifies transient errors correctly", async () => {
            const appContext = createAppContext();
            const executor = createMockExecutor(1, "", "connection refused");

            const result = await handleExec(
                { cmd: "curl http://localhost:9999" },
                executor,
                appContext
            );

            expect(result.ok).toBe(false);
            expect(result.exit_code).toBe(1);
        });
    });

    describe("AppContext + SessionMemory integration", () => {
        it("creates AppContext with SessionMemory", () => {
            const ctx = createAppContext();
            expect(ctx.session).toBeDefined();
            expect(ctx.session.doctorResult).toBeNull();
            expect(ctx.session.toolCallCount).toBe(0);
        });

        it("shares ApprovalMemory between AppContext and SessionMemory", () => {
            const ctx = createAppContext();
            expect(ctx.approvalMemory).toBe(ctx.session.approvalMemory);
        });

        it("SessionMemory tracks tool calls", () => {
            const ctx = createAppContext();
            ctx.session.recordToolCall();
            ctx.session.recordToolCall();
            expect(ctx.session.toolCallCount).toBe(2);
        });

        it("SessionMemory reports stats", () => {
            const ctx = createAppContext();
            const stats = ctx.session.getStats();
            expect(stats.startedAt).toBeLessThanOrEqual(Date.now());
            expect(stats.messageCount).toBe(0);
            expect(stats.toolCallCount).toBe(0);
        });
    });

    describe("HonestyGuard records tool executions", () => {
        it("records tool calls on successful execution", async () => {
            const appContext = createAppContext();
            const executor = createMockExecutor();

            expect(appContext.honestyGuard.getToolCallCount()).toBe(0);

            // Simulate what setup-bridge does: call handler then record
            const result = await handleExec(
                { cmd: "echo test" },
                executor,
                appContext
            );

            if (result.ok) {
                appContext.honestyGuard.onToolExecuted({
                    id: "1",
                    name: "exec_command",
                    args: { cmd: "echo test" },
                    timestamp: Date.now(),
                });
            }

            expect(appContext.honestyGuard.getToolCallCount()).toBe(1);
        });

        it("validates response claims against tool calls", () => {
            const appContext = createAppContext();

            // No tools executed yet — claiming execution should fail validation
            const validation = appContext.honestyGuard.validateResponse(
                "I executed the test and it passed"
            );

            expect(validation.valid).toBe(false);
        });

        it("validates mode-specific rules", () => {
            const appContext = createAppContext();

            // In CHAT mode, claiming side effects should fail
            const validation = appContext.honestyGuard.validateForMode(
                "I deleted the file",
                Mode.CHAT
            );

            expect(validation.valid).toBe(false);
        });
    });

    describe("Hook audit trail", () => {
        it("records hook executions in audit log", async () => {
            engine.register("test-hook", HookEvent.PRE_SHELL, () => ({
                action: HookAction.ALLOW,
            }));

            await engine.emit(HookEvent.PRE_SHELL, {
                mode: Mode.ACT,
                command: "echo test",
            });

            const log = engine.getAuditLog();
            expect(log).toHaveLength(1);
            expect(log[0].hookName).toBe("test-hook");
            expect(log[0].event).toBe(HookEvent.PRE_SHELL);
        });
    });
});
