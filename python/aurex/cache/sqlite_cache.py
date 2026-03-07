"""SQLite-based cache with 24h TTL for search results and URL content."""

import json
import sqlite3
import time
from typing import Any, Optional
from pathlib import Path

from aurex.config.paths import get_cache_dir

DEFAULT_TTL = 24 * 60 * 60  # 24 hours in seconds


class SQLiteCache:
    def __init__(self, db_path: Optional[str | Path] = None, ttl: int = DEFAULT_TTL):
        self.db_path = str(db_path) if db_path is not None else str(get_cache_dir() / "aurex_cache.db")
        self.ttl = ttl
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS cache (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    expires_at REAL NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_expires ON cache(expires_at)")

    def get(self, key: str) -> Optional[Any]:
        """Get a cached value. Returns None if expired or not found."""
        self._cleanup()

        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT value FROM cache WHERE key = ? AND expires_at > ?",
                (key, time.time()),
            ).fetchone()

        if row is None:
            return None

        return json.loads(row[0])

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """Set a cache entry with TTL."""
        now = time.time()
        expires = now + (ttl or self.ttl)
        serialized = json.dumps(value)

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO cache (key, value, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (key, serialized, now, expires),
            )

    def delete(self, key: str) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM cache WHERE key = ?", (key,))

    def clear(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM cache")

    def _cleanup(self) -> None:
        """Remove expired entries."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM cache WHERE expires_at <= ?", (time.time(),))

    def stats(self) -> dict:
        """Get cache statistics."""
        with sqlite3.connect(self.db_path) as conn:
            total = conn.execute("SELECT COUNT(*) FROM cache").fetchone()[0]
            valid = conn.execute(
                "SELECT COUNT(*) FROM cache WHERE expires_at > ?", (time.time(),)
            ).fetchone()[0]
        return {"total": total, "valid": valid, "expired": total - valid}
