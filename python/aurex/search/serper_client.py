"""Serper.dev - Google search fallback provider."""

import os
import httpx
from typing import Optional

from aurex.ratelimit.limiter import RateLimiter
from aurex.citations.manager import Citation

SERPER_URL = "https://google.serper.dev/search"


class SerperClient:
    def __init__(self, rate_limiter: Optional[RateLimiter] = None):
        self.api_key = os.environ.get("SERPER_API_KEY", "")
        self.rate_limiter = rate_limiter

    async def search(self, query: str, max_results: int = 5) -> list[Citation]:
        if not self.api_key:
            raise ValueError("SERPER_API_KEY not set")

        if self.rate_limiter:
            await self.rate_limiter.acquire("serper")

        headers = {
            "X-API-KEY": self.api_key,
            "Content-Type": "application/json",
        }

        payload = {"q": query, "num": max_results}

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(SERPER_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

        citations = []
        for result in data.get("organic", []):
            citations.append(
                Citation(
                    url=result.get("link", ""),
                    title=result.get("title", ""),
                    excerpt=result.get("snippet", "")[:500],
                    provider="serper",
                )
            )

        return citations
