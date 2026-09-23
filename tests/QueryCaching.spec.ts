import {
  DbContext,
  DbContextOptionsBuilder,
  DbSet,
  Table,
  Entity,
  PrimaryKey,
  Column,
  MemoryQueryCache,
  RedisQueryCache,
} from '../src';

@Entity()
@Table('cached_items')
class CachedItem {
  @PrimaryKey()
  id!: number;

  @Column()
  val!: string;
}

describe('Query Caching', () => {
  describe('MemoryQueryCache', () => {
    it('stores and retrieves cached items', () => {
      const cache = new MemoryQueryCache();
      cache.set('key1', { hello: 'world' });
      expect(cache.get('key1')).toEqual({ hello: 'world' });
    });

    it('expires items based on TTL', async () => {
      const cache = new MemoryQueryCache();
      cache.set('key_short', 'value', 20); // 20ms TTL
      expect(cache.get('key_short')).toBe('value');

      await new Promise(r => setTimeout(r, 30));
      expect(cache.get('key_short')).toBeNull();
    });

    it('evicts least recently used items when maxSize is exceeded', () => {
      const cache = new MemoryQueryCache({ maxSize: 2 });
      cache.set('k1', 1);
      cache.set('k2', 2);
      expect(cache.get('k1')).toBe(1); // accesses k1, making k2 oldest

      cache.set('k3', 3); // evicts k2
      expect(cache.get('k1')).toBe(1);
      expect(cache.get('k2')).toBeNull();
      expect(cache.get('k3')).toBe(3);
    });
  });

  describe('DbSet .cache() integration', () => {
    it('caches query results and avoids subsequent DB queries', async () => {
      const cache = new MemoryQueryCache();
      let dbQueryCount = 0;

      class CachedDbContext extends DbContext {
        public items!: DbSet<CachedItem>;

        protected onConfiguring(options: DbContextOptionsBuilder): void {
          options
            .useMock({
              tables: {
                cached_items: [{ id: 1, val: 'Alpha' }],
              },
            })
            .withCache(cache)
            .withHooks({
              onBeforeQuery: () => {
                dbQueryCount++;
              },
            });
        }
      }

      const ctx = new CachedDbContext();
      ctx.items = ctx.set(CachedItem);

      // First query hits DB
      const res1 = await ctx.items.cache(60000).toList();
      expect(res1.length).toBe(1);
      expect(dbQueryCount).toBe(1);

      // Second query hits cache
      const res2 = await ctx.items.cache(60000).toList();
      expect(res2.length).toBe(1);
      expect(dbQueryCount).toBe(1); // No new DB queries!

      // Invalidate cache
      await ctx.items.invalidateCache();

      // Third query hits DB again
      const res3 = await ctx.items.cache(60000).toList();
      expect(res3.length).toBe(1);
      expect(dbQueryCount).toBe(2);
    });
  });

  describe('RedisQueryCache', () => {
    it('works with a Redis-compatible client', async () => {
      const mockStorage = new Map<string, string>();
      const mockRedisClient = {
        get: async (key: string) => mockStorage.get(key) || null,
        set: async (key: string, val: string) => {
          mockStorage.set(key, val);
        },
        del: async (key: string) => {
          mockStorage.delete(key);
        },
        flushdb: async () => {
          mockStorage.clear();
        },
      };

      const redisCache = new RedisQueryCache({ client: mockRedisClient, keyPrefix: 'test:' });
      await redisCache.set('user:1', { name: 'Alice' }, 5000);

      const cached = await redisCache.get<{ name: string }>('user:1');
      expect(cached).toEqual({ name: 'Alice' });

      await redisCache.delete('user:1');
      expect(await redisCache.get('user:1')).toBeNull();
    });
  });
});
