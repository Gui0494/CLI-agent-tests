"""Firecrawl - heavy-duty web scraping (special use only)."""

import os
import httpx
from typing import Optional

from aurex.ratelimit.limiter import RateLimiter
from aurex.citations.manager import Citation

FIRECRAWL_URL = "https://api.firecrawl.dev/v1"


class FirecrawlClient:
    def __init__(self, rate_limiter: Optional[RateLimiter] = None):
        self.api_key = os.environ.get("FIRECRAWL_API_KEY", "")
        self.rate_limiter = rate_limiter

    async def search(self, query: str, max_results: int = 5) -> list[Citation]:
        """Use Firecrawl's search endpoint as last resort."""
        if not self.api_key:
            raise ValueError("FIRECRAWL_API_KEY not set")

        if self.rate_limiter:
            await self.rate_limiter.acquire("firecrawl")

        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {"query": query, "limit": max_results}

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{FIRECRAWL_URL}/search", json=payload, headers=headers
            )
            response.raise_for_status()
            data = response.json()

        citations = []
        for result in data.get("data", []):
            citations.append(
                Citation(
                    url=result.get("url", ""),
                    title=result.get("metadata", {}).get("title", ""),
                    excerpt=result.get("markdown", "")[:500],
                    provider="firecrawl",
                )
            )
        return citations

    async def extract(self, url: str) -> str:
        """Scrape a single URL for its content."""
        if not self.api_key:
            raise ValueError("FIRECRAWL_API_KEY not set")

        if self.rate_limiter:
            await self.rate_limiter.acquire("firecrawl")

        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {"url": url}

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{FIRECRAWL_URL}/scrape", json=payload, headers=headers
            )
            response.raise_for_status()
            data = response.json()

        return data.get("data", {}).get("markdown", "")
