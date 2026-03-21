/**
 * session.ts — Session memory for AurexAI CLI Agent
 *
 * Aggregates all session-level state: mode, conversation, file cache,
 * plan state, project context, doctor result, and approval memory.
 *
 * Reference: docs/architecture-reference/specs/memory.md §3
 */

import { Mode, ModeManager } from "../agent/modes.js";
import { ApprovalMemory } from "../agent/approval-memory.js";
import { FileCache } from "./file-cache.js";
import { PlanStateManager } from "./plan-state.js";
import { ConversationStore } from "./conversation.js";
import { loadAgentFiles, buildAgentPrompt, AgentFileEntry } from "./agent-files.js";

// ─── Interfaces ──────────────────────────────────────────

export interface ProjectContext {
  stack: string[];             // detected stack (e.g. ["node", "typescript", "react"])
  packageManager: string;      // npm, yarn, pnpm
  structure: string[];         // top-level dirs
  conventions: Record<string, unknown>; // from .agent/conventions.json
}

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  lastChecked: number;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  allHealthy: boolean;
  timestamp: number;
}

export interface SessionStats {
  startedAt: number;
  messageCount: number;
  toolCallCount: number;
  totalTokens: number;
  fileCacheSize: number;
  activePlan: string | null;
  approvalCount: number;
}

// ─── Memory Limits ──────────────────────────────────────

export const MEMORY_LIMITS = {
  maxContextTokens: 128_000,
  maxToolResults: 20,
  maxFilesCached: 30,
  maxConversationMessages: 200,
  maxSessionDuration: 4 * 3600 * 1000, // 4 hours in ms
  maxConventionsFileSize: 100 * 1024,   // 100KB
  maxCacheSize: 512 * 1024,             // 512KB
};

// ─── Session Memory ─────────────────────────────────────

export class SessionMemory {
  readonly startedAt: number = Date.now();

  // Core components
  readonly conversation: ConversationStore;
  readonly fileCache: FileCache;
  readonly planState: PlanStateManager;
  readonly approvalMemory: ApprovalMemory;

  // Session state
  projectContext: ProjectContext | null = null;
  doctorResult: DoctorResult | null = null;
  toolCallCount: number = 0;
  agentFiles: AgentFileEntry[] = [];

  constructor(
    private modeManager: ModeManager,
    options?: {
      maxMessages?: number;
      maxTokens?: number;
      maxFilesCached?: number;
    }
  ) {
    this.conversation = new ConversationStore({
      maxMessages: options?.maxMessages ?? MEMORY_LIMITS.maxConversationMessages,
      maxTokens: options?.maxTokens ?? MEMORY_LIMITS.maxContextTokens,
    });
    this.fileCache = new FileCache({
      maxEntries: options?.maxFilesCached ?? MEMORY_LIMITS.maxFilesCached,
    });
    this.planState = new PlanStateManager();
    this.approvalMemory = new ApprovalMemory();
  }

  /**
   * Get the current mode from ModeManager.
   */
  getMode(): Mode {
    return this.modeManager.getMode();
  }

  /**
   * Record a tool call.
   */
  recordToolCall(): void {
    this.toolCallCount++;
  }

  /**
   * Check if session has exceeded its time limit.
   */
  isExpired(): boolean {
    return Date.now() - this.startedAt > MEMORY_LIMITS.maxSessionDuration;
  }

  /**
   * Get session statistics.
   */
  getStats(): SessionStats {
    const activePlan = this.planState.getActivePlan();
    return {
      startedAt: this.startedAt,
      messageCount: this.conversation.getMessageCount(),
      toolCallCount: this.toolCallCount,
      totalTokens: this.conversation.getTotalTokens(),
      fileCacheSize: this.fileCache.size(),
      activePlan: activePlan?.objective || null,
      approvalCount: this.approvalMemory.getActiveApprovals().length,
    };
  }

  /**
   * Load project context from workspace.
   */
  async loadProjectContext(): Promise<void> {
    try {
      const fs = await import("fs/promises");
      const stack: string[] = [];
      let packageManager = 'npm';
      try {
        const pkg = JSON.parse(await fs.readFile("package.json", "utf-8"));
        stack.push("node");
        if (pkg.dependencies?.typescript || pkg.devDependencies?.typescript) stack.push("typescript");
        if (pkg.dependencies?.react) stack.push("react");
        if (pkg.dependencies?.next) stack.push("next");
        if (pkg.dependencies?.vue) stack.push("vue");
        if (pkg.dependencies?.express) stack.push("express");
      } catch {
        // No package.json
      }

      // Check for Python
      try {
        await fs.access("requirements.txt");
        stack.push("python");
      } catch {
        try {
          await fs.access("pyproject.toml");
          stack.push("python");
        } catch {
          // No Python
        }
      }

      // Check package manager
      try { await fs.access("yarn.lock"); packageManager = "yarn"; } catch { /* empty */ }
      try { await fs.access("pnpm-lock.yaml"); packageManager = "pnpm"; } catch { /* empty */ }

      // Get top-level structure
      const entries = await fs.readdir(".", { withFileTypes: true });
      const structure = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .map(e => e.name);

      // Load conventions if present
      let conventions: Record<string, unknown> = {};
      try {
        conventions = JSON.parse(await fs.readFile(".agent/conventions.json", "utf-8"));
      } catch {
        // No conventions file
      }

      this.projectContext = { stack, packageManager, structure, conventions };

      // Load AGENT.md hierarchy (global → project → dir → local → rules)
      this.agentFiles = loadAgentFiles(process.cwd(), process.cwd());
    } catch {
      // Can't load project context
    }
  }

  /**
   * Build system prompt section from loaded AGENT.md files.
   * Rules with glob scopes are filtered by activeFiles.
   */
  getAgentPrompt(activeFiles?: string[]): string {
    return buildAgentPrompt(this.agentFiles, activeFiles);
  }

  /**
   * Reload AGENT.md files from disk (e.g. after compaction).
   */
  reloadAgentFiles(): void {
    this.agentFiles = loadAgentFiles(process.cwd(), process.cwd());
  }

  /**
   * Reset session (fresh start, preserves project context).
   */
  reset(): void {
    this.conversation.clear();
    this.fileCache.invalidateAll();
    this.planState.clearPlan();
    this.approvalMemory.clearAll();
    this.doctorResult = null;
    this.toolCallCount = 0;
    // Keep projectContext since it's from disk
  }
}
