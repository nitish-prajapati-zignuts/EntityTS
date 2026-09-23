import { IDbAdapter, DbProvider } from '../adapters/IDbAdapter';
import { AdapterParam } from '../adapters/AdapterParam';
import { StoredProcedureResult } from '../procedure/StoredProcedureResult';
import { IsolationLevel, DbTransaction } from '../transaction';
import { IConnectionPool, ConnectionPoolOptions } from './IConnectionPool';
import { ConnectionPool } from './ConnectionPool';

/**
 * Adapter decorator that manages connection pooling, acquisition bounds,
 * and background health heartbeat checks over any underlying IDbAdapter.
 */
export class PooledDbAdapter implements IDbAdapter {
  public readonly pool: IConnectionPool;

  constructor(
    private readonly inner: IDbAdapter,
    poolOrOptions?: IConnectionPool | ConnectionPoolOptions,
  ) {
    if (
      poolOrOptions &&
      'acquire' in poolOrOptions &&
      typeof poolOrOptions.acquire === 'function'
    ) {
      this.pool = poolOrOptions;
    } else {
      this.pool = new ConnectionPool(inner, poolOrOptions as ConnectionPoolOptions | undefined);
    }
  }

  public get connectionPool(): IConnectionPool {
    return this.pool;
  }

  public get provider(): DbProvider {
    return this.inner.provider;
  }

  public get innerAdapter(): IDbAdapter {
    return this.inner;
  }

  public async connect(): Promise<void> {
    await this.inner.connect();
    await this.pool.start();
  }

  public async disconnect(): Promise<void> {
    await this.pool.close();
    await this.inner.disconnect();
  }

  public async ping(): Promise<boolean> {
    return this.pool.ping();
  }

  public escapeIdentifier(name: string): string {
    return this.inner.escapeIdentifier(name);
  }

  public formatParameterPlaceholder(paramName: string, index: number): string {
    return this.inner.formatParameterPlaceholder(paramName, index);
  }

  public async beginTransaction(isolationLevel?: IsolationLevel): Promise<DbTransaction> {
    await this.pool.acquire();
    try {
      const tx = await this.inner.beginTransaction(isolationLevel);
      // Hook transaction commit/rollback to release the pool lease
      const originalCommit = tx.commit.bind(tx);
      const originalRollback = tx.rollback.bind(tx);
      let released = false;

      const safeRelease = () => {
        if (!released) {
          released = true;
          this.pool.release();
        }
      };

      tx.commit = async () => {
        try {
          await originalCommit();
        } finally {
          safeRelease();
        }
      };

      tx.rollback = async () => {
        try {
          await originalRollback();
        } finally {
          safeRelease();
        }
      };

      return tx;
    } catch (err) {
      this.pool.release();
      throw err;
    }
  }

  private async withConnection<T>(fn: () => Promise<T>, transaction?: DbTransaction): Promise<T> {
    if (transaction !== undefined) {
      // Transaction already holds an active lease
      return fn();
    }

    await this.pool.acquire();
    try {
      return await fn();
    } finally {
      this.pool.release();
    }
  }

  public async executeQuery<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): Promise<T[]> {
    return this.withConnection(
      () => this.inner.executeQuery<T>(sql, params, transaction),
      transaction,
    );
  }

  public async executeNonQuery(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): Promise<{ rowsAffected: number; insertId?: unknown }> {
    return this.withConnection(
      () => this.inner.executeNonQuery(sql, params, transaction),
      transaction,
    );
  }

  public async executeScalar<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): Promise<T> {
    return this.withConnection(
      () => this.inner.executeScalar<T>(sql, params, transaction),
      transaction,
    );
  }

  public async executeProcedure<T = unknown>(
    name: string,
    params: AdapterParam[],
    timeoutMs?: number,
    transaction?: DbTransaction,
  ): Promise<StoredProcedureResult<T[]>> {
    return this.withConnection(
      () => this.inner.executeProcedure<T>(name, params, timeoutMs, transaction),
      transaction,
    );
  }

  public async executeProcedureMultiple<T extends unknown[] = unknown[]>(
    name: string,
    params: AdapterParam[],
    timeoutMs?: number,
    transaction?: DbTransaction,
  ): Promise<StoredProcedureResult<T>> {
    return this.withConnection(
      () => this.inner.executeProcedureMultiple<T>(name, params, timeoutMs, transaction),
      transaction,
    );
  }

  public executeStream?<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): AsyncIterable<T> {
    if (this.inner.executeStream) {
      return this.inner.executeStream<T>(sql, params, transaction);
    }
    throw new Error(`Inner adapter '${this.inner.provider}' does not support executeStream.`);
  }
}
