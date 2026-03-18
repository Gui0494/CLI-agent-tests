"""Tests for SQLite cache and deduplication."""

import os
import time
import pytest
from aurex.cache.sqlite_cache import SQLiteCache
from aurex.cache.dedup import normalize_url, deduplicate_citations
from aurex.citations.manager import Citation

TEST_DB = "test_cache.db"


@pytest.fixture
def cache():
    c = SQLiteCache(db_path=TEST_DB, ttl=2)  # 2 second TTL for tests
    yield c
    c.clear()
    try:
        os.remove(TEST_DB)
    except OSError:
        pass


def test_set_and_get(cache: SQLiteCache):
    cache.set("key1", {"data": "value"})
    result = cache.get("key1")
    assert result == {"data": "value"}


def test_expired_entry(cache: SQLiteCache):
    cache.set("key2", "data", ttl=1)
    time.sleep(1.1)
    result = cache.get("key2")
    assert result is None


def test_overwrite(cache: SQLiteCache):
    cache.set("key3", "old")
    cache.set("key3", "new")
    assert cache.get("key3") == "new"


def test_delete(cache: SQLiteCache):
    cache.set("key4", "data")
    cache.delete("key4")
    assert cache.get("key4") is None


def test_stats(cache: SQLiteCache):
    cache.set("a", 1)
    cache.set("b", 2)
    stats = cache.stats()
    assert stats["valid"] == 2


def test_normalize_url():
    assert normalize_url("https://Example.COM/path/") == "https://example.com/path"
    assert "a=" in normalize_url("https://example.com/path?utm_source=x&a=1")
    # Tracking params removed
    normalized = normalize_url("https://example.com?utm_source=google&q=test")
    assert "utm_source" not in normalized


def test_deduplicate_citations():
    citations = [
        Citation(url="https://example.com/page", title="Page 1", excerpt="text1"),
        Citation(url="https://example.com/page/", title="Page 1 dup", excerpt="text2"),
        Citation(url="https://other.com/page", title="Page 2", excerpt="text3"),
    ]
    result = deduplicate_citations(citations)
    assert len(result) == 2
