"""
Context Manager: Handles two levels of memory.
1. Short-term context: Tracks current execution trace, steps, and tool call results.
2. Long-term memory: General conversation history, with limits and summarization logic.
"""

from typing import List, Dict, Any
import logging
import os
import json

logger = logging.getLogger(__name__)

class ContextManager:
    def __init__(self, max_history: int = 20, llm_client=None):
        self.max_history = max_history
        self.llm_client = llm_client
        # Long-term memory: stores past high-level interactions and summarized context
        self.long_term_memory: List[Dict[str, Any]] = []
        # Short-term memory: stores detailed trace of the current execution loop
        self.current_execution_trace: List[Dict[str, Any]] = []
        
        # Disk persistence
        self.history_dir = os.path.join(os.getcwd(), ".aurex")
        self.history_file = os.path.join(self.history_dir, "history.json")

    def save_to_disk(self):
        """Persiste o histórico longo no disco."""
        try:
            os.makedirs(self.history_dir, exist_ok=True)
            with open(self.history_file, 'w', encoding='utf-8') as f:
                json.dump(self.long_term_memory, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save history: {e}")

    def load_from_disk(self):
        """Restaura o histórico longo do disco."""
        try:
            if os.path.exists(self.history_file):
                with open(self.history_file, 'r', encoding='utf-8') as f:
                    self.long_term_memory = json.load(f)
                    return True
        except Exception as e:
            logger.error(f"Failed to load history: {e}")
        return False

    def clear_history(self):
        """Limpa a memória atual e deleta o arquivo."""
        self.long_term_memory = []
        self.current_execution_trace = []
        if os.path.exists(self.history_file):
            try:
                os.remove(self.history_file)
            except Exception:
                pass

    def clear_short_term(self):
        """Clears the short-term execution trace."""
        self.current_execution_trace = []

    def undo_last_interaction(self) -> int:
        """Removes the last user-assistant interaction pair from history."""
        # A completed loop normally adds a 'user' then an 'assistant' output. We pop up to 2 items.
        removed = 0
        if len(self.long_term_memory) > 0:
            # Drop the last assistant node
            if self.long_term_memory[-1].get("role") == "assistant":
                self.long_term_memory.pop()
                removed += 1
            # Drop the preceding user node
            if len(self.long_term_memory) > 0 and self.long_term_memory[-1].get("role") == "user":
                self.long_term_memory.pop()
                removed += 1
        self.save_to_disk()
        return removed

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
        self.save_to_disk()

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
                    prompt = "Summarize the following interaction history concisely while retaining key facts and context:\n"
                    for msg in to_summarize:
                        prompt += f"[{msg['role'].upper()}]: {msg['content']}\n"
                    
                    response = await self.llm_client.chat([
                        {"role": "system", "content": "You are a memory summarizer. Create brief, factual summaries of chat logs."},
                        {"role": "user", "content": prompt}
                    ], temperature=0.1)
                    summary_content = f"Semantic Summary: {response.strip()}"
                    
                    summary_entry = {
                        "role": "system", 
                        "content": f"[System: {summary_content}]"
                    }
                    self.long_term_memory = old_context + [summary_entry] + recent_context
                except Exception as e:
                    logger.warning(f"Failed to generate semantic summary due to LLM error: {e}. Keeping original context without truncation.")
                    return
            else:
                summary_content = f"Summarized {len(to_summarize)} intermediate messages (No LLM client attached)."
                summary_entry = {
                    "role": "system", 
                    "content": f"[System: {summary_content}]"
                }
                self.long_term_memory = old_context + [summary_entry] + recent_context
                
            self.save_to_disk()
