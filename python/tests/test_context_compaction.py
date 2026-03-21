"""
Tests for AdaptiveContextManager — token estimation, compaction, 3-level build.
"""

import os
import pytest
from unittest.mock import AsyncMock, MagicMock

from aurex.core.adaptive_context import (
    AdaptiveContextManager,
    estimate_tokens,
    estimate_messages_tokens,
)


class TestTokenEstimation:
    def test_estimate_tokens_basic(self):
        assert estimate_tokens("hello world") == max(1, len("hello world") // 4)

    def test_estimate_tokens_empty(self):
        assert estimate_tokens("") == 1  # minimum 1

    def test_estimate_tokens_code(self):
        code = "function add(a: number, b: number): number { return a + b; }"
        tokens = estimate_tokens(code)
        assert tokens > 10

    def test_estimate_messages_tokens(self):
        messages = [
            {"role": "user", "content": "Hello " * 100},
            {"role": "assistant", "content": "World " * 100},
        ]
        tokens = estimate_messages_tokens(messages)
        # 600 chars each / 4 = 150 tokens each + 4 overhead each = ~308
        assert tokens > 200


class TestBuildContext:
    def test_empty_context(self):
        ctx = AdaptiveContextManager()
        messages = ctx.build_context()
        assert messages == []

    def test_project_context_injected(self):
        ctx = AdaptiveContextManager()
        ctx.set_project_context("Node.js + TypeScript project")
        messages = ctx.build_context()
        assert len(messages) == 1
        assert messages[0]["role"] == "system"
        assert "Node.js" in messages[0]["content"]

    def test_three_levels(self):
        ctx = AdaptiveContextManager()
        ctx.set_project_context("Project info")
        ctx.session_summary = "User asked to fix auth bug"
        ctx.working_memory = [
            {"role": "user", "content": "Fix the login"},
            {"role": "assistant", "content": "Done."},
        ]
        messages = ctx.build_context()
        assert len(messages) == 4  # project + summary + 2 working
        assert messages[0]["role"] == "system"
        assert "Project" in messages[0]["content"]
        assert messages[1]["role"] == "system"
        assert "Summary" in messages[1]["content"]
        assert messages[2]["role"] == "user"


class TestCompaction:
    @pytest.mark.asyncio
    async def test_compact_without_llm(self):
        ctx = AdaptiveContextManager(max_working_tokens=100)
        # Add enough messages to exceed token budget
        for i in range(10):
            ctx.working_memory.append({"role": "user", "content": f"Message {i} " * 20})

        original_count = len(ctx.working_memory)
        await ctx.compact()

        # Should have fewer messages now
        assert len(ctx.working_memory) < original_count
        # Summary should exist (fallback without LLM)
        assert "Compacted" in ctx.session_summary

    @pytest.mark.asyncio
    async def test_compact_with_llm(self):
        mock_llm = AsyncMock()
        mock_llm.chat = AsyncMock(return_value="User discussed authentication fixes and API changes.")

        ctx = AdaptiveContextManager(llm_client=mock_llm, max_working_tokens=100)
        for i in range(10):
            ctx.working_memory.append({"role": "user", "content": f"Message {i} " * 20})

        await ctx.compact()
        assert "authentication" in ctx.session_summary
        assert len(ctx.working_memory) < 10

    @pytest.mark.asyncio
    async def test_auto_compact_triggers(self):
        ctx = AdaptiveContextManager(max_working_tokens=50)
        # Add a message that will push over the limit
        for i in range(5):
            await ctx.add_to_long_term({"role": "user", "content": "x" * 200})

        # Should have been auto-compacted (keeps 40% of messages each round, no LLM summary)
        assert len(ctx.working_memory) < 5  # fewer messages than added
        assert ctx.session_summary != ""  # compaction happened

    @pytest.mark.asyncio
    async def test_no_compact_under_limit(self):
        ctx = AdaptiveContextManager(max_working_tokens=10000)
        await ctx.add_to_long_term({"role": "user", "content": "short"})
        assert len(ctx.working_memory) == 1
        assert ctx.session_summary == ""


class TestPersistence:
    @pytest.mark.asyncio
    async def test_save_and_load(self, tmp_path):
        ctx1 = AdaptiveContextManager(history_dir=str(tmp_path))
        ctx1.working_memory = [{"role": "user", "content": "hello"}]
        ctx1.session_summary = "Test summary"
        ctx1.save_to_disk()

        ctx2 = AdaptiveContextManager(history_dir=str(tmp_path))
        assert ctx2.load_from_disk() is True
        assert len(ctx2.working_memory) == 1
        assert ctx2.session_summary == "Test summary"

    def test_clear_history(self, tmp_path):
        ctx = AdaptiveContextManager(history_dir=str(tmp_path))
        ctx.working_memory = [{"role": "user", "content": "hello"}]
        ctx.session_summary = "summary"
        ctx.save_to_disk()

        ctx.clear_history()
        assert ctx.working_memory == []
        assert ctx.session_summary == ""
        assert not os.path.exists(ctx.history_file)


class TestBackwardsCompatibility:
    def test_long_term_memory_alias(self):
        ctx = AdaptiveContextManager()
        ctx.working_memory = [{"role": "user", "content": "test"}]
        assert ctx.long_term_memory == ctx.working_memory

    def test_get_long_term_context(self):
        ctx = AdaptiveContextManager()
        ctx.working_memory = [{"role": "user", "content": "test"}]
        result = ctx.get_long_term_context()
        assert len(result) == 1

    def test_undo_last_interaction(self):
        ctx = AdaptiveContextManager()
        ctx.working_memory = [
            {"role": "user", "content": "do something"},
            {"role": "assistant", "content": "done"},
        ]
        removed = ctx.undo_last_interaction()
        assert removed == 2
        assert len(ctx.working_memory) == 0
