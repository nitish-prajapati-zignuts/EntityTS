import { SqliteAdapter } from '../src/adapters/SqliteAdapter';
import { IdempotencyManager } from '../src/idempotency/IdempotencyManager';
import { IdempotencyConflictException } from '../src/errors';
import { DbContext } from '../src/context/DbContext';
import { DbContextOptionsBuilder } from '../src/context/DbContextOptionsBuilder';

class TestDbContext extends DbContext {
  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useSqlite(':memory:').withLogging(false);
  }
}

describe('Idempotency Engine', () => {
  let adapter: SqliteAdapter;
  let idempotency: IdempotencyManager;

  beforeEach(async () => {
    adapter = new SqliteAdapter(':memory:');
    await adapter.connect();
    idempotency = new IdempotencyManager(adapter);
    await idempotency.ensureSchema();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  it('creates the idempotency table and executes transaction successfully', async () => {
    let callCount = 0;
    const result = await idempotency.execute('ORDER-001', async () => {
      callCount++;
      return { status: 'SUCCESS', orderId: 'ORD-9988', amount: '150.00' };
    });

    expect(callCount).toBe(1);
    expect(result).toEqual({ status: 'SUCCESS', orderId: 'ORD-9988', amount: '150.00' });
  });

  it('returns cached response and prevents duplicate execution on repeated calls', async () => {
    let executionCount = 0;

    const executeOrder = () =>
      idempotency.execute('ORDER-RETRY-123', async () => {
        executionCount++;
        return { confirmationCode: 'CONF-ABC', timestamp: 123456 };
      });

    const first = await executeOrder();
    const second = await executeOrder();
    const third = await executeOrder();

    expect(executionCount).toBe(1);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });

  it('throws IdempotencyConflictException if a concurrent request is currently in progress', async () => {
    // Manually insert an IN_PROGRESS lock with future expiration
    await adapter.executeNonQuery(
      `INSERT INTO __entityts_idempotency (idempotency_key, status, response_body, created_at, locked_until, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        { name: 'p1', value: 'CONCURRENT-KEY' },
        { name: 'p2', value: 'IN_PROGRESS' },
        { name: 'p3', value: null },
        { name: 'p4', value: Date.now() },
        { name: 'p5', value: Date.now() + 60_000 },
        { name: 'p6', value: Date.now() + 86_400_000 },
      ],
    );

    await expect(
      idempotency.execute('CONCURRENT-KEY', async () => {
        return { ok: true };
      }),
    ).rejects.toThrow(IdempotencyConflictException);
  });

  it('cleans up lock on failure when removeOnFailure is true', async () => {
    let attempts = 0;

    const flakyOperation = () =>
      idempotency.execute(
        'FLAKY-REQUEST',
        async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error('Downstream network timeout');
          }
          return { success: true, attempts };
        },
        { removeOnFailure: true },
      );

    await expect(flakyOperation()).rejects.toThrow('Downstream network timeout');

    // Second retry should succeed because previous failed key was removed
    const retryResult = await flakyOperation();
    expect(retryResult).toEqual({ success: true, attempts: 2 });
  });

  it('integrates seamlessly with DbContext.withIdempotencyKey', async () => {
    const db = new TestDbContext();
    await db.adapter.connect();

    let executions = 0;
    const run = (key: string) =>
      db.withIdempotencyKey(key, async () => {
        executions++;
        return { data: 'processed', count: executions };
      });

    const res1 = await run('CTX-IDEMP-01');
    const res2 = await run('CTX-IDEMP-01');

    expect(executions).toBe(1);
    expect(res1).toEqual({ data: 'processed', count: 1 });
    expect(res2).toEqual({ data: 'processed', count: 1 });

    await db.adapter.disconnect();
  });
});
