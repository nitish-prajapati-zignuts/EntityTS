import { IQueryCache } from './IQueryCache';

interface CacheEntry<T> {
  value: T;
  expiresAt: number | null; // null = never expires
}

export interface MemoryQueryCacheOptions {
  maxSize?: number;
  defaultTtlMs?: number;
}

export class MemoryQueryCache implements IQueryCache {
  private readonly cache = new Map<string, CacheEntry<any>>();
  private readonly maxSize: number;
  private readonly defaultTtlMs?: number;

  constructor(options?: MemoryQueryCacheOptions) {
    this.maxSize = options?.maxSize ?? 1000;
    this.defaultTtlMs = options?.defaultTtlMs;
  }

  public get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Refresh key order for LRU behavior
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value as T;
  }

  public set<T>(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = ttl ? Date.now() + ttl : null;

    // LRU eviction if over capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, expiresAt });
  }

  public delete(key: string): void {
    this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
  }

  public get size(): number {
    return this.cache.size;
  }
}
