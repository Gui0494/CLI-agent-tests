"""Tests for LLM integration (mocked API calls)."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from aurex.llm.router import OpenRouterClient
from aurex.llm.planner import TaskPlanner
from aurex.ratelimit.limiter import RateLimiter


@pytest.fixture
def llm():
    limiter = RateLimiter()
    client = OpenRouterClient(rate_limiter=limiter)
    client.api_key = "test-key"
    return client


@pytest.mark.asyncio
async def test_chat_memory(llm: OpenRouterClient):
    """Test that conversation memory is maintained."""
    mock_response = {
        "choices": [{"message": {"content": "Hello! How can I help?"}}]
    }

    with patch("aurex.llm.router.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_response_obj = MagicMock()
        mock_response_obj.json.return_value = mock_response
        mock_response_obj.raise_for_status = MagicMock()
        mock_client.post = AsyncMock(return_value=mock_response_obj)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_cls.return_value = mock_client

        result = await llm.chat([{"role": "user", "content": "Hi"}])
        assert result == "Hello! How can I help?"
        assert len(llm.memory) == 2  # user + assistant


@pytest.mark.asyncio
async def test_planner():
    """Test task planner generates a plan."""
    mock_llm = AsyncMock(spec=OpenRouterClient)
    mock_llm.chat = AsyncMock(return_value="## Plan\n1. Step one\n2. Step two")

    planner = TaskPlanner(llm=mock_llm)
    plan = await planner.create_plan("Build a REST API")

    assert "Plan" in plan
    assert "Step one" in plan
