import { IDbAdapter, DbProvider } from '../adapters/IDbAdapter';
import { AdapterParam } from '../adapters/AdapterParam';
import { InterceptingDbAdapter } from '../adapters/InterceptingDbAdapter';
import { DbContextOptions } from './DbContextOptions';
import { DbContextOptionsBuilder } from './DbContextOptionsBuilder';
import { DbSet, EntityTarget } from '../set/DbSet';
import { StoredProcedureBuilder } from '../procedure/StoredProcedureBuilder';
import { ModelBuilder } from '../model/ModelBuilder';
import { DbTransaction, IsolationLevel } from '../transaction';
import { DbException, DatabaseErrorTranslator } from '../errors';
import { ChangeTracker, EntityState } from '../tracking';
import { IQueryCache } from '../cache';
import { ModelMetadataRegistry } from '../model/EntityMetadata';
import { SchemaGenerator } from '../codegen/SchemaGenerator';
import { MigrationRunner, MigrationModule } from '../migrations/MigrationRunner';
import { DefaultExecutionStrategy } from '../resilience';
import { IdempotencyManager, IdempotencyOptions } from '../idempotency';
import { OutboxDispatcher } from '../outbox';
import { EntityEventBus, EventHandler } from '../events';
import type { IConnectionPool } from '../pool/IConnectionPool';
import { UnitOfWork } from '../uow/UnitOfWork';

/**
 * Diagnostic health status object returned by `context.health()`.
 */
export interface DbHealthResult {
  /** Indicates whether the database heartbeat succeeded. */
  connected: boolean;
  /** Round-trip ping/version query latency in milliseconds. */
  latencyMs: number;
  /** Active database provider dialect identifier (e.g. 'postgres', 'sqlite', 'mssql'). */
  provider: DbProvider;
  /** Database server version string if queryable. */
  serverVersion?: string;
  /** Error message if connectivity check failed. */
  error?: string;
}

/**
 * Base database context class representing a session with the database.
 *
 * `DbContext` manages database connections, transactions, change tracking, entity sets (`DbSet`),
 * query execution, and schema migrations. Subclass this to define your application's data context.
 *
 * @example
 * ```ts
 * export class AppDbContext extends DbContext {
 *   public readonly users = this.set(User);
 *   public readonly posts = this.set(Post);
 *
 *   protected onConfiguring(options: DbContextOptionsBuilder): void {
 *     options.useSqlite('./app.db').withLogging(true);
 *   }
 * }
 * ```
 */
export abstract class DbContext {
  protected readonly _options: DbContextOptions;
  protected _adapter: IDbAdapter;
  protected _currentTransaction?: DbTransaction;
  private readonly _sets = new Map<EntityTarget, DbSet<any>>();

  /**
   * The current user or principal identifier for automatic audit logging (`@CreatedBy`).
   */
  public currentUser?: string;

  /**
   * The current tenant identifier for multi-tenant data isolation (`@TenantId`).
   */
  public tenantId?: string | number;

  /**
   * Sets the active tenant identifier on this context instance and returns `this` for chaining.
   *
   * @usecase Scope a DbContext instance to a specific tenant in Express/Fastify request middleware.
   * @param tenantId - The tenant identifier (string or number).
   * @returns `this` DbContext instance.
   * @example
   * ```ts
   * const ctx = new AppDbContext().forTenant(req.headers['x-tenant-id']);
   * const customers = await ctx.customers.toList(); // auto-filtered by tenant_id
   * ```
   */
  public forTenant(tenantId: string | number): this {
    this.tenantId = tenantId;
    return this;
  }

  /**
   * The active change tracker recording entity state modifications for `saveChanges()`.
   */
  public readonly changeTracker = new ChangeTracker();

  /**
   * Entity domain and lifecycle event bus.
   */
  public readonly events = new EntityEventBus();

  /**
   * Registers a domain or lifecycle event handler (e.g. `'Account:created'`, `'*:deleted'`, `'EntityCreated'`).
   *
   * @param event - The event name or pattern to listen to.
   * @param handler - Callback function invoked with the event payload or entity.
   * @returns `this` DbContext instance for chaining.
   * @example
   * ```ts
   * db.on('Account:created', async (entity) => {
   *   await eventBus.publish(new AccountCreatedEvent(entity));
   * });
   * ```
   */
  public on<T = any>(event: string, handler: EventHandler<T>): this {
    this.events.on(event, handler);
    return this;
  }

  /**
   * Registers a one-time domain or lifecycle event handler.
   */
  public once<T = any>(event: string, handler: EventHandler<T>): this {
    this.events.once(event, handler);
    return this;
  }

  /**
   * Unregisters a domain or lifecycle event handler.
   */
  public off(event: string, handler?: EventHandler): this {
    this.events.off(event, handler);
    return this;
  }

  /**
   * Emits a domain or lifecycle event to all matching registered listeners.
   */
  public async emit(event: string, payload: any, alias?: string): Promise<void> {
    await this.events.emit(event, payload, alias);
  }

  private _idempotency?: IdempotencyManager;
  private _outbox?: OutboxDispatcher;

  /**
   * Request idempotency manager.
   * Guarantees that duplicate requests or network retries never execute twice.
   */
  public get idempotency(): IdempotencyManager {
    if (!this._idempotency) {
      this._idempotency = new IdempotencyManager(this.adapter);
    }
    return this._idempotency;
  }

  /**
   * Transactional Outbox dispatcher for guaranteed at-least-once domain event publishing.
   */
  public get outbox(): OutboxDispatcher {
    if (!this._outbox) {
      this._outbox = new OutboxDispatcher(this.adapter);
    }
    return this._outbox;
  }

  /**
   * The connection pool managing active connections, heartbeat, and diagnostics, if configured.
   */
  public get pool(): IConnectionPool | undefined {
    return this._adapter.connectionPool || (this._adapter as any).pool;
  }

  /**
   * Executes an operation with automatic idempotency deduplication.
   * If the key has already been completed, returns the cached result without repeating the operation.
   *
   * @param key - Unique client idempotency key (e.g. UUID, orderId, request ref).
   * @param fn - Business transaction function.
   * @param options - Idempotency lock and TTL configurations.
   */
  public async withIdempotencyKey<T>(
    key: string,
    fn: () => Promise<T>,
    options?: IdempotencyOptions,
  ): Promise<T> {
    return this.idempotency.execute(key, fn, options);
  }

  /**
   * Creates a new Unit of Work instance bound to this DbContext session.
   * Enables batching multiple DbSet operations with topological dependency ordering
   * and single-transaction commit.
   */
  public createUnitOfWork(): UnitOfWork<this> {
    return new UnitOfWork<this>(this);
  }

  /**
   * Initializes a new instance of the `DbContext` class.
   *
   * @param options - Optional pre-built `DbContextOptions` configuration.
   */
  constructor(options?: DbContextOptions) {
    if (options && options.adapter) {
      this._options = options;
      this._adapter = options.adapter;
      if (options.tenantId !== undefined) {
        this.tenantId = options.tenantId;
      }
    } else {
      const builder = new DbContextOptionsBuilder();
      if (options) {
        if (options.adapter) builder.useAdapter(options.adapter);
        if (options.mssqlConfig) builder.useSqlServer(options.mssqlConfig);
        if (options.postgresConfig) builder.usePostgres(options.postgresConfig);
        if (options.mysqlConfig) builder.useMysql(options.mysqlConfig);
        if (options.sqliteConfig) builder.useSqlite(options.sqliteConfig);
        if (options.logging !== undefined) builder.withLogging(options.logging);
        if (options.hooks) builder.withHooks(options.hooks);
        if (options.namingConvention) builder.withNamingConvention(options.namingConvention);
        if (options.commandTimeoutMs) builder.withCommandTimeout(options.commandTimeoutMs);
        if (options.tenantId !== undefined) builder.withTenant(options.tenantId);
      }
      this.onConfiguring(builder);
      this._options = builder.build();
      if (this._options.tenantId !== undefined) {
        this.tenantId = this._options.tenantId;
      }

      if (!this._options.adapter) {
        throw new DbException(
          'No database adapter configured. Please configure an adapter in onConfiguring() or pass options to constructor.',
        );
      }
      this._adapter = this._options.adapter;
    }

    if (this._options.hooks || this._options.logging !== undefined) {
      this._adapter = new InterceptingDbAdapter(
        this._adapter,
        this._options.hooks,
        this._options.logging,
      );
    }

    // Initialize model mapping
    const modelBuilder = new ModelBuilder();
    this.onModelCreating(modelBuilder);
  }

  /**
   * Override this method to configure database providers, connection strings, replica routing, and logging.
   *
   * @usecase Implement this lifecycle hook in your `DbContext` subclass to specify how to connect to your database.
   * @param options - Fluent builder for database configuration.
   * @example
   * ```ts
   * protected onConfiguring(options: DbContextOptionsBuilder): void {
   *   options.usePostgres(process.env.DATABASE_URL!)
   *     .withLogging(true)
   *     .enableRetryOnFailure(3);
   * }
   * ```
   */
  protected onConfiguring(options: DbContextOptionsBuilder): void {
    // Subclasses override this
  }

  /**
   * Override this method to configure entity mappings, relationships, composite keys, and table names using fluent API.
   *
   * @usecase Implement this lifecycle hook to configure your entity models without adding decorators to domain classes.
   * @param modelBuilder - Fluent builder for model schema definitions.
   * @example
   * ```ts
   * protected onModelCreating(modelBuilder: ModelBuilder): void {
   *   modelBuilder.entity(User).toTable('app_users');
   *   modelBuilder.entity(Order).hasOne(User).withForeignKey('userId');
   * }
   * ```
   */
  protected onModelCreating(modelBuilder: ModelBuilder): void {
    // Subclasses override this
  }

  /**
   * Returns the database provider type currently active (e.g. `'sqlite'`, `'postgres'`, `'mysql'`, `'mssql'`).
   *
   * @usecase Use this to write provider-conditional logic or display diagnostics in status dashboards.
   * @returns The active `DbProvider` identifier.
   * @example
   * ```ts
   * if (context.provider === 'postgres') {
   *   // perform postgres-specific JSONB query
   * }
   * ```
   */
  public get provider(): DbProvider {
    return this._adapter.provider;
  }

  /**
   * Provides direct access to the underlying low-level database adapter.
   *
   * @usecase Use this when low-level adapter operations or driver-specific utilities are needed.
   * @returns The active `IDbAdapter` instance.
   */
  public get adapter(): IDbAdapter {
    return this._adapter;
  }

  /**
   * Creates or returns a cached `DbSet<T>` for the specified entity class or table name.
   *
   * @usecase Access repository methods (CRUD, LINQ querying, batch mutations, change tracking) for any registered entity.
   * @param entity - The entity class constructor (e.g. `User`) or table name string.
   * @returns A typed `DbSet<T>` for the requested entity.
   *
   * @example
   * ```ts
   * const users = context.set(User);
   * const activeAdmins = await users
   *   .where(u => u.role === 'admin' && u.isActive === true)
   *   .orderByDescending(u => u.createdAt)
   *   .toList();
   * ```
   */
  public set<T extends object>(entity: EntityTarget<T>): DbSet<T> {
    let existing = this._sets.get(entity);
    if (!existing) {
      existing = new DbSet<T>(this._adapter, entity, undefined, undefined, this);
      this._sets.set(entity, existing);
    }
    return existing as DbSet<T>;
  }

  /**
   * Initiates a fluent stored procedure execution builder.
   *
   * Enables execution of database stored procedures, routines, and user-defined functions across
   * MSSQL, MySQL, PostgreSQL, and Oracle with full support for input/output/inout parameters,
   * multiple result sets, and transaction binding.
   *
   * @usecase Execute database-native procedures for high performance, complex batch transactions, or legacy procedure integrations.
   * @param name - The name of the stored procedure in the database.
   * @returns A `StoredProcedureBuilder` configured for the procedure.
   *
   * @example
   * **SQL Server (MSSQL):**
   * ```ts
   * const { records, out } = await context.procedure('usp_GetCustomerDashboard')
   *   .input({ CustomerId: 101 })
   *   .output<{ TotalSpent: number }>()
   *   .query<OrderSummary>();
   * ```
   *
   * **MySQL:**
   * ```ts
   * const { out } = await context.procedure('sp_create_user')
   *   .input({ p_email: 'user@example.com' })
   *   .output<{ out_id: number }>()
   *   .run();
   * ```
   *
   * **PostgreSQL:**
   * ```ts
   * const users = await context.procedure('fn_get_active_users')
   *   .input({ min_rank: 5 })
   *   .query<User>();
   * ```
   */
  public procedure(name: string): StoredProcedureBuilder {
    return new StoredProcedureBuilder(this._adapter, name);
  }

  /**
   * Executes a raw parameterized SELECT SQL query returning typed rows.
   *
   * @usecase Execute complex analytical queries, CTEs (WITH RECURSIVE), window functions, or custom aggregations.
   * @param sql - Raw SQL query string with parameter placeholders (`@p0`, `@p1`, etc.).
   * @param params - Optional parameter array to bind safely into the query.
   * @returns A Promise resolving to an array of typed row objects.
   *
   * @example
   * **PostgreSQL / SQLite:**
   * ```ts
   * const stats = await context.fromSql<{ department: string; avgSalary: number }>(
   *   'SELECT department, AVG(salary) as "avgSalary" FROM employees GROUP BY department HAVING COUNT(*) > @p0',
   *   [5]
   * );
   * ```
   *
   * **MySQL / MSSQL:**
   * ```ts
   * const results = await context.fromSql<SalesReport>(
   *   'SELECT CategoryId, SUM(Total) AS Revenue FROM Orders WHERE OrderDate >= @p0 GROUP BY CategoryId',
   *   [new Date(2026, 0, 1)]
   * );
   * ```
   */
  public async fromSql<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const adapterParams = params
      ? params.map((val, idx) => ({ name: `p${idx}`, value: val }))
      : undefined;
    return this._adapter.executeQuery<T>(sql, adapterParams);
  }

  /**
   * Executes a raw parameterized SQL command (e.g. INSERT, UPDATE, DELETE, DDL).
   *
   * @usecase Perform bulk updates, table truncates, partition management, or raw administrative DML.
   * @param sql - Raw SQL command string with parameter placeholders.
   * @param params - Optional array of parameter values to bind safely.
   * @returns A Promise resolving to an object with `rowsAffected`.
   *
   * @example
   * **PostgreSQL / MySQL / SQLite / MSSQL:**
   * ```ts
   * const result = await context.executeSql(
   *   'UPDATE users SET status = @p0, updated_at = @p1 WHERE last_login < @p2',
   *   ['dormant', new Date(), sixMonthsAgo]
   * );
   * console.log(`Updated ${result.rowsAffected} dormant users`);
   * ```
   */
  public async executeSql(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }> {
    const adapterParams = params
      ? params.map((val, idx) => ({ name: `p${idx}`, value: val }))
      : undefined;
    return this._adapter.executeNonQuery(sql, adapterParams);
  }

  /**
   * Begins a new database transaction.
   *
   * @usecase Gain manual control over transaction boundaries across multiple operations, distributed services, or conditional rollbacks.
   * @param isolationLevel - Optional transaction isolation level (`READ_COMMITTED`, `REPEATABLE_READ`, `SERIALIZABLE`, `SNAPSHOT`).
   * @returns A Promise resolving to the active `DbTransaction`.
   *
   * @example
   * **PostgreSQL / MySQL / MSSQL:**
   * ```ts
   * const tx = await context.beginTransaction(IsolationLevel.SERIALIZABLE);
   * try {
   *   await context.users.inTransaction(tx).add({ name: 'Bob', email: 'bob@example.com' });
   *   await context.auditLogs.inTransaction(tx).add({ action: 'USER_CREATED', target: 'Bob' });
   *   await tx.commit();
   * } catch (err) {
   *   await tx.rollback();
   *   throw err;
   * }
   * ```
   */
  public async beginTransaction(isolationLevel?: IsolationLevel): Promise<DbTransaction> {
    return this._adapter.beginTransaction(isolationLevel);
  }

  /**
   * Executes a callback within a managed transaction, auto-committing on success or rolling back on error.
   *
   * @usecase Recommended pattern for executing transactional units of work safely without boilerplate try/catch/commit/rollback.
   * @param fn - Async callback receiving the active `DbTransaction`.
   * @param isolationLevel - Optional transaction isolation level.
   * @returns A Promise resolving to the result of the callback.
   *
   * @example
   * **PostgreSQL / MySQL / MSSQL / SQLite:**
   * ```ts
   * const transferResult = await context.useTransaction(async tx => {
   *   await context.accounts.inTransaction(tx).update(fromId, { balance: sourceBal - amt });
   *   await context.accounts.inTransaction(tx).update(toId, { balance: targetBal + amt });
   *   return { success: true, transferred: amt };
   * });
   * ```
   */
  public async useTransaction<T>(
    fn: (tx: DbTransaction) => Promise<T>,
    isolationLevel?: IsolationLevel,
  ): Promise<T> {
    const tx = await this.beginTransaction(isolationLevel);
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }

  /**
   * Binds this DbContext instance to an active database transaction.
   * All DbSet instances accessed via this context will automatically execute within the transaction.
   *
   * @param tx - The active `DbTransaction`.
   */
  public inTransaction(tx: DbTransaction): this {
    const proxy = Object.create(this);
    proxy._currentTransaction = tx;
    proxy.set = (entityTarget: EntityTarget<any>) => this.set(entityTarget).inTransaction(tx);
    return new Proxy(proxy, {
      get(target, prop, receiver) {
        if (prop === 'set') {
          return (entityTarget: any) => target.set(entityTarget);
        }
        if (prop === '_currentTransaction') {
          return tx;
        }
        const val = Reflect.get(target, prop, receiver);
        if (val instanceof DbSet) {
          return val.inTransaction(tx);
        }
        return val;
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Prisma-style Database-Level APIs
  // ---------------------------------------------------------------------------

  /**
   * Executes a raw SQL query returning typed rows.
   * Supports Prisma-style tagged template literal syntax or parameter placeholders.
   *
   * @example
   * ```ts
   * // Tagged template literal
   * const users = await db.$queryRaw<User>`SELECT * FROM users WHERE age > ${18}`;
   *
   * // Or parameterized query string
   * const users = await db.$queryRaw<User>('SELECT * FROM users WHERE id = @p0', 1);
   * ```
   */
  public async $queryRaw<T = unknown>(
    query: TemplateStringsArray | string,
    ...values: unknown[]
  ): Promise<T[]> {
    if (Array.isArray(query) && 'raw' in query) {
      let sqlStr = '';
      const params: unknown[] = [];
      for (let i = 0; i < query.length; i++) {
        sqlStr += query[i];
        if (i < values.length) {
          params.push(values[i]);
          const pIdx = params.length - 1;
          sqlStr += `@p${pIdx}`;
        }
      }
      return this.queryRaw<T>(sqlStr, params);
    }
    const p = values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
    return this.queryRaw<T>(query as string, p);
  }

  /**
   * Executes an unsafe raw SQL string query without template tagging.
   */
  public async $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T[]> {
    const p = values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
    return this.queryRaw<T>(query, p);
  }

  /**
   * Executes a raw SQL command (e.g. INSERT, UPDATE, DELETE) and returns the number of rows affected.
   * Supports Prisma-style tagged template literal syntax or parameter placeholders.
   *
   * @example
   * ```ts
   * const count = await db.$executeRaw`DELETE FROM logs WHERE created_at < ${cutoff}`;
   * ```
   */
  public async $executeRaw(
    query: TemplateStringsArray | string,
    ...values: unknown[]
  ): Promise<number> {
    if (Array.isArray(query) && 'raw' in query) {
      let sqlStr = '';
      const params: unknown[] = [];
      for (let i = 0; i < query.length; i++) {
        sqlStr += query[i];
        if (i < values.length) {
          params.push(values[i]);
          const pIdx = params.length - 1;
          sqlStr += `@p${pIdx}`;
        }
      }
      const res = await this.executeRaw(sqlStr, params);
      return res.rowsAffected;
    }
    const p = values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
    const res = await this.executeRaw(query as string, p);
    return res.rowsAffected;
  }

  /**
   * Executes an unsafe raw SQL string command without template tagging.
   */
  public async $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> {
    const p = values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
    const res = await this.executeRaw(query, p);
    return res.rowsAffected;
  }

  /**
   * Executes multiple operations in an atomic database transaction.
   * Supports both Prisma-style array of promises and interactive transaction callback functions.
   *
   * @example
   * ```ts
   * // Interactive transaction
   * const result = await db.$transaction(async (tx) => {
   *   const user = await tx.users.create({ data: { name: 'Alice' } });
   *   await tx.posts.create({ data: { title: 'First Post', authorId: user.id } });
   *   return user;
   * });
   * ```
   */
  public async $transaction<R>(
    operations: Promise<R>[],
    options?: { isolationLevel?: IsolationLevel; timeout?: number },
  ): Promise<R[]>;
  public async $transaction<R>(
    operations: (tx: this) => Promise<R>,
    options?: { isolationLevel?: IsolationLevel; timeout?: number },
  ): Promise<R>;
  public async $transaction<R>(
    operations: Promise<R>[] | ((tx: this) => Promise<R>),
    options?: { isolationLevel?: IsolationLevel; timeout?: number },
  ): Promise<R | R[]> {
    if (Array.isArray(operations)) {
      return this.useTransaction(async () => {
        const results: R[] = [];
        for (const op of operations) {
          results.push(await op);
        }
        return results;
      }, options?.isolationLevel);
    }
    if (typeof operations === 'function') {
      return this.useTransaction(async tx => {
        const txCtx = this.inTransaction(tx);
        return operations(txCtx);
      }, options?.isolationLevel);
    }
    throw new Error(
      'Invalid $transaction arguments: must provide an array of promises or an async function',
    );
  }

  // ---------------------------------------------------------------------------
  // Cross-Dialect RDBMS Execution APIs
  // ---------------------------------------------------------------------------

  /**
   * Executes a parameterized SELECT query returning typed rows.
   */
  public async queryRaw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    try {
      const adapterParams = params
        ? params.map((val, idx) => ({ name: `p${idx}`, value: val }))
        : undefined;
      return await this._adapter.executeQuery<T>(sql, adapterParams, this._currentTransaction);
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this._adapter.provider);
    }
  }

  /**
   * Executes a parameterized command (INSERT, UPDATE, DELETE, DDL) returning rowsAffected.
   */
  public async executeRaw(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }> {
    try {
      const adapterParams = params
        ? params.map((val, idx) => ({ name: `p${idx}`, value: val }))
        : undefined;
      return await this._adapter.executeNonQuery(sql, adapterParams, this._currentTransaction);
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this._adapter.provider);
    }
  }

  /**
   * Executes a query returning the first column value of the first row (e.g. `COUNT(*)`, `SUM(x)`).
   */
  public async queryScalar<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> {
    try {
      const adapterParams = params
        ? params.map((val, idx) => ({ name: `p${idx}`, value: val }))
        : undefined;
      return await this._adapter.executeScalar<T>(sql, adapterParams, this._currentTransaction);
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this._adapter.provider);
    }
  }

  /**
   * Shorthand callback to execute database work inside a managed transaction, auto-committing on completion or rolling back on error.
   *
   * @usecase Safe, concise transactional block preventing manual try/catch/commit/rollback boilerplate.
   * @param fn - Async callback receiving the active `DbTransaction`.
   * @param isolationLevel - Optional transaction isolation level.
   * @returns A Promise resolving to the result of the callback.
   * @example
   * ```ts
   * const order = await context.withTransaction(async tx => {
   *   const created = await context.orders.inTransaction(tx).add(newOrder);
   *   await context.inventory.inTransaction(tx).update(stockId, { count: remaining });
   *   return created;
   * });
   * ```
   */
  public async withTransaction<T>(
    fn: (tx: DbTransaction) => Promise<T>,
    isolationLevel?: IsolationLevel,
  ): Promise<T> {
    return this.useTransaction(fn, isolationLevel);
  }

  /**
   * Executes a callback within a managed transaction using the configured execution strategy,
   * automatically retrying with exponential backoff if transient errors or deadlocks occur.
   *
   * @usecase Ideal for cloud databases (Neon, Supabase, PlanetScale, CockroachDB) prone to transient network blips or serialization deadlocks.
   * @param fn - Async callback receiving the transaction.
   * @param isolationLevel - Optional isolation level.
   * @returns A Promise resolving to the callback result.
   * @example
   * ```ts
   * const result = await context.executeResilientTransaction(async tx => {
   *   return await context.orders.inTransaction(tx).add(newOrder);
   * });
   * ```
   */
  public async executeResilientTransaction<T>(
    fn: (tx: DbTransaction) => Promise<T>,
    isolationLevel?: IsolationLevel,
  ): Promise<T> {
    const strategy =
      this._options.executionStrategy ||
      new DefaultExecutionStrategy(this._options.executionStrategyOptions);
    return strategy.execute(async () => {
      return this.useTransaction(fn, isolationLevel);
    });
  }

  /**
   * Executes an async operation with automatic retry on transient errors or deadlocks with exponential backoff.
   *
   * @usecase Use this to wrap critical idempotent queries or external database operations to increase fault tolerance.
   * @param operation - Async operation to execute.
   * @returns A Promise resolving to the operation result.
   * @example
   * ```ts
   * const data = await context.executeResilient(() => context.users.toList());
   * ```
   */
  public async executeResilient<T>(operation: () => Promise<T>): Promise<T> {
    const strategy =
      this._options.executionStrategy ||
      new DefaultExecutionStrategy(this._options.executionStrategyOptions);
    return strategy.execute(operation);
  }

  /**
   * Explicitly establishes a connection pool to the database.
   *
   * @usecase Call this during application bootstrap to verify database connectivity before accepting incoming traffic.
   * @example
   * ```ts
   * await context.connect();
   * console.log('Connected to database successfully');
   * ```
   */
  public async connect(): Promise<void> {
    await this._adapter.connect();
  }

  /**
   * Closes all active connections and cleans up connection pool resources.
   *
   * @usecase Call this during graceful application shutdown (e.g. `SIGTERM`, `SIGINT`) or test teardown.
   * @example
   * ```ts
   * process.on('SIGTERM', async () => {
   *   await context.disconnect();
   *   process.exit(0);
   * });
   * ```
   */
  public async disconnect(): Promise<void> {
    await this._adapter.disconnect();
  }

  /**
   * Disposes the context instance, closing all underlying database connections (alias for `disconnect()`).
   *
   * @usecase Standard disposal pattern for dependency injection containers and scoped service lifetimes.
   */
  public async dispose(): Promise<void> {
    await this.disconnect();
  }

  /**
   * Tests database connectivity by executing a lightweight heartbeat query.
   *
   * @usecase Use this in HTTP health check endpoints (`GET /healthz` or Kubernetes liveness/readiness probes).
   * @returns `true` if database is reachable, otherwise `false`.
   * @example
   * ```ts
   * app.get('/health', async (req, res) => {
   *   const isHealthy = await context.ping();
   *   res.status(isHealthy ? 200 : 503).json({ database: isHealthy ? 'up' : 'down' });
   * });
   * ```
   */
  public async ping(): Promise<boolean> {
    return this._adapter.ping();
  }

  /**
   * Comprehensive health check diagnostic measuring query latency, connectivity status, and server version.
   *
   * @usecase Ideal for Kubernetes liveness/readiness probes, AWS ALB health checks, and `/healthz` HTTP monitoring endpoints.
   * @returns Detailed `DbHealthResult` with latency in milliseconds, connection status, provider, and server version.
   * @example
   * ```ts
   * app.get('/healthz', async (req, res) => {
   *   const status = await context.health();
   *   res.status(status.connected ? 200 : 503).json(status);
   * });
   * ```
   */
  public async health(): Promise<DbHealthResult> {
    const start = Date.now();
    try {
      const versionQuery =
        this._adapter.provider === 'mssql'
          ? 'SELECT @@VERSION'
          : this._adapter.provider === 'sqlite' ||
              this._adapter.provider === 'turso' ||
              this._adapter.provider === 'd1'
            ? 'SELECT sqlite_version()'
            : 'SELECT version()';

      let serverVersion: string | undefined;
      try {
        const v = await this._adapter.executeScalar<string>(versionQuery);
        if (v !== undefined && v !== null) {
          serverVersion = String(v).split('\n')[0].trim();
        }
      } catch {
        await this._adapter.ping();
      }

      const latencyMs = Date.now() - start;
      return {
        connected: true,
        latencyMs,
        provider: this._adapter.provider,
        serverVersion,
      };
    } catch (err: any) {
      return {
        connected: false,
        latencyMs: Date.now() - start,
        provider: this._adapter.provider,
        error: err?.message || String(err),
      };
    }
  }

  /**
   * Executes database seeding logic to populate initial, default, or mock reference data.
   *
   * Calls `this.onSeeding()` which can be overridden in application `DbContext` subclasses.
   *
   * @usecase Seed admin accounts, lookup tables, test fixtures, or default system configuration.
   * @example
   * ```ts
   * await context.seed();
   * ```
   */
  public async seed(): Promise<void> {
    await this.onSeeding();
  }

  /**
   * Override this method in your `DbContext` subclass to define custom seeding operations.
   *
   * @example
   * ```ts
   * protected async onSeeding(): Promise<void> {
   *   if (await this.roles.count() === 0) {
   *     await this.roles.addRange([{ name: 'admin' }, { name: 'user' }]);
   *   }
   * }
   * ```
   */
  protected async onSeeding(): Promise<void> {
    // Default implementation is a no-op; override in derived context
  }

  /**
   * Returns the configured query cache provider if one was registered in `DbContextOptions`.
   *
   * @usecase Use this to manually inspect or clear cached query entries across the application.
   */
  public get cache(): IQueryCache | undefined {
    return this._options.cache;
  }

  /**
   * Flushes all tracked entity mutations (Added, Modified, Deleted) in the `ChangeTracker` in a single transaction.
   *
   * Detects dirty properties, checks optimistic concurrency versions, updates timestamps, and accepts changes upon commit.
   *
   * @usecase Use this in the Unit of Work pattern where entities are loaded, mutated in memory, and persisted as a batch.
   * @returns The total number of state entries saved to the database.
   * @example
   * ```ts
   * const user = await context.users.track(1);
   * user.name = 'Updated Name';
   * const savedCount = await context.saveChanges();
   * ```
   */
  public async saveChanges(): Promise<number> {
    const entries = this.changeTracker
      .entries()
      .filter(
        e =>
          e.state === EntityState.Added ||
          e.state === EntityState.Modified ||
          e.state === EntityState.Deleted,
      );

    if (entries.length === 0) {
      return 0;
    }

    let affectedCount = 0;

    await this.useTransaction(async tx => {
      for (const entry of entries) {
        const target = entry.metadata?.target || (entry.entity.constructor as any);
        const set = this.set(target).inTransaction(tx);
        const pkProp = entry.metadata?.primaryKeys[0] || 'id';

        if (entry.state === EntityState.Added) {
          const inserted = await set.add(entry.entity);
          Object.assign(entry.entity, inserted);
          entry.acceptChanges();
          affectedCount++;
        } else if (entry.state === EntityState.Modified) {
          const id = (entry.entity as any)[pkProp];
          const changes = entry.getChanges();
          const versionProp = entry.metadata?.versionProperty?.propertyName;
          const expectedVersion = versionProp
            ? (entry.getOriginalValue(versionProp) ?? (entry.entity as any)[versionProp])
            : undefined;
          const concurrencyOriginals: Record<string, unknown> = {};
          if (entry.metadata?.concurrencyCheckProperties) {
            for (const prop of entry.metadata.concurrencyCheckProperties) {
              concurrencyOriginals[prop] =
                entry.getOriginalValue(prop) ?? (entry.entity as any)[prop];
            }
          }
          if (Object.keys(changes).length > 0 || expectedVersion !== undefined) {
            const updated = await set.update(id, changes, expectedVersion, concurrencyOriginals);
            if (versionProp) {
              (entry.entity as any)[versionProp] = (updated as any)[versionProp];
            }
          }
          entry.acceptChanges();
          affectedCount++;
        } else if (entry.state === EntityState.Deleted) {
          const id = (entry.entity as any)[pkProp];
          const versionProp = entry.metadata?.versionProperty?.propertyName;
          const expectedVersion = versionProp
            ? (entry.getOriginalValue(versionProp) ?? (entry.entity as any)[versionProp])
            : undefined;
          await set.remove(id, expectedVersion);
          entry.acceptChanges();
          affectedCount++;
        }
      }
    });

    return affectedCount;
  }

  /**
   * Safe tagged template literal for executing parameterized raw SQL queries with automatic parameter binding.
   *
   * Interpolated variables are automatically extracted and converted into parameterized values to prevent SQL injection.
   *
   * @usecase Ideal for complex queries where full SQL syntax is desired without risking SQL injection vulnerabilities.
   * @param strings - SQL template string parts.
   * @param values - Interpolated values to safely parameterize.
   * @returns A Promise resolving to an array of mapped row results.
   * @example
   * ```ts
   * const minPrice = 50;
   * const category = 'Electronics';
   * const items = await context.sql<Product>`
   *   SELECT * FROM products WHERE price > ${minPrice} AND category = ${category}
   * `;
   * ```
   */
  public async sql<T = unknown>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]> {
    let sql = '';
    const adapterParams: AdapterParam[] = [];

    for (let i = 0; i < strings.length; i++) {
      sql += strings[i];
      if (i < values.length) {
        const paramName = `p${i + 1}`;
        const placeholder = this._adapter.formatParameterPlaceholder(paramName, i + 1);
        sql += placeholder;
        adapterParams.push({ name: paramName, value: values[i] });
      }
    }

    try {
      return await this._adapter.executeQuery<T>(sql, adapterParams);
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this._adapter.provider);
    }
  }

  /**
   * Code-First schema synchronization: creates all entity tables, columns, and primary keys if they do not already exist.
   *
   * @usecase Ideal for quick prototyping, test setup, local development, and microservices needing zero-friction database initialization.
   * @param entityClasses - Optional explicit array of entity classes to generate. If omitted, all decorated classes are used.
   * @example
   * ```ts
   * const context = new AppDbContext();
   * await context.ensureCreated();
   * ```
   */
  public async ensureCreated(entityClasses?: Function[]): Promise<void> {
    const registry = ModelMetadataRegistry.getInstance();
    const classes =
      entityClasses ?? (Array.from((registry as any).entities?.keys() ?? []) as Function[]);
    const generator = new SchemaGenerator(this._adapter, classes);
    await generator.ensureCreated();
  }

  /**
   * Runs all pending migration modules sequentially.
   *
   * @usecase Use this during production deployments or CI/CD pipelines to apply schema migrations reliably.
   * @param migrations - Array of migration modules containing `up()` and `down()` definitions.
   * @returns A Promise resolving to an object containing an array of applied migration names.
   * @example
   * ```ts
   * import * as m1 from './migrations/001_initial_schema';
   * const { applied } = await context.migrate([m1]);
   * console.log('Applied migrations:', applied);
   * ```
   */
  public async migrate(migrations: MigrationModule[]): Promise<{ applied: string[] }> {
    const runner = new MigrationRunner(this._adapter);
    return runner.up(migrations);
  }

  /**
   * Dynamically fetches a related navigation property on an entity instance.
   *
   * @param entity - The parent entity instance containing the relation.
   * @param relationName - The navigation property name to fetch.
   * @returns A Promise resolving to the loaded relation data.
   * @example
   * ```ts
   * const orders = await db.fetchRelation(user, 'orders');
   * ```
   */
  public async fetchRelation<E extends object, R = any>(
    entity: E,
    relationName: string,
  ): Promise<R> {
    const proto = Object.getPrototypeOf(entity);
    const targetConstructor = proto ? proto.constructor : undefined;
    if (!targetConstructor) {
      throw new Error(`Cannot determine entity constructor for relation resolution.`);
    }
    const set = this.set(targetConstructor as any);
    return set.fetchRelation<R>(entity, relationName);
  }

  /**
   * Alias for fetchRelation().
   */
  public async loadRelation<E extends object, R = any>(
    entity: E,
    relationName: string,
  ): Promise<R> {
    return this.fetchRelation<E, R>(entity, relationName);
  }
}
