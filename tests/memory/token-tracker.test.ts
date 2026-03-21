import { TokenTracker } from "../../src/memory/token-tracker.js";

describe("TokenTracker", () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    tracker = new TokenTracker(100_000);
  });

  test("starts with zero consumption", () => {
    const summary = tracker.getSummary();
    expect(summary.consumed.total).toBe(0);
    expect(summary.remaining).toBe(100_000);
    expect(summary.overBudget).toBe(false);
  });

  test("records token usage", () => {
    tracker.record({ prompt_tokens: 1000, completion_tokens: 500 });
    const summary = tracker.getSummary();
    expect(summary.consumed.prompt).toBe(1000);
    expect(summary.consumed.completion).toBe(500);
    expect(summary.consumed.total).toBe(1500);
    expect(summary.remaining).toBe(98500);
  });

  test("accumulates across multiple calls", () => {
    tracker.record({ prompt_tokens: 1000, completion_tokens: 500 });
    tracker.record({ prompt_tokens: 2000, completion_tokens: 1000 });
    expect(tracker.getSummary().consumed.total).toBe(4500);
    expect(tracker.getCallCount()).toBe(2);
  });

  test("detects over budget", () => {
    tracker = new TokenTracker(1000);
    tracker.record({ prompt_tokens: 800, completion_tokens: 300 });
    expect(tracker.isOverBudget()).toBe(true);
    expect(tracker.getRemaining()).toBe(0);
  });

  test("provides cost estimate for Claude", () => {
    tracker.record({ prompt_tokens: 10000, completion_tokens: 5000 });
    const cost = tracker.getCostEstimate("claude-sonnet-4-20250514");
    expect(cost).toBeGreaterThan(0);
    // Prompt: 10000/1000 * 0.003 = 0.03
    // Completion: 5000/1000 * 0.015 = 0.075
    expect(cost).toBeCloseTo(0.105, 2);
  });

  test("provides cost estimate for deepseek", () => {
    tracker.record({ prompt_tokens: 10000, completion_tokens: 5000 });
    const cost = tracker.getCostEstimate("deepseek-chat");
    expect(cost).toBeLessThan(0.01); // very cheap
  });

  test("reset clears all data", () => {
    tracker.record({ prompt_tokens: 5000, completion_tokens: 2000 });
    tracker.reset();
    expect(tracker.getSummary().consumed.total).toBe(0);
    expect(tracker.getCallCount()).toBe(0);
  });
});
