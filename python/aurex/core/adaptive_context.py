"""
Adaptive Context Manager — 3-level memory system with token-based compaction.

Levels:
1. project_context — Static project info (from scanner, rules.md). Persists across session.
2. session_summary — LLM-summarized history of older interactions. Grows slowly.
3. working_memory — Recent messages. Auto-compacted when exceeding token budget.

Replaces the old message-count-based ContextManager with token-aware management.

Reference: Phase 2.1 — Adaptive Context Compaction
"""

import os
import json
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# Summarization prompt template
SUMMARIZE_PROMPT = (
    "Summarize the following conversation history concisely. Preserve:\n"
    "- All decisions taken and their rationale\n"
    "- Errors encountered and how they were resolved\n"
    "- Files modified and their current state\n"
    "- Remaining plan steps or open tasks\n"
    "- Key facts the user mentioned\n\n"
    "Be factual and brief. Do not add commentary.\n\n"
    "---\n"
)


def estimate_tokens(text: str) -> int:
    """Approximate token count: ~4 chars per token for English/code."""
    return max(1, len(text) // 4)


def estimate_messages_tokens(messages: List[Dict[str, Any]]) -> int:
    """Estimate total tokens across a list of messages."""
    total = 0
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            total += estimate_tokens(content)
        # Per-message overhead (~4 tokens for role + formatting)
        total += 4
    return total


class AdaptiveContextManager:
    """Token-aware 3-level context manager."""

    def __init__(
        self,
        llm_client=None,
        max_working_tokens: int = 8000,
        max_total_tokens: int = 32000,
        history_dir: Optional[str] = None,
    ):
        self.llm_client = llm_client
        self.max_working_tokens = max_working_tokens
        self.max_total_tokens = max_total_tokens

        # Level 1: Static project context (injected by scanner / rules.md)
        self.project_context: str = ""

        # Level 2: Compressed session summary (from older interactions)
        self.session_summary: str = ""

        # Level 3: Recent working memory (actual messages)
        self.working_memory: List[Dict[str, Any]] = []

        # Short-term execution trace (within a single agent run)
        self.current_execution_trace: List[Dict[str, Any]] = []

        # Disk persistence
        self.history_dir = history_dir or os.path.join(os.getcwd(), ".aurex")
        self.history_file = os.path.join(self.history_dir, "history.json")
        self.summary_file = os.path.join(self.history_dir, "session_summary.txt")

    # ─── Public API (compatible with old ContextManager) ──────

    async def add_to_long_term(self, interaction: Dict[str, Any]):
        """Add a message to working memory, auto-compacting if needed."""
        self.working_memory.append(interaction)
        await self._auto_compact()
        self.save_to_disk()

    def get_long_term_context(self) -> List[Dict[str, Any]]:
        """Build the full context for the LLM: project + summary + working memory."""
        return self.build_context()

    def build_context(self) -> List[Dict[str, Any]]:
        """Assemble all 3 levels into a message list for the LLM."""
        messages: List[Dict[str, Any]] = []

        # Level 1: Project context (as system message)
        if self.project_context:
            messages.append({
                "role": "system",
                "content": f"[Project Context]\n{self.project_context}",
            })

        # Level 2: Session summary (as system message)
        if self.session_summary:
            messages.append({
                "role": "system",
                "content": f"[Session Summary]\n{self.session_summary}",
            })

        # Level 3: Working memory (actual messages)
        messages.extend(self.working_memory)

        return messages

    def get_working_tokens(self) -> int:
        """Current token count of working memory."""
        return estimate_messages_tokens(self.working_memory)

    def get_total_tokens(self) -> int:
        """Total token estimate across all levels."""
        total = 0
        if self.project_context:
            total += estimate_tokens(self.project_context) + 4
        if self.session_summary:
            total += estimate_tokens(self.session_summary) + 4
        total += estimate_messages_tokens(self.working_memory)
        return total

    def set_project_context(self, context: str):
        """Set static project context (from scanner, rules.md, etc.)."""
        self.project_context = context

    # ─── Compaction ───────────────────────────────────────────

    async def _auto_compact(self):
        """Compact working memory when it exceeds the token budget."""
        current_tokens = self.get_working_tokens()
        if current_tokens <= self.max_working_tokens:
            return

        logger.info(
            f"Working memory ({current_tokens} tokens) exceeds limit "
            f"({self.max_working_tokens}). Compacting..."
        )
        await self.compact()

    async def compact(self):
        """Summarize the oldest 60% of working memory into session_summary."""
        if len(self.working_memory) < 4:
            return  # Too few messages to compact

        # Split: oldest 60% → to summarize, newest 40% → keep
        split_idx = int(len(self.working_memory) * 0.6)
        to_summarize = self.working_memory[:split_idx]
        to_keep = self.working_memory[split_idx:]

        # Build text to summarize
        summary_input = ""
        if self.session_summary:
            summary_input += f"Previous summary:\n{self.session_summary}\n\n"
        summary_input += "New interactions to integrate:\n"
        for msg in to_summarize:
            role = msg.get("role", "unknown").upper()
            content = msg.get("content", "")
            if isinstance(content, str):
                # Truncate very long messages in the summary input
                if len(content) > 2000:
                    content = content[:2000] + "... [truncated]"
                summary_input += f"[{role}]: {content}\n"

        new_summary = await self._generate_summary(summary_input)

        if new_summary:
            self.session_summary = new_summary
            self.working_memory = to_keep
            logger.info(
                f"Compacted {len(to_summarize)} messages. "
                f"Working memory: {self.get_working_tokens()} tokens."
            )
        else:
            # Fallback: simple truncation without LLM
            self.session_summary = (
                (self.session_summary + "\n" if self.session_summary else "")
                + f"[Compacted {len(to_summarize)} messages at this point]"
            )
            self.working_memory = to_keep

    async def _generate_summary(self, text: str) -> Optional[str]:
        """Use the LLM to generate a summary."""
        if not self.llm_client:
            return None

        try:
            response = await self.llm_client.chat(
                [
                    {"role": "system", "content": "You are a memory summarizer. Create brief, factual summaries."},
                    {"role": "user", "content": SUMMARIZE_PROMPT + text},
                ],
                temperature=0.1,
            )
            return response.strip() if isinstance(response, str) else str(response)
        except Exception as e:
            logger.warning(f"Summary generation failed: {e}")
            return None

    # ─── Short-term trace (within a single run) ──────────────

    def add_execution_step(self, step_info: Dict[str, Any]):
        self.current_execution_trace.append(step_info)

    def get_short_term_context(self) -> List[Dict[str, Any]]:
        return self.current_execution_trace

    def clear_short_term(self):
        self.current_execution_trace = []

    def get_full_context(self) -> Dict[str, Any]:
        return {
            "history": self.working_memory,
            "current_trace": self.current_execution_trace,
            "session_summary": self.session_summary,
            "project_context": self.project_context,
        }

    # ─── Persistence ─────────────────────────────────────────

    def save_to_disk(self):
        try:
            os.makedirs(self.history_dir, exist_ok=True)
            with open(self.history_file, "w", encoding="utf-8") as f:
                json.dump(self.working_memory, f, ensure_ascii=False, indent=2)
            if self.session_summary:
                with open(self.summary_file, "w", encoding="utf-8") as f:
                    f.write(self.session_summary)
        except Exception as e:
            logger.error(f"Failed to save context: {e}")

    def load_from_disk(self) -> bool:
        try:
            if os.path.exists(self.history_file):
                with open(self.history_file, "r", encoding="utf-8") as f:
                    self.working_memory = json.load(f)
            if os.path.exists(self.summary_file):
                with open(self.summary_file, "r", encoding="utf-8") as f:
                    self.session_summary = f.read()
            return True
        except Exception as e:
            logger.error(f"Failed to load context: {e}")
        return False

    def clear_history(self):
        self.working_memory = []
        self.session_summary = ""
        self.current_execution_trace = []
        for fpath in [self.history_file, self.summary_file]:
            if os.path.exists(fpath):
                try:
                    os.remove(fpath)
                except Exception:
                    pass

    def undo_last_interaction(self) -> int:
        removed = 0
        if self.working_memory and self.working_memory[-1].get("role") == "assistant":
            self.working_memory.pop()
            removed += 1
        if self.working_memory and self.working_memory[-1].get("role") == "user":
            self.working_memory.pop()
            removed += 1
        self.save_to_disk()
        return removed

    # Alias for backwards compatibility
    @property
    def long_term_memory(self) -> List[Dict[str, Any]]:
        return self.working_memory

    @long_term_memory.setter
    def long_term_memory(self, value: List[Dict[str, Any]]):
        self.working_memory = value
