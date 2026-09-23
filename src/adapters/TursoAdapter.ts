import { IDbAdapter, DbProvider } from './IDbAdapter';
import { AdapterParam } from './AdapterParam';
import { StoredProcedureResult } from '../procedure/StoredProcedureResult';
import { IsolationLevel, DbTransaction, IDbTransactionDriver } from '../transaction';
import { ConnectionException, ProcedureException, QueryException } from '../errors';

export interface TursoAdapterConfig {
  url: string;
  authToken?: string;
  tls?: boolean;
  intMode?: 'number' | 'bigint' | 'string';
}

/**
 * Turso / libSQL adapter using `@libsql/client`.
 * Works with remote Turso edge databases, embedded replicas, or local libSQL files.
 */
export class TursoAdapter implements IDbAdapter {
  public readonly provider: DbProvider = 'turso';
  private libsqlModule: any;
  private client: any;

  constructor(private readonly config: TursoAdapterConfig | string) {}

  public async connect(): Promise<void> {
    if (this.client) return;
    try {
      this.libsqlModule = await this.resolveLibsql();
      const connConfig = typeof this.config === 'string' ? { url: this.config } : this.config;
      this.client = this.libsqlModule.createClient(connConfig);
    } catch (err) {
      throw new ConnectionException(
        `Failed to connect to Turso / libSQL: ${(err as Error).message}`,
        err,
      );
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      if (typeof this.client.close === 'function') {
        this.client.close();
      }
      this.client = null;
    }
  }

  public async ping(): Promise<boolean> {
    try {
      await this.connect();
      const res = await this.client.execute('SELECT 1 AS ping');
      return !!(res.rows && res.rows.length > 0);
    } catch {
      return false;
    }
  }

  public async executeQuery<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): Promise<T[]> {
    await this.connect();
    const runner = transaction ? transaction.getDriver<any>().client : this.client;
    const values = params ? params.map(p => p.value) : [];

    try {
      const res = await runner.execute({ sql, args: values });
      return (res.rows ?? []) as T[];
    } catch (err) {
      throw new QueryException(
        `Failed to execute Turso / libSQL query: ${(err as Error).message}`,
        sql,
        err,
      );
    }
  }

  public async executeNonQuery(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): Promise<{ rowsAffected: number; insertId?: unknown }> {
    await this.connect();
    const runner = transaction ? transaction.getDriver<any>().client : this.client;
    const values = params ? params.map(p => p.value) : [];

    try {
      const res = await runner.execute({ sql, args: values });
      return {
        rowsAffected: res.rowsAffected ?? 0,
        insertId: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : undefined,
      };
    } catch (err) {
      throw new QueryException(
        `Failed to execute Turso / libSQL non-query: ${(err as Error).message}`,
        sql,
        err,
      );
    }
  }

  public async executeScalar<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): Promise<T> {
    const rows = await this.executeQuery<Record<string, unknown>>(sql, params, transaction);
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
        `Turso does not natively support stored procedures ('${name}'): ${(err as Error).message}`,
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
    await this.connect();
    const tx = await this.client.transaction();

    const driver: IDbTransactionDriver = {
      client: tx,
      commit: async () => {
        await tx.commit();
      },
      rollback: async () => {
        await tx.rollback();
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

  private async resolveLibsql(): Promise<any> {
    const { loadDriver } = await import('./DriverLoader');
    return await loadDriver('turso', '@libsql/client');
  }
}
