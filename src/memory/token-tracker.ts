/**
 * token-tracker.ts — Token budget management for AurexAI CLI Agent.
 *
 * Tracks prompt/completion token usage across LLM calls, provides
 * budget remaining and rough cost estimates.
 *
 * Reference: Phase 3.3 — Token Budget Management
 */

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface TokenBudgetSummary {
  budget: number;
  consumed: { prompt: number; completion: number; total: number };
  remaining: number;
  overBudget: boolean;
  costEstimateUsd: number;
}

// Rough per-token pricing (USD per 1K tokens) by model family
const COST_PER_1K: Record<string, { prompt: number; completion: number }> = {
  "claude": { prompt: 0.003, completion: 0.015 },
  "gpt-4": { prompt: 0.03, completion: 0.06 },
  "gpt-3.5": { prompt: 0.0005, completion: 0.0015 },
  "deepseek": { prompt: 0.00014, completion: 0.00028 },
  "llama": { prompt: 0.0, completion: 0.0 }, // free tier on openrouter
  "default": { prompt: 0.001, completion: 0.002 },
};

function getCostTier(model: string): { prompt: number; completion: number } {
  const lower = model.toLowerCase();
  for (const [key, cost] of Object.entries(COST_PER_1K)) {
    if (key !== "default" && lower.includes(key)) return cost;
  }
  return COST_PER_1K["default"];
}

export class TokenTracker {
  private budget: number;
  private consumed = { prompt: 0, completion: 0, total: 0 };
  private callCount = 0;

  constructor(budget: number = 500_000) {
    this.budget = budget;
  }

  record(usage: TokenUsage): void {
    this.consumed.prompt += usage.prompt_tokens;
    this.consumed.completion += usage.completion_tokens;
    this.consumed.total += usage.prompt_tokens + usage.completion_tokens;
    this.callCount++;
  }

  getRemaining(): number {
    return Math.max(0, this.budget - this.consumed.total);
  }

  isOverBudget(): boolean {
    return this.consumed.total > this.budget;
  }

  getCostEstimate(model: string = "default"): number {
    const tier = getCostTier(model);
    return (
      (this.consumed.prompt / 1000) * tier.prompt +
      (this.consumed.completion / 1000) * tier.completion
    );
  }

  getCallCount(): number {
    return this.callCount;
  }

  getSummary(model: string = "default"): TokenBudgetSummary {
    return {
      budget: this.budget,
      consumed: { ...this.consumed },
      remaining: this.getRemaining(),
      overBudget: this.isOverBudget(),
      costEstimateUsd: this.getCostEstimate(model),
    };
  }

  reset(): void {
    this.consumed = { prompt: 0, completion: 0, total: 0 };
    this.callCount = 0;
  }
}
