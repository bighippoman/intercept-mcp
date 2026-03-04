import type { PipelineResult } from "./types.js";

const FAILURE_SENTINEL = Symbol("failure");
type CacheEntry = PipelineResult | typeof FAILURE_SENTINEL;

export class LRUCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(url: string): PipelineResult | undefined {
    const entry = this.cache.get(url);
    if (entry === undefined || entry === FAILURE_SENTINEL) return undefined;

    // Move to end (most recently used)
    this.cache.delete(url);
    this.cache.set(url, entry);
    return entry;
  }

  set(url: string, result: PipelineResult): void {
    this.cache.delete(url);
    this.cache.set(url, result);
    this.evict();
  }

  setFailure(url: string): void {
    this.cache.delete(url);
    this.cache.set(url, FAILURE_SENTINEL);
    this.evict();
  }

  isFailure(url: string): boolean {
    const entry = this.cache.get(url);
    if (entry === FAILURE_SENTINEL) {
      // Refresh LRU position
      this.cache.delete(url);
      this.cache.set(url, FAILURE_SENTINEL);
      return true;
    }
    return false;
  }

  get size(): number {
    return this.cache.size;
  }

  private evict(): void {
    while (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
  }
}
