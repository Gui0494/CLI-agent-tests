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

        if not self.api_key:
            raise ValueError("OPENROUTER_API_KEY is not set. Please set it in .env or your environment.")

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
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/aurex-ai",
            "X-Title": "AurexAI",
        }

        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(OPENROUTER_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

        choices = data.get("choices", [])
        if not choices:
            raise ValueError("No response from model")

        return choices[0]["message"]["content"]
