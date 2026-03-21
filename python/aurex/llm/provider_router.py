"""
Provider Abstraction Layer — Unified LLM provider interface with fallback chain.

Replaces the provider if/elif/else chain in function_calling/run.py with a
pluggable router that supports automatic fallback on provider errors.

Reference: Phase 5.4 — Provider Abstraction Layer
"""

import logging
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


@runtime_checkable
class LLMProvider(Protocol):
    """Common interface for all LLM providers."""

    async def chat(
        self,
        messages: list[dict],
        tools: list[dict],
        model: str = "",
        api_key: str = "",
        system_prompt: str = "",
        max_tokens: int = 4096,
    ) -> dict[str, Any]: ...


class AnthropicProvider:
    """Wraps call_anthropic as an LLMProvider."""

    name = "anthropic"

    async def chat(self, messages, tools, model="", api_key="",
                   system_prompt="", max_tokens=4096) -> dict[str, Any]:
        from aurex.skills.function_calling.run import call_anthropic
        return await call_anthropic(
            messages=messages, tools=tools,
            model=model or "claude-sonnet-4-20250514",
            api_key=api_key, system_prompt=system_prompt,
            max_tokens=max_tokens,
        )


class OpenRouterProvider:
    """Wraps call_openrouter as an LLMProvider."""

    name = "openrouter"

    async def chat(self, messages, tools, model="", api_key="",
                   system_prompt="", max_tokens=4096) -> dict[str, Any]:
        from aurex.skills.function_calling.run import call_openrouter
        return await call_openrouter(
            messages=messages, tools=tools,
            model=model or "meta-llama/llama-3.3-70b-instruct:free",
            api_key=api_key, max_tokens=max_tokens,
        )


class DeepSeekProvider:
    """Wraps call_deepseek as an LLMProvider."""

    name = "deepseek"

    async def chat(self, messages, tools, model="", api_key="",
                   system_prompt="", max_tokens=4096) -> dict[str, Any]:
        from aurex.skills.function_calling.run import call_deepseek
        return await call_deepseek(
            messages=messages, tools=tools,
            model=model or "deepseek-chat",
            api_key=api_key, max_tokens=max_tokens,
        )


# Registry of built-in providers
PROVIDERS: dict[str, type] = {
    "anthropic": AnthropicProvider,
    "openrouter": OpenRouterProvider,
    "deepseek": DeepSeekProvider,
}


class ProviderRouter:
    """Routes LLM calls through a provider chain with automatic fallback."""

    def __init__(
        self,
        primary: str = "openrouter",
        fallback_order: list[str] | None = None,
    ):
        self.primary = primary
        self.fallback_order = fallback_order or []
        self._instances: dict[str, LLMProvider] = {}

    def _get_provider(self, name: str) -> LLMProvider:
        if name not in self._instances:
            cls = PROVIDERS.get(name)
            if cls is None:
                raise ValueError(f"Unknown provider: {name}")
            self._instances[name] = cls()
        return self._instances[name]

    async def call(
        self,
        messages: list[dict],
        tools: list[dict],
        model: str = "",
        api_key: str = "",
        system_prompt: str = "",
        max_tokens: int = 4096,
    ) -> dict[str, Any]:
        """Try primary provider, fall back on error."""
        providers_to_try = [self.primary] + [
            p for p in self.fallback_order if p != self.primary
        ]
        last_error: Exception | None = None

        for provider_name in providers_to_try:
            try:
                provider = self._get_provider(provider_name)
                result = await provider.chat(
                    messages=messages, tools=tools,
                    model=model, api_key=api_key,
                    system_prompt=system_prompt, max_tokens=max_tokens,
                )
                result["provider_used"] = provider_name
                return result
            except Exception as e:
                last_error = e
                logger.warning(f"Provider {provider_name} failed: {e}")
                if provider_name != providers_to_try[-1]:
                    logger.info(f"Falling back to next provider...")

        raise last_error or RuntimeError("No providers available")
