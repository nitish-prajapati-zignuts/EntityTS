import { AdapterParam } from './AdapterParam';
import { StoredProcedureResult } from '../procedure/StoredProcedureResult';
import { IsolationLevel, DbTransaction } from '../transaction';
import type { IConnectionPool } from '../pool/IConnectionPool';

export type DbProvider =
  | 'mssql'
  | 'postgres'
  | 'mysql'
  | 'sqlite'
  | 'mock'
  | 'neon'
  | 'planetscale'
  | 'turso'
  | 'cockroachdb'
  | 'd1'
  | 'supabase';

export interface IDbAdapter {
  readonly provider: DbProvider;
  readonly connectionPool?: IConnectionPool;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<boolean>;

  executeQuery<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): Promise<T[]>;

  executeNonQuery(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): Promise<{ rowsAffected: number; insertId?: unknown }>;

  executeScalar<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): Promise<T>;

  executeProcedure<T = unknown>(
    name: string,
    params: AdapterParam[],
    timeoutMs?: number,
    transaction?: DbTransaction,
  ): Promise<StoredProcedureResult<T[]>>;

  executeProcedureMultiple<T extends unknown[] = unknown[]>(
    name: string,
    params: AdapterParam[],
    timeoutMs?: number,
    transaction?: DbTransaction,
  ): Promise<StoredProcedureResult<T>>;

  beginTransaction(isolationLevel?: IsolationLevel): Promise<DbTransaction>;

  escapeIdentifier(name: string): string;
  formatParameterPlaceholder(paramName: string, index: number): string;

  /**
   * Optional: streams large result sets as an `AsyncIterable` without loading all rows into memory.
   *
   * Adapters that don't implement this method will fall back to `DbSet.stream()`'s
   * built-in batched-pagination polyfill, which works on every adapter.
   */
  executeStream?<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): AsyncIterable<T>;
}
