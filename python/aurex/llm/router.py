"""
OpenRouter client - uses free-tier models for LLM inference.
Supports fallback between models and conversation memory.
"""

import os
import sys
import httpx
from typing import Optional

from aurex.ratelimit.limiter import RateLimiter
from aurex.llm.prompts import SYSTEM_PROMPT
from aurex.config.loader import LLMConfig

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def _sanitize_surrogates(obj):
    """Recursively removes utf-8 surrogate characters that crash httpx JSON encoder."""
    if isinstance(obj, str):
        return obj.encode('utf-8', 'replace').decode('utf-8')
    elif isinstance(obj, dict):
        return {k: _sanitize_surrogates(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_sanitize_surrogates(item) for item in obj]
    return obj


class OpenRouterClient:
    def __init__(self, rate_limiter: Optional[RateLimiter] = None, config: Optional[LLMConfig] = None):
        self.api_key = os.environ.get("OPENROUTER_API_KEY", "")
        self.rate_limiter = rate_limiter
        self.config = config or LLMConfig()
        self.memory: list[dict] = []
        self.max_memory = self.config.memory_turns

    async def chat(
        self,
        messages: list[dict],
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> str:
        if self.rate_limiter:
            await self.rate_limiter.acquire("openrouter")

        # Build conversation with memory
        full_messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        full_messages.extend(self.memory[-self.max_memory * 2 :])
        full_messages.extend(messages)

        target_model = model or self.config.default_model
        temp = temperature if temperature is not None else self.config.temperature
        tokens = max_tokens if max_tokens is not None else self.config.max_tokens

        try:
            result = await self._call_api(full_messages, target_model, temp, tokens, timeout=60.0)
        except Exception as e:
            # Fallback to alternative model
            print(f"[llm] Primary model {target_model} failed: {e}. Falling back to {self.config.fallback_model}.", file=sys.stderr)
            target_model = self.config.fallback_model
            result = await self._call_api(full_messages, target_model, temp, tokens, timeout=15.0)

        # Update memory
        if messages:
            self.memory.extend(messages)
            self.memory.append({"role": "assistant", "content": result})
            # Trim memory
            if len(self.memory) > self.max_memory * 2:
                self.memory = self.memory[-self.max_memory * 2 :]

        return result

    async def _call_api(
        self,
        messages: list[dict],
        model: str,
        temperature: float,
        max_tokens: int,
        timeout: float = 60.0,
    ) -> str:
        if "deepseek" in model.lower() and "/" not in model:
            api_key = os.environ.get("DEEPSEEK_API_KEY", self.api_key)
            url = "https://api.deepseek.com/chat/completions"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            if not api_key:
                raise ValueError("DEEPSEEK_API_KEY is not set.")
        else:
            api_key = os.environ.get("OPENROUTER_API_KEY", self.api_key)
            url = "https://openrouter.ai/api/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/aurex-ai",
                "X-Title": "AurexAI",
            }
            if not api_key:
                raise ValueError("OPENROUTER_API_KEY is not set.")

        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        # Include DeepSeek Native Web Search Support if available in env
        if os.environ.get("AUREX_DEEPSEEK_SEARCH") == "1" and "deepseek" in model.lower():
            payload["search"] = True

        # Sanitize surrogate characters that crash httpx JSON encoder (common on Windows)
        payload = _sanitize_surrogates(payload)

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

        choices = data.get("choices", [])
        if not choices:
            raise ValueError("No response from model")

        return choices[0]["message"]["content"]
