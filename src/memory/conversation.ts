/**
 * conversation.ts — Conversation store with compression
 *
 * This is the **canonical source of truth** for the current session's messages.
 * The Python-side ContextManager handles only disk persistence for cross-session
 * continuity and execution trace for the current agent loop.
 *
 * Reference: docs/architecture-reference/specs/memory.md §3 ConversationStore
 */

import { Mode } from "../agent/modes.js";

// ─── Interfaces ──────────────────────────────────────────

function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.match(/\b\w+\b/g)?.length || 0;
  const symbols = text.match(/[^\w\s]/g)?.length || 0;
  // Words ~1.33 tokens, symbols ~1 token
  const estimate = Math.ceil(words * 1.33 + symbols);
  const lengthFallback = Math.ceil(text.length / 3.5);
  return Math.max(estimate, lengthFallback);
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  metadata: {
    mode: Mode;
    toolCalls?: ToolCall[];
    tokenCount: number;
  };
}

export interface ConversationConfig {
  maxMessages: number;       // before forcing compression
  maxTokens: number;         // total tokens allowed
  compressionThresholds: {
    toolResultPrune: number;   // 70% → prune old tool results
    messageSummarize: number;  // 80% → summarize old messages
    conversationTruncate: number; // 95% → truncate
  };
}

const DEFAULT_CONFIG: ConversationConfig = {
  maxMessages: 200,
  maxTokens: 128_000,
  compressionThresholds: {
    toolResultPrune: 0.7,
    messageSummarize: 0.8,
    conversationTruncate: 0.95,
  },
};

// ─── Conversation Store ──────────────────────────────────

export class ConversationStore {
  private messages: Message[] = [];
  private totalTokens: number = 0;
  private config: ConversationConfig;

  constructor(config?: Partial<ConversationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a message to the conversation.
   */
  add(message: Message): void {
    this.messages.push(message);
    this.totalTokens += message.metadata.tokenCount;

    // Auto-compress if needed
    this.autoCompress();
  }

  /**
   * Create and add a message from components.
   */
  addMessage(
    role: 'user' | 'assistant' | 'tool',
    content: string,
    mode: Mode,
    toolCalls?: ToolCall[]
  ): Message {
    const msg: Message = {
      role,
      content,
      timestamp: Date.now(),
      metadata: {
        mode,
        toolCalls,
        tokenCount: estimateTokens(content),
      },
    };
    this.add(msg);
    return msg;
  }

  /**
   * Get the N most recent messages.
   */
  getRecent(n: number): Message[] {
    return this.messages.slice(-n);
  }

  /**
   * Get all messages.
   */
  getAll(): Message[] {
    return [...this.messages];
  }

  /**
   * Get total token count.
   */
  getTotalTokens(): number {
    return this.totalTokens;
  }

  /**
   * Get message count.
   */
  getMessageCount(): number {
    return this.messages.length;
  }

  /**
   * Get token utilization as percentage.
   */
  getUtilization(): number {
    return this.totalTokens / this.config.maxTokens;
  }

  /**
   * Clear all messages.
   */
  clear(): void {
    this.messages = [];
    this.totalTokens = 0;
  }

  /**
   * Export messages in a format suitable for syncing to the Python ContextManager.
   * Used by the bridge to keep both runtimes in sync.
   */
  getStateForSync(): Array<{ role: string; content: string }> {
    return this.messages.map(m => ({ role: m.role, content: m.content }));
  }

  /**
   * Manual compression trigger.
   */
  compress(): { pruned: number; summarized: number; truncated: number } {
    let pruned = 0;
    let summarized = 0;
    let truncated = 0;

    // Stage 1: Prune old tool results
    pruned = this.pruneToolResults(5);

    // Stage 2: Summarize old messages (collapse sequences)
    if (this.getUtilization() > this.config.compressionThresholds.messageSummarize) {
      summarized = this.summarizeOldMessages();
    }

    // Stage 3: Truncate if still over
    if (this.getUtilization() > this.config.compressionThresholds.conversationTruncate) {
      truncated = this.truncate(50);
    }

    return { pruned, summarized, truncated };
  }

  // ─── Private ───────────────────────────────────────────

  private autoCompress(): void {
    const utilization = this.getUtilization();
    const thresholds = this.config.compressionThresholds;

    if (utilization > thresholds.conversationTruncate) {
      this.truncate(50);
    } else if (utilization > thresholds.messageSummarize) {
      this.summarizeOldMessages();
    } else if (utilization > thresholds.toolResultPrune) {
      this.pruneToolResults(5);
    } else if (this.messages.length > this.config.maxMessages) {
      this.pruneToolResults(10);
    }
  }

  /**
   * Remove tool results from messages older than the last N tool messages.
   */
  private pruneToolResults(keep: number): number {
    let pruned = 0;
    const toolMessages = this.messages
      .map((m, i) => ({ msg: m, index: i }))
      .filter(x => x.msg.role === 'tool')
      .reverse();

    for (let i = keep; i < toolMessages.length; i++) {
      const entry = toolMessages[i];
      const oldLen = entry.msg.content.length;
      entry.msg.content = `[pruned: ${oldLen} chars]`;
      const newTokens = estimateTokens(entry.msg.content);
      const diff = entry.msg.metadata.tokenCount - newTokens;
      entry.msg.metadata.tokenCount = newTokens;
      this.totalTokens -= diff;
      pruned++;
    }
    return pruned;
  }

  /**
   * Collapse old message sequences into summaries.
   * Keeps the 30 most recent messages intact.
   */
  private summarizeOldMessages(): number {
    if (this.messages.length <= 30) return 0;

    const keepRecent = 30;
    const oldMessages = this.messages.slice(0, -keepRecent);
    const recentMessages = this.messages.slice(-keepRecent);

    // Collapse old messages into a summary message
    const summaryContent = `[Conversa anterior: ${oldMessages.length} mensagens comprimidas]`;
    const summaryMsg: Message = {
      role: 'assistant',
      content: summaryContent,
      timestamp: oldMessages[0]?.timestamp || Date.now(),
      metadata: {
        mode: Mode.CHAT,
        tokenCount: estimateTokens(summaryContent),
      },
    };

    const removedTokens = oldMessages.reduce((sum, m) => sum + m.metadata.tokenCount, 0);
    this.totalTokens -= removedTokens;
    this.totalTokens += summaryMsg.metadata.tokenCount;

    this.messages = [summaryMsg, ...recentMessages];
    return oldMessages.length;
  }

  /**
   * Truncate to keep only the most recent N messages.
   */
  private truncate(keep: number): number {
    if (this.messages.length <= keep) return 0;

    const removed = this.messages.splice(0, this.messages.length - keep);
    const removedTokens = removed.reduce((sum, m) => sum + m.metadata.tokenCount, 0);
    this.totalTokens -= removedTokens;
    return removed.length;
  }
}
