import type { PipelineResult } from "./types.js";

const FAILURE_SENTINEL = Symbol("failure");

interface CacheEntryMeta {
  value: PipelineResult | typeof FAILURE_SENTINEL;
  expiresAt: number | null;
}

export interface LRUCacheOptions {
  ttl?: number;
  failureTtl?: number;
}

export class LRUCache {
  private cache = new Map<string, CacheEntryMeta>();
  private readonly maxSize: number;
  private readonly ttl: number | null;
  private readonly failureTtl: number | null;

  constructor(maxSize: number, options: LRUCacheOptions = {}) {
    this.maxSize = maxSize;
    this.ttl = options.ttl ?? null;
    this.failureTtl = options.failureTtl ?? options.ttl ?? null;
  }

  get(url: string): PipelineResult | undefined {
    const entry = this.cache.get(url);
    if (!entry || entry.value === FAILURE_SENTINEL) return undefined;
    if (this.isExpired(entry)) {
      this.cache.delete(url);
      return undefined;
    }
    // Move to end (most recently used)
    this.cache.delete(url);
    this.cache.set(url, entry);
    return entry.value;
  }

  set(url: string, result: PipelineResult): void {
    this.cache.delete(url);
    this.cache.set(url, {
      value: result,
      expiresAt: this.ttl !== null ? Date.now() + this.ttl : null,
    });
    this.evict();
  }

  setFailure(url: string): void {
    this.cache.delete(url);
    this.cache.set(url, {
      value: FAILURE_SENTINEL,
      expiresAt: this.failureTtl !== null ? Date.now() + this.failureTtl : null,
    });
    this.evict();
  }

  isFailure(url: string): boolean {
    const entry = this.cache.get(url);
    if (!entry || entry.value !== FAILURE_SENTINEL) return false;
    if (this.isExpired(entry)) {
      this.cache.delete(url);
      return false;
    }
    // Refresh LRU position
    this.cache.delete(url);
    this.cache.set(url, entry);
    return true;
  }

  get size(): number {
    return this.cache.size;
  }

  private isExpired(entry: CacheEntryMeta): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  private evict(): void {
    while (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
  }
}
