import { IDbAdapter, DbProvider } from './IDbAdapter';
import { AdapterParam } from './AdapterParam';
import { StoredProcedureResult } from '../procedure/StoredProcedureResult';
import { ParameterDirection } from '../procedure/ParameterDirection';
import { IsolationLevel, DbTransaction, IDbTransactionDriver } from '../transaction';
import { ConnectionException, ProcedureException, QueryException, DatabaseErrorTranslator } from '../errors';

export interface PostgresAdapterConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | object;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  /** When true, uses named prepared statements for high-frequency banking throughput. */
  preparedStatements?: boolean;
}

export class PostgresAdapter implements IDbAdapter {
  public readonly provider: DbProvider = 'postgres';
  private pgModule: any;
  private pool: any;
  private readonly sqlTransformCache = new Map<string, string>();
  private readonly preparedStatements: boolean;

  constructor(private readonly config: PostgresAdapterConfig | string) {
    this.preparedStatements = typeof config === 'object' && config.preparedStatements === true;
  }

  public async connect(): Promise<void> {
    if (this.pool) return;
    try {
      this.pgModule = await this.resolvePg();
      const connConfig =
        typeof this.config === 'string'
          ? { connectionString: this.config }
          : this.config;
      this.pool = new this.pgModule.Pool(connConfig);
    } catch (err) {
      throw new ConnectionException(`Failed to connect to PostgreSQL: ${(err as Error).message}`, err);
    }
  }

  public async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  public async ping(): Promise<boolean> {
    try {
      await this.connect();
      const res = await this.pool.query('SELECT 1 AS ping');
      return res.rows && res.rows.length > 0;
    } catch {
      return false;
    }
  }

  private getStatementName(sql: string): string {
    let hash = 0;
    for (let i = 0; i < sql.length; i++) {
      hash = ((hash << 5) - hash + sql.charCodeAt(i)) | 0;
    }
    return `nsp_ps_${Math.abs(hash)}`;
  }

  public async executeQuery<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction
  ): Promise<T[]> {
    await this.connect();
    const client = transaction ? transaction.getDriver<any>().client : this.pool;
    const values = params ? params.map(p => p.value) : [];
    const transformedSql = this.transformSql(sql, params);

    try {
      let queryConfig: any = transformedSql;
      if (this.preparedStatements) {
        queryConfig = {
          name: this.getStatementName(transformedSql),
          text: transformedSql,
          values,
        };
        const res = await client.query(queryConfig);
        return res.rows as T[];
      }
      const res = await client.query(queryConfig, values);
      return res.rows as T[];
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this.provider);
    }
  }

  public async executeNonQuery(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction
  ): Promise<{ rowsAffected: number; insertId?: unknown }> {
    await this.connect();
    const client = transaction ? transaction.getDriver<any>().client : this.pool;
    const values = params ? params.map(p => p.value) : [];
    const transformedSql = this.transformSql(sql, params);

    try {
      let queryConfig: any = transformedSql;
      if (this.preparedStatements) {
        queryConfig = {
          name: this.getStatementName(transformedSql),
          text: transformedSql,
          values,
        };
        const res = await client.query(queryConfig);
        let insertId: unknown;
        if (res.rows && res.rows.length > 0) {
          const row = res.rows[0];
          insertId = row.id !== undefined ? row.id : Object.values(row)[0];
        }
        return { rowsAffected: res.rowCount ?? 0, insertId };
      }
      const res = await client.query(transformedSql, values);
      let insertId: unknown;
      if (res.rows && res.rows.length > 0) {
        const row = res.rows[0];
        insertId = row.id !== undefined ? row.id : Object.values(row)[0];
      }
      return { rowsAffected: res.rowCount ?? 0, insertId };
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this.provider);
    }
  }

  private transformSql(sql: string, params?: AdapterParam[]): string {
    if (!params || params.length === 0) return sql;

    const cached = this.sqlTransformCache.get(sql);
    if (cached) return cached;

    // 1. Replace @p0, @p1, etc. with $1, $2 (mapped by index: @p{i} -> ${i+1})
    let transformed = sql.replace(/@p(\d+)/g, (_, idx) => `$${parseInt(idx, 10) + 1}`);

    // 2. Replace any remaining ? placeholders sequentially with $1, $2, ...
    if (transformed.includes('?')) {
      let qIdx = 1;
      transformed = transformed.replace(/\?/g, () => `$${qIdx++}`);
    }

    if (this.sqlTransformCache.size < 2000) {
      this.sqlTransformCache.set(sql, transformed);
    }

    return transformed;
  }

  public async executeScalar<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction
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
    transaction?: DbTransaction
  ): Promise<StoredProcedureResult<T[]>> {
    await this.connect();
    const client = transaction ? transaction.getDriver<any>().client : this.pool;

    try {
      // In PostgreSQL:
      // CALL proc($1, $2, ...)
      // Postgres returns output/inout arguments as columns in res.rows[0]
      const inputParams = params.filter(
        p => p.direction !== ParameterDirection.ReturnValue
      );

      const placeholders = inputParams
        .map((_, idx) => `$${idx + 1}`)
        .join(', ');

      const callSql = `CALL ${this.escapeIdentifier(name)}(${placeholders})`;
      const values = inputParams.map(p => p.value ?? null);

      let res: any;
      let records: T[] = [];
      const outputParams: Record<string, unknown> = {};

      try {
        res = await client.query(callSql, values);
      } catch (callErr: any) {
        // Fallback: If procedure is a stored function returning a set/table, try SELECT * FROM func($1, ...)
        if (callErr.message && (callErr.message.includes('not a procedure') || callErr.code === '42809')) {
          const selectSql = `SELECT * FROM ${this.escapeIdentifier(name)}(${placeholders})`;
          res = await client.query(selectSql, values);
        } else {
          throw callErr;
        }
      }

      if (res.rows && res.rows.length > 0) {
        records = res.rows as T[];

        // Extract output parameters from the returned row
        const firstRow = res.rows[0];
        for (const p of params) {
          if (
            p.direction === ParameterDirection.Output ||
            p.direction === ParameterDirection.InputOutput
          ) {
            const lowerName = p.name.toLowerCase();
            const matchingKey = Object.keys(firstRow).find(
              k => k.toLowerCase() === lowerName
            );
            if (matchingKey) {
              outputParams[p.name] = firstRow[matchingKey];
            }
          }
        }
      }

      return {
        records,
        outputParams,
        returnValue: 0,
        rowsAffected: res.rowCount ?? records.length,
      };
    } catch (err) {
      throw DatabaseErrorTranslator.translateProcedure(err, name, this.provider);
    }
  }

  public async executeProcedureMultiple<T extends unknown[] = unknown[]>(
    name: string,
    params: AdapterParam[],
    timeoutMs?: number,
    transaction?: DbTransaction
  ): Promise<StoredProcedureResult<T>> {
    const single = await this.executeProcedure<any>(name, params, timeoutMs, transaction);
    return {
      records: [single.records] as unknown as T,
      outputParams: single.outputParams,
      returnValue: single.returnValue,
      rowsAffected: single.rowsAffected,
    };
  }

  public async beginTransaction(isolationLevel = IsolationLevel.ReadCommitted): Promise<DbTransaction> {
    await this.connect();
    const client = await this.pool.connect();
    await client.query(`BEGIN TRANSACTION ISOLATION LEVEL ${isolationLevel}`);

    const driver: IDbTransactionDriver = {
      client,
      commit: async () => {
        try {
          await client.query('COMMIT');
        } finally {
          client.release();
        }
      },
      rollback: async () => {
        try {
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      },
      savepoint: async (name: string) => {
        await client.query(`SAVEPOINT ${this.escapeIdentifier(name)}`);
      },
      rollbackTo: async (name: string) => {
        await client.query(`ROLLBACK TO SAVEPOINT ${this.escapeIdentifier(name)}`);
      },
    };

    return new DbTransaction(driver, isolationLevel);
  }

  public escapeIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  public formatParameterPlaceholder(_paramName: string, index: number): string {
    return `$${index}`;
  }

  private async resolvePg(): Promise<any> {
    const { loadDriver } = await import('./DriverLoader');
    return await loadDriver('postgres', 'pg');
  }
}
