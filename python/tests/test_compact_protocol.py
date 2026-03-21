"""
Tests for CompactProtocol — smart summarization with preserved critical info.
"""

import pytest
from unittest.mock import AsyncMock

from aurex.core.compact_protocol import CompactProtocol, extract_preserved_lines


class TestExtractPreservedLines:
    def test_preserves_error_lines(self):
        text = "Normal line\nError: something failed\nAnother normal line"
        preserved = extract_preserved_lines(text)
        assert any("Error: something failed" in line for line in preserved)

    def test_preserves_decision_lines(self):
        text = "decision: use PostgreSQL instead of SQLite\nsome other content"
        preserved = extract_preserved_lines(text)
        assert any("PostgreSQL" in line for line in preserved)

    def test_preserves_file_modification_lines(self):
        text = "modified src/auth.ts to fix login\nRegular content"
        preserved = extract_preserved_lines(text)
        assert any("auth.ts" in line for line in preserved)

    def test_redacts_credentials(self):
        text = "api_key: sk-abc123456789012345"
        preserved = extract_preserved_lines(text)
        assert any("REDACTED" in line for line in preserved)

    def test_empty_text(self):
        assert extract_preserved_lines("") == []

    def test_preserves_todo_fixme(self):
        text = "TODO: implement caching\nFIXME: race condition in worker"
        preserved = extract_preserved_lines(text)
        assert len(preserved) == 2


class TestCompactProtocol:
    @pytest.mark.asyncio
    async def test_summarize_without_llm(self):
        protocol = CompactProtocol()
        messages = [
            {"role": "user", "content": "Fix the Error: connection timeout in auth.ts"},
            {"role": "assistant", "content": "I modified src/auth.ts to add retry logic"},
        ]
        summary = await protocol.summarize(messages)
        # Should contain preserved lines
        assert "Error" in summary or "modified" in summary or "Compacted" in summary

    @pytest.mark.asyncio
    async def test_summarize_with_llm(self):
        mock_llm = AsyncMock()
        mock_llm.chat = AsyncMock(return_value="User fixed auth timeout by adding retry logic.")

        protocol = CompactProtocol()
        messages = [
            {"role": "user", "content": "Fix the timeout"},
            {"role": "assistant", "content": "Done, added retry logic"},
        ]
        summary = await protocol.summarize(messages, llm_client=mock_llm)
        assert "retry" in summary

    @pytest.mark.asyncio
    async def test_summarize_empty_messages(self):
        protocol = CompactProtocol()
        summary = await protocol.summarize([])
        assert "Compacted" in summary

    @pytest.mark.asyncio
    async def test_max_preserved_lines(self):
        protocol = CompactProtocol(max_preserved_lines=2)
        messages = [
            {"role": "user", "content": "Error 1\nError 2\nError 3\nError 4"},
        ]
        summary = await protocol.summarize(messages)
        # Should not have more than 2 preserved lines
        preserved_count = summary.count("- Error")
        assert preserved_count <= 2
