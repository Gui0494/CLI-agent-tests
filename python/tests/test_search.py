"""Tests for search orchestrator (mocked providers)."""

import pytest
from unittest.mock import AsyncMock
from aurex.citations.manager import Citation
from aurex.search.orchestrator import SearchOrchestrator
from aurex.cache.sqlite_cache import SQLiteCache
from aurex.ratelimit.limiter import RateLimiter
import os

TEST_DB = "test_search_cache.db"


@pytest.fixture
def orchestrator(monkeypatch):
    # Inject dummy keys so client wrappers don't throw errors
    # Using monkeypatch ensures env vars are restored after each test
    for key in ["TAVILY_API_KEY", "SERPER_API_KEY", "FIRECRAWL_API_KEY", "JINA_API_KEY"]:
        monkeypatch.setenv(key, os.environ.get(key, "dummy"))

    cache = SQLiteCache(db_path=TEST_DB, ttl=2)
    limiter = RateLimiter()
    orch = SearchOrchestrator(cache=cache, rate_limiter=limiter)
    yield orch
    cache.clear()
    try:
        os.remove(TEST_DB)
    except OSError:
        pass


@pytest.mark.asyncio
async def test_search_with_cache(orchestrator: SearchOrchestrator):
    mock_citations = [
        Citation(url="https://example.com", title="Test", excerpt="Test excerpt", provider="tavily")
    ]

    # Pre-populate cache
    orchestrator.cache.set(
        "search:test query",
        [c.model_dump() for c in mock_citations],
    )

    results = await orchestrator.search("test query")
    assert len(results) == 1
    assert results[0].title == "Test"


@pytest.mark.asyncio
async def test_search_fallback(orchestrator: SearchOrchestrator):
    # Mock all providers to test fallback chain
    orchestrator.tavily.search = AsyncMock(side_effect=Exception("Tavily down"))
    orchestrator.serper.search = AsyncMock(
        return_value=[
            Citation(url="https://serper.com", title="Serper Result", excerpt="found via serper")
        ]
    )

    results = await orchestrator.search("test query 2")
    assert len(results) == 1
    assert results[0].provider is None or results[0].title == "Serper Result"


@pytest.mark.asyncio
async def test_fetch_url_cached(orchestrator: SearchOrchestrator):
    from aurex.cache.dedup import normalize_url
    url = "https://example.com/"
    normalized = normalize_url(url)
    
    orchestrator.cache.set(f"url:{normalized}", "cached content")
    content = await orchestrator.fetch_url(url)
    
    assert content == "cached content"
