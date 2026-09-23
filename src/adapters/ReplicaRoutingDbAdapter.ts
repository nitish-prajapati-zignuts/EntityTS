import { IDbAdapter, DbProvider } from './IDbAdapter';
import { AdapterParam } from './AdapterParam';
import { StoredProcedureResult } from '../procedure/StoredProcedureResult';
import { IsolationLevel, DbTransaction } from '../transaction';

export type LoadBalancingStrategy = 'round-robin' | 'random';

export interface ReplicaRoutingOptions {
  strategy?: LoadBalancingStrategy;
}

/**
 * An adapter wrapper that routes read operations across read replicas
 * and locks write operations, procedures, and transactions to the primary database.
 */
export class ReplicaRoutingDbAdapter implements IDbAdapter {
  private roundRobinCounter = 0;
  private readonly strategy: LoadBalancingStrategy;

  constructor(
    private readonly primary: IDbAdapter,
    private readonly replicas: IDbAdapter[] = [],
    options?: ReplicaRoutingOptions
  ) {
    this.strategy = options?.strategy || 'round-robin';
  }

  public get provider(): DbProvider {
    return this.primary.provider;
  }

  public getPrimaryAdapter(): IDbAdapter {
    return this.primary;
  }

  public getReplicaAdapters(): IDbAdapter[] {
    return [...this.replicas];
  }

  public getNextReplica(): IDbAdapter {
    if (this.replicas.length === 0) {
      return this.primary;
    }
    if (this.strategy === 'random') {
      const idx = Math.floor(Math.random() * this.replicas.length);
      return this.replicas[idx];
    }
    // round-robin
    const idx = (this.roundRobinCounter++) % this.replicas.length;
    return this.replicas[idx];
  }

  public async connect(): Promise<void> {
    await this.primary.connect();
    for (const r of this.replicas) {
      await r.connect();
    }
  }

  public async disconnect(): Promise<void> {
    await this.primary.disconnect();
    for (const r of this.replicas) {
      await r.disconnect();
    }
  }

  public async ping(): Promise<boolean> {
    const primaryOk = await this.primary.ping();
    if (!primaryOk) return false;
    for (const r of this.replicas) {
      const ok = await r.ping();
      if (!ok) return false;
    }
    return true;
  }

  public async executeQuery<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction
  ): Promise<T[]> {
    // 1. Transaction active -> lock to Primary
    if (transaction) {
      return this.primary.executeQuery<T>(sql, params, transaction);
    }

    // 2. Non-SELECT statements (e.g. INSERT ... RETURNING or CTE writes) -> Primary
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH') && !trimmed.startsWith('EXPLAIN')) {
      return this.primary.executeQuery<T>(sql, params, transaction);
    }

    // 3. Route to replica
    const replica = this.getNextReplica();
    return replica.executeQuery<T>(sql, params);
  }

  public async executeNonQuery(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction
  ): Promise<{ rowsAffected: number; insertId?: unknown }> {
    // All writes must go to Primary
    return this.primary.executeNonQuery(sql, params, transaction);
  }

  public async executeScalar<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction
  ): Promise<T> {
    if (transaction) {
      return this.primary.executeScalar<T>(sql, params, transaction);
    }
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT')) {
      return this.primary.executeScalar<T>(sql, params, transaction);
    }
    const replica = this.getNextReplica();
    return replica.executeScalar<T>(sql, params);
  }

  public async executeProcedure<T = unknown>(
    name: string,
    params: AdapterParam[],
    timeoutMs?: number,
    transaction?: DbTransaction
  ): Promise<StoredProcedureResult<T[]>> {
    // Stored procedures may mutate state; execute on Primary
    return this.primary.executeProcedure<T>(name, params, timeoutMs, transaction);
  }

  public async executeProcedureMultiple<T extends unknown[] = unknown[]>(
    name: string,
    params: AdapterParam[],
    timeoutMs?: number,
    transaction?: DbTransaction
  ): Promise<StoredProcedureResult<T>> {
    return this.primary.executeProcedureMultiple<T>(name, params, timeoutMs, transaction);
  }

  public async beginTransaction(isolationLevel?: IsolationLevel): Promise<DbTransaction> {
    // Transactions always initiate on Primary
    return this.primary.beginTransaction(isolationLevel);
  }

  public escapeIdentifier(name: string): string {
    return this.primary.escapeIdentifier(name);
  }

  public formatParameterPlaceholder(paramName: string, index: number): string {
    return this.primary.formatParameterPlaceholder(paramName, index);
  }
}
