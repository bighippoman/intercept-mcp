import { describe, it, expect } from "vitest";
import { LRUCache } from "../cache.js";
import type { PipelineResult } from "../types.js";

const MOCK_RESULT: PipelineResult = {
  result: { content: "cached content", source: "jina", quality: 0.8, timing: 100 },
  attempts: [{ name: "jina", status: "success", quality: 0.8, timing: 100 }],
};

describe("LRUCache", () => {
  it("returns undefined for cache miss", () => {
    const cache = new LRUCache(10);
    expect(cache.get("https://example.com")).toBeUndefined();
  });

  it("stores and retrieves a result", () => {
    const cache = new LRUCache(10);
    cache.set("https://example.com", MOCK_RESULT);
    expect(cache.get("https://example.com")).toEqual(MOCK_RESULT);
  });

  it("stores and retrieves failure sentinel", () => {
    const cache = new LRUCache(10);
    cache.setFailure("https://dead.com");
    expect(cache.isFailure("https://dead.com")).toBe(true);
    expect(cache.get("https://dead.com")).toBeUndefined();
  });

  it("returns false for isFailure on non-cached URL", () => {
    const cache = new LRUCache(10);
    expect(cache.isFailure("https://unknown.com")).toBe(false);
  });

  it("evicts oldest entry when over capacity", () => {
    const cache = new LRUCache(2);
    cache.set("https://one.com", MOCK_RESULT);
    cache.set("https://two.com", MOCK_RESULT);
    cache.set("https://three.com", MOCK_RESULT);
    expect(cache.get("https://one.com")).toBeUndefined();
    expect(cache.get("https://two.com")).toBeDefined();
    expect(cache.get("https://three.com")).toBeDefined();
  });

  it("accessing an entry makes it recently used", () => {
    const cache = new LRUCache(2);
    cache.set("https://one.com", MOCK_RESULT);
    cache.set("https://two.com", MOCK_RESULT);
    cache.get("https://one.com"); // touch one, making two the oldest
    cache.set("https://three.com", MOCK_RESULT); // should evict two
    expect(cache.get("https://one.com")).toBeDefined();
    expect(cache.get("https://two.com")).toBeUndefined();
    expect(cache.get("https://three.com")).toBeDefined();
  });

  it("reports correct size", () => {
    const cache = new LRUCache(10);
    expect(cache.size).toBe(0);
    cache.set("https://a.com", MOCK_RESULT);
    cache.setFailure("https://b.com");
    expect(cache.size).toBe(2);
  });
});
