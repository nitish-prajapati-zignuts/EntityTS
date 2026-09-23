import { IDbAdapter, DbProvider } from './IDbAdapter';
import { AdapterParam } from './AdapterParam';
import { StoredProcedureResult } from '../procedure/StoredProcedureResult';
import { IsolationLevel, DbTransaction } from '../transaction';
import { QueryHooks } from '../hooks/QueryHook';
import { LogMode, LogFunction } from '../context/DbContextOptions';
import type { IConnectionPool } from '../pool/IConnectionPool';

export class InterceptingDbAdapter implements IDbAdapter {
  constructor(
    private readonly inner: IDbAdapter,
    private readonly hooks?: QueryHooks,
    private readonly logging?: LogMode,
  ) {}

  public get provider(): DbProvider {
    return this.inner.provider;
  }

  public get pool(): IConnectionPool | undefined {
    return this.inner.connectionPool || (this.inner as any).pool;
  }

  public get connectionPool(): IConnectionPool | undefined {
    return this.inner.connectionPool;
  }

  public get innerAdapter(): IDbAdapter {
    return this.inner;
  }

  public connect(): Promise<void> {
    return this.inner.connect();
  }

  public disconnect(): Promise<void> {
    return this.inner.disconnect();
  }

  public ping(): Promise<boolean> {
    return this.inner.ping();
  }

  public escapeIdentifier(name: string): string {
    return this.inner.escapeIdentifier(name);
  }

  public formatParameterPlaceholder(paramName: string, index: number): string {
    return this.inner.formatParameterPlaceholder(paramName, index);
  }

  public beginTransaction(isolationLevel?: IsolationLevel): Promise<DbTransaction> {
    return this.inner.beginTransaction(isolationLevel);
  }

  public async executeQuery<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): Promise<T[]> {
    return this.intercept(sql, params, () => this.inner.executeQuery<T>(sql, params, transaction));
  }

  public async executeNonQuery(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): Promise<{ rowsAffected: number; insertId?: unknown }> {
    return this.intercept(sql, params, () => this.inner.executeNonQuery(sql, params, transaction));
  }

  public async executeScalar<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction,
  ): Promise<T> {
    return this.intercept(sql, params, () => this.inner.executeScalar<T>(sql, params, transaction));
  }

  public async executeProcedure<T = unknown>(
    name: string,
    params: AdapterParam[],
    timeoutMs?: number,
    transaction?: DbTransaction,
  ): Promise<StoredProcedureResult<T[]>> {
    const pseudoSql = `EXEC ${name}`;
    return this.intercept(pseudoSql, params, () =>
      this.inner.executeProcedure<T>(name, params, timeoutMs, transaction),
    );
  }

  public async executeProcedureMultiple<T extends unknown[] = unknown[]>(
    name: string,
    params: AdapterParam[],
    timeoutMs?: number,
    transaction?: DbTransaction,
  ): Promise<StoredProcedureResult<T>> {
    const pseudoSql = `EXEC ${name}`;
    return this.intercept(pseudoSql, params, () =>
      this.inner.executeProcedureMultiple<T>(name, params, timeoutMs, transaction),
    );
  }

  private async intercept<R>(
    sql: string,
    params: AdapterParam[] | undefined,
    action: () => Promise<R>,
  ): Promise<R> {
    const rawParams = params?.map(p => p.value);

    // Hook: onBeforeQuery
    if (this.hooks?.onBeforeQuery) {
      await this.hooks.onBeforeQuery(sql, rawParams);
    }

    const start = Date.now();
    try {
      const result = await action();
      const durationMs = Date.now() - start;

      // Logging after query execution
      if (this.logging) {
        this.logQuery(sql, rawParams, durationMs);
      }

      // Hook: onAfterQuery
      if (this.hooks?.onAfterQuery) {
        await this.hooks.onAfterQuery(sql, rawParams, durationMs);
      }

      return result;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      if (this.logging) {
        this.logError(sql, rawParams, durationMs, err);
      }
      // Hook: onError
      if (this.hooks?.onError) {
        await this.hooks.onError(err, sql, rawParams);
      }
      throw err;
    }
  }

  private logQuery(sql: string, params?: unknown[], durationMs?: number): void {
    const ms = durationMs ?? 0;
    if (typeof this.logging === 'function') {
      this.logging(sql, params, ms);
      return;
    }

    const colorize = process.stdout ? process.stdout.isTTY !== false : true;
    const cCyan = colorize ? '\x1b[36m' : '';
    const cGreen = colorize ? '\x1b[32m' : '';
    const cGray = colorize ? '\x1b[90m' : '';
    const cWhite = colorize ? '\x1b[37m' : '';
    const cReset = colorize ? '\x1b[0m' : '';

    const paramStr = params && params.length ? JSON.stringify(params) : '[]';

    if (this.logging === 'json') {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          target: 'query',
          query: sql,
          params: params ?? [],
          durationMs: ms,
        }),
      );
    } else if (this.logging === 'compact') {
      const pStr = params && params.length ? ` ${cGray}-- params: ${paramStr}${cReset}` : '';
      console.log(
        `${cCyan}query${cReset} ${cWhite}${sql}${cReset}${pStr} ${cGreen}(${ms}ms)${cReset}`,
      );
    } else {
      // Default: Prisma-style multi-line structured format
      console.log(
        `${cCyan}query${cReset} ${cWhite}${sql}${cReset}\n  ${cGray}Duration:${cReset} ${cGreen}${ms}ms${cReset}\n  ${cGray}Params:  ${cReset} ${paramStr}`,
      );
    }
  }

  private logError(sql: string, params?: unknown[], durationMs?: number, err?: Error): void {
    if (typeof this.logging === 'function') {
      return;
    }

    const colorize = process.stdout ? process.stdout.isTTY !== false : true;
    const cRed = colorize ? '\x1b[31m' : '';
    const cGray = colorize ? '\x1b[90m' : '';
    const cWhite = colorize ? '\x1b[37m' : '';
    const cReset = colorize ? '\x1b[0m' : '';

    const paramStr = params && params.length ? JSON.stringify(params) : '[]';

    if (this.logging === 'json') {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          target: 'error',
          query: sql,
          params: params ?? [],
          error: err?.message,
          durationMs,
        }),
      );
    } else {
      console.error(
        `${cRed}error${cReset} ${cWhite}${sql}${cReset}\n  ${cGray}Params:  ${cReset} ${paramStr}\n  ${cRed}Error:   ${err?.message}${cReset}`,
      );
    }
  }
}
