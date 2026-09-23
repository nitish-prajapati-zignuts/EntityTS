import { IDbAdapter, DbProvider } from './IDbAdapter';
import { AdapterParam } from './AdapterParam';
import { StoredProcedureResult } from '../procedure/StoredProcedureResult';
import { IsolationLevel, DbTransaction, IDbTransactionDriver } from '../transaction';
import { ConnectionException, QueryException, ProcedureException, DatabaseErrorTranslator } from '../errors';

export interface SqliteAdapterConfig {
  filename: string;
  readonly?: boolean;
  fileMustExist?: boolean;
  timeout?: number;
  verbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
}

export class SqliteAdapter implements IDbAdapter {
  public readonly provider: DbProvider = 'sqlite';
  private sqliteModule: any;
  private db: any;

  constructor(private readonly config: SqliteAdapterConfig | string) {}

  public async connect(): Promise<void> {
    if (this.db) return;
    try {
      this.sqliteModule = await this.resolveSqlite();
      const filename = typeof this.config === 'string' ? this.config : this.config.filename;
      const options = typeof this.config === 'string' ? {} : this.config;
      this.db = new this.sqliteModule(filename, options);
    } catch (err) {
      throw new ConnectionException(`Failed to open SQLite database: ${(err as Error).message}`, err);
    }
  }

  public async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  public async ping(): Promise<boolean> {
    try {
      await this.connect();
      const res = this.db.prepare('SELECT 1 AS ping').get();
      return !!res;
    } catch {
      return false;
    }
  }

  private normalizeValue(val: unknown): unknown {
    if (val === undefined) return null;
    if (val instanceof Date) return val.toISOString();
    if (typeof val === 'boolean') return val ? 1 : 0;
    return val;
  }

  private transformSql(sql: string): string {
    return sql.replace(/@p\d+/g, '?');
  }

  public async executeQuery<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    _transaction?: DbTransaction
  ): Promise<T[]> {
    await this.connect();
    try {
      const stmt = this.db.prepare(this.transformSql(sql));
      const values = params ? params.map(p => this.normalizeValue(p.value)) : [];
      return stmt.all(...values) as T[];
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this.provider);
    }
  }

  public async executeNonQuery(
    sql: string,
    params?: AdapterParam[],
    _transaction?: DbTransaction
  ): Promise<{ rowsAffected: number; insertId?: unknown }> {
    await this.connect();
    try {
      const stmt = this.db.prepare(this.transformSql(sql));
      const values = params ? params.map(p => this.normalizeValue(p.value)) : [];
      const info = stmt.run(...values);
      return {
        rowsAffected: info.changes ?? 0,
        insertId: info.lastInsertRowid,
      };
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this.provider);
    }
  }

  public async executeScalar<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    _transaction?: DbTransaction
  ): Promise<T> {
    await this.connect();
    try {
      const stmt = this.db.prepare(this.transformSql(sql));
      const values = params ? params.map(p => this.normalizeValue(p.value)) : [];
      const row = stmt.get(...values);
      if (!row) return null as unknown as T;
      const keys = Object.keys(row);
      return (keys.length > 0 ? row[keys[0]] : null) as T;
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this.provider);
    }
  }

  public async executeProcedure<T = unknown>(
    name: string,
    params: AdapterParam[],
    _timeoutMs?: number,
    transaction?: DbTransaction
  ): Promise<StoredProcedureResult<T[]>> {
    // SQLite does not support native stored procedures.
    // If user passed a query string as procedure name or a registered statement, execute it
    try {
      const records = await this.executeQuery<T>(name, params, transaction);
      return {
        records,
        outputParams: {},
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
    this.db.exec('BEGIN TRANSACTION');

    const driver: IDbTransactionDriver = {
      commit: async () => {
        this.db.exec('COMMIT');
      },
      rollback: async () => {
        this.db.exec('ROLLBACK');
      },
      savepoint: async (name: string) => {
        this.db.exec(`SAVEPOINT ${this.escapeIdentifier(name)}`);
      },
      rollbackTo: async (name: string) => {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${this.escapeIdentifier(name)}`);
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

  private async resolveSqlite(): Promise<any> {
    const { loadDriver } = await import('./DriverLoader');
    const mod = await loadDriver('sqlite', 'better-sqlite3');
    return mod.default || mod;
  }
}
