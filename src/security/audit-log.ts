/**
 * audit-log.ts — Immutable, append-only audit trail for AurexAI CLI Agent
 *
 * Records every significant action (tool calls, approvals, mode changes, errors)
 * to a JSONL file that cannot be modified by the agent loop.
 *
 * Design principles:
 * - Append-only: entries are written sequentially, never modified or deleted
 * - Structured: each line is a valid JSON object (JSONL format)
 * - Tamper-evident: file is opened in append mode only
 * - Queryable: exposed via /audit command in REPL
 */

import * as fs from "fs";
import * as path from "path";
import { Mode } from "../agent/modes.js";

// ─── Types ───────────────────────────────────────────────

export type AuditAction =
  | "tool_call"
  | "tool_result"
  | "approval_granted"
  | "approval_denied"
  | "mode_change"
  | "session_start"
  | "session_end"
  | "error"
  | "hook_executed"
  | "sandbox_fallback_blocked";

export interface AuditEntry {
  timestamp: number;
  sessionId: string;
  mode: Mode;
  action: AuditAction;
  tool?: string;
  args?: Record<string, unknown>;
  result?: "success" | "denied" | "error" | "blocked";
  approvalScope?: string;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ─── Sanitization ────────────────────────────────────────

/**
 * Redact potentially sensitive values from args before logging.
 */
function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_KEYS = new Set([
    "api_key", "apiKey", "password", "secret", "token",
    "authorization", "auth", "credential", "private_key",
    "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY",
  ]);

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "string" && value.length > 2048) {
      sanitized[key] = value.slice(0, 2048) + `...[truncated, ${value.length} chars]`;
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeArgs(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ─── Audit Logger ────────────────────────────────────────

export class AuditLog {
  private fd: number | null = null;
  private logPath: string;
  private sessionId: string;
  private entryCount = 0;

  constructor(logDir: string, sessionId: string) {
    this.sessionId = sessionId;

    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Log file named by session
    this.logPath = path.join(logDir, `${sessionId}.audit.jsonl`);

    // Open in append-only mode (O_APPEND | O_CREAT | O_WRONLY)
    this.fd = fs.openSync(this.logPath, "a");
  }

  /**
   * Record an audit entry. This is append-only — entries cannot be modified.
   */
  record(entry: Omit<AuditEntry, "timestamp" | "sessionId">): void {
    if (this.fd === null) return;

    const fullEntry: AuditEntry = {
      timestamp: Date.now(),
      sessionId: this.sessionId,
      ...entry,
      args: entry.args ? sanitizeArgs(entry.args) : undefined,
    };

    const line = JSON.stringify(fullEntry) + "\n";

    try {
      fs.writeSync(this.fd, line);
      this.entryCount++;
    } catch (err) {
      // Audit log write failures should not crash the agent
      console.error(`[audit] Failed to write entry: ${err}`);
    }
  }

  /**
   * Record a tool call event.
   */
  recordToolCall(
    mode: Mode,
    tool: string,
    args: Record<string, unknown>,
    result: "success" | "denied" | "error",
    durationMs?: number,
    error?: string,
  ): void {
    this.record({
      mode,
      action: "tool_call",
      tool,
      args,
      result,
      durationMs,
      error,
    });
  }

  /**
   * Record an approval decision.
   */
  recordApproval(
    mode: Mode,
    tool: string,
    granted: boolean,
    scope?: string,
  ): void {
    this.record({
      mode,
      action: granted ? "approval_granted" : "approval_denied",
      tool,
      result: granted ? "success" : "denied",
      approvalScope: scope,
    });
  }

  /**
   * Record a mode change.
   */
  recordModeChange(fromMode: Mode, toMode: Mode): void {
    this.record({
      mode: toMode,
      action: "mode_change",
      metadata: { fromMode },
    });
  }

  /**
   * Record session start.
   */
  recordSessionStart(mode: Mode): void {
    this.record({
      mode,
      action: "session_start",
      metadata: { pid: process.pid, nodeVersion: process.version },
    });
  }

  /**
   * Read all entries from the log (for /audit command).
   * Returns entries in chronological order.
   */
  readAll(): AuditEntry[] {
    try {
      const content = fs.readFileSync(this.logPath, "utf-8");
      return content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as AuditEntry);
    } catch {
      return [];
    }
  }

  /**
   * Get the number of entries recorded in this session.
   */
  getEntryCount(): number {
    return this.entryCount;
  }

  /**
   * Get the log file path.
   */
  getLogPath(): string {
    return this.logPath;
  }

  /**
   * Close the file descriptor. Should be called on session end.
   */
  close(): void {
    if (this.fd !== null) {
      this.record({
        mode: Mode.CHAT, // default for session end
        action: "session_end",
        metadata: { totalEntries: this.entryCount },
      });
      try {
        fs.closeSync(this.fd);
      } catch {
        // ignore
      }
      this.fd = null;
    }
  }
}

// ─── Singleton ───────────────────────────────────────────

let defaultAuditLog: AuditLog | null = null;

export function getAuditLog(logDir?: string, sessionId?: string): AuditLog {
  if (!defaultAuditLog && logDir && sessionId) {
    defaultAuditLog = new AuditLog(logDir, sessionId);
  }
  if (!defaultAuditLog) {
    throw new Error("AuditLog not initialized. Call getAuditLog(logDir, sessionId) first.");
  }
  return defaultAuditLog;
}
