import { IDbAdapter, DbProvider } from './IDbAdapter';
import { AdapterParam } from './AdapterParam';
import { StoredProcedureResult } from '../procedure/StoredProcedureResult';
import { ParameterDirection } from '../procedure/ParameterDirection';
import { SqlType } from '../procedure/SqlType';
import { IsolationLevel, DbTransaction, IDbTransactionDriver } from '../transaction';
import { ConnectionException, ProcedureException, QueryException, DatabaseErrorTranslator } from '../errors';

export interface MssqlAdapterConfig {
  connectionString?: string;
  server?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    enableArithAbort?: boolean;
    instanceName?: string;
    connectTimeout?: number;
    requestTimeout?: number;
  };
  pool?: {
    max?: number;
    min?: number;
    idleTimeoutMillis?: number;
  };
}

export class MssqlAdapter implements IDbAdapter {
  public readonly provider: DbProvider = 'mssql';
  private mssqlModule: any;
  private pool: any;

  constructor(private readonly config: MssqlAdapterConfig | string) {}

  public async connect(): Promise<void> {
    if (this.pool && this.pool.connected) {
      return;
    }

    try {
      this.mssqlModule = await this.resolveMssql();
      const connConfig =
        typeof this.config === 'string'
          ? this.config
          : {
              server: this.config.server,
              port: this.config.port,
              user: this.config.user,
              password: this.config.password,
              database: this.config.database,
              options: {
                encrypt: true,
                trustServerCertificate: true,
                ...this.config.options,
              },
              pool: this.config.pool,
            };

      this.pool = new this.mssqlModule.ConnectionPool(connConfig);
      await this.pool.connect();
    } catch (err) {
      throw new ConnectionException(`Failed to connect to SQL Server: ${(err as Error).message}`, err);
    }
  }

  public async disconnect(): Promise<void> {
    if (this.pool && this.pool.connected) {
      await this.pool.close();
    }
  }

  public async ping(): Promise<boolean> {
    try {
      await this.connect();
      const res = await this.pool.request().query('SELECT 1 AS ping');
      return res.recordset && res.recordset.length > 0;
    } catch {
      return false;
    }
  }

  public async executeQuery<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction
  ): Promise<T[]> {
    await this.connect();
    try {
      const request = this.createRequest(transaction);
      this.bindParameters(request, params);
      const res = await request.query(sql);
      return (res.recordset || []) as T[];
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
    try {
      const request = this.createRequest(transaction);
      this.bindParameters(request, params);
      const res = await request.query(sql);
      const rowsAffected = Array.isArray(res.rowsAffected)
        ? res.rowsAffected.reduce((a: number, b: number) => a + b, 0)
        : res.rowsAffected || 0;
      return { rowsAffected };
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this.provider);
    }
  }

  public async executeScalar<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction
  ): Promise<T> {
    const rows = await this.executeQuery<Record<string, unknown>>(sql, params, transaction);
    if (!rows || rows.length === 0) {
      return null as unknown as T;
    }
    const firstRow = rows[0];
    const keys = Object.keys(firstRow);
    return (keys.length > 0 ? firstRow[keys[0]] : null) as T;
  }

  public async executeProcedure<T = unknown>(
    name: string,
    params: AdapterParam[],
    timeoutMs?: number,
    transaction?: DbTransaction
  ): Promise<StoredProcedureResult<T[]>> {
    await this.connect();
    try {
      const request = this.createRequest(transaction);
      if (timeoutMs) {
        request.timeout = timeoutMs;
      }
      this.bindParameters(request, params);
      const res = await request.execute(name);

      const rowsAffected = Array.isArray(res.rowsAffected)
        ? res.rowsAffected.reduce((a: number, b: number) => a + b, 0)
        : res.rowsAffected || 0;

      return {
        records: (res.recordset || []) as T[],
        outputParams: res.output || {},
        returnValue: res.returnValue ?? 0,
        rowsAffected,
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
    await this.connect();
    try {
      const request = this.createRequest(transaction);
      if (timeoutMs) {
        request.timeout = timeoutMs;
      }
      this.bindParameters(request, params);
      const res = await request.execute(name);

      const rowsAffected = Array.isArray(res.rowsAffected)
        ? res.rowsAffected.reduce((a: number, b: number) => a + b, 0)
        : res.rowsAffected || 0;

      return {
        records: (res.recordsets || []) as unknown as T,
        outputParams: res.output || {},
        returnValue: res.returnValue ?? 0,
        rowsAffected,
      };
    } catch (err) {
      throw new ProcedureException(
        `Failed to execute procedure '${name}': ${(err as Error).message}`,
        name,
        err
      );
    }
  }

  public async beginTransaction(isolationLevel = IsolationLevel.ReadCommitted): Promise<DbTransaction> {
    await this.connect();
    const tx = new this.mssqlModule.Transaction(this.pool);
    const mssqlIso = this.mapIsolationLevel(isolationLevel);
    await tx.begin(mssqlIso);

    const driver: IDbTransactionDriver = {
      commit: async () => tx.commit(),
      rollback: async () => tx.rollback(),
      savepoint: async (name: string) => {
        const req = new this.mssqlModule.Request(tx);
        await req.query(`SAVE TRANSACTION ${this.escapeIdentifier(name)}`);
      },
      rollbackTo: async (name: string) => {
        const req = new this.mssqlModule.Request(tx);
        await req.query(`ROLLBACK TRANSACTION ${this.escapeIdentifier(name)}`);
      },
    };

    return new DbTransaction(driver, isolationLevel);
  }

  public escapeIdentifier(name: string): string {
    return `[${name.replace(/\]/g, ']]')}]`;
  }

  public formatParameterPlaceholder(paramName: string, _index: number): string {
    return `@${paramName}`;
  }

  private createRequest(transaction?: DbTransaction): any {
    if (transaction) {
      const driver = transaction.getDriver<any>();
      return new this.mssqlModule.Request(driver.tx || driver);
    }
    return this.pool.request();
  }

  private bindParameters(request: any, params?: AdapterParam[]): void {
    if (!params) return;

    for (const p of params) {
      const type = p.type ? this.mapSqlType(p.type, p.maxLength, p.precision, p.scale) : undefined;

      if (p.direction === ParameterDirection.Output) {
        if (type) {
          request.output(p.name, type);
        } else {
          request.output(p.name);
        }
      } else if (p.direction === ParameterDirection.InputOutput) {
        if (type) {
          request.output(p.name, type, p.value);
        } else {
          request.output(p.name, undefined, p.value);
        }
      } else if (p.direction === ParameterDirection.ReturnValue) {
        // SQL Server captures returnValue on execute() response automatically
      } else {
        // Input parameter
        if (type) {
          request.input(p.name, type, p.value);
        } else {
          request.input(p.name, p.value);
        }
      }
    }
  }

  private mapSqlType(
    type: SqlType,
    maxLength?: number,
    precision?: number,
    scale?: number
  ): any {
    const m = this.mssqlModule;
    switch (type) {
      case SqlType.VarChar:
        return maxLength !== undefined ? m.VarChar(maxLength) : m.VarChar(m.MAX);
      case SqlType.NVarChar:
        return maxLength !== undefined ? m.NVarChar(maxLength) : m.NVarChar(m.MAX);
      case SqlType.Text:
        return m.Text;
      case SqlType.NText:
        return m.NText;
      case SqlType.Char:
        return maxLength !== undefined ? m.Char(maxLength) : m.Char(1);
      case SqlType.NChar:
        return maxLength !== undefined ? m.NChar(maxLength) : m.NChar(1);
      case SqlType.Int:
        return m.Int;
      case SqlType.BigInt:
        return m.BigInt;
      case SqlType.SmallInt:
        return m.SmallInt;
      case SqlType.TinyInt:
        return m.TinyInt;
      case SqlType.Decimal:
      case SqlType.Numeric:
        return precision !== undefined ? m.Decimal(precision, scale) : m.Decimal(18, 2);
      case SqlType.Float:
        return m.Float;
      case SqlType.Real:
        return m.Real;
      case SqlType.Money:
        return m.Money;
      case SqlType.Bit:
      case SqlType.Boolean:
        return m.Bit;
      case SqlType.Date:
        return m.Date;
      case SqlType.DateTime:
        return m.DateTime;
      case SqlType.DateTime2:
        return m.DateTime2(scale ?? 7);
      case SqlType.Time:
        return m.Time(scale ?? 7);
      case SqlType.DateTimeOffset:
        return m.DateTimeOffset(scale ?? 7);
      case SqlType.Binary:
        return m.Binary(maxLength ?? 8000);
      case SqlType.VarBinary:
        return maxLength !== undefined ? m.VarBinary(maxLength) : m.VarBinary(m.MAX);
      case SqlType.UniqueIdentifier:
      case SqlType.Uuid:
        return m.UniqueIdentifier;
      case SqlType.Xml:
        return m.Xml;
      case SqlType.Json:
        return m.NVarChar(m.MAX);
      default:
        return undefined;
    }
  }

  private mapIsolationLevel(level: IsolationLevel): any {
    const m = this.mssqlModule.ISOLATION_LEVEL;
    switch (level) {
      case IsolationLevel.ReadUncommitted:
        return m.READ_UNCOMMITTED;
      case IsolationLevel.ReadCommitted:
        return m.READ_COMMITTED;
      case IsolationLevel.RepeatableRead:
        return m.REPEATABLE_READ;
      case IsolationLevel.Serializable:
        return m.SERIALIZABLE;
      case IsolationLevel.Snapshot:
        return m.SNAPSHOT;
      default:
        return m.READ_COMMITTED;
    }
  }

  private async resolveMssql(): Promise<any> {
    const { loadDriver } = await import('./DriverLoader');
    return await loadDriver('mssql', 'mssql');
  }
}
