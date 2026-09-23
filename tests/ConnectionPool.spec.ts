import {
  DbContext,
  DbContextOptionsBuilder,
  MockDbAdapter,
  ConnectionPool,
  PooledDbAdapter,
  IConnectionPool,
  PoolHealthResult,
} from '../src';

describe('Connection Pooling & Health Checks', () => {
  let mockAdapter: MockDbAdapter;

  beforeEach(() => {
    mockAdapter = new MockDbAdapter({
      tables: {
        users: [{ id: 1, name: 'Alice' }],
      },
    });
  });

  describe('ConnectionPool Unit Tests', () => {
    it('initializes with default settings and pre-warms minConnections', () => {
      const pool = new ConnectionPool(mockAdapter, { minConnections: 3, maxConnections: 8 });
      const stats = pool.stats();

      expect(stats.idle).toBe(3);
      expect(stats.active).toBe(0);
      expect(stats.total).toBe(3);
      expect(pool.options.maxConnections).toBe(8);
      expect(pool.options.minConnections).toBe(3);
    });

    it('acquires and releases connections tracking active and idle counts', async () => {
      const pool = new ConnectionPool(mockAdapter, { minConnections: 2, maxConnections: 5 });

      await pool.acquire();
      expect(pool.stats().active).toBe(1);
      expect(pool.stats().idle).toBe(1);

      await pool.acquire();
      expect(pool.stats().active).toBe(2);
      expect(pool.stats().idle).toBe(0);

      pool.release();
      expect(pool.stats().active).toBe(1);
      expect(pool.stats().idle).toBe(1);

      pool.release();
      expect(pool.stats().active).toBe(0);
      expect(pool.stats().idle).toBe(2);
    });

    it('queues pending acquires when max capacity is reached and resolves on release', async () => {
      const pool = new ConnectionPool(mockAdapter, { minConnections: 1, maxConnections: 1 });

      await pool.acquire();
      expect(pool.stats().active).toBe(1);

      let acquiredSecond = false;
      const secondPromise = pool.acquire().then(() => {
        acquiredSecond = true;
      });

      expect(pool.stats().pending).toBe(1);
      expect(acquiredSecond).toBe(false);

      pool.release();
      await secondPromise;

      expect(acquiredSecond).toBe(true);
      expect(pool.stats().active).toBe(1);
      expect(pool.stats().pending).toBe(0);
    });

    it('rejects acquire with timeout if capacity is not freed within acquireTimeoutMs', async () => {
      const pool = new ConnectionPool(mockAdapter, {
        minConnections: 1,
        maxConnections: 1,
        acquireTimeoutMs: 50,
      });

      await pool.acquire();
      await expect(pool.acquire()).rejects.toThrow(/Connection pool acquire timeout/);
    });

    it('reports health diagnostics via pool.health()', async () => {
      const pool = new ConnectionPool(mockAdapter, { minConnections: 2, maxConnections: 5 });
      const health: PoolHealthResult = await pool.health();

      expect(health.isAlive).toBe(true);
      expect(health.status).toBe('healthy');
      expect(health.totalConnections).toBe(2);
      expect(health.activeConnections).toBe(0);
      expect(health.minConnections).toBe(2);
      expect(health.maxConnections).toBe(5);
      expect(health.lastHeartbeatMs).toBeGreaterThanOrEqual(0);
      expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('marks status as degraded when pending waiters exist', async () => {
      const pool = new ConnectionPool(mockAdapter, {
        minConnections: 1,
        maxConnections: 1,
        acquireTimeoutMs: 500,
      });

      await pool.acquire();
      const waiting = pool.acquire();

      expect(pool.status).toBe('degraded');

      pool.release();
      await waiting;
      pool.release();
    });

    it('drains and rejects waiters upon close()', async () => {
      const pool = new ConnectionPool(mockAdapter, {
        minConnections: 1,
        maxConnections: 1,
        acquireTimeoutMs: 1000,
      });

      await pool.acquire();
      const waiting = pool.acquire();

      await pool.close();
      await expect(waiting).rejects.toThrow(/Connection pool was closed/);
      await expect(pool.acquire()).rejects.toThrow(/closed/);
    });
  });

  describe('PooledDbAdapter Integration', () => {
    it('automatically wraps queries with pool acquire and release', async () => {
      const pooledAdapter = new PooledDbAdapter(mockAdapter, {
        minConnections: 2,
        maxConnections: 5,
      });
      await pooledAdapter.connect();

      expect(pooledAdapter.pool.stats().active).toBe(0);

      const rows = await pooledAdapter.executeQuery('SELECT * FROM users');
      expect(rows.length).toBe(1);
      expect(pooledAdapter.pool.stats().active).toBe(0);

      await pooledAdapter.disconnect();
    });

    it('holds pool connection during active transaction until commit', async () => {
      const pooledAdapter = new PooledDbAdapter(mockAdapter, {
        minConnections: 1,
        maxConnections: 5,
      });

      const tx = await pooledAdapter.beginTransaction();
      expect(pooledAdapter.pool.stats().active).toBe(1);

      await tx.commit();
      expect(pooledAdapter.pool.stats().active).toBe(0);
    });

    it('holds pool connection during active transaction until rollback', async () => {
      const pooledAdapter = new PooledDbAdapter(mockAdapter, {
        minConnections: 1,
        maxConnections: 5,
      });

      const tx = await pooledAdapter.beginTransaction();
      expect(pooledAdapter.pool.stats().active).toBe(1);

      await tx.rollback();
      expect(pooledAdapter.pool.stats().active).toBe(0);
    });
  });

  describe('DbContext withConnectionPool Integration', () => {
    class AppDbContext extends DbContext {
      protected onConfiguring(options: DbContextOptionsBuilder): void {
        options
          .useAdapter(new MockDbAdapter({ tables: { accounts: [{ id: 1, balance: 100 }] } }))
          .withConnectionPool({
            minConnections: 3,
            maxConnections: 8,
            heartbeatIntervalMs: 0, // disable interval in tests
          });
      }
    }

    it('configures ctx.pool on DbContext and provides health diagnostics', async () => {
      const ctx = new AppDbContext();

      expect(ctx.pool).toBeDefined();
      expect(ctx.pool?.options.minConnections).toBe(3);
      expect(ctx.pool?.options.maxConnections).toBe(8);

      const health = await ctx.pool!.health();
      expect(health.status).toBe('healthy');
      expect(health.isAlive).toBe(true);
      expect(health.totalConnections).toBe(3);
    });
  });
});
