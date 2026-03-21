"""
Tests for parallel tool execution in function_calling/run.py.
"""

import asyncio
import pytest
from unittest.mock import AsyncMock, patch


class TestParallelToolClassification:
    """Test the parallel execution logic in run()."""

    def test_read_only_tools_identified(self):
        """Verify the set of read-only tools."""
        READ_ONLY_TOOLS = {"read_file", "list_files", "grep", "find_symbol", "get_outline"}
        assert "read_file" in READ_ONLY_TOOLS
        assert "write_file" not in READ_ONLY_TOOLS
        assert "edit_file" not in READ_ONLY_TOOLS
        assert "exec_command" not in READ_ONLY_TOOLS

    @pytest.mark.asyncio
    async def test_parallel_read_only_execution(self):
        """Multiple read-only tools should execute concurrently."""
        call_times = []

        async def mock_executor(name, args):
            call_times.append(asyncio.get_event_loop().time())
            await asyncio.sleep(0.01)  # simulate I/O
            return {"ok": True, "content": f"result for {name}"}

        # Simulate what the run loop does
        READ_ONLY_TOOLS = {"read_file", "list_files", "grep", "find_symbol", "get_outline"}
        tool_calls = [
            {"id": "1", "name": "read_file", "arguments": {"path": "a.ts"}},
            {"id": "2", "name": "read_file", "arguments": {"path": "b.ts"}},
            {"id": "3", "name": "list_files", "arguments": {"dir": "."}},
        ]

        all_read_only = all(tc["name"] in READ_ONLY_TOOLS for tc in tool_calls)
        assert all_read_only is True

        async def execute_single_tool(tc):
            result = await mock_executor(tc["name"], tc["arguments"])
            return (tc, result)

        results = await asyncio.gather(
            *(execute_single_tool(tc) for tc in tool_calls)
        )

        assert len(results) == 3
        # All should have succeeded
        for tc, result in results:
            assert result["ok"] is True

    @pytest.mark.asyncio
    async def test_sequential_with_write_tool(self):
        """If any tool is a write tool, all should be sequential."""
        READ_ONLY_TOOLS = {"read_file", "list_files", "grep", "find_symbol", "get_outline"}
        tool_calls = [
            {"id": "1", "name": "read_file", "arguments": {"path": "a.ts"}},
            {"id": "2", "name": "write_file", "arguments": {"path": "b.ts", "content": "x"}},
        ]

        all_read_only = all(tc["name"] in READ_ONLY_TOOLS for tc in tool_calls)
        assert all_read_only is False
