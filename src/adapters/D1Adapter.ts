import { IDbAdapter, DbProvider } from './IDbAdapter';
import { AdapterParam } from './AdapterParam';
import { StoredProcedureResult } from '../procedure/StoredProcedureResult';
import { IsolationLevel, DbTransaction, IDbTransactionDriver } from '../transaction';
import { DbException, ProcedureException, QueryException } from '../errors';

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T = unknown>(): Promise<{
    results?: T[];
    success: boolean;
    meta?: { changes?: number; last_row_id?: number };
  }>;
  run<T = unknown>(): Promise<{
    success: boolean;
    meta?: { changes?: number; last_row_id?: number };
  }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch?<T = unknown>(statements: D1PreparedStatementLike[]): Promise<any[]>;
  exec?(query: string): Promise<any>;
}

export interface D1AdapterConfig {
  database: D1DatabaseLike;
}

/**
 * Cloudflare D1 serverless SQLite adapter.
 * Runs directly on Cloudflare Workers / Pages using the environment D1 binding.
 */
export class D1Adapter implements IDbAdapter {
  public readonly provider: DbProvider = 'd1';
  private readonly db: D1DatabaseLike;

  constructor(config: D1DatabaseLike | D1AdapterConfig) {
    if (config && 'prepare' in config && typeof (config as D1DatabaseLike).prepare === 'function') {
      this.db = config as D1DatabaseLike;
    } else if (config && (config as D1AdapterConfig).database) {
      this.db = (config as D1AdapterConfig).database;
    } else {
      throw new DbException('D1Adapter requires a valid D1Database binding instance.');
    }
  }

  public async connect(): Promise<void> {
    // Cloudflare D1 binding is always connected
  }

  public async disconnect(): Promise<void> {
    // Stateless edge environment
  }

  public async ping(): Promise<boolean> {
    try {
      const stmt = this.db.prepare('SELECT 1 AS ping');
      const res = await stmt.all();
      return !!(res.results && res.results.length > 0);
    } catch {
      return false;
    }
  }

  public async executeQuery<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    _transaction?: DbTransaction,
  ): Promise<T[]> {
    try {
      const values = params ? params.map(p => p.value) : [];
      const stmt = values.length > 0 ? this.db.prepare(sql).bind(...values) : this.db.prepare(sql);
      const res = await stmt.all<T>();
      return (res.results ?? []) as T[];
    } catch (err) {
      throw new QueryException(`Failed to execute D1 query: ${(err as Error).message}`, sql, err);
    }
  }

  public async executeNonQuery(
    sql: string,
    params?: AdapterParam[],
    _transaction?: DbTransaction,
  ): Promise<{ rowsAffected: number; insertId?: unknown }> {
    try {
      const values = params ? params.map(p => p.value) : [];
      const stmt = values.length > 0 ? this.db.prepare(sql).bind(...values) : this.db.prepare(sql);
      const res = await stmt.run();
      return {
        rowsAffected: res.meta?.changes ?? 0,
        insertId: res.meta?.last_row_id,
      };
    } catch (err) {
      throw new QueryException(
        `Failed to execute D1 non-query: ${(err as Error).message}`,
        sql,
        err,
      );
    }
  }

  public async executeScalar<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    _transaction?: DbTransaction,
  ): Promise<T> {
    const rows = await this.executeQuery<Record<string, unknown>>(sql, params, _transaction);
    if (!rows || rows.length === 0) return null as unknown as T;
    const first = rows[0];
    const keys = Object.keys(first);
    return (keys.length > 0 ? first[keys[0]] : null) as T;
  }

  public async executeProcedure<T = unknown>(
    name: string,
    params: AdapterParam[],
    _timeoutMs?: number,
    transaction?: DbTransaction,
  ): Promise<StoredProcedureResult<T[]>> {
    try {
      const records = await this.executeQuery<T>(name, params, transaction);
      return {
        records,
        outputParams: {},
        returnValue: 0,
        rowsAffected: records.length,
      };
    } catch (err) {
      throw new ProcedureException(
        `D1 does not natively support stored procedures ('${name}'): ${(err as Error).message}`,
        name,
        err,
      );
    }
  }

  public async executeProcedureMultiple<T extends unknown[] = unknown[]>(
    name: string,
    params: AdapterParam[],
    timeoutMs?: number,
    transaction?: DbTransaction,
  ): Promise<StoredProcedureResult<T>> {
    const single = await this.executeProcedure<any>(name, params, timeoutMs, transaction);
    return {
      records: [single.records] as unknown as T,
      outputParams: single.outputParams,
      returnValue: single.returnValue,
      rowsAffected: single.rowsAffected,
    };
  }

  public async beginTransaction(
    isolationLevel = IsolationLevel.ReadCommitted,
  ): Promise<DbTransaction> {
    // D1 in Cloudflare executes statements in autocommit; batch executions are atomic.
    if (this.db.exec) {
      await this.db.exec('BEGIN TRANSACTION');
    }

    const driver: IDbTransactionDriver = {
      commit: async () => {
        if (this.db.exec) await this.db.exec('COMMIT');
      },
      rollback: async () => {
        if (this.db.exec) await this.db.exec('ROLLBACK');
      },
    };

    return new DbTransaction(driver, isolationLevel);
  }

  public escapeIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  public formatParameterPlaceholder(_paramName: string, _index: number): string {
    return '?';
  }
}
