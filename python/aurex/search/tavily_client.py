"""Tavily Search API client - primary search provider."""

import os
import httpx
from typing import Optional

from aurex.ratelimit.limiter import RateLimiter
from aurex.citations.manager import Citation

TAVILY_URL = "https://api.tavily.com/search"


class TavilyClient:
    def __init__(self, rate_limiter: Optional[RateLimiter] = None):
        self.api_key = os.environ.get("TAVILY_API_KEY", "")
        self.rate_limiter = rate_limiter

    async def search(self, query: str, max_results: int = 5) -> list[Citation]:
        if not self.api_key:
            raise ValueError("TAVILY_API_KEY not set")

        if self.rate_limiter:
            await self.rate_limiter.acquire("tavily")

        payload = {
            "api_key": self.api_key,
            "query": query,
            "max_results": max_results,
            "include_answer": True,
            "include_raw_content": False,
            "search_depth": "basic",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(TAVILY_URL, json=payload)
            response.raise_for_status()
            data = response.json()

        citations = []
        for result in data.get("results", []):
            citations.append(
                Citation(
                    url=result.get("url", ""),
                    title=result.get("title", ""),
                    excerpt=result.get("content", "")[:500],
                    date=result.get("published_date"),
                    provider="tavily",
                )
            )

        return citations
