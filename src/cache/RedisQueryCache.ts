import { IQueryCache } from './IQueryCache';

export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: any[]): Promise<any>;
  del(key: string | string[]): Promise<any>;
  flushdb?(): Promise<any>;
}

export interface RedisQueryCacheOptions {
  client: RedisLikeClient;
  keyPrefix?: string;
  defaultTtlMs?: number;
}

export class RedisQueryCache implements IQueryCache {
  private readonly client: RedisLikeClient;
  private readonly prefix: string;
  private readonly defaultTtlMs?: number;

  constructor(options: RedisQueryCacheOptions) {
    this.client = options.client;
    this.prefix = options.keyPrefix || 'nsp:cache:';
    this.defaultTtlMs = options.defaultTtlMs;
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  public async get<T>(key: string): Promise<T | null> {
    const data = await this.client.get(this.getKey(key));
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return data as unknown as T;
    }
  }

  public async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const fullKey = this.getKey(key);
    const serialized = JSON.stringify(value);
    const ttl = ttlMs ?? this.defaultTtlMs;

    if (ttl) {
      const ttlSec = Math.max(1, Math.ceil(ttl / 1000));
      await this.client.set(fullKey, serialized, 'EX', ttlSec);
    } else {
      await this.client.set(fullKey, serialized);
    }
  }

  public async delete(key: string): Promise<void> {
    await this.client.del(this.getKey(key));
  }

  public async clear(): Promise<void> {
    if (typeof this.client.flushdb === 'function') {
      await this.client.flushdb();
    }
  }
}
