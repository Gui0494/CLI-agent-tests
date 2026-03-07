"""
Context Manager: Handles two levels of memory.
1. Short-term context: Tracks current execution trace, steps, and tool call results.
2. Long-term memory: General conversation history, with limits and summarization logic.
"""

from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)

class ContextManager:
    def __init__(self, max_history: int = 20, llm_client=None):
        self.max_history = max_history
        self.llm_client = llm_client
        # Long-term memory: stores past high-level interactions and summarized context
        self.long_term_memory: List[Dict[str, Any]] = []
        # Short-term memory: stores detailed trace of the current execution loop
        self.current_execution_trace: List[Dict[str, Any]] = []

    def clear_short_term(self):
        """Clears the short-term execution trace."""
        self.current_execution_trace = []

    def add_execution_step(self, step_info: Dict[str, Any]):
        """Records a step in the current execution (e.g., tool called, result obtained)."""
        self.current_execution_trace.append(step_info)

    def get_short_term_context(self) -> List[Dict[str, Any]]:
        """Returns the trace of the current execution."""
        return self.current_execution_trace

    async def add_to_long_term(self, interaction: Dict[str, Any]):
        """Adds to long-term memory, summarizing if history exceeds max_history."""
        self.long_term_memory.append(interaction)
        await self._enforce_history_limit()

    def get_long_term_context(self) -> List[Dict[str, Any]]:
        """Returns the persistent long-term memory."""
        return self.long_term_memory

    def get_full_context(self) -> Dict[str, Any]:
        """Returns a combined view of the current state."""
        return {
            "history": self.long_term_memory,
            "current_trace": self.current_execution_trace
        }

    async def _enforce_history_limit(self):
        """Semantic summarization logic when history gets too long."""
        if len(self.long_term_memory) > self.max_history:
            # We preserve the oldest 2 as 'context' and keep the most recent N
            old_context = self.long_term_memory[:2]
            recent_count = max(0, self.max_history - 3)
            recent_context = self.long_term_memory[-recent_count:] if recent_count > 0 else []
            
            # Messages to summarize
            to_summarize = self.long_term_memory[2:-recent_count] if recent_count > 0 else self.long_term_memory[2:]
            
            summary_content = ""
            if self.llm_client and to_summarize:
                try:
                    prompt = "Summarize the following interaction history concisely while retaining key facts and context:\\n"
                    for msg in to_summarize:
                        prompt += f"[{msg['role'].upper()}]: {msg['content']}\\n"
                    
                    response = await self.llm_client.chat([
                        {"role": "system", "content": "You are a memory summarizer. Create brief, factual summaries of chat logs."},
                        {"role": "user", "content": prompt}
                    ], temperature=0.1)
                    summary_content = f"Semantic Summary: {response.strip()}"
                except Exception as e:
                    logger.warning(f"Failed to generate semantic summary: {e}")
                    summary_content = f"Summarized {len(to_summarize)} intermediate messages (LLM summarization failed)."
            else:
                summary_content = f"Summarized {len(to_summarize)} intermediate messages (No LLM client attached)."
            
            summary_entry = {
                "role": "system", 
                "content": f"[System: {summary_content}]"
            }
            
            self.long_term_memory = old_context + [summary_entry] + recent_context
