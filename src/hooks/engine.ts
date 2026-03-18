/**
 * engine.ts — Deterministic hook engine for AurexAI CLI Agent
 *
 * Executes hooks in priority order with configurable failure policy and timeout.
 *
 * Reference: docs/architecture-reference/specs/contracts.md §2
 */

import { Mode } from "../agent/modes.js";

// ─── Enums ───────────────────────────────────────────────

export enum HookEvent {
  PRE_SHELL        = 'pre-shell',
  PRE_WRITE        = 'pre-write',
  POST_EDIT        = 'post-edit',
  POST_TASK        = 'post-task',
  PRE_DEPLOY       = 'pre-deploy',
  PRE_GIT_PUSH     = 'pre-git-push',
  ON_ERROR         = 'on-error',
  ON_SESSION_START  = 'on-session-start',
}

export enum HookAction {
  ALLOW = 'allow',
  BLOCK = 'block',
  WARN  = 'warn',
  RUN   = 'run',
  LOG   = 'log',
}

// ─── Interfaces ──────────────────────────────────────────

export interface HookContext {
  command?: string;
  filePath?: string;
  cwd?: string;
  mode: Mode;
  [key: string]: unknown;
}

export interface HookResult {
  action: HookAction;
  reason?: string;
  suggestion?: string;
  hookName?: string;
  executionTimeMs?: number;
}

export type HookHandler = (context: HookContext) => HookResult | Promise<HookResult>;

export interface RegisteredHook {
  name: string;
  event: HookEvent;
  handler: HookHandler;
  priority: number;       // lower = runs first
  enabled: boolean;
}

export type FailMode = 'block' | 'warn' | 'log';

export interface HookEngineConfig {
  failMode: FailMode;       // what to do if a hook throws
  defaultTimeoutMs: number;  // max time per hook execution
}

// ─── Hook Engine ─────────────────────────────────────────

export class HookEngine {
  private hooks: RegisteredHook[] = [];
  private config: HookEngineConfig;
  private auditLog: Array<{ timestamp: number; event: HookEvent; hookName: string; result: HookResult }> = [];

  constructor(config?: Partial<HookEngineConfig>) {
    this.config = {
      failMode: config?.failMode ?? 'block',
      defaultTimeoutMs: config?.defaultTimeoutMs ?? 5000,
    };
  }

  /**
   * Register a hook handler with a priority.
   * Lower priority number = runs first.
   */
  register(name: string, event: HookEvent, handler: HookHandler, priority: number = 100): void {
    this.hooks.push({
      name,
      event,
      handler,
      priority,
      enabled: true,
    });

    // Keep sorted by priority (deterministic order)
    this.hooks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Unregister a hook by name.
   */
  unregister(name: string): void {
    this.hooks = this.hooks.filter(h => h.name !== name);
  }

  /**
   * Enable/disable a hook by name.
   */
  setEnabled(name: string, enabled: boolean): void {
    const hook = this.hooks.find(h => h.name === name);
    if (hook) hook.enabled = enabled;
  }

  /**
   * Emit a hook event. Runs all matching hooks in priority order.
   * Returns the most restrictive result (BLOCK > WARN > RUN > LOG > ALLOW).
   */
  async emit(event: HookEvent, context: HookContext): Promise<HookResult> {
    const matching = this.hooks.filter(h => h.event === event && h.enabled);

    if (matching.length === 0) {
      return { action: HookAction.ALLOW };
    }

    let mostRestrictive: HookResult = { action: HookAction.ALLOW };

    for (const hook of matching) {
      try {
        const result = await this.executeWithTimeout(hook, context);
        result.hookName = hook.name;

        // Audit log
        this.auditLog.push({
          timestamp: Date.now(),
          event,
          hookName: hook.name,
          result,
        });

        // Track most restrictive result
        if (this.isMoreRestrictive(result.action, mostRestrictive.action)) {
          mostRestrictive = result;
        }

        // Short-circuit on BLOCK
        if (result.action === HookAction.BLOCK) {
          return result;
        }
      } catch (error: unknown) {
        const failResult = this.handleHookError(hook, error as Error);
        this.auditLog.push({
          timestamp: Date.now(),
          event,
          hookName: hook.name,
          result: failResult,
        });

        if (failResult.action === HookAction.BLOCK) {
          return failResult;
        }
        if (this.isMoreRestrictive(failResult.action, mostRestrictive.action)) {
          mostRestrictive = failResult;
        }
      }
    }

    return mostRestrictive;
  }

  /**
   * Get the audit log of all hook executions.
   */
  getAuditLog(): typeof this.auditLog {
    return [...this.auditLog];
  }

  /**
   * Clear the audit log.
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }

  /**
   * Get registered hooks for an event.
   */
  getHooksForEvent(event: HookEvent): RegisteredHook[] {
    return this.hooks.filter(h => h.event === event);
  }

  // ─── Private Methods ────────────────────────────────────

  private async executeWithTimeout(hook: RegisteredHook, context: HookContext): Promise<HookResult> {
    const startTime = Date.now();

    const timeoutPromise = new Promise<HookResult>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Hook "${hook.name}" timed out after ${this.config.defaultTimeoutMs}ms`));
      }, this.config.defaultTimeoutMs);
    });

    const handlerPromise = Promise.resolve(hook.handler(context)).then(result => {
      result.executionTimeMs = Date.now() - startTime;
      return result;
    });

    return Promise.race([handlerPromise, timeoutPromise]);
  }

  private handleHookError(hook: RegisteredHook, error: Error): HookResult {
    const reason = `Hook "${hook.name}" failed: ${error.message}`;

    switch (this.config.failMode) {
      case 'block':
        return { action: HookAction.BLOCK, reason, hookName: hook.name };
      case 'warn':
        return { action: HookAction.WARN, reason, hookName: hook.name };
      case 'log':
        return { action: HookAction.LOG, reason, hookName: hook.name };
    }
  }

  private isMoreRestrictive(a: HookAction, b: HookAction): boolean {
    const ORDER: Record<HookAction, number> = {
      [HookAction.ALLOW]: 0,
      [HookAction.LOG]:   1,
      [HookAction.RUN]:   2,
      [HookAction.WARN]:  3,
      [HookAction.BLOCK]: 4,
    };
    return ORDER[a] > ORDER[b];
  }
}

// ─── Default Engine Instance ─────────────────────────────

let defaultEngine: HookEngine | null = null;

export function getHookEngine(config?: Partial<HookEngineConfig>): HookEngine {
  if (!defaultEngine) {
    defaultEngine = new HookEngine(config);
  }
  return defaultEngine;
}
