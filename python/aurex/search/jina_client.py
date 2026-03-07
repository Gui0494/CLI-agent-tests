"""Jina Reader - extract clean text content from URLs."""

import os
import httpx
from typing import Optional

from aurex.ratelimit.limiter import RateLimiter

JINA_READER_URL = "https://r.jina.ai/"


class JinaClient:
    def __init__(self, rate_limiter: Optional[RateLimiter] = None):
        self.api_key = os.environ.get("JINA_API_KEY", "")
        self.rate_limiter = rate_limiter

    async def extract(self, url: str) -> str:
        """Extract clean text content from a URL using Jina Reader."""
        if self.rate_limiter:
            await self.rate_limiter.acquire("jina")

        headers = {
            "Accept": "text/plain",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        target_url = f"{JINA_READER_URL}{url}"

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(target_url, headers=headers)
            response.raise_for_status()

        return response.text
