/**
 * action-ledger.ts — Action ledger for AurexAI CLI Agent
 *
 * Records every action taken by the agent with evidence.
 * No action should be reported without a corresponding tool call,
 * hook event, or real diff.
 *
 * Reference: docs/architecture-reference/prompts/anti-hallucination.md
 */

// ─── Interfaces ──────────────────────────────────────────

export type EvidenceType = 'tool_call' | 'hook_event' | 'diff' | 'command_output' | 'file_read';

export interface ActionEvidence {
  type: EvidenceType;
  toolCallId?: string;
  output?: string;
  diff?: string;
  hookEvent?: string;
}

export interface LedgerEntry {
  id: string;
  action: string;          // what was done (e.g., "Edited src/foo.ts")
  timestamp: number;
  evidence: ActionEvidence;
}

// ─── Action Ledger ───────────────────────────────────────

export class ActionLedger {
  private entries: LedgerEntry[] = [];
  private counter: number = 0;

  /**
   * Record an action with evidence.
   */
  record(action: string, evidence: ActionEvidence): string {
    const id = `action-${++this.counter}`;
    this.entries.push({
      id,
      action,
      timestamp: Date.now(),
      evidence,
    });
    return id;
  }

  /**
   * Get all recorded actions.
   */
  getActions(): LedgerEntry[] {
    return [...this.entries];
  }

  /**
   * Get the last N actions.
   */
  getRecentActions(n: number): LedgerEntry[] {
    return this.entries.slice(-n);
  }

  /**
   * Check if a specific action type has evidence.
   */
  hasEvidence(actionId: string): boolean {
    const entry = this.entries.find(e => e.id === actionId);
    return entry !== undefined && entry.evidence !== undefined;
  }

  /**
   * Validate that all entries have valid evidence.
   * Returns entries without proper evidence.
   */
  validateAll(): LedgerEntry[] {
    return this.entries.filter(entry => {
      if (!entry.evidence) return true;
      if (!entry.evidence.type) return true;
      return false;
    });
  }

  /**
   * Clear the ledger (e.g., at task boundary).
   */
  clear(): void {
    this.entries = [];
    this.counter = 0;
  }

  /**
   * Get a summary of actions taken.
   */
  getSummary(): string {
    if (this.entries.length === 0) return 'No actions recorded.';
    return this.entries
      .map(e => `[${e.evidence.type}] ${e.action}`)
      .join('\n');
  }
}
