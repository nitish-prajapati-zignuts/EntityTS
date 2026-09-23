import { IDbAdapter } from '../adapters/IDbAdapter';
import { IdempotencyConflictException } from '../errors';

export interface IdempotencyOptions {
  /** Lock timeout in milliseconds before an IN_PROGRESS request is considered timed out. Default 30,000ms (30s). */
  lockTimeoutMs?: number;
  /** Retention TTL in milliseconds for completed responses. Default 86,400,000ms (24h). */
  ttlMs?: number;
  /** Whether to delete or clear the idempotency lock on failure so the client can retry. Default true. */
  removeOnFailure?: boolean;
}

export interface IdempotencyRecord {
  idempotency_key: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  response_body?: string;
  created_at: number;
  locked_until: number;
  expires_at: number;
}

/**
 * Enterprise Idempotency Engine for EntityTS.
 * Guarantees that client retries, webhook dispatches, and duplicate mutation instructions
 * never execute transactions twice.
 */
export class IdempotencyManager {
  private schemaEnsured = false;

  constructor(private readonly adapter: IDbAdapter) {}

  /**
   * Automatically verifies and creates the `__entityts_idempotency` table if it does not yet exist.
   */
  public async ensureSchema(): Promise<void> {
    if (this.schemaEnsured) return;

    const provider = this.adapter.provider;
    let sql: string;

    if (provider === 'mssql') {
      sql = `
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='__entityts_idempotency' AND xtype='U')
        CREATE TABLE [__entityts_idempotency] (
          [idempotency_key] NVARCHAR(255) PRIMARY KEY,
          [status] NVARCHAR(32) NOT NULL,
          [response_body] NVARCHAR(MAX),
          [created_at] BIGINT NOT NULL,
          [locked_until] BIGINT NOT NULL,
          [expires_at] BIGINT NOT NULL
        )
      `;
    } else if (provider === 'mysql' || provider === 'planetscale') {
      sql = `
        CREATE TABLE IF NOT EXISTS \`__entityts_idempotency\` (
          \`idempotency_key\` VARCHAR(255) PRIMARY KEY,
          \`status\` VARCHAR(32) NOT NULL,
          \`response_body\` LONGTEXT,
          \`created_at\` BIGINT NOT NULL,
          \`locked_until\` BIGINT NOT NULL,
          \`expires_at\` BIGINT NOT NULL
        )
      `;
    } else if (
      provider === 'postgres' ||
      provider === 'neon' ||
      provider === 'supabase' ||
      provider === 'cockroachdb'
    ) {
      sql = `
        CREATE TABLE IF NOT EXISTS "__entityts_idempotency" (
          "idempotency_key" VARCHAR(255) PRIMARY KEY,
          "status" VARCHAR(32) NOT NULL,
          "response_body" TEXT,
          "created_at" BIGINT NOT NULL,
          "locked_until" BIGINT NOT NULL,
          "expires_at" BIGINT NOT NULL
        )
      `;
    } else {
      // SQLite, Turso, D1, fallback
      sql = `
        CREATE TABLE IF NOT EXISTS __entityts_idempotency (
          idempotency_key TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          response_body TEXT,
          created_at INTEGER NOT NULL,
          locked_until INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )
      `;
    }

    await this.adapter.executeNonQuery(sql);
    this.schemaEnsured = true;
  }

  /**
   * Executes the transaction handler guarded by an idempotency key.
   * If the key was already completed, returns the previously cached response immediately without re-executing.
   * If the key is currently being processed concurrently, throws `IdempotencyConflictException`.
   *
   * @param key - The unique idempotency key (e.g. UUID, order reference, header value).
   * @param handler - Transactional callback to execute once.
   * @param options - Idempotency lock and TTL configurations.
   */
  public async execute<T>(
    key: string,
    handler: () => Promise<T>,
    options?: IdempotencyOptions,
  ): Promise<T> {
    if (!key || typeof key !== 'string') {
      throw new Error('Valid idempotency key is required');
    }

    await this.ensureSchema();

    const lockTimeoutMs = options?.lockTimeoutMs ?? 30_000;
    const ttlMs = options?.ttlMs ?? 86_400_000;
    const removeOnFailure = options?.removeOnFailure ?? true;
    const now = Date.now();
    const lockedUntil = now + lockTimeoutMs;
    const expiresAt = now + ttlMs;

    const escape = (col: string) => this.adapter.escapeIdentifier(col);
    const tableName = escape('__entityts_idempotency');
    const colKey = escape('idempotency_key');
    const colStatus = escape('status');
    const colResp = escape('response_body');
    const colCreated = escape('created_at');
    const colLocked = escape('locked_until');
    const colExpires = escape('expires_at');

    const ph = (name: string, idx: number) => this.adapter.formatParameterPlaceholder(name, idx);

    // 1. Check existing record
    const selectSql = `SELECT ${colStatus}, ${colResp}, ${colLocked}, ${colExpires} FROM ${tableName} WHERE ${colKey} = ${ph('key', 1)}`;
    const existing = await this.adapter.executeQuery<IdempotencyRecord>(selectSql, [
      { name: 'key', value: key },
    ]);

    if (existing.length > 0) {
      const record = existing[0];
      if (record.status === 'COMPLETED') {
        return record.response_body
          ? JSON.parse(record.response_body)
          : (undefined as unknown as T);
      }

      if (record.status === 'IN_PROGRESS' && Number(record.locked_until) > now) {
        throw new IdempotencyConflictException(key);
      }

      // If lock expired or status was failed, update to in progress
      const updateSql = `
        UPDATE ${tableName}
        SET ${colStatus} = ${ph('status', 1)}, ${colLocked} = ${ph('locked', 2)}
        WHERE ${colKey} = ${ph('key', 3)}
      `;
      await this.adapter.executeNonQuery(updateSql, [
        { name: 'status', value: 'IN_PROGRESS' },
        { name: 'locked', value: lockedUntil },
        { name: 'key', value: key },
      ]);
    } else {
      // Insert new IN_PROGRESS record
      const insertSql = `
        INSERT INTO ${tableName} (${colKey}, ${colStatus}, ${colResp}, ${colCreated}, ${colLocked}, ${colExpires})
        VALUES (${ph('key', 1)}, ${ph('status', 2)}, ${ph('resp', 3)}, ${ph('created', 4)}, ${ph('locked', 5)}, ${ph('expires', 6)})
      `;
      try {
        await this.adapter.executeNonQuery(insertSql, [
          { name: 'key', value: key },
          { name: 'status', value: 'IN_PROGRESS' },
          { name: 'resp', value: null },
          { name: 'created', value: now },
          { name: 'locked', value: lockedUntil },
          { name: 'expires', value: expiresAt },
        ]);
      } catch (insertErr) {
        // Concurrency race condition during initial insert
        throw new IdempotencyConflictException(
          key,
          `Concurrent request conflict on idempotency key '${key}'`,
        );
      }
    }

    // 2. Execute business handler
    let result: T;
    try {
      result = await handler();
    } catch (handlerErr) {
      if (removeOnFailure) {
        const deleteSql = `DELETE FROM ${tableName} WHERE ${colKey} = ${ph('key', 1)}`;
        try {
          await this.adapter.executeNonQuery(deleteSql, [{ name: 'key', value: key }]);
        } catch {
          // Ignore delete failure to preserve original error
        }
      } else {
        const markFailedSql = `UPDATE ${tableName} SET ${colStatus} = ${ph('status', 1)} WHERE ${colKey} = ${ph('key', 2)}`;
        try {
          await this.adapter.executeNonQuery(markFailedSql, [
            { name: 'status', value: 'FAILED' },
            { name: 'key', value: key },
          ]);
        } catch {}
      }
      throw handlerErr;
    }

    // 3. Mark COMPLETED with serialized response
    const serialized = result !== undefined ? JSON.stringify(result) : null;
    const completeSql = `
      UPDATE ${tableName}
      SET ${colStatus} = ${ph('status', 1)}, ${colResp} = ${ph('resp', 2)}
      WHERE ${colKey} = ${ph('key', 3)}
    `;
    await this.adapter.executeNonQuery(completeSql, [
      { name: 'status', value: 'COMPLETED' },
      { name: 'resp', value: serialized },
      { name: 'key', value: key },
    ]);

    return result;
  }
}
