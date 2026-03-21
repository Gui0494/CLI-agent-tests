/**
 * session-store.ts — JSONL-based session persistence.
 *
 * Each session is stored as a JSONL file where each line is a
 * timestamped event (message, tool call, mode change, etc.).
 *
 * Supports:
 * - `--continue` to resume the most recent session
 * - `--resume <session-id>` to resume a specific session
 */

import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { getDataDir } from "../config/paths.js";
import { Message } from "./conversation.js";

export interface SessionEvent {
  type: "message" | "tool_call" | "mode_change" | "compaction" | "meta";
  timestamp: number;
  data: Record<string, unknown>;
}

export interface SessionMetadata {
  id: string;
  startedAt: number;
  lastActivity: number;
  cwd: string;
  messageCount: number;
}

const SESSIONS_DIR = "sessions";

function getSessionsDir(): string {
  const dir = path.join(getDataDir(), SESSIONS_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export class SessionStore {
  private sessionId: string;
  private filePath: string;
  private fd: number | null = null;

  constructor(sessionId?: string) {
    this.sessionId = sessionId ?? uuidv4();
    this.filePath = path.join(getSessionsDir(), `${this.sessionId}.jsonl`);
  }

  get id(): string {
    return this.sessionId;
  }

  /** Open the session file for appending. */
  open(): void {
    this.fd = fs.openSync(this.filePath, "a");
    this.appendEvent({
      type: "meta",
      timestamp: Date.now(),
      data: { action: "session_start", cwd: process.cwd() },
    });
  }

  /** Append a message event to the session log. */
  appendMessage(message: Message): void {
    this.appendEvent({
      type: "message",
      timestamp: message.timestamp,
      data: {
        role: message.role,
        content: message.content,
        mode: message.metadata.mode,
        tokenCount: message.metadata.tokenCount,
      },
    });
  }

  /** Append a generic event. */
  appendEvent(event: SessionEvent): void {
    if (this.fd === null) return;
    const line = JSON.stringify(event) + "\n";
    fs.writeSync(this.fd, line);
  }

  /** Close the session file. */
  close(): void {
    if (this.fd !== null) {
      this.appendEvent({
        type: "meta",
        timestamp: Date.now(),
        data: { action: "session_end" },
      });
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }

  /** Load all events from a session file. */
  static loadSession(sessionId: string): SessionEvent[] {
    const filePath = path.join(getSessionsDir(), `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) return [];

    return fs.readFileSync(filePath, "utf-8")
      .split("\n")
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as SessionEvent; }
        catch { return null; }
      })
      .filter((e): e is SessionEvent => e !== null);
  }

  /** Get metadata for the most recent session. */
  static getMostRecent(): SessionMetadata | null {
    const dir = getSessionsDir();
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(dir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;

    const id = files[0].name.replace(".jsonl", "");
    const events = SessionStore.loadSession(id);
    const meta = events.find(e => e.type === "meta" && e.data.action === "session_start");

    return {
      id,
      startedAt: meta?.timestamp ?? files[0].mtime,
      lastActivity: files[0].mtime,
      cwd: (meta?.data.cwd as string) ?? "",
      messageCount: events.filter(e => e.type === "message").length,
    };
  }

  /** List all stored sessions. */
  static listSessions(): SessionMetadata[] {
    const dir = getSessionsDir();
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => {
        const id = f.replace(".jsonl", "");
        const stat = fs.statSync(path.join(dir, f));
        return {
          id,
          startedAt: stat.birthtimeMs,
          lastActivity: stat.mtimeMs,
          cwd: "",
          messageCount: 0,
        };
      })
      .sort((a, b) => b.lastActivity - a.lastActivity);
  }
}
