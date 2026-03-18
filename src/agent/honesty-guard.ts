/**
 * honesty-guard.ts — Anti-hallucination guard for AurexAI CLI Agent
 *
 * Validates that the agent doesn't claim side-effects without evidence.
 * Enforces per-mode honesty rules.
 *
 * Reference: docs/architecture-reference/prompts/anti-hallucination.md
 */

import { Mode } from "./modes.js";

// ─── Interfaces ──────────────────────────────────────────

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  timestamp: number;
}

export interface ActionClaim {
  text: string;
  fullMatch: RegExpExecArray;
}

export interface ValidationResult {
  valid: boolean;
  violation?: string;
  claim?: ActionClaim;
}

// ─── Action Claim Patterns ───────────────────────────────

// Patterns that indicate the agent claims to have executed an action
const ACTION_PATTERNS: RegExp[] = [
  // Portuguese action claims
  /(?:executei|rodei|instalei|criei|editei|salvei|commitei|removi|deletei|apaguei)\s+(.+)/gi,
  /(?:arquivo|comando|teste|build)\s+(?:foi|está|foram)\s+(.+)/gi,
  /(?:de acordo com|segundo|conforme)\s+(?:a documentação|os docs|a página)/gi,

  // English action claims
  /(?:I\s+)?(?:executed|ran|installed|created|edited|saved|committed|removed|deleted)\s+(.+)/gi,
  /(?:file|command|test|build)\s+(?:was|is|were|has been)\s+(?:successfully\s+)?(.+)/gi,
  /(?:according to|based on)\s+(?:the documentation|the docs|the page)/gi,
];

// ─── Mode-Specific Rules ─────────────────────────────────

// Patterns that indicate side-effects (actions that modify state)
const SIDE_EFFECT_PATTERNS: RegExp[] = [
  /(?:criei|editei|salvei|commitei|executei|instalei|removi|deletei|apaguei)/gi,
  /(?:created|edited|saved|committed|executed|installed|removed|deleted)/gi,
  /(?:file\s+(?:was|has been)\s+(?:created|modified|saved|deleted))/gi,
  /(?:command\s+(?:was|has been)\s+executed)/gi,
];

// ─── Honesty Guard ───────────────────────────────────────

export class HonestyGuard {
  private executedToolCalls: Map<string, ToolCallRecord> = new Map();

  /**
   * Register a tool call that was actually executed.
   */
  onToolExecuted(toolCall: ToolCallRecord): void {
    this.executedToolCalls.set(toolCall.id, toolCall);
  }

  /**
   * Validate a response doesn't claim unexecuted actions.
   */
  validateResponse(response: string): ValidationResult {
    const claims = this.extractActionClaims(response);

    for (const claim of claims) {
      if (!this.hasMatchingToolCall(claim)) {
        return {
          valid: false,
          violation: `Agent afirmou "${claim.text}" sem tool call correspondente.`,
          claim,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Validate response according to mode-specific rules.
   */
  validateForMode(response: string, mode: Mode): ValidationResult {
    switch (mode) {
      case Mode.CHAT:
        // CHAT mode: cannot claim any side effects
        return this.validateNoSideEffects(response);

      case Mode.PLAN:
        // PLAN mode: cannot claim execution
        return this.validateNoExecution(response);

      case Mode.ACT:
      case Mode.AUTO:
        // ACT/AUTO: must have evidence for claimed actions
        return this.validateResponse(response);

      case Mode.RESEARCH:
        // RESEARCH: cannot claim side effects
        return this.validateNoSideEffects(response);

      default:
        return { valid: true };
    }
  }

  /**
   * Clear recorded tool calls (e.g., at task boundary).
   */
  clear(): void {
    this.executedToolCalls.clear();
  }

  /**
   * Get count of recorded tool calls.
   */
  getToolCallCount(): number {
    return this.executedToolCalls.size;
  }

  // ─── Private Methods ────────────────────────────────────

  /**
   * Extract action claims from response text.
   */
  extractActionClaims(text: string): ActionClaim[] {
    const claims: ActionClaim[] = [];

    for (const pattern of ACTION_PATTERNS) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        claims.push({ text: match[0], fullMatch: match });
      }
    }

    return claims;
  }

  /**
   * Check if there's a matching tool call for a claim.
   * Simple heuristic: any tool call registered counts as evidence.
   */
  private hasMatchingToolCall(claim: ActionClaim): boolean {
    if (this.executedToolCalls.size === 0) return false;
    
    const text = claim.text.toLowerCase();
    
    // Check for write claims
    const hasWrite = text.includes("edit") || 
                     text.includes("salv") || 
                     text.includes("criei") || 
                     text.includes("creat") ||
                     text.includes("remov") ||
                     text.includes("delet");
                     
    if (hasWrite) {
      return Array.from(this.executedToolCalls.values()).some(tc => 
        tc.name.includes("edit") || tc.name.includes("write") || tc.name.includes("agent")
      );
    }
    
    // Check for execution claims
    const hasExec = text.includes("execut") || text.includes("rodei") || text.includes("ran") || text.includes("test") || text.includes("build");
    
    if (hasExec) {
      return Array.from(this.executedToolCalls.values()).some(tc => 
        tc.name.includes("exec")
      );
    }

    // Baseline fallback if we can't categorize the claim
    return true;
  }

  /**
   * Validate that response doesn't contain side-effect claims.
   * Used for CHAT and RESEARCH modes.
   */
  private validateNoSideEffects(response: string): ValidationResult {
    for (const pattern of SIDE_EFFECT_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(response);
      if (match) {
        return {
          valid: false,
          violation: `Modo não permite afirmar side-effects: "${match[0]}". ` +
                     `Use modo ACT ou AUTO para executar ações.`,
          claim: { text: match[0], fullMatch: match },
        };
      }
    }
    return { valid: true };
  }

  /**
   * Validate that response doesn't claim execution.
   * Used for PLAN mode.
   */
  private validateNoExecution(response: string): ValidationResult {
    const executionPatterns: RegExp[] = [
      /(?:executei|rodei|apliquei)/gi,
      /(?:I\s+)?(?:executed|ran|applied)/gi,
    ];

    for (const pattern of executionPatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(response);
      if (match) {
        return {
          valid: false,
          violation: `Modo PLAN não permite afirmar execução: "${match[0]}". ` +
                     `PLAN apenas planeja, não executa.`,
          claim: { text: match[0], fullMatch: match },
        };
      }
    }
    return { valid: true };
  }
}
