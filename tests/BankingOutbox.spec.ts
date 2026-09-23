import { SqliteAdapter } from '../src/adapters/SqliteAdapter';
import { OutboxDispatcher, OutboxMessage } from '../src/banking/OutboxDispatcher';

describe('Transactional Outbox Pattern', () => {
  let adapter: SqliteAdapter;
  let outbox: OutboxDispatcher;

  beforeEach(async () => {
    adapter = new SqliteAdapter(':memory:');
    await adapter.connect();
    outbox = new OutboxDispatcher(adapter);
    await outbox.ensureSchema();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  it('enqueues messages with PENDING status and tracks count', async () => {
    const msgId = await outbox.enqueue('PAYMENT_INITIATED', {
      transferId: 'TR-101',
      amount: '500.00',
      currency: 'USD',
    });

    expect(msgId).toBeDefined();
    const count = await outbox.getPendingCount();
    expect(count).toBe(1);
  });

  it('dispatches pending messages and transitions status to DISPATCHED', async () => {
    await outbox.enqueue('ORDER_PLACED', { orderId: 1001 });
    await outbox.enqueue('ORDER_PLACED', { orderId: 1002 });

    const published: OutboxMessage[] = [];
    const summary = await outbox.dispatchPending(async msg => {
      published.push(msg);
    });

    expect(summary.dispatchedCount).toBe(2);
    expect(summary.failedCount).toBe(0);
    expect(published.length).toBe(2);
    expect(published[0].payload).toEqual({ orderId: 1001 });

    const remaining = await outbox.getPendingCount();
    expect(remaining).toBe(0);
  });

  it('increments retry count on dispatch failure and marks FAILED upon max retries', async () => {
    await outbox.enqueue('NOTIFICATION_EMAIL', { to: 'user@bank.com' });

    // Attempt 1: fails
    const res1 = await outbox.dispatchPending(
      async () => {
        throw new Error('SMTP connection timed out');
      },
      { maxRetries: 2 }
    );
    expect(res1.failedCount).toBe(1);

    // Should still be pending for retry 2
    let count = await outbox.getPendingCount();
    expect(count).toBe(1);

    // Attempt 2: fails again -> reaches maxRetries (2) -> transitioned to FAILED
    const res2 = await outbox.dispatchPending(
      async () => {
        throw new Error('SMTP connection timed out again');
      },
      { maxRetries: 2 }
    );
    expect(res2.failedCount).toBe(1);

    // No longer pending
    count = await outbox.getPendingCount();
    expect(count).toBe(0);
  });

  it('rolls back enqueued message if enclosing database transaction is aborted', async () => {
    const tx = await adapter.beginTransaction();

    await outbox.enqueue('TRANSFER_CANCELLED', { reason: 'insufficient funds' }, tx);

    // Rollback the transaction
    await tx.rollback();

    const count = await outbox.getPendingCount();
    expect(count).toBe(0);
  });
});
