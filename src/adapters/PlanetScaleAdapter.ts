import { IDbAdapter, DbProvider } from './IDbAdapter';
import { AdapterParam } from './AdapterParam';
import { StoredProcedureResult } from '../procedure/StoredProcedureResult';
import { IsolationLevel, DbTransaction, IDbTransactionDriver } from '../transaction';
import { ConnectionException, ProcedureException, QueryException } from '../errors';

export interface PlanetScaleAdapterConfig {
  url?: string;
  host?: string;
  username?: string;
  password?: string;
  fetch?: any;
}

/**
 * PlanetScale serverless MySQL adapter using `@planetscale/database`.
 * Communicates with PlanetScale over HTTP with low latency.
 */
export class PlanetScaleAdapter implements IDbAdapter {
  public readonly provider: DbProvider = 'planetscale';
  private psModule: any;
  private connection: any;

  constructor(private readonly config: PlanetScaleAdapterConfig | string) {}

  public async connect(): Promise<void> {
    if (this.connection) return;
    try {
      this.psModule = await this.resolvePlanetScale();
      const connConfig = typeof this.config === 'string' ? { url: this.config } : this.config;
      this.connection = this.psModule.connect(connConfig);
    } catch (err) {
      throw new ConnectionException(
        `Failed to connect to PlanetScale: ${(err as Error).message}`,
        err,
      );
    }
  }

  public async disconnect(): Promise<void> {
    // PlanetScale connection is stateless HTTP fetch; clear handle
    this.connection = null;
  }

  public async ping(): Promise<boolean> {
    try {
      await this.connect();
      const res = await this.connection.execute('SELECT 1 AS ping');
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
    const client = transaction ? transaction.getDriver<any>().client : this.connection;
    const values = params ? params.map(p => p.value) : [];

    try {
      const res = await client.execute(sql, values);
      return (res.rows ?? []) as T[];
    } catch (err) {
      throw new QueryException(
        `Failed to execute PlanetScale query: ${(err as Error).message}`,
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
    const client = transaction ? transaction.getDriver<any>().client : this.connection;
    const values = params ? params.map(p => p.value) : [];

    try {
      const res = await client.execute(sql, values);
      return {
        rowsAffected: res.rowsAffected ?? 0,
        insertId: res.insertId,
      };
    } catch (err) {
      throw new QueryException(
        `Failed to execute PlanetScale non-query: ${(err as Error).message}`,
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
    // PlanetScale does not support stored procedures directly over HTTP
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
        `PlanetScale does not natively support stored procedures ('${name}'): ${(err as Error).message}`,
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
    let txClient: any;
    let txEndResolve: (value?: unknown) => void;
    let txEndReject: (reason?: any) => void;

    const txReady = new Promise<void>((resolveReady, rejectReady) => {
      this.connection
        .transaction(async (tx: any) => {
          txClient = tx;
          resolveReady();
          await new Promise((resolve, reject) => {
            txEndResolve = resolve;
            txEndReject = reject;
          });
        })
        .catch((err: any) => {
          rejectReady(err);
        });
    });

    await txReady;

    const driver: IDbTransactionDriver = {
      client: txClient,
      commit: async () => {
        if (txEndResolve) txEndResolve();
      },
      rollback: async () => {
        if (txEndReject) txEndReject(new Error('Transaction rolled back'));
      },
    };

    return new DbTransaction(driver, isolationLevel);
  }

  public escapeIdentifier(name: string): string {
    return `\`${name.replace(/`/g, '``')}\``;
  }

  public formatParameterPlaceholder(_paramName: string, _index: number): string {
    return '?';
  }

  private async resolvePlanetScale(): Promise<any> {
    const { loadDriver } = await import('./DriverLoader');
    return await loadDriver('planetscale', '@planetscale/database');
  }
}
