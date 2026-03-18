"""
Search orchestrator with fallback chain, caching, and deduplication.
Chain: Tavily → Serper → Firecrawl
URL extraction: Jina Reader → Firecrawl
"""

import sys
import re
from typing import Optional


from aurex.cache.sqlite_cache import SQLiteCache
from aurex.cache.dedup import normalize_url, deduplicate_citations
from aurex.ratelimit.limiter import RateLimiter
from aurex.search.tavily_client import TavilyClient
from aurex.search.jina_client import JinaClient
from aurex.search.serper_client import SerperClient
from aurex.search.firecrawl_client import FirecrawlClient
from aurex.search.deepseek_client import DeepSeekSearchClient
from aurex.citations.manager import Citation


def sanitize_error(error_msg: str) -> str:
    """Removes sensitive tokens like API keys from error messages."""
    msg = re.sub(r'Bearer\s+[A-Za-z0-9_\-\.]+', 'Bearer [REDACTED]', error_msg)
    msg = re.sub(r'sk-[A-Za-z0-9_\-\.]+', 'sk-[REDACTED]', msg)
    return msg


class SearchOrchestrator:
    def __init__(
        self,
        cache: Optional[SQLiteCache] = None,
        rate_limiter: Optional[RateLimiter] = None,
    ):
        self.cache = cache or SQLiteCache()
        self.rate_limiter = rate_limiter or RateLimiter()

        self.tavily = TavilyClient(rate_limiter=self.rate_limiter)
        self.jina = JinaClient(rate_limiter=self.rate_limiter)
        self.serper = SerperClient(rate_limiter=self.rate_limiter)
        self.firecrawl = FirecrawlClient(rate_limiter=self.rate_limiter)
        self.deepseek_search = DeepSeekSearchClient(rate_limiter=self.rate_limiter)

    async def search(self, query: str, max_results: int = 5) -> list[Citation]:
        # Check cache first
        cached = self.cache.get(f"search:{query}")
        if cached:
            return [Citation(**c) for c in cached]

        citations: list[Citation] = []

        # Fallback chain: DeepSeek -> Tavily → Serper → Firecrawl
        providers = [
            ("deepseek", self.deepseek_search.search),
            ("tavily", self.tavily.search),
            ("serper", self.serper.search),
            ("firecrawl", self.firecrawl.search),
        ]

        for name, search_fn in providers:
            try:
                results = await search_fn(query, max_results=max_results)
                citations = results
                break
            except Exception as e:
                print(f"[search] {name} failed: {sanitize_error(str(e))}", file=sys.stderr)
                continue

        # Deduplicate
        citations = deduplicate_citations(citations)

        # Cache results
        if citations:
            self.cache.set(f"search:{query}", [c.model_dump() for c in citations])

        return citations[:max_results]

    async def fetch_url(self, url: str) -> str:
        normalized = normalize_url(url)

        # Check cache
        cached = self.cache.get(f"url:{normalized}")
        if cached:
            return cached

        content = ""

        # Try Jina Reader first, then Firecrawl
        try:
            content = await self.jina.extract(url)
        except Exception:
            try:
                content = await self.firecrawl.extract(url)
            except Exception as e:
                content = f"Failed to fetch URL: {sanitize_error(str(e))}"

        # Cache
        if content and not content.startswith("Failed"):
            self.cache.set(f"url:{normalized}", content)

        return content
