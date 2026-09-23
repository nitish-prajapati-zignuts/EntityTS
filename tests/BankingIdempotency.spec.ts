import { SqliteAdapter } from '../src/adapters/SqliteAdapter';
import { IdempotencyManager } from '../src/banking/IdempotencyManager';
import { IdempotencyConflictException } from '../src/errors';

describe('Banking Idempotency Engine', () => {
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
    const result = await idempotency.execute('PAYMENT-001', async () => {
      callCount++;
      return { status: 'SUCCESS', transferId: 'TX-9988', amount: '150.00' };
    });

    expect(callCount).toBe(1);
    expect(result).toEqual({ status: 'SUCCESS', transferId: 'TX-9988', amount: '150.00' });
  });

  it('returns cached response and prevents duplicate execution on repeated calls', async () => {
    let executionCount = 0;

    const executeTransfer = () =>
      idempotency.execute('ORDER-RETRY-123', async () => {
        executionCount++;
        return { confirmationCode: 'CONF-ABC', timestamp: 123456 };
      });

    const first = await executeTransfer();
    const second = await executeTransfer();
    const third = await executeTransfer();

    expect(executionCount).toBe(1);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });

  it('throws IdempotencyConflictException if a concurrent request is currently in progress', async () => {
    // Manually insert an IN_PROGRESS lock with future expiration
    await adapter.executeNonQuery(
      `INSERT INTO __nsp_idempotency (idempotency_key, status, response_body, created_at, locked_until, expires_at)
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
        'FLAKY-PAYMENT',
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
});
