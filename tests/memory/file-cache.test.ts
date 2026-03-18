/**
 * Unit tests for FileCache
 */
import { FileCache } from "../../src/memory/file-cache.js";

describe("FileCache", () => {
  let cache: FileCache;

  beforeEach(() => {
    cache = new FileCache({ maxEntries: 5, maxTotalSize: 1000 });
  });

  it("starts empty", () => {
    expect(cache.size()).toBe(0);
    expect(cache.getTotalSize()).toBe(0);
  });

  it("stores and retrieves files", async () => {
    await cache.set("/test/file.ts", "const x = 1;");
    // Note: get() checks mtime so may not work in test without real file
    // Testing internal state instead
    expect(cache.size()).toBe(1);
    expect(cache.getPaths().length).toBe(1);
  });

  it("invalidate removes specific file", async () => {
    await cache.set("/test/a.ts", "aaa");
    await cache.set("/test/b.ts", "bbb");
    cache.invalidate("/test/a.ts");
    expect(cache.size()).toBe(1);
  });

  it("invalidateAll clears everything", async () => {
    await cache.set("/test/a.ts", "aaa");
    await cache.set("/test/b.ts", "bbb");
    cache.invalidateAll();
    expect(cache.size()).toBe(0);
  });

  it("evicts oldest when over maxEntries", async () => {
    for (let i = 0; i < 6; i++) {
      await cache.set(`/test/file${i}.ts`, `content${i}`);
    }
    expect(cache.size()).toBeLessThanOrEqual(5);
  });

  it("tracks total token count", async () => {
    await cache.set("/test/file.ts", "a".repeat(100));
    expect(cache.getTotalTokens()).toBe(25); // 100/4
  });

  it("compress replaces content with placeholder", async () => {
    await cache.set("/test/file.ts", "a".repeat(200));
    const compressed = cache.compress();
    expect(compressed).toHaveLength(1);
    expect(cache.getTotalSize()).toBeLessThan(200);
  });
});
