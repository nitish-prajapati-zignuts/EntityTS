import { IDbAdapter, DbProvider } from './IDbAdapter';
import { AdapterParam } from './AdapterParam';
import { StoredProcedureResult } from '../procedure/StoredProcedureResult';
import { ParameterDirection } from '../procedure/ParameterDirection';
import { IsolationLevel, DbTransaction, IDbTransactionDriver } from '../transaction';
import {
  ConnectionException,
  ProcedureException,
  QueryException,
  DatabaseErrorTranslator,
} from '../errors';

export interface MysqlAdapterConfig {
  uri?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  connectionLimit?: number;
  waitForConnections?: boolean;
  multipleStatements?: boolean;
}

export class MysqlAdapter implements IDbAdapter {
  public readonly provider: DbProvider = 'mysql';
  private mysqlModule: any;
  private pool: any;

  constructor(private readonly config: MysqlAdapterConfig | string) {}

  public async connect(): Promise<void> {
    if (this.pool) return;
    try {
      this.mysqlModule = await this.resolveMysql();
      const connConfig =
        typeof this.config === 'string'
          ? this.config
          : {
              ...this.config,
              multipleStatements: true,
            };
      this.pool = this.mysqlModule.createPool(connConfig);
    } catch (err) {
      throw new ConnectionException(`Failed to connect to MySQL: ${(err as Error).message}`, err);
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
      const [rows] = await this.pool.query('SELECT 1 AS ping');
      return Array.isArray(rows) && rows.length > 0;
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
    const conn = transaction ? transaction.getDriver<any>().connection : this.pool;
    const values = params ? params.map(p => p.value) : [];

    try {
      const [rows] = await conn.query(sql, values);
      return (Array.isArray(rows) ? rows : [rows]) as T[];
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this.provider);
    }
  }

  public async executeNonQuery(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): Promise<{ rowsAffected: number; insertId?: unknown }> {
    await this.connect();
    const conn = transaction ? transaction.getDriver<any>().connection : this.pool;
    const values = params ? params.map(p => p.value) : [];

    try {
      const [result] = await conn.query(sql, values);
      return {
        rowsAffected: (result as any).affectedRows ?? 0,
        insertId: (result as any).insertId,
      };
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this.provider);
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
    await this.connect();
    const conn = transaction ? transaction.getDriver<any>().connection : this.pool;

    try {
      // Separate inputs and outputs
      const inputValues: unknown[] = [];
      const callArgs: string[] = [];
      const outVarNames: string[] = [];

      for (const p of params) {
        if (p.direction === ParameterDirection.Output) {
          const varName = `@out_${p.name}`;
          callArgs.push(varName);
          outVarNames.push(`${varName} AS ${this.escapeIdentifier(p.name)}`);
        } else if (p.direction === ParameterDirection.InputOutput) {
          const varName = `@inout_${p.name}`;
          // Set inout variable first
          await conn.query(`SET ${varName} = ?`, [p.value]);
          callArgs.push(varName);
          outVarNames.push(`${varName} AS ${this.escapeIdentifier(p.name)}`);
        } else if (p.direction === ParameterDirection.ReturnValue) {
          // ignore in MySQL
        } else {
          callArgs.push('?');
          inputValues.push(p.value ?? null);
        }
      }

      let query = `CALL ${this.escapeIdentifier(name)}(${callArgs.join(', ')})`;
      if (outVarNames.length > 0) {
        query += `; SELECT ${outVarNames.join(', ')}`;
      }

      const [res] = await conn.query(query, inputValues);

      let records: T[] = [];
      const outputParams: Record<string, unknown> = {};

      if (Array.isArray(res)) {
        if (outVarNames.length > 0) {
          // The last result set contains the output variables
          const lastItem = res[res.length - 1];
          if (Array.isArray(lastItem) && lastItem.length > 0) {
            Object.assign(outputParams, lastItem[0]);
          }
          // The records are in the prior sets if any
          if (res.length > 1 && Array.isArray(res[0])) {
            records = res[0] as T[];
          }
        } else {
          // First item is the record set
          if (res.length > 0 && Array.isArray(res[0])) {
            records = res[0] as T[];
          }
        }
      }

      return {
        records,
        outputParams,
        returnValue: 0,
        rowsAffected: records.length,
      };
    } catch (err) {
      throw DatabaseErrorTranslator.translateProcedure(err, name, this.provider);
    }
  }

  public async executeProcedureMultiple<T extends unknown[] = unknown[]>(
    name: string,
    params: AdapterParam[],
    timeoutMs?: number,
    transaction?: DbTransaction,
  ): Promise<StoredProcedureResult<T>> {
    await this.connect();
    const conn = transaction ? transaction.getDriver<any>().connection : this.pool;

    try {
      const callPlaceholders = params.map(() => '?').join(', ');
      const [res] = await conn.query(
        `CALL ${this.escapeIdentifier(name)}(${callPlaceholders})`,
        params.map(p => p.value),
      );

      const resultSets = Array.isArray(res)
        ? (res.filter(item => Array.isArray(item)) as unknown as T)
        : ([] as unknown as T);

      return {
        records: resultSets,
        outputParams: {},
        returnValue: 0,
        rowsAffected: 0,
      };
    } catch (err) {
      throw new ProcedureException(
        `Failed to execute MySQL procedure multiple: ${(err as Error).message}`,
        name,
        err,
      );
    }
  }

  public async beginTransaction(
    isolationLevel = IsolationLevel.ReadCommitted,
  ): Promise<DbTransaction> {
    await this.connect();
    const connection = await this.pool.getConnection();
    await connection.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
    await connection.beginTransaction();

    const driver: IDbTransactionDriver = {
      connection,
      commit: async () => {
        try {
          await connection.commit();
        } finally {
          connection.release();
        }
      },
      rollback: async () => {
        try {
          await connection.rollback();
        } finally {
          connection.release();
        }
      },
      savepoint: async (name: string) => {
        await connection.query(`SAVEPOINT ${this.escapeIdentifier(name)}`);
      },
      rollbackTo: async (name: string) => {
        await connection.query(`ROLLBACK TO SAVEPOINT ${this.escapeIdentifier(name)}`);
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

  private async resolveMysql(): Promise<any> {
    const { loadDriver } = await import('./DriverLoader');
    return await loadDriver('mysql', 'mysql2/promise');
  }
}
