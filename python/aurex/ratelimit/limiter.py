"""Per-provider rate limiter using token bucket algorithm."""

import time
import asyncio
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from aurex.config.paths import get_cache_dir

@dataclass
class ProviderLimit:
    max_requests: int
    window_seconds: int
    timestamps: list[float] = field(default_factory=list)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


# Default rate limits per provider
DEFAULT_LIMITS: dict[str, tuple[int, int]] = {
    "tavily": (33, 86400),       # 33/day
    "jina": (200, 86400),        # 200/day
    "serper": (3, 86400),        # 3/day (conservative)
    "openrouter": (50, 86400),   # 50/day
    "github": (5000, 3600),      # 5000/hour
    "firecrawl": (500, 999999),  # 500 total (lifetime)
}


class RateLimiter:
    def __init__(self, custom_limits: dict[str, tuple[int, int]] | None = None, db_path: Optional[str | Path] = None):
        limits = {**DEFAULT_LIMITS, **(custom_limits or {})}
        self.providers: dict[str, ProviderLimit] = {
            name: ProviderLimit(max_req, window)
            for name, (max_req, window) in limits.items()
        }
        self.db_path = str(db_path) if db_path is not None else str(get_cache_dir() / "aurex_ratelimits.db")
        self._init_db()
        self._load_from_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS rate_limits (
                    provider TEXT NOT NULL,
                    timestamp REAL NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_provider_ts ON rate_limits(provider, timestamp)")

    def _load_from_db(self):
        """Load recent timestamps from DB for all configured providers."""
        now = time.time()
        with sqlite3.connect(self.db_path) as conn:
            for name, limit in self.providers.items():
                cutoff = now - limit.window_seconds
                # Delete old timestamps first to keep DB small
                conn.execute("DELETE FROM rate_limits WHERE provider = ? AND timestamp <= ?", (name, cutoff))
                
                # Load valid timestamps
                rows = conn.execute(
                    "SELECT timestamp FROM rate_limits WHERE provider = ? ORDER BY timestamp ASC", 
                    (name,)
                ).fetchall()
                limit.timestamps = [r[0] for r in rows]
            conn.commit()

    def _save_to_db(self, provider: str, timestamp: float):
        """Save a new timestamp to DB."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO rate_limits (provider, timestamp) VALUES (?, ?)",
                (provider, timestamp)
            )

    async def acquire(self, provider: str) -> None:
        """Wait until a request slot is available for the provider."""
        if provider not in self.providers:
            return  # No limit configured

        limit = self.providers[provider]
        
        async with limit.lock:
            now = time.time()
    
            # Remove expired timestamps
            cutoff = now - limit.window_seconds
            limit.timestamps = [t for t in limit.timestamps if t > cutoff]
    
            # Wait if at capacity
            while len(limit.timestamps) >= limit.max_requests:
                oldest = limit.timestamps[0]
                wait_time = oldest + limit.window_seconds - now
                if wait_time > 0:
                    await asyncio.sleep(wait_time + 0.1)
                now = time.time()
                cutoff = now - limit.window_seconds
                limit.timestamps = [t for t in limit.timestamps if t > cutoff]
    
            limit.timestamps.append(now)
            self._save_to_db(provider, now)

    def remaining(self, provider: str) -> int:
        """Get remaining requests for a provider."""
        if provider not in self.providers:
            return 999999

        limit = self.providers[provider]
        now = time.time()
        cutoff = now - limit.window_seconds
        active = sum(1 for t in limit.timestamps if t > cutoff)
        return max(0, limit.max_requests - active)

    def stats(self) -> dict[str, dict]:
        """Get rate limit stats for all providers."""
        result = {}
        for name, limit in self.providers.items():
            remaining = self.remaining(name)
            result[name] = {
                "max": limit.max_requests,
                "used": limit.max_requests - remaining,
                "remaining": remaining,
                "window_seconds": limit.window_seconds,
            }
        return result
