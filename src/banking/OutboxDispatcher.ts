import { IDbAdapter } from '../adapters/IDbAdapter';
import { DbTransaction } from '../transaction/DbTransaction';

export type OutboxStatus = 'PENDING' | 'DISPATCHED' | 'FAILED';

export interface OutboxMessage<T = unknown> {
  id: string;
  eventType: string;
  payload: T;
  status: OutboxStatus;
  retryCount: number;
  lastError?: string;
  createdAt: number;
  dispatchedAt?: number;
}

export interface DispatchOptions {
  batchSize?: number;
  maxRetries?: number;
}

export interface DispatchSummary {
  dispatchedCount: number;
  failedCount: number;
}

/**
 * Enterprise Transactional Outbox Engine for @nsp/dbcontext.
 * Guarantees zero message loss and at-least-once delivery between local database transactions
 * and distributed message brokers (e.g. Kafka, RabbitMQ, SQS, Webhooks).
 */
export class OutboxDispatcher {
  private schemaEnsured = false;

  constructor(private readonly adapter: IDbAdapter) {}

  public async ensureSchema(): Promise<void> {
    if (this.schemaEnsured) return;

    const provider = this.adapter.provider;
    let sql: string;

    if (provider === 'mssql') {
      sql = `
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='__nsp_outbox' AND xtype='U')
        CREATE TABLE [__nsp_outbox] (
          [id] NVARCHAR(64) PRIMARY KEY,
          [event_type] NVARCHAR(128) NOT NULL,
          [payload] NVARCHAR(MAX) NOT NULL,
          [status] NVARCHAR(32) NOT NULL,
          [retry_count] INT NOT NULL,
          [last_error] NVARCHAR(MAX),
          [created_at] BIGINT NOT NULL,
          [dispatched_at] BIGINT
        )
      `;
    } else if (provider === 'mysql' || provider === 'planetscale') {
      sql = `
        CREATE TABLE IF NOT EXISTS \`__nsp_outbox\` (
          \`id\` VARCHAR(64) PRIMARY KEY,
          \`event_type\` VARCHAR(128) NOT NULL,
          \`payload\` LONGTEXT NOT NULL,
          \`status\` VARCHAR(32) NOT NULL,
          \`retry_count\` INT NOT NULL,
          \`last_error\` LONGTEXT,
          \`created_at\` BIGINT NOT NULL,
          \`dispatched_at\` BIGINT
        )
      `;
    } else if (provider === 'postgres' || provider === 'neon' || provider === 'supabase' || provider === 'cockroachdb') {
      sql = `
        CREATE TABLE IF NOT EXISTS "__nsp_outbox" (
          "id" VARCHAR(64) PRIMARY KEY,
          "event_type" VARCHAR(128) NOT NULL,
          "payload" TEXT NOT NULL,
          "status" VARCHAR(32) NOT NULL,
          "retry_count" INT NOT NULL,
          "last_error" TEXT,
          "created_at" BIGINT NOT NULL,
          "dispatched_at" BIGINT
        )
      `;
    } else {
      // SQLite, Turso, D1
      sql = `
        CREATE TABLE IF NOT EXISTS __nsp_outbox (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL,
          retry_count INTEGER NOT NULL,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          dispatched_at INTEGER
        )
      `;
    }

    await this.adapter.executeNonQuery(sql);
    this.schemaEnsured = true;
  }

  /**
   * Enqueues a message into the outbox within the current database transaction.
   * If the transaction commits, the message is guaranteed to be saved; if rolled back, nothing is emitted.
   *
   * @param eventType - Domain event type name (e.g. 'PAYMENT_RECEIVED', 'ACCOUNT_LOCKED').
   * @param payload - Arbitrary event data object or primitive.
   * @param transaction - Optional active `DbTransaction` instance.
   * @returns Generated outbox message ID.
   */
  public async enqueue<T>(
    eventType: string,
    payload: T,
    transaction?: DbTransaction
  ): Promise<string> {
    await this.ensureSchema();

    const id = `MSG-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const serializedPayload = JSON.stringify(payload);
    const now = Date.now();

    const escape = (col: string) => this.adapter.escapeIdentifier(col);
    const ph = (name: string, idx: number) => this.adapter.formatParameterPlaceholder(name, idx);

    const insertSql = `
      INSERT INTO ${escape('__nsp_outbox')}
      (${escape('id')}, ${escape('event_type')}, ${escape('payload')}, ${escape('status')}, ${escape('retry_count')}, ${escape('created_at')})
      VALUES (${ph('id', 1)}, ${ph('type', 2)}, ${ph('payload', 3)}, ${ph('status', 4)}, ${ph('retry', 5)}, ${ph('created', 6)})
    `;

    await this.adapter.executeNonQuery(
      insertSql,
      [
        { name: 'id', value: id },
        { name: 'type', value: eventType },
        { name: 'payload', value: serializedPayload },
        { name: 'status', value: 'PENDING' },
        { name: 'retry', value: 0 },
        { name: 'created', value: now },
      ],
      transaction
    );

    return id;
  }

  /**
   * Polls and dispatches pending outbox events through the provided delivery handler (e.g. Kafka producer).
   * Updates message status to DISPATCHED or increments retry count on failure.
   *
   * @param handler - Asynchronous message sender callback.
   * @param options - Batch size and max retry attempts.
   */
  public async dispatchPending(
    handler: (message: OutboxMessage) => Promise<void>,
    options?: DispatchOptions
  ): Promise<DispatchSummary> {
    await this.ensureSchema();

    const batchSize = options?.batchSize ?? 50;
    const maxRetries = options?.maxRetries ?? 3;

    const escape = (col: string) => this.adapter.escapeIdentifier(col);
    const ph = (name: string, idx: number) => this.adapter.formatParameterPlaceholder(name, idx);

    const fetchSql = `
      SELECT ${escape('id')}, ${escape('event_type')}, ${escape('payload')}, ${escape('status')}, ${escape('retry_count')}, ${escape('last_error')}, ${escape('created_at')}, ${escape('dispatched_at')}
      FROM ${escape('__nsp_outbox')}
      WHERE ${escape('status')} = ${ph('status', 1)} AND ${escape('retry_count')} < ${ph('max', 2)}
      ORDER BY ${escape('created_at')} ASC
    `;

    const rawRows = await this.adapter.executeQuery<any>(fetchSql, [
      { name: 'status', value: 'PENDING' },
      { name: 'max', value: maxRetries },
    ]);

    const messages: OutboxMessage[] = rawRows.slice(0, batchSize).map(r => ({
      id: r.id,
      eventType: r.event_type,
      payload: JSON.parse(r.payload),
      status: r.status as OutboxStatus,
      retryCount: Number(r.retry_count),
      lastError: r.last_error ?? undefined,
      createdAt: Number(r.created_at),
      dispatchedAt: r.dispatched_at ? Number(r.dispatched_at) : undefined,
    }));

    let dispatchedCount = 0;
    let failedCount = 0;

    for (const msg of messages) {
      try {
        await handler(msg);

        // Mark DISPATCHED
        const updateSql = `
          UPDATE ${escape('__nsp_outbox')}
          SET ${escape('status')} = ${ph('status', 1)}, ${escape('dispatched_at')} = ${ph('dispatched', 2)}
          WHERE ${escape('id')} = ${ph('id', 3)}
        `;
        await this.adapter.executeNonQuery(updateSql, [
          { name: 'status', value: 'DISPATCHED' },
          { name: 'dispatched', value: Date.now() },
          { name: 'id', value: msg.id },
        ]);
        dispatchedCount++;
      } catch (dispatchErr) {
        failedCount++;
        const nextRetry = msg.retryCount + 1;
        const newStatus = nextRetry >= maxRetries ? 'FAILED' : 'PENDING';
        const errorMsg = dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr);

        const failSql = `
          UPDATE ${escape('__nsp_outbox')}
          SET ${escape('status')} = ${ph('status', 1)}, ${escape('retry_count')} = ${ph('retry', 2)}, ${escape('last_error')} = ${ph('err', 3)}
          WHERE ${escape('id')} = ${ph('id', 4)}
        `;
        await this.adapter.executeNonQuery(failSql, [
          { name: 'status', value: newStatus },
          { name: 'retry', value: nextRetry },
          { name: 'err', value: errorMsg },
          { name: 'id', value: msg.id },
        ]);
      }
    }

    return { dispatchedCount, failedCount };
  }

  /**
   * Retrieves current pending message count in the outbox.
   */
  public async getPendingCount(): Promise<number> {
    await this.ensureSchema();
    const escape = (col: string) => this.adapter.escapeIdentifier(col);
    const ph = (name: string, idx: number) => this.adapter.formatParameterPlaceholder(name, idx);

    const countSql = `
      SELECT COUNT(*) as count
      FROM ${escape('__nsp_outbox')}
      WHERE ${escape('status')} = ${ph('status', 1)}
    `;

    const rows = await this.adapter.executeQuery<{ count: number }>(countSql, [
      { name: 'status', value: 'PENDING' },
    ]);
    return Number(rows[0]?.count || 0);
  }
}
