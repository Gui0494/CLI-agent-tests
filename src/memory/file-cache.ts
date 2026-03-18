/**
 * file-cache.ts — File cache with mtime-based invalidation
 *
 * Reference: docs/architecture-reference/specs/memory.md §3 FileCache
 */

import * as fs from "fs/promises";
import * as path from "path";

// ─── Interfaces ──────────────────────────────────────────

export interface FileCacheEntry {
  path: string;
  content: string;
  mtime: number;         // modification time for invalidation
  readAt: number;        // when it was read into cache
  tokenCount: number;    // approximate token count (chars / 4)
}

export interface FileCacheConfig {
  maxEntries: number;    // max files to cache
  maxTotalSize: number;  // max total bytes across all entries
}

const DEFAULT_CONFIG: FileCacheConfig = {
  maxEntries: 30,
  maxTotalSize: 512 * 1024, // 512KB
};

// ─── File Cache ──────────────────────────────────────────

export class FileCache {
  private entries: Map<string, FileCacheEntry> = new Map();
  private config: FileCacheConfig;

  constructor(config?: Partial<FileCacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get a cached file entry if still valid (mtime hasn't changed).
   */
  async get(filePath: string): Promise<FileCacheEntry | null> {
    const key = path.resolve(filePath);
    const entry = this.entries.get(key);
    if (!entry) return null;

    // Check if mtime changed → invalidate
    try {
      const stat = await fs.stat(key);
      if (stat.mtimeMs !== entry.mtime) {
        this.entries.delete(key);
        return null;
      }
    } catch {
      this.entries.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * Set a file in the cache.
   */
  async set(filePath: string, content: string): Promise<void> {
    const key = path.resolve(filePath);

    let mtime: number;
    try {
      const stat = await fs.stat(key);
      mtime = stat.mtimeMs;
    } catch {
      mtime = Date.now();
    }

    // Evict if over limits
    while (this.entries.size >= this.config.maxEntries) {
      this.evictOldest();
    }
    while (this.getTotalSize() + content.length > this.config.maxTotalSize) {
      if (!this.evictOldest()) break;
    }

    this.entries.set(key, {
      path: key,
      content,
      mtime,
      readAt: Date.now(),
      tokenCount: Math.ceil(content.length / 4),
    });
  }

  /**
   * Invalidate a single file.
   */
  invalidate(filePath: string): void {
    this.entries.delete(path.resolve(filePath));
  }

  /**
   * Invalidate all cached files.
   */
  invalidateAll(): void {
    this.entries.clear();
  }

  /**
   * Get the number of cached files.
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Get total content size in bytes.
   */
  getTotalSize(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.content.length;
    }
    return total;
  }

  /**
   * Get total approximate token count.
   */
  getTotalTokens(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.tokenCount;
    }
    return total;
  }

  /**
   * Compress: replace file contents with path-only entries.
   * Returns list of paths that were compressed.
   */
  compress(): string[] {
    const compressed: string[] = [];
    for (const [key, entry] of this.entries) {
      if (entry.content.length > 0) {
        this.entries.set(key, {
          ...entry,
          content: `[cached: ${entry.content.length} bytes]`,
          tokenCount: 5,
        });
        compressed.push(key);
      }
    }
    return compressed;
  }

  /**
   * Get all cached entries (for serialization/inspection).
   */
  getAll(): FileCacheEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get list of cached paths.
   */
  getPaths(): string[] {
    return Array.from(this.entries.keys());
  }

  // ─── Private ───────────────────────────────────────────

  private evictOldest(): boolean {
    let oldest: [string, FileCacheEntry] | null = null;
    for (const entry of this.entries) {
      if (!oldest || entry[1].readAt < oldest[1].readAt) {
        oldest = entry;
      }
    }
    if (oldest) {
      this.entries.delete(oldest[0]);
      return true;
    }
    return false;
  }
}
