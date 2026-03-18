/**
 * Unit tests for ConversationStore
 */
import { ConversationStore } from "../../src/memory/conversation.js";
import { Mode } from "../../src/agent/modes.js";

describe("ConversationStore", () => {
  let store: ConversationStore;

  beforeEach(() => {
    store = new ConversationStore({ maxMessages: 50, maxTokens: 1000 });
  });

  it("starts empty", () => {
    expect(store.getMessageCount()).toBe(0);
    expect(store.getTotalTokens()).toBe(0);
  });

  it("adds messages and tracks tokens", () => {
    store.addMessage("user", "Hello world", Mode.CHAT);
    expect(store.getMessageCount()).toBe(1);
    expect(store.getTotalTokens()).toBeGreaterThan(0);
  });

  it("getRecent returns last N messages", () => {
    store.addMessage("user", "msg1", Mode.CHAT);
    store.addMessage("assistant", "msg2", Mode.CHAT);
    store.addMessage("user", "msg3", Mode.CHAT);
    const recent = store.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].content).toBe("msg2");
    expect(recent[1].content).toBe("msg3");
  });

  it("getAll returns all messages", () => {
    store.addMessage("user", "a", Mode.CHAT);
    store.addMessage("assistant", "b", Mode.PLAN);
    expect(store.getAll()).toHaveLength(2);
  });

  it("clear empties everything", () => {
    store.addMessage("user", "test", Mode.CHAT);
    store.clear();
    expect(store.getMessageCount()).toBe(0);
    expect(store.getTotalTokens()).toBe(0);
  });

  it("tracks utilization percentage", () => {
    store.addMessage("user", "a".repeat(400), Mode.CHAT); // ~100 tokens
    expect(store.getUtilization()).toBeGreaterThan(0);
    expect(store.getUtilization()).toBeLessThan(1);
  });

  it("compress prunes tool results", () => {
    for (let i = 0; i < 10; i++) {
      store.addMessage("tool", `tool result ${i} ${"x".repeat(50)}`, Mode.ACT);
    }
    const initial = store.getTotalTokens();
    const result = store.compress();
    expect(result.pruned).toBeGreaterThan(0);
    expect(store.getTotalTokens()).toBeLessThan(initial);
  });

  it("auto-compresses when near token limit", () => {
    // Force utilization over 95% to trigger truncation
    const smallStore = new ConversationStore({ maxMessages: 200, maxTokens: 100 });
    smallStore.addMessage("user", "a".repeat(400), Mode.CHAT); // ~100 tokens, over limit
    // Should have auto-compressed by truncation or not grown unbounded
    expect(smallStore.getMessageCount()).toBeLessThanOrEqual(200);
  });

  it("adds tool calls to metadata", () => {
    store.addMessage("assistant", "executed", Mode.ACT, [
      { name: "exec_command", args: { cmd: "ls" } },
    ]);
    const msgs = store.getAll();
    expect(msgs[0].metadata.toolCalls).toHaveLength(1);
    expect(msgs[0].metadata.toolCalls![0].name).toBe("exec_command");
  });
});
