"""
Tests for ProviderRouter — provider abstraction with fallback chain.
"""

import pytest
from unittest.mock import AsyncMock, patch

from aurex.llm.provider_router import ProviderRouter, PROVIDERS


class TestProviderRouter:
    @pytest.mark.asyncio
    async def test_call_primary_provider(self):
        router = ProviderRouter(primary="openrouter")
        mock_response = {
            "text": "Hello",
            "tool_calls": [],
            "has_tool_calls": False,
            "stop_reason": "end_turn",
        }

        with patch("aurex.skills.function_calling.run.call_openrouter", new_callable=AsyncMock) as mock_call:
            mock_call.return_value = mock_response
            result = await router.call(
                messages=[{"role": "user", "content": "hi"}],
                tools=[],
            )
            assert result["text"] == "Hello"
            assert result["provider_used"] == "openrouter"
            mock_call.assert_called_once()

    @pytest.mark.asyncio
    async def test_fallback_on_primary_failure(self):
        router = ProviderRouter(primary="anthropic", fallback_order=["deepseek"])

        mock_response = {
            "text": "Fallback response",
            "tool_calls": [],
            "has_tool_calls": False,
            "stop_reason": "end_turn",
        }

        with patch("aurex.skills.function_calling.run.call_anthropic", new_callable=AsyncMock) as mock_anthropic, \
             patch("aurex.skills.function_calling.run.call_deepseek", new_callable=AsyncMock) as mock_deepseek:
            mock_anthropic.side_effect = Exception("API key invalid")
            mock_deepseek.return_value = mock_response

            result = await router.call(
                messages=[{"role": "user", "content": "hi"}],
                tools=[],
            )
            assert result["provider_used"] == "deepseek"
            assert result["text"] == "Fallback response"

    @pytest.mark.asyncio
    async def test_all_providers_fail_raises(self):
        router = ProviderRouter(primary="anthropic", fallback_order=["deepseek"])

        with patch("aurex.skills.function_calling.run.call_anthropic", new_callable=AsyncMock) as mock_a, \
             patch("aurex.skills.function_calling.run.call_deepseek", new_callable=AsyncMock) as mock_d:
            mock_a.side_effect = Exception("Anthropic down")
            mock_d.side_effect = Exception("DeepSeek down")

            with pytest.raises(Exception, match="DeepSeek down"):
                await router.call(
                    messages=[{"role": "user", "content": "hi"}],
                    tools=[],
                )

    def test_unknown_provider_raises(self):
        router = ProviderRouter(primary="nonexistent")
        with pytest.raises(ValueError, match="Unknown provider"):
            router._get_provider("nonexistent")

    def test_builtin_providers_registered(self):
        assert "anthropic" in PROVIDERS
        assert "openrouter" in PROVIDERS
        assert "deepseek" in PROVIDERS
