"""DeepSeek Search Client - uses DeepSeek Chat completions with search=True enabled to fetch search results directly."""

import os
import httpx
from typing import Optional
from datetime import datetime

from aurex.ratelimit.limiter import RateLimiter
from aurex.citations.manager import Citation

DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"

class DeepSeekSearchClient:
    def __init__(self, rate_limiter: Optional[RateLimiter] = None):
        self.api_key = os.environ.get("DEEPSEEK_API_KEY", "")
        self.rate_limiter = rate_limiter

    async def search(self, query: str, max_results: int = 5) -> list[Citation]:
        if not self.api_key:
            raise ValueError("DEEPSEEK_API_KEY not set")

        if self.rate_limiter:
            await self.rate_limiter.acquire("deepseek")

        payload = {
            "model": "deepseek-chat",
            "messages": [
                {"role": "system", "content": "You are a web search assistant. Given a query, search the internet and provide a synthesized summary of the most relevant information found."},
                {"role": "user", "content": f"Search the web for: {query}"}
            ],
            "search": True,
            "max_tokens": 1000,
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(DEEPSEEK_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

        message = data.get("choices", [{}])[0].get("message", {})
        content = message.get("content", "")

        citations = []
        if content:
            citations.append(
                Citation(
                    url="https://api.deepseek.com/search",
                    title=f"DeepSeek Search Summary: {query[:30]}...",
                    excerpt=content[:1000], 
                    date=datetime.now().isoformat(),
                    provider="deepseek"
                )
            )

        return citations
