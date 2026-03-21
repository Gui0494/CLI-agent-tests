/**
 * Unit tests for AuditLog — immutable, append-only audit trail
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { AuditLog } from "../../src/security/audit-log.js";
import { Mode } from "../../src/agent/modes.js";

describe("AuditLog", () => {
  let tmpDir: string;
  let auditLog: AuditLog;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurex-audit-test-"));
    auditLog = new AuditLog(tmpDir, "test-session-001");
  });

  afterEach(() => {
    auditLog.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates log file on instantiation", () => {
    const logPath = auditLog.getLogPath();
    expect(fs.existsSync(logPath)).toBe(true);
  });

  it("records entries in JSONL format", () => {
    auditLog.record({
      mode: Mode.ACT,
      action: "tool_call",
      tool: "read_file",
      result: "success",
    });

    // Close to flush session_end, then read
    auditLog.close();
    const content = fs.readFileSync(auditLog.getLogPath(), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2); // tool_call + session_end

    const entry = JSON.parse(lines[0]);
    expect(entry.sessionId).toBe("test-session-001");
    expect(entry.mode).toBe(Mode.ACT);
    expect(entry.action).toBe("tool_call");
    expect(entry.tool).toBe("read_file");
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it("recordToolCall writes structured entry", () => {
    auditLog.recordToolCall(
      Mode.AUTO,
      "exec_command",
      { cmd: "npm test" },
      "success",
      1234,
    );

    const entries = auditLog.readAll();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const entry = entries[0];
    expect(entry.tool).toBe("exec_command");
    expect(entry.args).toEqual({ cmd: "npm test" });
    expect(entry.durationMs).toBe(1234);
  });

  it("recordApproval writes approval entries", () => {
    auditLog.recordApproval(Mode.ACT, "git_push", true, "once");
    auditLog.recordApproval(Mode.ACT, "deploy", false);

    const entries = auditLog.readAll();
    expect(entries[0].action).toBe("approval_granted");
    expect(entries[0].approvalScope).toBe("once");
    expect(entries[1].action).toBe("approval_denied");
  });

  it("recordModeChange writes mode change", () => {
    auditLog.recordModeChange(Mode.CHAT, Mode.ACT);

    const entries = auditLog.readAll();
    expect(entries[0].action).toBe("mode_change");
    expect(entries[0].mode).toBe(Mode.ACT);
    expect(entries[0].metadata).toEqual({ fromMode: Mode.CHAT });
  });

  it("sanitizes sensitive args", () => {
    auditLog.recordToolCall(
      Mode.ACT,
      "llm_stream",
      {
        prompt: "test",
        api_key: "sk-super-secret-key-123",
        password: "hunter2",
        safe_arg: "visible",
      },
      "success",
    );

    const entries = auditLog.readAll();
    const args = entries[0].args!;
    expect(args.api_key).toBe("[REDACTED]");
    expect(args.password).toBe("[REDACTED]");
    expect(args.safe_arg).toBe("visible");
    expect(args.prompt).toBe("test");
  });

  it("truncates long arg values", () => {
    const longString = "x".repeat(5000);
    auditLog.recordToolCall(
      Mode.ACT,
      "write_file",
      { content: longString },
      "success",
    );

    const entries = auditLog.readAll();
    const content = entries[0].args!.content as string;
    expect(content.length).toBeLessThan(5000);
    expect(content).toContain("[truncated");
  });

  it("readAll returns entries in order", () => {
    auditLog.recordSessionStart(Mode.CHAT);
    auditLog.recordModeChange(Mode.CHAT, Mode.ACT);
    auditLog.recordToolCall(Mode.ACT, "read_file", { path: "foo.ts" }, "success");

    const entries = auditLog.readAll();
    expect(entries.length).toBe(3);
    expect(entries[0].action).toBe("session_start");
    expect(entries[1].action).toBe("mode_change");
    expect(entries[2].action).toBe("tool_call");
  });

  it("getEntryCount tracks entries", () => {
    expect(auditLog.getEntryCount()).toBe(0);
    auditLog.record({ mode: Mode.CHAT, action: "session_start" });
    expect(auditLog.getEntryCount()).toBe(1);
    auditLog.record({ mode: Mode.CHAT, action: "tool_call" });
    expect(auditLog.getEntryCount()).toBe(2);
  });

  it("close writes session_end entry", () => {
    auditLog.record({ mode: Mode.CHAT, action: "session_start" });
    auditLog.close();

    const content = fs.readFileSync(auditLog.getLogPath(), "utf-8");
    const lines = content.trim().split("\n");
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    expect(lastEntry.action).toBe("session_end");
    expect(lastEntry.metadata.totalEntries).toBeGreaterThan(0);
  });

  it("is append-only (second instance appends)", () => {
    auditLog.record({ mode: Mode.CHAT, action: "session_start" });
    auditLog.close();

    // Create new instance pointing to same file
    const auditLog2 = new AuditLog(tmpDir, "test-session-001");
    auditLog2.record({ mode: Mode.ACT, action: "tool_call", tool: "grep" });
    auditLog2.close();

    const content = fs.readFileSync(
      path.join(tmpDir, "test-session-001.audit.jsonl"),
      "utf-8",
    );
    const lines = content.trim().split("\n");
    // session_start + session_end (first) + tool_call + session_end (second)
    expect(lines.length).toBe(4);
  });
});
