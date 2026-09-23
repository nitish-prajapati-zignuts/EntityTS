import { IDbAdapter } from '../adapters/IDbAdapter';
import { QueryBuilder } from '../query/QueryBuilder';
import { GroupedQueryBuilder } from '../query/GroupedQueryBuilder';
import { WhereClause, ColumnKey, extractColumnName, SearchOptions } from '../query/WhereClause';
import { PagedResult } from '../query/OrderByClause';
import {
  CursorPaginationOptions,
  CursorPageResult,
  PagedListOptions,
  encodeCursor,
  decodeCursor,
} from '../query/CursorPagination';
import { DbTransaction } from '../transaction/DbTransaction';
import {
  EntityMetadata,
  ModelMetadataRegistry,
  RelationMetadata,
  EntityLifecycleHooks,
} from '../model/EntityMetadata';
import { EntityNotFoundException, DbException, DbUpdateConcurrencyException } from '../errors';
import { GlobalQueryFilterRegistry } from '../filters/GlobalQueryFilter';
import {
  BulkInsertBuilder,
  BulkInsertOptions,
  BulkUpdateBuilder,
  BulkUpdateOptions,
  BulkUpsertBuilder,
  BulkUpsertOptions,
  BulkDeleteBuilder,
  BulkDeleteOptions,
} from '../bulk';
import { IQueryCache } from '../cache';
import { EncryptionEngine } from '../security/Encryption';
import { Subquery, NearestOptions } from '../query/Subquery';
import { ValidationEngine } from '../validation/ValidationEngine';
import { DatabaseErrorTranslator } from '../errors/DatabaseErrorTranslator';
import { LazyRelation } from './LazyLoader';
import { AuditEngine } from '../audit/AuditEngine';
import {
  EntityEventBus,
  EventHandler,
  EntityCreated,
  EntityUpdated,
  EntityDeleted,
} from '../events';

export type WithLoaded<T, K extends string> = T & {
  [P in K]: P extends keyof T ? NonNullable<T[P]> : any;
};

export type EntityTarget<T = any> = (new (...args: any[]) => T) | string;

export interface DbSetOptions {
  withDeleted?: boolean;
  onlyDeleted?: boolean;
  ignoreQueryFilters?: boolean;
  ignoreTenant?: boolean;
  cacheTtlMs?: number;
  cacheKey?: string;
  includes?: string[];
  lazy?: boolean;
}

/**
 * Represents a typed collection of entities in the database for querying and mutation operations.
 *
 * `DbSet<T>` provides a fluent LINQ-style query builder, CRUD operations, bulk batching,
 * pagination, relation loading, and transaction binding for a specific entity type or table.
 */
export class DbSet<T extends object = any> {
  private readonly metadata?: EntityMetadata;
  private readonly tableName: string;
  private readonly queryBuilder: QueryBuilder<T>;
  private transaction?: DbTransaction;
  private readonly context?: any;
  private readonly options: DbSetOptions;
  private _events?: EntityEventBus;

  /**
   * Initializes a new instance of the `DbSet` class for a specific entity model or table name.
   *
   * @param adapter - The low-level database adapter (e.g. SQLite, PostgreSQL, MySQL, SQL Server).
   * @param entityTarget - The entity class constructor (decorated with `@Entity`) or raw table name string.
   * @param queryBuilder - Optional internal `QueryBuilder` state for immutable method chaining.
   * @param transaction - Optional active database transaction context.
   * @param context - Optional parent `DbContext` instance.
   * @param options - Optional query configuration flags (soft deletes, caching, relation includes).
   */
  constructor(
    private readonly adapter: IDbAdapter,
    private readonly entityTarget: EntityTarget<T>,
    queryBuilder?: QueryBuilder<T>,
    transaction?: DbTransaction,
    context?: any,
    options?: DbSetOptions,
  ) {
    if (typeof entityTarget === 'function') {
      this.metadata = ModelMetadataRegistry.getInstance().get(entityTarget);
      this.tableName = this.metadata?.tableName || entityTarget.name;
    } else {
      this.tableName = entityTarget;
    }

    this.queryBuilder = queryBuilder || new QueryBuilder<T>(adapter, this.tableName);
    this.transaction = transaction;
    this.context = context;
    this.options = { ...options };
  }

  /**
   * Returns the underlying database table name associated with this `DbSet`.
   *
   * @usecase Use this when constructing dynamic SQL queries, generating log messages, or verifying table names.
   * @returns The resolved table name as a string.
   * @example
   * ```ts
   * const tableName = context.users.getTableName(); // returns 'users'
   * ```
   */
  public getTableName(): string {
    return this.tableName;
  }

  /**
   * Attaches this `DbSet` query or mutation operation to an active database transaction.
   *
   * @usecase Use this to execute queries or mutations within a unit-of-work transaction to guarantee ACID consistency.
   * @param tx - The active `DbTransaction` instance obtained from `context.beginTransaction()`.
   * @returns A new cloned `DbSet` scoped to the provided transaction.
   * @example
   * ```ts
   * const tx = await context.beginTransaction();
   * try {
   *   await context.users.inTransaction(tx).add({ name: 'Alice' });
   *   await tx.commit();
   * } catch (err) {
   *   await tx.rollback();
   * }
   * ```
   */
  public inTransaction(tx: DbTransaction): DbSet<T> {
    return this.createClone(undefined, undefined, tx);
  }

  /**
   * Registers a lifecycle event listener on this DbSet (e.g. `'created'`, `'updated'`, `'deleted'`).
   *
   * @param event - Lifecycle event name or pattern.
   * @param handler - Asynchronous or synchronous event callback.
   * @returns `this` instance for chaining.
   */
  public on<E = T>(event: string, handler: EventHandler<E>): this {
    if (!this._events) {
      this._events = new EntityEventBus();
    }
    this._events.on(event, handler);
    return this;
  }

  /**
   * Unregisters a lifecycle event listener from this DbSet.
   */
  public off(event: string, handler?: EventHandler): this {
    if (this._events) {
      this._events.off(event, handler);
    }
    return this;
  }

  /**
   * Internal helper to dispatch lifecycle domain events to both the parent DbContext and local DbSet.
   */
  private async emitLifecycleEvent(
    action: 'created' | 'updated' | 'deleted',
    entity: any,
    previous?: any,
  ): Promise<void> {
    if (!entity) return;
    const entityName =
      typeof this.entityTarget === 'function' ? this.entityTarget.name : this.tableName;
    const tableAlias = entityName !== this.tableName ? `${this.tableName}:${action}` : undefined;

    if (this.context && typeof this.context.emit === 'function') {
      await this.context.emit(`${entityName}:${action}`, entity, tableAlias);
      if (action === 'created') {
        await this.context.emit(
          'EntityCreated',
          new EntityCreated(entity, entityName, this.tableName),
        );
      } else if (action === 'updated') {
        await this.context.emit(
          'EntityUpdated',
          new EntityUpdated(entity, entityName, this.tableName, previous),
        );
      } else if (action === 'deleted') {
        await this.context.emit(
          'EntityDeleted',
          new EntityDeleted(entity, entityName, this.tableName),
        );
      }
    }

    if (this._events) {
      await this._events.emit(`${entityName}:${action}`, entity, tableAlias);
      await this._events.emit(action, entity);
    }
  }

  // --- Options & Filters chaining ---

  /**
   * Disables the soft-delete filter, causing subsequent query execution to return both active and soft-deleted records.
   *
   * @usecase Use this when building audit logs, admin dashboards, or compliance reports where deleted items must be visible.
   * @returns A new cloned `DbSet` configured to include soft-deleted records.
   * @example
   * ```ts
   * // Fetch all users including previously soft-deleted ones
   * const allUsers = await context.users.withDeleted().toList();
   * ```
   */
  public withDeleted(): DbSet<T> {
    return this.createClone(undefined, { withDeleted: true, onlyDeleted: false });
  }

  /**
   * Scopes the query to return only records that have been soft-deleted (where `deletedAt IS NOT NULL`).
   *
   * @usecase Use this to display a "Trash" or "Recycle Bin" screen allowing users to inspect or restore deleted items.
   * @returns A new cloned `DbSet` configured to filter exclusively for deleted records.
   * @example
   * ```ts
   * // Fetch records in the recycle bin
   * const trashedUsers = await context.users.onlyDeleted().toList();
   * ```
   */
  public onlyDeleted(): DbSet<T> {
    return this.createClone(undefined, { withDeleted: false, onlyDeleted: true });
  }

  /**
   * Ignores all global and model-level query filters for this query execution.
   *
   * @usecase Use this in multi-tenant systems for cross-tenant super-admin tasks or background jobs that need system-wide access.
   * @returns A new cloned `DbSet` with global query filters bypassed.
   * @example
   * ```ts
   * // Query records across all tenants by bypassing tenant isolation filters
   * const allTenantsUsers = await context.users.ignoreQueryFilters().toList();
   * ```
   */
  public ignoreQueryFilters(): DbSet<T> {
    return this.createClone(undefined, { ignoreQueryFilters: true });
  }

  /**
   * Bypasses automatic tenant isolation filters for cross-tenant super-admin queries.
   *
   * @usecase System analytics, global reporting, or platform administrative consoles.
   * @returns A new cloned `DbSet` ignoring `@TenantId` filtering.
   * @example
   * ```ts
   * const allTenantsUsers = await context.users.ignoreTenant().toList();
   * ```
   */
  public ignoreTenant(): DbSet<T> {
    return this.createClone(undefined, { ignoreTenant: true });
  }

  /**
   * Automatically initializes unpopulated relation properties as `LazyRelation` instances.
   *
   * @returns A new cloned `DbSet` with lazy relation resolution enabled.
   * @example
   * ```ts
   * const users = await context.users.withLazy().toList();
   * const posts = await users[0].posts.fetch();
   * ```
   */
  public withLazy(): DbSet<T> {
    return this.createClone(undefined, { lazy: true });
  }

  /**
   * Applies pessimistic row locking (e.g. FOR UPDATE or WITH (UPDLOCK, ROWLOCK)).
   * Ensures rows selected cannot be modified by concurrent transactions until this transaction commits.
   * Essential for inventory reservation, financial records, and high-contention row updates.
   *
   * @param options - Optional lock modifiers:
   *   - `noWait`: Throw immediately if row is locked rather than waiting.
   *   - `skipLocked`: Skip locked rows (useful for worker queue polling).
   * @returns A new cloned `DbSet` configured with row locking.
   * @example
   * ```ts
   * await db.useTransaction(async (tx) => {
   *   const account = await db.accounts.inTransaction(tx)
   *     .where({ id: 101 })
   *     .forUpdate()
   *     .firstOrThrow();
   * });
   * ```
   */
  public forUpdate(options?: { noWait?: boolean; skipLocked?: boolean }): DbSet<T> {
    const qb = this.queryBuilder.clone<T>();
    qb.forUpdate(options);
    return this.createClone(qb);
  }

  /**
   * Applies shared read locking (e.g. FOR SHARE / LOCK IN SHARE MODE / WITH (HOLDLOCK)).
   *
   * @returns A new cloned `DbSet` configured with shared locking.
   */
  public forShare(): DbSet<T> {
    const qb = this.queryBuilder.clone<T>();
    qb.forShare();
    return this.createClone(qb);
  }

  /**
   * Applies exclusive row locking with NOWAIT (fails immediately if rows are locked).
   *
   * @returns A new cloned `DbSet` configured with row locking.
   */
  public forUpdateNoWait(): DbSet<T> {
    const qb = this.queryBuilder.clone<T>();
    qb.forUpdateNoWait();
    return this.createClone(qb);
  }

  /**
   * Applies exclusive row locking skipping already locked rows (ideal for queue workers).
   *
   * @returns A new cloned `DbSet` configured with row locking.
   */
  public forUpdateSkipLocked(): DbSet<T> {
    const qb = this.queryBuilder.clone<T>();
    qb.forUpdateSkipLocked();
    return this.createClone(qb);
  }

  /**
   * Fluent helper to set locking strategy explicitly.
   *
   * @param mode - Lock strategy: 'exclusive' | 'shared' | 'no-wait' | 'skip-locked'.
   * @returns A new cloned `DbSet` configured with row locking.
   */
  public withLock(mode: 'exclusive' | 'shared' | 'no-wait' | 'skip-locked'): DbSet<T> {
    const qb = this.queryBuilder.clone<T>();
    qb.withLock(mode);
    return this.createClone(qb);
  }

  /**
   * Applies a pessimistic row lock using a human-readable lock mode string.
   *
   * This is a semantic alias over `forUpdate()`, `forShare()`, etc., providing a
   * clean and unified API for all locking strategies across dialects.
   *
   * | mode           | SQL emitted (PostgreSQL)     | SQL emitted (MSSQL)               |
   * |----------------|------------------------------|-----------------------------------|
   * | `'pessimistic'`| `FOR UPDATE`                 | `WITH (UPDLOCK, ROWLOCK, HOLDLOCK)`|
   * | `'shared'`     | `FOR SHARE`                  | `WITH (HOLDLOCK, ROWLOCK)`         |
   * | `'no-wait'`    | `FOR UPDATE NOWAIT`          | `WITH (UPDLOCK, ROWLOCK, NOWAIT)` |
   * | `'skip-locked'`| `FOR UPDATE SKIP LOCKED`     | `WITH (UPDLOCK, ROWLOCK, READPAST)`|
   * | `'optimistic'` | *(no SQL modifier — handled via `@Version`)* | |
   *
   * @param mode - Lock strategy to apply.
   * @returns A new cloned `DbSet` with the specified row lock applied.
   * @example
   * ```ts
   * // Prevent concurrent updates to an account during a balance transfer
   * await db.useTransaction(async (tx) => {
   *   const account = await db.accounts
   *     .inTransaction(tx)
   *     .where({ id: accountId })
   *     .lock('pessimistic')
   *     .firstOrThrow();
   *
   *   await db.accounts.inTransaction(tx).update(account.id, {
   *     balance: account.balance - transferAmount,
   *   });
   * });
   * ```
   */
  public lock(mode: 'pessimistic' | 'shared' | 'optimistic' | 'no-wait' | 'skip-locked'): DbSet<T> {
    switch (mode) {
      case 'pessimistic':
        return this.forUpdate();
      case 'shared':
        return this.forShare();
      case 'no-wait':
        return this.forUpdateNoWait();
      case 'skip-locked':
        return this.forUpdateSkipLocked();
      case 'optimistic':
      default:
        // Optimistic concurrency is handled via @Version — no SQL lock modifier needed.
        return this.createClone();
    }
  }

  /**
   * Caches the result of this query in the registered query cache provider (e.g., Redis or in-memory) for the given TTL.
   *
   * @usecase Use this for high-read, low-write lookup tables (like system settings or product categories) to reduce database load.
   * @param ttlMs - Time-to-live in milliseconds (defaults to 60,000ms / 1 minute).
   * @param cacheKey - Optional custom key string. If omitted, an MD5/hash of SQL + parameters is auto-generated.
   * @returns A new cloned `DbSet` configured with caching options.
   * @example
   * ```ts
   * // Cache product catalog results for 5 minutes
   * const products = await context.products.cache(300000, 'active_products').toList();
   * ```
   */
  public cache(ttlMs: number = 60000, cacheKey?: string): DbSet<T> {
    return this.createClone(undefined, { cacheTtlMs: ttlMs, cacheKey });
  }

  /**
   * Invalidates and clears query cache entries matching a specific key, or clears the entire cache if no key is supplied.
   *
   * @usecase Use this after an update or delete mutation to invalidate stale cached lists.
   * @param cacheKey - Optional specific cache key to remove. If omitted, the entire query cache is purged.
   * @example
   * ```ts
   * await context.products.update(productId, { price: 19.99 });
   * await context.products.invalidateCache('active_products');
   * ```
   */
  public async invalidateCache(cacheKey?: string): Promise<void> {
    const cache: IQueryCache | undefined = this.context?.cache;
    if (cache) {
      if (cacheKey) {
        await cache.delete(cacheKey);
      } else {
        await cache.clear();
      }
    }
  }

  /**
   * Eagerly loads related navigation properties (`@HasMany`, `@HasOne`, `@BelongsTo`) in a single efficient batch using a lambda selector.
   *
   * @usecase Prevent the N+1 query problem by loading parent-child relationships upfront with compile-time type safety.
   * @param navigationProperty - Property accessor lambda (e.g. `u => u.posts`).
   * @returns A new cloned `DbSet` configured to eager load the specified navigation property.
   * @example
   * ```ts
   * const users = await context.users.include(u => u.posts).toList();
   * ```
   */
  public include<V>(navigationProperty: (entity: T) => V): DbSet<T>;
  /**
   * Eagerly loads related navigation properties using a relation property name.
   *
   * @param navigationProperty - Relation property name or dot-nested path.
   * @param enabled - Optional boolean flag (defaults to `true`). If `false`, inclusion is skipped.
   * @returns A new cloned `DbSet` configured to eager load the specified navigation property.
   */
  public include<K extends string = ColumnKey<T>>(
    navigationProperty: K,
    enabled?: boolean,
  ): DbSet<WithLoaded<T, K>>;
  public include(
    navigationPropertyOrSelector: ColumnKey<T> | ((entity: T) => unknown),
    enabled = true,
  ): DbSet<any> {
    const existingIncludes = [...(this.options.includes || [])];

    if (typeof navigationPropertyOrSelector === 'function') {
      const propName = this.resolvePropertySelector(navigationPropertyOrSelector);
      if (propName && enabled) {
        existingIncludes.push(propName);
      }
    } else if (typeof navigationPropertyOrSelector === 'string') {
      if (enabled) {
        existingIncludes.push(navigationPropertyOrSelector);
      }
    }

    return this.createClone(undefined, {
      includes: existingIncludes,
    });
  }

  /**
   * Eagerly loads a nested relationship following a preceding `.include()`.
   *
   * @usecase Load multi-level relationships (e.g. User -> Posts -> Comments).
   * @param navigationProperty - Property accessor lambda or relation property name on the child entity.
   * @returns A new cloned `DbSet` configured to eager load the nested relation.
   * @example
   * ```ts
   * const feed = await context.users
   *   .include(u => u.posts)
   *   .thenInclude((p: any) => p.comments)
   *   .toList();
   * ```
   */
  public thenInclude(navigationProperty: string | ((entity: any) => unknown)): DbSet<T> {
    const existingIncludes = [...(this.options.includes || [])];
    const propName =
      typeof navigationProperty === 'function'
        ? this.resolvePropertySelector(navigationProperty as any)
        : navigationProperty;

    if (existingIncludes.length > 0 && propName) {
      const last = existingIncludes[existingIncludes.length - 1];
      existingIncludes[existingIncludes.length - 1] = `${last}.${propName}`;
    } else if (propName) {
      existingIncludes.push(propName);
    }

    return this.createClone(undefined, {
      includes: existingIncludes,
    });
  }

  /**
   * Programmatically fetches and hydrates an unpopulated relation on an existing entity.
   *
   * @param entity - The parent entity instance.
   * @param relationName - Name of the navigation property to resolve.
   */
  public async fetchRelation<R = any>(entity: T, relationName: string): Promise<R> {
    const relMeta = this.metadata?.relations.get(relationName);
    if (!relMeta) {
      throw new Error(`Relation '${relationName}' is not defined on '${this.tableName}'.`);
    }
    const lazy = new LazyRelation(entity, relMeta, this);
    return lazy.fetch();
  }

  /**
   * Alias for fetchRelation.
   */
  public async loadRelation<R = any>(entity: T, relationName: string): Promise<R> {
    return this.fetchRelation(entity, relationName);
  }

  // --- Projection ---

  /**
   * Projects only specific columns/properties from the table into a typed partial entity result.
   *
   * @usecase Use this to minimize network bandwidth and database memory overhead by querying only the columns your view requires.
   * @param fields - Names of the entity properties to include in the SELECT clause.
   * @returns A new `DbSet` typed with only the selected fields (`Pick<T, K>`).
   * @example
   * ```ts
   * // Select only id, name, and email for a lightweight dropdown list
   * const summaries = await context.users
   *   .select('id', 'name', 'email')
   *   .toList();
   * ```
   */
  public select<K extends keyof T>(...fields: K[]): DbSet<Pick<T, K>> {
    const qb = this.cloneQueryBuilder<Pick<T, K>>();
    qb.select(...(fields as string[]));
    return new DbSet<Pick<T, K>>(
      this.adapter,
      this.entityTarget as any,
      qb,
      this.transaction,
      this.context,
      this.options,
    );
  }

  // --- Filtering ---

  /**
   * Filters records using a column comparison (`column`, `operator`, `value`).
   *
   * @usecase Filter records using standard relational comparison operators.
   * @param column - The column name or entity property key.
   * @param operator - Relational operator (`=`, `!=`, `<`, `>`, `LIKE`, `IN`, etc.).
   * @param value - Comparison value.
   * @returns A new cloned `DbSet` with the filter condition applied.
   * @example
   * ```ts
   * const activeAdmins = await context.users
   *   .where('role', '=', 'admin')
   *   .toList();
   * ```
   */
  public where<K extends keyof T & string>(
    column: K,
    operator:
      '=' | '!=' | '<>' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'ILIKE' | 'NOT LIKE' | 'IN' | 'NOT IN',
    value: any,
  ): DbSet<T>;
  public where(
    column: string,
    operator:
      '=' | '!=' | '<>' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'ILIKE' | 'NOT LIKE' | 'IN' | 'NOT IN',
    value: any,
  ): DbSet<T>;
  /**
   * Filters records using an object of property-value pairs (equality, IN arrays, or IS NULL).
   *
   * @param predicate - An object with entity keys and expected values.
   */
  public where(predicate: Partial<T>): DbSet<T>;
  /**
   * Filters records using a fluent WhereClause builder callback.
   *
   * @param fn - Callback receiving a WhereClause builder.
   */
  public where(fn: (clause: WhereClause<T>) => void | WhereClause<T>): DbSet<T>;
  public where(
    ...conditions: (Partial<T> | ((clause: WhereClause<T>) => void | WhereClause<T>))[]
  ): DbSet<T>;
  public where(...args: any[]): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    const where = qb.getWhereClause();

    if (args.length === 3 && typeof args[0] === 'string' && typeof args[1] === 'string') {
      const col = this.mapPropertyToColumn(args[0]);
      (where as any).addCondition(col, args[1], args[2]);
      return this.createClone(qb);
    }

    for (const arg of args) {
      if (!arg) continue;
      if (typeof arg === 'function') {
        const result = arg(where);
        if (result instanceof WhereClause) {
          qb.where(result);
        }
      } else if (typeof arg === 'object' && arg !== null) {
        for (const [key, val] of Object.entries(arg)) {
          const colName = this.mapPropertyToColumn(key);
          if (val === null || val === undefined) {
            where.isNull(colName);
          } else if (Array.isArray(val)) {
            where.in(colName, val);
          } else {
            where.eq(colName, val);
          }
        }
      }
    }
    return this.createClone(qb);
  }

  /**
   * Injects a raw SQL WHERE condition with parameterized values for advanced provider-specific expressions.
   *
   * @usecase Use this for vendor-specific SQL functions, spatial queries, or complex math calculations not expressible via standard operators.
   * @param sql - Raw SQL expression to append to WHERE (use parameter placeholders, e.g. `p0`, `?`).
   * @param params - Optional array of parameter values to bind safely against SQL injection.
   * @returns A new cloned `DbSet` with the raw condition appended.
   * @example
   * ```ts
   * const nearbyStores = await context.stores
   *   .whereRaw('ST_Distance(location, ST_Point(@p0, @p1)) < 5000', [lng, lat])
   *   .toList();
   * ```
   */
  public whereRaw(sql: string, params?: unknown[]): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    qb.getWhereClause().raw(sql, params);
    return this.createClone(qb);
  }

  /**
   * Adds a Common Table Expression (WITH clause) to the query.
   *
   * @param name - The CTE identifier name.
   * @param query - The query or subquery defining the CTE.
   * @param recursive - Whether the CTE is RECURSIVE.
   */
  public withCte(
    name: string,
    query:
      QueryBuilder<any> | DbSet<any> | Subquery<any> | string | ((qb: QueryBuilder<any>) => any),
    recursive = false,
  ): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    const effectiveQuery = (query as any)?.queryBuilder ? (query as any).queryBuilder : query;
    qb.withCte(name, effectiveQuery, recursive);
    return this.createClone(qb);
  }

  /**
   * Converts this DbSet query into an aliased Subquery.
   *
   * @param alias - Alias for referencing this subquery.
   */
  public asSubquery(alias: string): Subquery<T> {
    return this.cloneQueryBuilder().asSubquery(alias);
  }

  /**
   * Adds an SQL EXISTS subquery condition.
   *
   * @param subquery - Subquery, DbSet, QueryBuilder, or SQL string.
   * @param joinPredicate - Callback defining join predicate between outer entity and subquery.
   */
  public whereExists(subquery: any, joinPredicate?: (outer: any, inner: any) => void): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    qb.getWhereClause().exists(subquery, joinPredicate);
    return this.createClone(qb);
  }

  /**
   * Adds an SQL NOT EXISTS subquery condition.
   *
   * @param subquery - Subquery, DbSet, QueryBuilder, or SQL string.
   * @param joinPredicate - Callback defining join predicate between outer entity and subquery.
   */
  public whereNotExists(subquery: any, joinPredicate?: (outer: any, inner: any) => void): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    qb.getWhereClause().notExists(subquery, joinPredicate);
    return this.createClone(qb);
  }

  /**
   * Performs semantic / vector distance search on an embedding column using pgvector operators.
   *
   * @param column - Vector column or property name.
   * @param vector - Query embedding coordinates array.
   * @param options - Distance metric ('cosine', 'l2', 'inner_product') and limit.
   */
  public nearest(column: keyof T | string, vector: number[], options?: NearestOptions): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    const colName = this.mapPropertyToColumn(String(column));
    qb.nearest(colName, vector, options);
    return this.createClone(qb);
  }

  /**
   * Queries inside a JSON or JSONB column using dialect-specific extraction operators.
   *
   * @usecase Use this to filter documents or flexible schema attributes stored inside JSON columns (e.g. metadata, settings, tags).
   * @param column - The property or column holding the JSON payload.
   * @param path - JSON property path (e.g., `'address.city'` or `'tier'`).
   * @param operatorOrValue - Comparison operator (`'='`, `'>'`, etc.) or direct value when testing for equality.
   * @param value - Target value to compare against when an explicit operator is provided.
   * @returns A new cloned `DbSet` with the JSON filter condition applied.
   * @example
   * ```ts
   * const goldUsers = await context.users
   *   .whereJson('metadata', 'tier', '=', 'gold')
   *   .toList();
   * ```
   */
  public whereJson(
    column: ColumnKey<T>,
    path: string,
    operatorOrValue: string | unknown,
    value?: unknown,
  ): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    const colName = this.mapPropertyToColumn(String(column));
    qb.getWhereClause().whereJson(colName, path, operatorOrValue as any, value);
    return this.createClone(qb);
  }

  /**
   * Applies a native full-text search condition across one or more columns with dialect-specific fallback.
   *
   * @usecase Use this to implement search bars, catalog searches, or document matching across multiple text fields.
   * @param columns - Array of property names or property accessor functions to search within.
   * @param query - The search query term or phrase.
   * @param options - Optional search options (e.g. language, prefix matching).
   * @returns A new cloned `DbSet` with full-text search filtering applied.
   * @example
   * ```ts
   * const searchResults = await context.products
   *   .whereSearch(['title', 'description'], 'wireless headphones')
   *   .toList();
   * ```
   */
  public whereSearch(
    columns: (ColumnKey<T> | ((entity: T) => unknown))[],
    query: string,
    options?: SearchOptions,
  ): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    const mappedColumns = columns.map(col => {
      const colName = extractColumnName(col);
      return this.mapPropertyToColumn(colName);
    });
    qb.getWhereClause().whereSearch(mappedColumns, query, options);
    return this.createClone(qb);
  }

  /**
   * Filters records where a column value falls within an inclusive range `[lower, upper]`.
   *
   * @usecase Query date intervals, price ranges, age brackets, or numerical ranges directly.
   * @param field - Property accessor lambda or property name key.
   * @param range - Tuple containing `[lowerBound, upperBound]`.
   * @returns A new cloned `DbSet` with the range condition applied.
   * @example
   * ```ts
   * const q = await context.orders
   *   .whereBetween('createdAt', [startDate, endDate])
   *   .toList();
   * ```
   */
  public whereBetween<K extends keyof T & string>(
    field: K | ((entity: T) => unknown),
    range: [unknown, unknown],
  ): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    const propName = this.resolvePropertySelector(field as any) || String(field);
    const colName = this.mapPropertyToColumn(propName);
    qb.getWhereClause().between(colName, range[0], range[1]);
    return this.createClone(qb);
  }

  /**
   * Filters records where a column value matches any value in the provided array (`IN (...)`).
   *
   * @usecase Query items matching multiple IDs, statuses, or category codes without raw callbacks.
   * @param field - Property accessor lambda or property name key.
   * @param values - Array of matching values.
   * @returns A new cloned `DbSet` with the IN filter applied.
   * @example
   * ```ts
   * const orders = await context.orders.whereIn('status', ['paid', 'shipped']).toList();
   * ```
   */
  public whereIn<K extends keyof T & string>(
    field: K | ((entity: T) => unknown),
    values: unknown[],
  ): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    const propName = this.resolvePropertySelector(field as any) || String(field);
    const colName = this.mapPropertyToColumn(propName);
    qb.getWhereClause().in(colName, values);
    return this.createClone(qb);
  }

  /**
   * Filters records where a column value does NOT match any value in the provided array (`NOT IN (...)`).
   *
   * @usecase Exclude specific record IDs, statuses, or categories.
   * @param field - Property accessor lambda or property name key.
   * @param values - Array of values to exclude.
   * @returns A new cloned `DbSet` with the NOT IN filter applied.
   */
  public whereNotIn<K extends keyof T & string>(
    field: K | ((entity: T) => unknown),
    values: unknown[],
  ): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    const propName = this.resolvePropertySelector(field as any) || String(field);
    const colName = this.mapPropertyToColumn(propName);
    qb.getWhereClause().notIn(colName, values);
    return this.createClone(qb);
  }

  /**
   * Filters records matching a SQL `LIKE` pattern (e.g. `'%example.com'`).
   *
   * @usecase Simple prefix, suffix, or substring pattern searches.
   * @param field - Property accessor lambda or property name key.
   * @param pattern - Pattern with SQL `%` or `_` wildcards.
   * @returns A new cloned `DbSet` with the LIKE filter applied.
   */
  public whereLike<K extends keyof T & string>(
    field: K | ((entity: T) => unknown),
    pattern: string,
  ): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    const propName = this.resolvePropertySelector(field as any) || String(field);
    const colName = this.mapPropertyToColumn(propName);
    qb.getWhereClause().like(colName, pattern);
    return this.createClone(qb);
  }

  /**
   * Filters records NOT matching a SQL `NOT LIKE` pattern.
   */
  public whereNotLike<K extends keyof T & string>(
    field: K | ((entity: T) => unknown),
    pattern: string,
  ): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    const propName = this.resolvePropertySelector(field as any) || String(field);
    const colName = this.mapPropertyToColumn(propName);
    qb.getWhereClause().notLike(colName, pattern);
    return this.createClone(qb);
  }

  /**
   * Filters records where a column value is `NULL`.
   */
  public whereNull<K extends keyof T & string>(field: K | ((entity: T) => unknown)): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    const propName = this.resolvePropertySelector(field as any) || String(field);
    const colName = this.mapPropertyToColumn(propName);
    qb.getWhereClause().isNull(colName);
    return this.createClone(qb);
  }

  /**
   * Filters records where a column value is `NOT NULL`.
   */
  public whereNotNull<K extends keyof T & string>(field: K | ((entity: T) => unknown)): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    const propName = this.resolvePropertySelector(field as any) || String(field);
    const colName = this.mapPropertyToColumn(propName);
    qb.getWhereClause().isNotNull(colName);
    return this.createClone(qb);
  }

  // --- Sorting ---

  /**
   * Sorts the query results by a property or column in ascending or descending order.
   *
   * @usecase Use this to order lists chronologically, alphabetically, or by numerical ranking.
   * @param field - Property accessor lambda or property name key.
   * @param direction - Sort direction: `'asc'` (default) or `'desc'`.
   * @returns A new cloned `DbSet` with the sort order applied.
   * @example
   * ```ts
   * const users = await context.users
   *   .orderBy(u => u.createdAt, 'desc')
   *   .toList();
   * ```
   */
  public orderBy<V>(field: (entity: T) => V, direction?: 'asc' | 'desc'): DbSet<T>;
  public orderBy<K extends keyof T & string>(field: K, direction?: 'asc' | 'desc'): DbSet<T>;
  public orderBy(field: string & {}, direction?: 'asc' | 'desc'): DbSet<T>;
  public orderBy(
    field: ColumnKey<T> | ((entity: T) => unknown),
    direction: 'asc' | 'desc' = 'asc',
  ): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    const colName = this.resolvePropertySelector(field);
    qb.orderBy(colName, direction);
    return this.createClone(qb);
  }

  /**
   * Sorts the query results by a property or column in descending order (highest/newest first).
   *
   * @usecase Convenience method to sort by newest created records or highest prices/scores.
   * @param field - Property accessor lambda or property name key.
   * @returns A new cloned `DbSet` sorted in descending order.
   * @example
   * ```ts
   * const topScores = await context.players
   *   .orderByDescending(p => p.score)
   *   .toList();
   * ```
   */
  public orderByDescending<V>(field: (entity: T) => V): DbSet<T>;
  public orderByDescending<K extends keyof T & string>(field: K): DbSet<T>;
  public orderByDescending(field: string & {}): DbSet<T>;
  public orderByDescending(field: ColumnKey<T> | ((entity: T) => unknown)): DbSet<T> {
    return this.orderBy(field as any, 'desc');
  }

  /**
   * Adds a secondary sorting criteria after an initial `orderBy` or `orderByDescending`.
   *
   * @usecase Use this to break ties in sorting, e.g. sort by category ascending, then by price descending.
   * @param field - Property accessor lambda or property name key.
   * @param direction - Sort direction: `'asc'` (default) or `'desc'`.
   * @returns A new cloned `DbSet` with secondary sorting criteria added.
   * @example
   * ```ts
   * const products = await context.products
   *   .orderBy('category', 'asc')
   *   .thenBy('price', 'desc')
   *   .toList();
   * ```
   */
  public thenBy<V>(field: (entity: T) => V, direction?: 'asc' | 'desc'): DbSet<T>;
  public thenBy<K extends keyof T & string>(field: K, direction?: 'asc' | 'desc'): DbSet<T>;
  public thenBy(field: string & {}, direction?: 'asc' | 'desc'): DbSet<T>;
  public thenBy(
    field: ColumnKey<T> | ((entity: T) => unknown),
    direction: 'asc' | 'desc' = 'asc',
  ): DbSet<T> {
    return this.orderBy(field as any, direction);
  }

  // --- Pagination ---

  /**
   * Skips the specified number of rows from the beginning of the result set.
   *
   * @usecase Use this together with `.take()` for offset-based pagination.
   * @param n - The number of rows to skip.
   * @returns A new cloned `DbSet` with the OFFSET clause set.
   * @example
   * ```ts
   * const page2 = await context.users.skip(20).take(10).toList();
   * ```
   */
  public skip(n: number): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    qb.offset(n);
    return this.createClone(qb);
  }

  /**
   * Limits the number of rows returned by the query.
   *
   * @usecase Use this to restrict result set size for top-N queries or pagination.
   * @param n - The maximum number of rows to return.
   * @returns A new cloned `DbSet` with the LIMIT clause set.
   * @example
   * ```ts
   * const topFive = await context.products.orderByDescending('sales').take(5).toList();
   * ```
   */
  public take(n: number): DbSet<T> {
    const qb = this.cloneQueryBuilder();
    qb.limit(n);
    return this.createClone(qb);
  }

  /**
   * Configures pagination using 1-based page numbers and page size.
   *
   * @usecase Use this to cleanly paginate REST API endpoints with query parameters `?page=1&pageSize=20`.
   * @param page - The 1-based page number (e.g. 1 for first page).
   * @param pageSize - Number of items per page.
   * @returns A new cloned `DbSet` with appropriate `skip` and `take` applied.
   * @example
   * ```ts
   * const items = await context.users.paginate(2, 25).toList();
   * ```
   */
  public paginate(page: number, pageSize: number): DbSet<T> {
    const offset = Math.max(0, (page - 1) * pageSize);
    return this.skip(offset).take(pageSize);
  }

  /**
   * Executes a callback with the current `DbSet` instance for side-effects, debugging, or logging, without breaking the fluent query chain.
   *
   * @usecase Peek into query state, log intermediate SQL, or perform diagnostics mid-chain.
   * @param fn - Inspection callback receiving this `DbSet`.
   * @returns The same `DbSet` instance.
   * @example
   * ```ts
   * const users = await context.users
   *   .where({ isActive: true })
   *   .tap(set => console.log('Querying table:', set.getTableName()))
   *   .orderBy('createdAt', 'desc')
   *   .toList();
   * ```
   */
  public tap(fn: (set: DbSet<T>) => void): DbSet<T> {
    fn(this);
    return this;
  }

  // --- Joins ---

  /**
   * Performs an SQL JOIN operation against another table or entity model.
   *
   * @usecase Use this to query across related tables when eager loading or projection across boundaries is needed.
   * @param target - Target entity class or table name to join with.
   * @param on - Join key pairing `{ left: 'userId', right: 'id' }`.
   * @param type - Join type (`'INNER'`, `'LEFT'`, `'RIGHT'`, or `'FULL'`), defaults to `'INNER'`.
   * @param alias - Optional SQL table alias for the joined entity.
   * @returns A new `DbSet` representing the merged entity type `T & Partial<R>`.
   * @example
   * ```ts
   * const userOrders = await context.users
   *   .join(Order, { left: 'id', right: 'userId' }, 'INNER')
   *   .toList();
   * ```
   */
  public join<R extends object>(
    target: EntityTarget<R>,
    on: { left: ColumnKey<T>; right: ColumnKey<R> },
    type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' = 'INNER',
    alias?: string,
  ): DbSet<T & Partial<R>> {
    const qb = this.cloneQueryBuilder<T & Partial<R>>();
    let otherTable = '';
    let rightCol = String(on.right);
    if (typeof target === 'function') {
      const otherMeta = ModelMetadataRegistry.getInstance().get(target);
      otherTable = otherMeta?.tableName || target.name;
      if (otherMeta) {
        const colMeta = otherMeta.columns.get(String(on.right));
        if (colMeta?.columnName) {
          rightCol = colMeta.columnName;
        }
      }
    } else {
      otherTable = target;
    }

    const leftCol = this.mapPropertyToColumn(String(on.left));
    qb.join(type, otherTable, leftCol, rightCol, alias);
    return new DbSet<T & Partial<R>>(
      this.adapter,
      this.entityTarget as any,
      qb,
      this.transaction,
      this.context,
      this.options,
    );
  }

  /**
   * Performs a LEFT OUTER JOIN operation against another table or entity model.
   *
   * @usecase Convenience method to retrieve all rows from the primary table even if no matching row exists in the joined table.
   * @param target - Target entity class or table name to join with.
   * @param on - Join key pairing `{ left: 'userId', right: 'id' }`.
   * @param alias - Optional SQL table alias.
   * @returns A new `DbSet` representing the merged entity type `T & Partial<R>`.
   * @example
   * ```ts
   * const usersWithProfiles = await context.users
   *   .leftJoin(Profile, { left: 'id', right: 'userId' })
   *   .toList();
   * ```
   */
  public leftJoin<R extends object>(
    target: EntityTarget<R>,
    on: { left: ColumnKey<T>; right: ColumnKey<R> },
    alias?: string,
  ): DbSet<T & Partial<R>> {
    return this.join(target, on, 'LEFT', alias);
  }

  // --- Terminal: Reads ---

  /**
   * Executes the constructed query and returns all matching entities as an array.
   *
   * @usecase Terminal execution method to retrieve results into memory, applying any soft-delete filters, query caching, and eager-loaded relations.
   * @returns A Promise resolving to an array of entity instances.
   * @example
   * ```ts
   * const activeUsers = await context.users.where({ isActive: true }).toList();
   * ```
   */
  public async toList(): Promise<T[]> {
    const qb = this.prepareFinalQueryBuilder();
    const { sql, params } = qb.toSelectSql();

    const cache: IQueryCache | undefined = this.context?.cache;
    let cacheKey: string | undefined;
    if (cache && this.options.cacheTtlMs) {
      cacheKey =
        this.options.cacheKey || `${this.tableName}:${sql}:${JSON.stringify(params || [])}`;
      const cached = await cache.get<T[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const effectiveAdapter = this.resolveEffectiveAdapter(qb);
    let rows: Record<string, unknown>[];
    try {
      rows = await effectiveAdapter.executeQuery<Record<string, unknown>>(
        sql,
        params,
        this.transaction,
      );
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, effectiveAdapter.provider);
    }
    const entities = rows.map(r => this.mapRowToEntity(r));

    if (this.options.includes && this.options.includes.length > 0 && entities.length > 0) {
      await this.loadIncludes(entities, this.options.includes);
    }

    if (cache && cacheKey && this.options.cacheTtlMs) {
      await cache.set(cacheKey, entities, this.options.cacheTtlMs);
    }

    return entities;
  }

  /**
   * Alias for `toList()` for developers accustomed to array-oriented method names.
   *
   * @usecase Retrieve all matching entities as an array.
   * @returns A Promise resolving to an array of entity instances.
   */
  public async toArray(): Promise<T[]> {
    return this.toList();
  }

  /**
   * Executes the query and transforms the results into a JavaScript `Map<K, T>` keyed by the specified selector.
   *
   * @usecase Perform O(1) in-memory lookups by ID or unique key without writing manual `.reduce()` loops.
   * @param keySelector - Function returning the key to use for each item in the map.
   * @returns A Promise resolving to a Map where each entry maps a key to its corresponding entity.
   * @example
   * ```ts
   * const userMap = await context.users.where({ isActive: true }).toMap(u => u.id);
   * const user = userMap.get(42);
   * ```
   */
  public async toMap<K>(keySelector: (entity: T) => K): Promise<Map<K, T>> {
    const list = await this.toList();
    const map = new Map<K, T>();
    for (const item of list) {
      map.set(keySelector(item), item);
    }
    return map;
  }

  /**
   * Projects each entity in the query result into a custom DTO or mapped shape in a type-safe manner.
   *
   * @usecase Retrieve and map entities directly into API response models or lightweight view models.
   * @param mapFn - Mapping function transforming each entity `T` to `TDto`.
   * @returns A Promise resolving to an array of mapped `TDto` objects.
   * @example
   * ```ts
   * const summaries = await context.users
   *   .where({ isActive: true })
   *   .selectAs(u => ({ id: u.id, displayName: `${u.firstName} ${u.lastName}` }));
   * ```
   */
  public async selectAs<TDto>(mapFn: (entity: T) => TDto): Promise<TDto[]> {
    const list = await this.toList();
    return list.map(mapFn);
  }

  /**
   * Processes large datasets in manageable batches (chunks) using sequential paging, avoiding memory exhaustion.
   *
   * @usecase Ideal for background jobs, data migrations, ETL pipelines, or bulk notifications.
   * @param size - The number of records to fetch and process in each batch.
   * @param callback - Async function executed for each batch of items.
   * @example
   * ```ts
   * await context.orders.where({ status: 'pending' }).chunk(500, async (batch, pageIndex) => {
   *   console.log(`Processing batch #${pageIndex} with ${batch.length} items`);
   *   await notifyWarehouse(batch);
   * });
   * ```
   */
  public async chunk(
    size: number,
    callback: (batch: T[], index: number) => Promise<boolean | void> | boolean | void,
  ): Promise<number> {
    if (!size || size <= 0) {
      throw new Error(`Chunk size must be greater than 0, received ${size}`);
    }

    const parentLimit = this.queryBuilder.getLimit();
    const baseOffset = this.queryBuilder.getOffset() || 0;

    let offset = baseOffset;
    let pageIndex = 0;
    let totalProcessed = 0;

    while (true) {
      let currentBatchSize = size;
      if (parentLimit !== undefined) {
        const remaining = parentLimit - totalProcessed;
        if (remaining <= 0) break;
        currentBatchSize = Math.min(size, remaining);
      }

      const batch = await this.skip(offset).take(currentBatchSize).toList();
      if (!batch || batch.length === 0) break;

      totalProcessed += batch.length;
      const res = await callback(batch, pageIndex++);
      if (res === false) break;

      if (batch.length < currentBatchSize) break;
      offset += currentBatchSize;
    }

    return totalProcessed;
  }

  /**
   * Returns an async iterable stream yielding entities row by row in configurable batch sizes.
   *
   * @usecase Process large datasets, CSV exports, or background streams with minimal memory overhead.
   * @param batchSize - Batch size for underlying chunk fetching (default: 100).
   * @returns An `AsyncIterable<T>` compatible with `for await (const entity of set.stream())`.
   * @example
   * ```ts
   * for await (const user of context.users.where({ isActive: true }).stream(250)) {
   *   await processUser(user);
   * }
   * ```
   */
  public async *stream(batchSize = 100): AsyncGenerator<T> {
    const qb = this.prepareFinalQueryBuilder();
    const effectiveAdapter = this.resolveEffectiveAdapter(qb);

    if (typeof effectiveAdapter.executeStream === 'function') {
      const { sql, params } = qb.toSelectSql();
      const iterable = effectiveAdapter.executeStream<Record<string, unknown>>(
        sql,
        params,
        this.transaction,
      );
      for await (const row of iterable) {
        yield this.mapRowToEntity(row);
      }
      return;
    }

    const size = Math.max(1, batchSize);
    let offset = 0;
    while (true) {
      const batch = await this.skip(offset).take(size).toList();
      if (batch.length === 0) break;
      for (const item of batch) {
        yield item;
      }
      if (batch.length < size) break;
      offset += size;
    }
  }

  /**
   * Executes a paginated query returning both the page of items and comprehensive pagination metadata (totalCount, totalPages, hasNext, hasPrevious).
   *
   * @usecase Use this in data tables, UI grids, and search endpoints where total record counts and page controls are required.
   * @param pageOrOptions - The 1-based page number or a `PagedListOptions` object.
   * @param maybePageSize - Number of items per page if first argument is a number.
   * @returns A Promise resolving to `PagedResult<T>` containing `items`, `totalCount`, `totalPages`, etc.
   * @example
   * ```ts
   * const page = await context.products.where({ isActive: true }).toPagedList(1, 10);
   * console.log(`Showing ${page.items.length} of ${page.totalCount} products across ${page.totalPages} pages`);
   * ```
   */
  public async toPagedList(
    pageOrOptions: number | PagedListOptions,
    maybePageSize?: number,
  ): Promise<PagedResult<T>> {
    let page: number;
    let pageSize: number;

    if (typeof pageOrOptions === 'object' && pageOrOptions !== null) {
      page = pageOrOptions.page;
      pageSize = pageOrOptions.pageSize;
    } else {
      page = pageOrOptions;
      pageSize = maybePageSize || 10;
    }

    const total = await this.count();
    const items = await this.paginate(page, pageSize).toList();
    const totalPages = Math.ceil(total / pageSize) || 1;
    const hasNext = page < totalPages;
    const hasPrevious = page > 1;

    return {
      items,
      total,
      totalCount: total,
      page,
      pageIndex: page,
      pageSize,
      totalPages,
      hasNext,
      hasNextPage: hasNext,
      hasPrevious,
      hasPreviousPage: hasPrevious,
    };
  }

  /**
   * Executes keyset (cursor-based) pagination with constant O(1) row navigation and zero offset performance degradation.
   *
   * @usecase Ideal for infinite scroll feeds, real-time activity timelines, and large data export pipelines where offset pagination gets slow.
   * @param options - Pagination options specifying cursor, limit, orderBy column, and tie-breaker column.
   * @returns A Promise resolving to `CursorPageResult<T>` containing items, `nextCursor`, and navigation flags.
   * @example
   * ```ts
   * const page = await context.posts.toCursorPage({
   *   limit: 20,
   *   orderBy: 'createdAt',
   *   direction: 'desc',
   *   cursor: req.query.cursor as string,
   * });
   * ```
   */
  public async toCursorPage(options: CursorPaginationOptions<T>): Promise<CursorPageResult<T>> {
    const limit = options.limit;
    const direction = (options.direction || 'asc').toLowerCase() as 'asc' | 'desc';
    const orderCol = this.mapPropertyToColumn(extractColumnName(options.orderBy));
    const tieCol = options.tieBreaker
      ? this.mapPropertyToColumn(extractColumnName(options.tieBreaker))
      : undefined;

    let query: DbSet<T> = this;

    // Decode cursor if provided
    const decoded = options.cursor ? decodeCursor(options.cursor) : null;

    if (decoded) {
      const cursorVal = decoded[orderCol] !== undefined ? decoded[orderCol] : decoded.value;
      const cursorTieVal = tieCol && decoded[tieCol] !== undefined ? decoded[tieCol] : decoded.id;

      if (cursorVal !== undefined) {
        if (!tieCol || orderCol === tieCol || cursorTieVal === undefined) {
          const op = direction === 'desc' ? '<' : '>';
          query = query.where((clause: WhereClause<T>) => {
            (clause as any).addCondition(orderCol, op, cursorVal);
          });
        } else {
          const primaryOp = direction === 'desc' ? '<' : '>';
          const tieOp = direction === 'desc' ? '<' : '>';

          query = query.where((clause: WhereClause<T>) => {
            clause.group(sub1 => {
              (sub1 as any).addCondition(orderCol, primaryOp, cursorVal);
            });
            clause.or();
            clause.group(sub2 => {
              (sub2 as any).addCondition(orderCol, '=', cursorVal);
              (sub2 as any).addCondition(tieCol, tieOp, cursorTieVal);
            });
          });
        }
      }
    }

    // Apply ORDER BY
    query = query.orderBy(orderCol as any, direction);
    if (tieCol && orderCol !== tieCol) {
      query = query.orderBy(tieCol as any, direction);
    }

    // Fetch limit + 1 items to determine if a next page exists
    const fetched = await query.take(limit + 1).toList();

    const hasNextPage = fetched.length > limit;
    const items = hasNextPage ? fetched.slice(0, limit) : fetched;
    const hasPreviousPage = decoded !== null;

    let nextCursor: string | null = null;
    if (hasNextPage && items.length > 0) {
      const lastItem = items[items.length - 1] as any;
      const cursorPayload: Record<string, any> = {
        [orderCol]: lastItem[orderCol],
        value: lastItem[orderCol],
      };
      if (tieCol && lastItem[tieCol] !== undefined) {
        cursorPayload[tieCol] = lastItem[tieCol];
        cursorPayload.id = lastItem[tieCol];
      } else if (lastItem.id !== undefined) {
        cursorPayload.id = lastItem.id;
      }
      nextCursor = encodeCursor(cursorPayload);
    }

    let prevCursor: string | null = null;
    if (hasPreviousPage && items.length > 0) {
      const firstItem = items[0] as any;
      const prevPayload: Record<string, any> = {
        [orderCol]: firstItem[orderCol],
        value: firstItem[orderCol],
      };
      if (tieCol && firstItem[tieCol] !== undefined) {
        prevPayload[tieCol] = firstItem[tieCol];
        prevPayload.id = firstItem[tieCol];
      } else if (firstItem.id !== undefined) {
        prevPayload.id = firstItem.id;
      }
      prevCursor = encodeCursor(prevPayload);
    }

    return {
      items,
      nextCursor,
      prevCursor,
      hasNextPage,
      hasPreviousPage,
    };
  }

  /**
   * Finds the first entity matching the criteria or returns `null` if no match is found.
   *
   * @usecase Use this when a record might not exist and you want to handle `null` gracefully without exception handling.
   * @param predicate - Optional filter object to narrow the search.
   * @returns A Promise resolving to the first matching entity or `null`.
   * @example
   * ```ts
   * const user = await context.users.first({ email: 'user@example.com' });
   * if (!user) {
   *   // handle unregistered user
   * }
   * ```
   */
  public async first(predicate?: Partial<T>): Promise<T | null> {
    let set: DbSet<T> = this;
    if (predicate) {
      set = set.where(predicate);
    }
    const list = await set.take(1).toList();
    return list.length > 0 ? list[0] : null;
  }

  /**
   * Finds the first entity matching the criteria or returns `null` if none found.
   * Alias for `first()`.
   */
  public async firstOrDefault(predicate?: Partial<T>): Promise<T | null> {
    return this.first(predicate);
  }

  /**
   * Finds the first entity matching the criteria, or throws `EntityNotFoundException` if none exists.
   *
   * @usecase Use this in HTTP handlers or service methods where an entity must exist (e.g. `GET /users/:id`), letting your error middleware handle 404 responses.
   * @param predicate - Optional filter object to narrow the search.
   * @throws `EntityNotFoundException` when no matching record is found.
   * @returns A Promise resolving to the first matching entity.
   * @example
   * ```ts
   * const user = await context.users.firstOrThrow({ email });
   * ```
   */
  public async firstOrThrow(predicate?: Partial<T>): Promise<T> {
    const item = await this.first(predicate);
    if (!item) {
      throw new EntityNotFoundException(`Entity '${this.tableName}' not found matching predicate.`);
    }
    return item;
  }

  /**
   * Asserts that at most one entity matches the query and returns it, or returns `null` if empty.
   *
   * @usecase Use this when you expect a unique record and want to detect accidental duplicate records in the database.
   * @param predicate - Optional filter object.
   * @throws `DbException` if more than one record matches the condition.
   * @returns The single matching entity or `null`.
   * @example
   * ```ts
   * const uniqueSetting = await context.settings.single({ key: 'site_name' });
   * ```
   */
  public async single(predicate?: Partial<T>): Promise<T | null> {
    let set: DbSet<T> = this;
    if (predicate) {
      set = set.where(predicate);
    }
    const list = await set.take(2).toList();
    if (list.length > 1) {
      throw new DbException(`Sequence contains more than one element in '${this.tableName}'.`);
    }
    return list.length === 1 ? list[0] : null;
  }

  /**
   * Asserts that exactly one entity matches the query and returns it.
   *
   * @usecase Use this when a unique record is strictly expected; throws if not found or if duplicates exist.
   * @param predicate - Optional filter object.
   * @throws `EntityNotFoundException` if no record is found.
   * @throws `DbException` if more than one record is found.
   * @returns The single matching entity.
   * @example
   * ```ts
   * const account = await context.accounts.singleOrThrow({ accountNumber: 'ACC-12345' });
   * ```
   */
  public async singleOrThrow(predicate?: Partial<T>): Promise<T> {
    const item = await this.single(predicate);
    if (!item) {
      throw new EntityNotFoundException(`Entity '${this.tableName}' not found matching predicate.`);
    }
    return item;
  }

  /**
   * Looks up an entity by its primary key value or returns `null` if not found.
   *
   * @usecase Fast, direct primary key lookup across any supported database engine (PostgreSQL, MySQL, SQLite, MSSQL, Neon, Turso).
   * @param id - The primary key value (e.g. number, string, or UUID).
   * @returns A Promise resolving to the entity instance or `null`.
   *
   * @example
   * **PostgreSQL / MySQL / SQLite / MSSQL:**
   * ```ts
   * const user = await context.users.find(10);
   * if (user) {
   *   console.log('Found user:', user.name);
   * }
   * ```
   */
  public async find(id: unknown): Promise<T | null> {
    const pk = this.getPrimaryKeyProperty();
    return this.first({ [pk]: id } as unknown as Partial<T>);
  }

  /**
   * Looks up an entity by its primary key value or throws `EntityNotFoundException` if it does not exist.
   *
   * @usecase Standard lookup for API controller show/edit endpoints where a missing entity should trigger a 404 response.
   * @param id - The primary key value.
   * @throws `EntityNotFoundException` if no entity with the given primary key exists.
   * @returns A Promise resolving to the matching entity instance.
   *
   * @example
   * ```ts
   * const user = await context.users.findOrThrow(req.params.id);
   * ```
   */
  public async findOrThrow(id: unknown): Promise<T> {
    const pk = this.getPrimaryKeyProperty();
    return this.firstOrThrow({ [pk]: id } as unknown as Partial<T>);
  }

  /**
   * Counts the total number of matching rows in the table.
   *
   * @usecase Total record counts for analytics, dashboards, and pagination calculations.
   * @returns A Promise resolving to the count as a number.
   * @example
   * ```ts
   * const total = await context.users.count();
   * ```
   */
  public async count(): Promise<number>;
  /**
   * Counts the total number of matching rows using an inline filter predicate.
   *
   * @param predicate - Filter criteria object.
   * @example
   * ```ts
   * const activeAdmins = await context.users.count({ role: 'admin', isActive: true });
   * ```
   */
  public async count(predicate: Partial<T>): Promise<number>;
  /**
   * Counts the total number of matching rows using a WhereClause builder callback.
   *
   * @param fn - Builder callback function.
   * @example
   * ```ts
   * const highSpenders = await context.orders.count(w => w.gt('total', 500));
   * ```
   */
  public async count(fn: (clause: WhereClause<T>) => void | WhereClause<T>): Promise<number>;
  public async count(
    predicate?: Partial<T> | ((clause: WhereClause<T>) => void | WhereClause<T>),
  ): Promise<number>;
  public async count(
    predicate?: Partial<T> | ((builder: WhereClause<T>) => void | WhereClause<T>),
  ): Promise<number> {
    let set: DbSet<T> = this;
    if (predicate) {
      set = set.where(predicate as any);
    }
    const qb = set.prepareFinalQueryBuilder();
    const { sql, params } = qb.toCountSql();
    const adapter = this.resolveEffectiveAdapter(qb);
    const res = await adapter.executeScalar<number | string>(sql, params, this.transaction);
    return Number(res) || 0;
  }

  /**
   * Computes the mathematical sum of a numeric column across matching rows.
   *
   * @usecase Use this for calculating revenue, total inventory quantities, or points totals.
   * @param selector - Property name key or property accessor function.
   * @returns A Promise resolving to the aggregated sum as a number.
   * @example
   * ```ts
   * const totalSales = await context.orders.where({ status: 'completed' }).sum('totalAmount');
   * ```
   */
  public async sum(selector: (entity: T) => number): Promise<number>;
  public async sum<K extends keyof T & string>(selector: K): Promise<number>;
  public async sum(selector: string & {}): Promise<number>;
  public async sum(selector: ColumnKey<T> | ((entity: T) => number)): Promise<number> {
    const col = this.resolveAggregateSelector(selector);
    const qb = this.prepareFinalQueryBuilder();
    const { sql, params } = qb.toAggregateSql('SUM', col);
    const adapter = this.resolveEffectiveAdapter(qb);
    const res = await adapter.executeScalar<number | string>(sql, params, this.transaction);
    return Number(res) || 0;
  }

  /**
   * Computes the mathematical average of a numeric column across matching rows.
   *
   * @usecase Use this for calculating average ratings, average order values, or performance metrics.
   * @param selector - Property name key or property accessor function.
   * @returns A Promise resolving to the average value as a number.
   * @example
   * ```ts
   * const avgRating = await context.reviews.avg(r => r.rating);
   * ```
   */
  public async avg(selector: (entity: T) => number): Promise<number>;
  public async avg<K extends keyof T & string>(selector: K): Promise<number>;
  public async avg(selector: string & {}): Promise<number>;
  public async avg(selector: ColumnKey<T> | ((entity: T) => number)): Promise<number> {
    const col = this.resolveAggregateSelector(selector);
    const qb = this.prepareFinalQueryBuilder();
    const { sql, params } = qb.toAggregateSql('AVG', col);
    const adapter = this.resolveEffectiveAdapter(qb);
    const res = await adapter.executeScalar<number | string>(sql, params, this.transaction);
    return Number(res) || 0;
  }

  /**
   * Determines the minimum value of a column across matching rows.
   *
   * @usecase Use this to find lowest product price, earliest event date, or minimum score.
   * @param selector - Property name key or property accessor function.
   * @returns A Promise resolving to the minimum value.
   * @example
   * ```ts
   * const lowestPrice = await context.products.min('price');
   * ```
   */
  public async min<R = unknown>(selector: (entity: T) => R): Promise<R>;
  public async min<K extends keyof T & string>(selector: K): Promise<T[K]>;
  public async min<R = unknown>(selector: string & {}): Promise<R>;
  public async min<R = unknown>(selector: ColumnKey<T> | ((entity: T) => unknown)): Promise<R> {
    const col = this.resolveAggregateSelector(selector);
    const qb = this.prepareFinalQueryBuilder();
    const { sql, params } = qb.toAggregateSql('MIN', col);
    const adapter = this.resolveEffectiveAdapter(qb);
    return adapter.executeScalar<R>(sql, params, this.transaction);
  }

  /**
   * Determines the maximum value of a column across matching rows.
   *
   * @usecase Use this to find highest product price, latest update timestamp, or top score.
   * @param selector - Property name key or property accessor function.
   * @returns A Promise resolving to the maximum value.
   * @example
   * ```ts
   * const maxPrice = await context.products.max('price');
   * ```
   */
  public async max<R = unknown>(selector: (entity: T) => R): Promise<R>;
  public async max<K extends keyof T & string>(selector: K): Promise<T[K]>;
  public async max<R = unknown>(selector: string & {}): Promise<R>;
  public async max<R = unknown>(selector: ColumnKey<T> | ((entity: T) => unknown)): Promise<R> {
    const col = this.resolveAggregateSelector(selector);
    const qb = this.prepareFinalQueryBuilder();
    const { sql, params } = qb.toAggregateSql('MAX', col);
    const adapter = this.resolveEffectiveAdapter(qb);
    return adapter.executeScalar<R>(sql, params, this.transaction);
  }

  /**
   * Checks whether any rows in the table match the optional criteria.
   *
   * @usecase Use this to quickly verify existence of matching records before proceeding with dependent operations.
   * @param predicate - Optional filter condition.
   * @returns `true` if at least one matching row exists, otherwise `false`.
   * @example
   * ```ts
   * const hasOverdueInvoices = await context.invoices.any({ status: 'overdue' });
   * ```
   */
  public async any(predicate?: Partial<T> | ((builder: WhereClause<T>) => void)): Promise<boolean> {
    if (!predicate) {
      return (await this.count()) > 0;
    }
    return (await this.count(predicate)) > 0;
  }

  /**
   * Checks whether all rows in the table match the specified condition.
   *
   * @usecase Use this for validation workflows to assert that all records satisfy a rule (e.g. all tasks in a project are completed).
   * @param predicate - Filter condition that all rows must satisfy.
   * @returns `true` if all rows match, otherwise `false`.
   * @example
   * ```ts
   * const allPaid = await context.orders.all({ paymentStatus: 'paid' });
   * ```
   */
  public async all(predicate: Partial<T> | ((builder: WhereClause<T>) => void)): Promise<boolean> {
    const total = await this.count();
    if (total === 0) return true;
    const matching = await this.count(predicate);
    return matching === total;
  }

  /**
   * Groups rows by a key property selector for aggregate queries (`COUNT`, `SUM`, `AVG`).
   *
   * @usecase Use this for reporting and charts (e.g. count of users by country, sales sum by category).
   * @param keySelector - Function returning the grouping property key.
   * @returns A `GroupedQueryBuilder` instance supporting aggregate operations.
   * @example
   * ```ts
   * const salesByCategory = await context.products
   *   .groupBy(p => p.category)
   *   .sum('price');
   * ```
   */
  public groupBy<TKey>(keySelector: (entity: T) => TKey): GroupedQueryBuilder<T, TKey> {
    const qb = this.prepareFinalQueryBuilder();
    return new GroupedQueryBuilder<T, TKey>(
      this.resolveEffectiveAdapter(qb),
      qb,
      keySelector,
      this.metadata,
      this.transaction,
    );
  }

  /**
   * Routes the query explicitly to the primary/write database connection instead of read-replicas.
   *
   * @usecase Critical for read-after-write consistency to prevent replication lag anomalies immediately following a mutation.
   * @param use - Whether to force primary connection routing (defaults to `true`).
   * @returns A new cloned `DbSet` configured to route through the primary database adapter.
   * @example
   * ```ts
   * await context.users.add(newUser);
   * // Immediately read from primary to ensure updated data is returned
   * const created = await context.users.usePrimary().first({ email: newUser.email });
   * ```
   */
  public usePrimary(use = true): DbSet<T> {
    const qb = this.queryBuilder.clone();
    qb.usePrimary(use);
    return this.createClone(qb);
  }

  /**
   * Applies the DISTINCT keyword to the generated query.
   */
  public distinct(distinct = true): DbSet<T> {
    const qb = this.queryBuilder.clone();
    qb.distinct(distinct);
    return this.createClone(qb);
  }

  /**
   * Checks whether any record matching the predicate exists.
   *
   * @usecase Use this for fast existence checks, e.g. checking if an email is already registered during signup.
   * @param predicate - Optional filter criteria.
   * @returns `true` if matching record exists, otherwise `false`.
   * @example
   * ```ts
   * const emailTaken = await context.users.exists({ email: 'test@example.com' });
   * ```
   */
  public async exists(predicate?: Partial<T>): Promise<boolean> {
    const c = await this.count(predicate);
    return c > 0;
  }

  private resolveEffectiveAdapter(qb: QueryBuilder<any>): IDbAdapter {
    if (
      qb.isUsePrimary() &&
      'getPrimaryAdapter' in this.adapter &&
      typeof (this.adapter as any).getPrimaryAdapter === 'function'
    ) {
      return (this.adapter as any).getPrimaryAdapter();
    }
    return this.adapter;
  }

  private resolvePropertySelector(selector: ColumnKey<T> | ((entity: T) => unknown)): string {
    if (typeof selector === 'function') {
      const accessed: string[] = [];
      const proxy = new Proxy({} as any, {
        get: (_, prop) => {
          accessed.push(String(prop));
          return String(prop);
        },
      });
      try {
        const res = (selector as any)(proxy);
        if (typeof res === 'string' && accessed.length === 0) {
          accessed.push(res);
        }
      } catch {
        // ignore
      }
      const prop = accessed[0] || '';
      return prop ? this.mapPropertyToColumn(prop) : '';
    }
    return this.mapPropertyToColumn(String(selector));
  }

  private resolveAggregateSelector(selector: ColumnKey<T> | ((entity: T) => unknown)): string {
    const prop = this.resolvePropertySelector(selector);
    return prop || '*';
  }

  // --- Change Tracking ---

  /**
   * Fetches an entity by primary key and registers it in the `ChangeTracker` for automatic dirty checking.
   *
   * @usecase Use this in enterprise architectures where modifications are applied directly to entity object properties and flushed via `context.saveChanges()`.
   * @param id - The primary key of the entity to load and track.
   * @returns A Promise resolving to the tracked proxy/entity instance.
   * @example
   * ```ts
   * const user = await context.users.track(1);
   * user.name = 'Updated Name';
   * await context.saveChanges(); // automatically issues UPDATE users SET name = 'Updated Name' WHERE id = 1
   * ```
   */
  public async track(id: unknown): Promise<T> {
    const entity = await this.findOrThrow(id);
    if (this.context?.changeTracker) {
      return this.context.changeTracker.track(entity, this.metadata);
    }
    return entity;
  }

  // --- Terminal: Mutations ---

  /**
   * Inserts a new entity row into the database table.
   *
   * Automatically handles primary key generation (`RETURNING id` in PostgreSQL / SQLite, `OUTPUT INSERTED.id` in MSSQL, `insertId` in MySQL),
   * audit timestamps (`@CreatedAt`, `@UpdatedAt`), audit user (`@CreatedBy`), tenant scoping (`@TenantId`), and optimistic concurrency versioning.
   *
   * @usecase Persist a new entity record into the database across any supported engine with automatic identity resolution.
   * @param entity - The entity attributes to insert.
   * @returns A Promise resolving to the inserted entity with its generated primary key populated.
   *
   * @example
   * **PostgreSQL / MySQL / SQLite / MSSQL / Neon / Turso:**
   * ```ts
   * const newUser = await context.users.add({
   *   name: 'John Doe',
   *   email: 'john@example.com',
   *   role: 'user',
   * });
   * console.log('Generated User ID:', newUser.id);
   * ```
   */
  public async add(entity: Partial<T>): Promise<T> {
    this.ensureNotView('add');
    const proto =
      typeof this.entityTarget === 'function'
        ? (this.entityTarget as any).prototype
        : Object.getPrototypeOf(entity);
    const toInsert = Object.create(proto || Object.prototype);
    Object.assign(toInsert, entity);

    if (this.metadata) {
      const now = new Date();
      if (
        this.metadata.createdAtProperty &&
        toInsert[this.metadata.createdAtProperty] === undefined
      ) {
        toInsert[this.metadata.createdAtProperty] = now;
      }
      if (
        this.metadata.updatedAtProperty &&
        toInsert[this.metadata.updatedAtProperty] === undefined
      ) {
        toInsert[this.metadata.updatedAtProperty] = now;
      }
      if (
        this.metadata.createdByProperty &&
        toInsert[this.metadata.createdByProperty] === undefined
      ) {
        if (this.context?.currentUser) {
          toInsert[this.metadata.createdByProperty] = this.context.currentUser;
        }
      }
      if (
        !this.options.ignoreTenant &&
        this.metadata.tenantIdProperty &&
        toInsert[this.metadata.tenantIdProperty] === undefined &&
        this.context?.tenantId !== undefined
      ) {
        toInsert[this.metadata.tenantIdProperty] = this.context.tenantId;
      }
      if (
        this.metadata.versionProperty &&
        toInsert[this.metadata.versionProperty.propertyName] === undefined
      ) {
        const vp = this.metadata.versionProperty;
        if (vp.strategy === 'number') {
          toInsert[vp.propertyName] = 1;
        } else if (vp.strategy === 'timestamp') {
          toInsert[vp.propertyName] = now;
        } else if (vp.strategy === 'uuid') {
          toInsert[vp.propertyName] = this.generateUuid();
        }
      }
      for (const [propName, colMeta] of this.metadata.columns.entries()) {
        if (toInsert[propName] === undefined && colMeta.defaultValue !== undefined) {
          toInsert[propName] =
            typeof colMeta.defaultValue === 'function'
              ? (colMeta.defaultValue as Function)()
              : colMeta.defaultValue;
        }
      }
    }

    // Extract nested relation objects/arrays for cascading insert
    const nestedRelations: Array<{ rel: RelationMetadata; payload: any }> = [];
    if (this.metadata?.relations && this.metadata.relations.size > 0) {
      for (const [relName, rel] of this.metadata.relations.entries()) {
        if (rel.type === 'hasMany' || rel.type === 'hasOne') {
          if ((toInsert as any)[relName] !== undefined) {
            nestedRelations.push({
              rel,
              payload: (toInsert as any)[relName],
            });
            delete (toInsert as any)[relName];
          }
        }
      }
    }

    await this.executeHooks(toInsert, 'beforeInsert');

    if (typeof this.entityTarget === 'function') {
      ValidationEngine.validateOrThrow(toInsert, this.entityTarget as Function, this.tableName);
    }

    const insertData = this.mapEntityToRow(toInsert);
    const { sql, params } = new QueryBuilder(this.adapter, this.tableName).toInsertSql(insertData);
    let res;
    try {
      res = await this.adapter.executeNonQuery(sql, params, this.transaction);
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this.adapter.provider);
    }

    const pk = this.getPrimaryKeyProperty();
    const resultEntity = Object.create(proto || Object.prototype);
    Object.assign(resultEntity, toInsert);
    if (res.insertId !== undefined && !(toInsert as any)[pk]) {
      (resultEntity as any)[pk] = res.insertId;
    }

    // Cascade insert related children if present
    if (nestedRelations.length > 0) {
      const parentId = (resultEntity as any)[pk];
      for (const { rel, payload } of nestedRelations) {
        const targetEntity = rel.target();
        const childSet = this.context
          ? this.context.set(targetEntity as any)
          : new DbSet(this.adapter, targetEntity as any, undefined, this.transaction, this.context);
        const scopedChildSet = this.transaction
          ? childSet.inTransaction(this.transaction)
          : childSet;

        if (rel.type === 'hasMany' && Array.isArray(payload)) {
          const insertedChildren: any[] = [];
          for (const item of payload) {
            const childItem = { ...item, [rel.foreignKey]: parentId };
            const saved = await scopedChildSet.add(childItem);
            insertedChildren.push(saved);
          }
          (resultEntity as any)[rel.propertyName] = insertedChildren;
        } else if (rel.type === 'hasOne' && payload && typeof payload === 'object') {
          const childItem = { ...payload, [rel.foreignKey]: parentId };
          const saved = await scopedChildSet.add(childItem);
          (resultEntity as any)[rel.propertyName] = saved;
        }
      }
    }

    await this.executeHooks(resultEntity, 'afterInsert');

    // Audit changelog
    if (typeof this.entityTarget === 'function' && AuditEngine.shouldLog(this.entityTarget)) {
      const auditOpts = AuditEngine.getOptions(this.entityTarget)!;
      const pk = this.getPrimaryKeyProperty();
      const entry = AuditEngine.buildEntry(
        'INSERT',
        this.tableName,
        (resultEntity as any)[pk],
        AuditEngine.snapshot(resultEntity),
        undefined,
        this.context?.currentUser,
      );
      await AuditEngine.write(entry, this.adapter, auditOpts.tableName, this.transaction);
    }

    await this.emitLifecycleEvent('created', resultEntity);

    return resultEntity;
  }

  /**
   * Inserts multiple entities sequentially into the database within the current transaction.
   *
   * @usecase Add a collection of domain entities while triggering individual entity lifecycle hooks, validation, and audit entries.
   * @param entities - Array of entity objects to insert.
   * @returns A Promise resolving to an array of saved entities with generated primary keys.
   *
   * @example
   * ```ts
   * const users = await context.users.addRange([
   *   { name: 'Alice', email: 'alice@example.com' },
   *   { name: 'Bob', email: 'bob@example.com' },
   * ]);
   * ```
   */
  public async addRange(entities: Partial<T>[]): Promise<T[]> {
    const results: T[] = [];
    for (const e of entities) {
      results.push(await this.add(e));
    }
    return results;
  }

  /**
   * Updates an existing entity by primary key with partial field updates and optimistic concurrency checking.
   *
   * Automatically refreshes `updatedAt` and advances `@Version` properties.
   *
   * @usecase Update entity attributes (e.g. status changes, price updates) with concurrency conflict prevention.
   * @param id - The primary key of the entity to update.
   * @param patch - Partial object containing fields to update.
   * @param expectedVersion - Optional expected version for optimistic concurrency conflict detection.
   * @param concurrencyOriginals - Optional map of original values for columns decorated with `@ConcurrencyCheck`.
   * @throws `DbUpdateConcurrencyException` if expected version does not match current database row.
   * @returns A Promise resolving to the refreshed updated entity from the database.
   *
   * @example
   * **PostgreSQL / MySQL / SQLite / MSSQL:**
   * ```ts
   * const updatedUser = await context.users.update(userId, {
   *   name: 'Jane Doe',
   *   role: 'admin',
   * });
   * ```
   */
  public async update(
    id: unknown,
    patch: Partial<T>,
    expectedVersion?: unknown,
    concurrencyOriginals?: Record<string, unknown>,
  ): Promise<T> {
    this.ensureNotView('update');
    const toUpdate = { ...patch } as any;
    if (typeof this.entityTarget === 'function') {
      ValidationEngine.validateOrThrow(toUpdate, this.entityTarget as Function, this.tableName, {
        partial: true,
      });
    }
    await this.executeHooks(toUpdate, 'beforeUpdate');

    // Capture old snapshot for audit changelog before mutation
    let _auditOldSnapshot: Record<string, unknown> | undefined;
    if (typeof this.entityTarget === 'function' && AuditEngine.shouldLog(this.entityTarget)) {
      const auditOpts = AuditEngine.getOptions(this.entityTarget)!;
      if (auditOpts.includeOld !== false) {
        const oldEntity = await this.find(id);
        if (oldEntity) _auditOldSnapshot = AuditEngine.snapshot(oldEntity);
      }
    }

    if (
      this.metadata?.updatedAtProperty &&
      toUpdate[this.metadata.updatedAtProperty] === undefined
    ) {
      toUpdate[this.metadata.updatedAtProperty] = new Date();
    }

    let versionToCheck = expectedVersion;
    if (this.metadata?.versionProperty) {
      const vp = this.metadata.versionProperty;
      if (versionToCheck === undefined && (patch as any)[vp.propertyName] !== undefined) {
        versionToCheck = (patch as any)[vp.propertyName];
      }
      if (versionToCheck === undefined) {
        const existingRec = await this.find(id);
        if (existingRec) {
          versionToCheck = (existingRec as any)[vp.propertyName];
        }
      }

      let nextVersion: unknown;
      if (vp.strategy === 'number') {
        const curNum =
          typeof versionToCheck === 'number' ? versionToCheck : Number(versionToCheck) || 0;
        nextVersion = curNum + 1;
      } else if (vp.strategy === 'timestamp') {
        nextVersion = new Date();
      } else if (vp.strategy === 'uuid') {
        nextVersion = this.generateUuid();
      }
      toUpdate[vp.propertyName] = nextVersion;
    }

    const pkProp = this.getPrimaryKeyProperty();
    const pkCol = this.mapPropertyToColumn(pkProp);
    const updateData = this.mapEntityToRow(toUpdate);

    const qb = new QueryBuilder(this.adapter, this.tableName);
    qb.getWhereClause().eq(pkCol, id);

    if (
      !this.options.ignoreTenant &&
      this.metadata?.tenantIdProperty &&
      this.context?.tenantId !== undefined
    ) {
      const tCol = this.mapPropertyToColumn(this.metadata.tenantIdProperty);
      qb.getWhereClause().eq(tCol, this.context.tenantId);
    }

    if (this.metadata?.versionProperty && versionToCheck !== undefined) {
      const vCol = this.mapPropertyToColumn(this.metadata.versionProperty.propertyName);
      qb.getWhereClause().eq(vCol, versionToCheck);
    }

    if (this.metadata?.concurrencyCheckProperties && concurrencyOriginals) {
      for (const prop of this.metadata.concurrencyCheckProperties) {
        if (prop in concurrencyOriginals) {
          const col = this.mapPropertyToColumn(prop);
          qb.getWhereClause().eq(col, concurrencyOriginals[prop]);
        }
      }
    }

    const { sql, params } = qb.toUpdateSql(updateData);
    let res;
    try {
      res = await this.adapter.executeNonQuery(sql, params, this.transaction);
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this.adapter.provider);
    }

    if (
      (this.metadata?.versionProperty && versionToCheck !== undefined && res.rowsAffected === 0) ||
      (this.metadata?.concurrencyCheckProperties &&
        this.metadata.concurrencyCheckProperties.size > 0 &&
        res.rowsAffected === 0)
    ) {
      throw new DbUpdateConcurrencyException(
        `Database operation expected to affect 1 row, but affected 0 rows due to a concurrency conflict in '${this.tableName}'.`,
        this.tableName,
        id,
      );
    }

    if (this.metadata?.versionProperty && typeof patch === 'object' && patch !== null) {
      (patch as any)[this.metadata.versionProperty.propertyName] =
        toUpdate[this.metadata.versionProperty.propertyName];
    }

    const updated = await this.findOrThrow(id);
    await this.executeHooks(updated, 'afterUpdate');

    // Audit changelog
    if (typeof this.entityTarget === 'function' && AuditEngine.shouldLog(this.entityTarget)) {
      const auditOpts = AuditEngine.getOptions(this.entityTarget)!;
      const entry = AuditEngine.buildEntry(
        'UPDATE',
        this.tableName,
        id,
        AuditEngine.snapshot(updated),
        _auditOldSnapshot,
        this.context?.currentUser,
      );
      await AuditEngine.write(entry, this.adapter, auditOpts.tableName, this.transaction);
    }

    await this.emitLifecycleEvent('updated', updated, _auditOldSnapshot);

    return updated;
  }

  /**
   * Performs an atomic native database upsert using conflict target and update payload,
   * or a select-and-insert/update fallback based on primary keys.
   *
   * @example
   * ```ts
   * await db.accounts.upsert(
   *   { email: 'user@corp.com' },
   *   { balance: 5000, name: 'Updated' }
   * );
   * ```
   */
  public async upsert(conflictTarget: Partial<T>, updatePayload: Partial<T>): Promise<T>;
  public async upsert(args: {
    where: Partial<T>;
    update: Partial<T>;
    create: Partial<T>;
    select?: (keyof T)[];
  }): Promise<T>;
  public async upsert(entity: Partial<T>, keys?: (keyof T)[]): Promise<T>;
  public async upsert(
    entityOrArgs:
      | Partial<T>
      | {
          where: Partial<T>;
          update: Partial<T>;
          create: Partial<T>;
          select?: (keyof T)[];
        },
    keys?: (keyof T)[] | Partial<T>,
  ): Promise<T> {
    // Case 1: Native upsert with conflictTarget and updatePayload
    if (
      keys !== undefined &&
      typeof keys === 'object' &&
      !Array.isArray(keys) &&
      entityOrArgs &&
      !('where' in entityOrArgs && 'update' in entityOrArgs && 'create' in entityOrArgs)
    ) {
      return this.nativeUpsert(entityOrArgs as Partial<T>, keys as Partial<T>);
    }

    if (
      entityOrArgs &&
      'where' in entityOrArgs &&
      'update' in entityOrArgs &&
      'create' in entityOrArgs
    ) {
      const args = entityOrArgs as {
        where: Partial<T>;
        update: Partial<T>;
        create: Partial<T>;
        select?: (keyof T)[];
      };
      const existing = await this.where(args.where as any).firstOrDefault();
      if (existing) {
        const pk = this.getPrimaryKeyProperty();
        const id = (existing as any)[pk];
        const updated = await this.update(id, args.update);
        if (args.select && args.select.length > 0) {
          const filtered: any = {};
          for (const k of args.select) filtered[k] = (updated as any)[k];
          return filtered;
        }
        return updated;
      }
      const created = await this.add({ ...args.where, ...args.create });
      if (args.select && args.select.length > 0) {
        const filtered: any = {};
        for (const k of args.select) filtered[k] = (created as any)[k];
        return filtered;
      }
      return created;
    }

    const entity = entityOrArgs as Partial<T>;
    const checkKeys = (keys as (keyof T)[] | undefined) || [
      this.getPrimaryKeyProperty() as keyof T,
    ];
    const whereObj: Partial<T> = {};
    for (const k of checkKeys) {
      whereObj[k] = entity[k];
    }

    const existing = await this.first(whereObj);
    if (existing) {
      const pk = this.getPrimaryKeyProperty();
      const id = (existing as any)[pk];
      return this.update(id, entity);
    } else {
      return this.add(entity);
    }
  }

  private async nativeUpsert(conflictTarget: Partial<T>, updatePayload: Partial<T>): Promise<T> {
    this.ensureNotView('upsert');
    const proto =
      typeof this.entityTarget === 'function'
        ? (this.entityTarget as any).prototype
        : Object.prototype;

    const merged = { ...conflictTarget, ...updatePayload };
    const toInsert = Object.create(proto || Object.prototype);
    Object.assign(toInsert, merged);

    const now = new Date();
    if (this.metadata) {
      if (
        this.metadata.createdAtProperty &&
        toInsert[this.metadata.createdAtProperty] === undefined
      ) {
        toInsert[this.metadata.createdAtProperty] = now;
      }
      if (
        this.metadata.updatedAtProperty &&
        toInsert[this.metadata.updatedAtProperty] === undefined
      ) {
        toInsert[this.metadata.updatedAtProperty] = now;
      }
      if (
        this.metadata.createdByProperty &&
        toInsert[this.metadata.createdByProperty] === undefined &&
        this.context?.currentUser
      ) {
        toInsert[this.metadata.createdByProperty] = this.context.currentUser;
      }
      if (
        !this.options.ignoreTenant &&
        this.metadata.tenantIdProperty &&
        toInsert[this.metadata.tenantIdProperty] === undefined &&
        this.context?.tenantId !== undefined
      ) {
        toInsert[this.metadata.tenantIdProperty] = this.context.tenantId;
      }
    }

    const conflictRow = this.mapEntityToRow(conflictTarget);
    const updateRow = this.mapEntityToRow(updatePayload);

    if (this.metadata?.updatedAtProperty) {
      const updatedCol = this.mapPropertyToColumn(this.metadata.updatedAtProperty);
      updateRow[updatedCol] = now;
    }

    const qb = new QueryBuilder(this.adapter, this.tableName);
    const { sql, params } = qb.toUpsertSql(conflictRow, updateRow);

    let resultEntity: T;
    try {
      const rows = await this.adapter.executeQuery<any>(sql, params, this.transaction);
      if (rows && rows.length > 0) {
        resultEntity = this.mapRowToEntity(rows[0]);
      } else {
        const found = await this.first(conflictTarget);
        resultEntity = found || toInsert;
      }
    } catch {
      await this.adapter.executeNonQuery(sql, params, this.transaction);
      const found = await this.first(conflictTarget);
      resultEntity = found || toInsert;
    }

    await this.emitLifecycleEvent('updated', resultEntity);
    return resultEntity;
  }

  /**
   * Performs a batch upsert (insert if not found, or update if existing) for multiple entities.
   *
   * @usecase Ideal for sync pipelines, bulk imports, catalog refreshes, and seeder routines.
   * @param items - Array of entity data objects to insert or update.
   * @param keys - Optional array of property keys used to check for existing records (defaults to primary key).
   * @returns A Promise resolving to an array of the saved entities.
   * @example
   * ```ts
   * const saved = await context.products.upsertRange(incomingCatalog, ['sku']);
   * ```
   */
  public async upsertRange(items: Partial<T>[], keys?: (keyof T)[]): Promise<T[]> {
    if (!items || items.length === 0) return [];
    const results: T[] = [];
    for (const item of items) {
      const saved = await this.upsert(item, keys);
      results.push(saved);
    }
    return results;
  }

  /**
   * Deletes an entity by its primary key or entity instance.
   *
   * If the entity has `@SoftDelete` configured, this sets `deletedAt` without deleting the row.
   * Otherwise, it performs a hard `DELETE`. Supports optimistic concurrency checks.
   *
   * @usecase Standard deletion method for REST controllers (`DELETE /items/:id`).
   * @param id - The primary key value or the entity instance itself.
   * @param expectedVersion - Optional version token for optimistic concurrency verification.
   * @example
   * ```ts
   * await context.users.remove(userId);
   * ```
   */
  public async remove(id: unknown, expectedVersion?: unknown): Promise<void> {
    this.ensureNotView('remove');
    const entityObj = typeof id === 'object' && id !== null ? (id as any) : undefined;
    const actualId = entityObj ? entityObj[this.getPrimaryKeyProperty()] : id;
    if (expectedVersion === undefined && entityObj && this.metadata?.versionProperty) {
      expectedVersion = entityObj[this.metadata.versionProperty.propertyName];
    }

    const existing = await this.find(actualId);
    if (existing) {
      await this.executeHooks(existing, 'beforeRemove');
    }

    // Capture snapshot for audit before mutation
    const _auditOldSnapshot: Record<string, unknown> | undefined =
      existing &&
      typeof this.entityTarget === 'function' &&
      AuditEngine.shouldLog(this.entityTarget)
        ? AuditEngine.snapshot(existing)
        : undefined;

    if (this.metadata?.softDelete) {
      const colName = this.metadata.softDelete.column;
      const propName = this.metadata.softDelete.propertyName;
      const now = new Date();

      if (propName) {
        await this.update(actualId, { [propName]: now } as any, expectedVersion);
      } else {
        const pkProp = this.getPrimaryKeyProperty();
        const pkCol = this.mapPropertyToColumn(pkProp);
        const qb = new QueryBuilder(this.adapter, this.tableName);
        qb.getWhereClause().eq(pkCol, actualId);

        if (
          !this.options.ignoreTenant &&
          this.metadata?.tenantIdProperty &&
          this.context?.tenantId !== undefined
        ) {
          const tCol = this.mapPropertyToColumn(this.metadata.tenantIdProperty);
          qb.getWhereClause().eq(tCol, this.context.tenantId);
        }

        if (this.metadata?.versionProperty && expectedVersion !== undefined) {
          const vCol = this.mapPropertyToColumn(this.metadata.versionProperty.propertyName);
          qb.getWhereClause().eq(vCol, expectedVersion);
        }
        const { sql, params } = qb.toUpdateSql({ [colName]: now });
        const res = await this.adapter.executeNonQuery(sql, params, this.transaction);
        if (
          this.metadata?.versionProperty &&
          expectedVersion !== undefined &&
          res.rowsAffected === 0
        ) {
          throw new DbUpdateConcurrencyException(
            `Database operation expected to affect 1 row, but affected 0 rows due to a concurrency conflict in '${this.tableName}'.`,
            this.tableName,
            actualId,
          );
        }
      }

      // Cascade soft-delete to hasMany / hasOne children
      if (
        this.metadata.softDelete.cascade &&
        this.metadata.relations &&
        this.metadata.relations.size > 0
      ) {
        for (const [, rel] of this.metadata.relations) {
          if (rel.type !== 'hasMany' && rel.type !== 'hasOne') continue;
          const childTarget = rel.target();
          const childMeta = ModelMetadataRegistry.getInstance().get(childTarget);
          if (!childMeta?.softDelete) {
            // Child doesn't have @SoftDelete configured: do not accidentally hard delete
            continue;
          }
          const childSet = this.context
            ? this.context.set(childTarget as any)
            : new DbSet(
                this.adapter,
                childTarget as any,
                undefined,
                this.transaction,
                this.context,
              );
          const scoped = this.transaction ? childSet.inTransaction(this.transaction) : childSet;
          await scoped.removeWhere({ [rel.foreignKey]: actualId } as any);
        }
      }
    } else {
      await this.hardRemove(actualId, expectedVersion);
    }

    if (existing) {
      await this.executeHooks(existing, 'afterRemove');
    }

    // Audit changelog
    if (typeof this.entityTarget === 'function' && AuditEngine.shouldLog(this.entityTarget)) {
      const auditOpts = AuditEngine.getOptions(this.entityTarget)!;
      const entry = AuditEngine.buildEntry(
        'DELETE',
        this.tableName,
        actualId,
        undefined,
        _auditOldSnapshot,
        this.context?.currentUser,
      );
      await AuditEngine.write(entry, this.adapter, auditOpts.tableName, this.transaction);
    }

    await this.emitLifecycleEvent(
      'deleted',
      existing || { [this.getPrimaryKeyProperty()]: actualId },
    );
  }

  /**
   * Permanently deletes a row from the database table regardless of `@SoftDelete` configuration.
   *
   * @usecase Use this for GDPR "Right to be Forgotten" requests, test database teardown, or permanent data purging.
   * @param id - The primary key value or entity object.
   * @param expectedVersion - Optional version token for concurrency verification.
   * @example
   * ```ts
   * await context.users.hardRemove(userId);
   * ```
   */
  public async hardRemove(id: unknown, expectedVersion?: unknown): Promise<void> {
    const entityObj = typeof id === 'object' && id !== null ? (id as any) : undefined;
    const actualId = entityObj ? entityObj[this.getPrimaryKeyProperty()] : id;
    if (expectedVersion === undefined && entityObj && this.metadata?.versionProperty) {
      expectedVersion = entityObj[this.metadata.versionProperty.propertyName];
    }

    const pkProp = this.getPrimaryKeyProperty();
    const pkCol = this.mapPropertyToColumn(pkProp);

    const qb = new QueryBuilder(this.adapter, this.tableName);
    qb.getWhereClause().eq(pkCol, actualId);

    if (
      !this.options.ignoreTenant &&
      this.metadata?.tenantIdProperty &&
      this.context?.tenantId !== undefined
    ) {
      const tCol = this.mapPropertyToColumn(this.metadata.tenantIdProperty);
      qb.getWhereClause().eq(tCol, this.context.tenantId);
    }

    if (this.metadata?.versionProperty && expectedVersion !== undefined) {
      const vCol = this.mapPropertyToColumn(this.metadata.versionProperty.propertyName);
      qb.getWhereClause().eq(vCol, expectedVersion);
    }
    const { sql, params } = qb.toDeleteSql();
    let res;
    try {
      res = await this.adapter.executeNonQuery(sql, params, this.transaction);
    } catch (err) {
      throw DatabaseErrorTranslator.translate(err, sql, this.adapter.provider);
    }
    if (this.metadata?.versionProperty && expectedVersion !== undefined && res.rowsAffected === 0) {
      throw new DbUpdateConcurrencyException(
        `Database operation expected to affect 1 row, but affected 0 rows due to a concurrency conflict in '${this.tableName}'.`,
        this.tableName,
        actualId,
      );
    }
  }

  /**
   * Deletes (or soft-deletes if configured) all records matching the specified predicate.
   *
   * @usecase Use this to remove multiple records satisfying a filter (e.g. deleting expired sessions or unverified temp accounts).
   * @param predicate - Filter criteria matching the records to remove.
   * @returns A Promise resolving to the number of rows affected.
   * @example
   * ```ts
   * const deletedCount = await context.sessions.removeWhere({ isExpired: true });
   * ```
   */
  public async removeWhere(predicate: Partial<T>): Promise<number> {
    if (this.metadata?.softDelete) {
      const colName = this.metadata.softDelete.column;
      const now = new Date();
      let rowsAffected = 0;

      if (
        this.adapter.provider === 'mock' &&
        typeof (this.adapter as any).getTableData === 'function'
      ) {
        const rows = (this.adapter as any).getTableData(this.tableName) || [];
        for (const row of rows) {
          let matches = true;
          for (const [key, val] of Object.entries(predicate)) {
            const col = this.mapPropertyToColumn(key);
            const rKey = Object.keys(row).find(k => k.toLowerCase() === col.toLowerCase());
            if (!rKey || String(row[rKey]) !== String(val)) {
              matches = false;
              break;
            }
          }
          if (matches) {
            row[colName] = now;
            rowsAffected++;
          }
        }
      } else {
        const qb = new QueryBuilder(this.adapter, this.tableName);
        for (const [key, val] of Object.entries(predicate)) {
          qb.getWhereClause().eq(this.mapPropertyToColumn(key), val);
        }
        const { sql, params } = qb.toUpdateSql({ [colName]: now });
        const res = await this.adapter.executeNonQuery(sql, params, this.transaction);
        rowsAffected = res.rowsAffected;
      }

      // Cascade soft-delete down to grandchildren if this child has cascade: true
      if (
        this.metadata.softDelete.cascade &&
        this.metadata.relations &&
        this.metadata.relations.size > 0
      ) {
        const matchingRecords = await this.where(predicate as any)
          .withDeleted()
          .toList();
        const pkProp = this.getPrimaryKeyProperty();
        for (const childRec of matchingRecords) {
          const childId = (childRec as any)[pkProp];
          for (const [, rel] of this.metadata.relations) {
            if (rel.type !== 'hasMany' && rel.type !== 'hasOne') continue;
            const grandChildTarget = rel.target();
            const grandChildMeta = ModelMetadataRegistry.getInstance().get(grandChildTarget);
            if (!grandChildMeta?.softDelete) continue;
            const grandChildSet = this.context
              ? this.context.set(grandChildTarget as any)
              : new DbSet(
                  this.adapter,
                  grandChildTarget as any,
                  undefined,
                  this.transaction,
                  this.context,
                );
            const scoped = this.transaction
              ? grandChildSet.inTransaction(this.transaction)
              : grandChildSet;
            await scoped.removeWhere({ [rel.foreignKey]: childId } as any);
          }
        }
      }

      return rowsAffected;
    } else {
      return this.hardRemoveWhere(predicate);
    }
  }

  /**
   * Permanently deletes all records matching the specified predicate regardless of soft-delete settings.
   *
   * @usecase Use this to permanently purge old records (e.g. purging logs older than 90 days).
   * @param predicate - Filter criteria matching the records to permanently delete.
   * @returns A Promise resolving to the number of rows physically removed.
   * @example
   * ```ts
   * const purgedCount = await context.auditLogs.hardRemoveWhere({ status: 'archived' });
   * ```
   */
  public async hardRemoveWhere(predicate: Partial<T>): Promise<number> {
    const qb = new QueryBuilder(this.adapter, this.tableName);
    for (const [key, val] of Object.entries(predicate)) {
      qb.getWhereClause().eq(this.mapPropertyToColumn(key), val);
    }
    const { sql, params } = qb.toDeleteSql();
    const res = await this.adapter.executeNonQuery(sql, params, this.transaction);
    return res.rowsAffected;
  }

  /**
   * Restores a single soft-deleted entity by setting its `deletedAt` column back to `null`.
   *
   * If `@SoftDelete({ cascade: true })` is configured, all `hasMany` / `hasOne` children
   * that share the same `foreignKey` value will also be restored.
   *
   * @usecase Use this to implement a "Restore from Trash" action for soft-deleted records.
   * @param id - The primary key of the entity to restore.
   * @throws `Error` if the entity does not have `@SoftDelete` configured.
   * @example
   * ```ts
   * await context.users.restore(userId);
   * ```
   */
  public async restore(id: unknown): Promise<void> {
    if (!this.metadata?.softDelete) {
      throw new Error(
        `Cannot restore '${this.tableName}': entity does not have @SoftDelete configured.`,
      );
    }

    const sdMeta = this.metadata.softDelete;
    const pkProp = this.getPrimaryKeyProperty();
    const pkCol = this.mapPropertyToColumn(pkProp);

    // Build UPDATE SET deleted_at = NULL WHERE pk = id
    const qb = new QueryBuilder(this.adapter, this.tableName);
    qb.getWhereClause().eq(pkCol, id);
    const { sql, params } = qb.toUpdateSql({ [sdMeta.column]: null });
    await this.adapter.executeNonQuery(sql, params, this.transaction);

    // Cascade restore to hasMany / hasOne children
    if (sdMeta.cascade && this.metadata.relations && this.metadata.relations.size > 0) {
      for (const [, rel] of this.metadata.relations) {
        if (rel.type !== 'hasMany' && rel.type !== 'hasOne') continue;
        const childTarget = rel.target();
        const childSet = this.context
          ? this.context.set(childTarget as any)
          : new DbSet(this.adapter, childTarget as any, undefined, this.transaction, this.context);
        const scoped = this.transaction ? childSet.inTransaction(this.transaction) : childSet;
        await scoped.restoreWhere({ [rel.foreignKey]: id } as any);
      }
    }
  }

  /**
   * Restores all soft-deleted entities matching the given predicate by setting `deletedAt` to `null`.
   *
   * @usecase Use this for bulk restoration of archived records (e.g., restoring all posts for a reactivated user).
   * @param predicate - Filter criteria matching the records to restore.
   * @returns A Promise resolving to the number of rows restored.
   * @throws `Error` if the entity does not have `@SoftDelete` configured.
   * @example
   * ```ts
   * // Restore all posts belonging to a user
   * const count = await context.posts.restoreWhere({ userId: 42 });
   * ```
   */
  public async restoreWhere(predicate: Partial<T>): Promise<number> {
    if (!this.metadata?.softDelete) {
      throw new Error(
        `Cannot restoreWhere '${this.tableName}': entity does not have @SoftDelete configured.`,
      );
    }

    const sdMeta = this.metadata.softDelete;
    let rowsAffected = 0;

    if (
      this.adapter.provider === 'mock' &&
      typeof (this.adapter as any).getTableData === 'function'
    ) {
      const rows = (this.adapter as any).getTableData(this.tableName) || [];
      for (const row of rows) {
        let matches = true;
        for (const [key, val] of Object.entries(predicate)) {
          const col = this.mapPropertyToColumn(key);
          const rKey = Object.keys(row).find(k => k.toLowerCase() === col.toLowerCase());
          if (!rKey || String(row[rKey]) !== String(val)) {
            matches = false;
            break;
          }
        }
        if (matches) {
          row[sdMeta.column] = null;
          rowsAffected++;
        }
      }
    } else {
      const qb = new QueryBuilder(this.adapter, this.tableName);
      for (const [key, val] of Object.entries(predicate)) {
        qb.getWhereClause().eq(this.mapPropertyToColumn(key), val);
      }
      const { sql, params } = qb.toUpdateSql({ [sdMeta.column]: null });
      const res = await this.adapter.executeNonQuery(sql, params, this.transaction);
      rowsAffected = res.rowsAffected;
    }

    // Cascade restore to hasMany / hasOne children if cascade is true
    if (sdMeta.cascade && this.metadata.relations && this.metadata.relations.size > 0) {
      const restoredRecords = await this.where(predicate as any).toList();
      const pkProp = this.getPrimaryKeyProperty();
      for (const rec of restoredRecords) {
        const id = (rec as any)[pkProp];
        for (const [, rel] of this.metadata.relations) {
          if (rel.type !== 'hasMany' && rel.type !== 'hasOne') continue;
          const childTarget = rel.target();
          const childMeta = ModelMetadataRegistry.getInstance().get(childTarget);
          if (!childMeta?.softDelete) continue;
          const childSet = this.context
            ? this.context.set(childTarget as any)
            : new DbSet(
                this.adapter,
                childTarget as any,
                undefined,
                this.transaction,
                this.context,
              );
          const scoped = this.transaction ? childSet.inTransaction(this.transaction) : childSet;
          await scoped.restoreWhere({ [rel.foreignKey]: id } as any);
        }
      }
    }

    return rowsAffected;
  }

  // --- Bulk Operations ---

  /**
   * Performs high-performance batch insertion of multiple records in a single chunked SQL statement.
   *
   * Automatically handles dialect parameter limits (e.g. SQLite 999/32766 params, PostgreSQL 65535 params, MSSQL 2100 params)
   * by splitting large batches into optimal sub-chunks.
   *
   * @usecase Ideal for data imports, CSV uploads, ETL pipelines, and seeding thousands of records with optimal database throughput.
   * @param entities - Array of entities to insert in bulk.
   * @param options - Batching options (batch size, concurrency, transaction).
   * @returns A Promise resolving to the total number of rows inserted.
   *
   * @example
   * **PostgreSQL / MySQL / SQLite / MSSQL:**
   * ```ts
   * const insertedCount = await context.products.bulkInsert(newProductList, {
   *   batchSize: 500,
   *   ignoreDuplicates: false,
   * });
   * console.log(`Inserted ${insertedCount} products`);
   * ```
   */
  public async bulkInsert(entities: Partial<T>[], options?: BulkInsertOptions): Promise<number> {
    const builder = new BulkInsertBuilder<T>(
      this.adapter,
      this.tableName,
      this.metadata,
      this.transaction,
      this.context,
    );
    return builder.execute(entities, options);
  }

  /**
   * Performs high-performance batch updates across multiple records matching by primary key or specified keys.
   *
   * Generates optimized multi-row UPDATE statements (using `CASE ... WHEN` or temporary staging tables based on provider).
   *
   * @usecase Ideal for bulk price adjustments, mass status changes, and inventory level updates across thousands of records.
   * @param entities - Array of entities containing update values and identifying keys.
   * @param options - Bulk update options (update columns, key columns, batch size).
   * @returns A Promise resolving to the total number of rows updated.
   *
   * @example
   * **PostgreSQL / MySQL / SQLite / MSSQL:**
   * ```ts
   * await context.products.bulkUpdate(updatedProducts, {
   *   keyColumns: ['id'],
   *   updateColumns: ['price', 'stockQuantity'],
   *   batchSize: 250,
   * });
   * ```
   */
  public async bulkUpdate(entities: Partial<T>[], options: BulkUpdateOptions<T>): Promise<number> {
    const builder = new BulkUpdateBuilder<T>(
      this.adapter,
      this.tableName,
      this.metadata,
      this.transaction,
    );
    return builder.execute(entities, options);
  }

  /**
   * Performs high-performance bulk upsert across multiple records in a single statement.
   *
   * Automatically adapts to the underlying database dialect:
   * - **PostgreSQL**: `INSERT ... ON CONFLICT (key) DO UPDATE SET ...`
   * - **MySQL**: `INSERT ... ON DUPLICATE KEY UPDATE ...`
   * - **SQLite**: `INSERT ... ON CONFLICT (key) DO UPDATE SET ...`
   * - **Microsoft SQL Server**: `MERGE INTO ... USING (VALUES ...) ON ... WHEN MATCHED THEN UPDATE ... WHEN NOT MATCHED THEN INSERT ...`
   *
   * @usecase Ideal for data synchronization with external APIs or CRMs where incoming records must be inserted if new or updated if existing.
   * @param entities - Array of entities to upsert.
   * @param options - Match keys, update columns, and batching configuration.
   * @returns A Promise resolving to the number of rows affected.
   *
   * @example
   * **PostgreSQL / MySQL / SQLite / MSSQL:**
   * ```ts
   * await context.products.bulkUpsert(syncedItems, {
   *   keyColumns: ['sku'],
   *   updateColumns: ['price', 'stock', 'title'],
   *   batchSize: 500,
   * });
   * ```
   */
  public async bulkUpsert(entities: Partial<T>[], options: BulkUpsertOptions<T>): Promise<number> {
    const builder = new BulkUpsertBuilder<T>(
      this.adapter,
      this.tableName,
      this.metadata,
      this.transaction,
      this.context,
    );
    return builder.execute(entities, options);
  }

  /**
   * Performs high-performance bulk deletion of records matching criteria.
   *
   * @usecase Ideal for purging historical records in bulk batches with transaction safety.
   * @param predicate - Criteria matching rows to delete.
   * @param options - Batching and transaction options.
   * @returns A Promise resolving to the number of rows deleted.
   *
   * @example
   * **PostgreSQL / MySQL / SQLite / MSSQL:**
   * ```ts
   * await context.notifications.bulkDelete({ isRead: true });
   * ```
   */
  public async bulkDelete(predicate: Partial<T>, options?: BulkDeleteOptions): Promise<number> {
    const builder = new BulkDeleteBuilder<T>(
      this.adapter,
      this.tableName,
      this.metadata,
      this.transaction,
    );
    return builder.execute(predicate, options);
  }

  // --- Raw escape hatch ---

  /**
   * Executes a raw SQL query with parameterized values and maps the resulting rows into typed entity instances.
   *
   * @usecase Use this for complex CTEs, window functions, union queries, or database-specific optimizations while still receiving typed entities.
   * @param sql - Raw SQL string with parameter placeholders (e.g. `@p0`, `?`).
   * @param params - Parameter array to bind safely into the query.
   * @returns A Promise resolving to an array of mapped typed entities.
   * @example
   * ```ts
   * const topUsers = await context.users.fromSql(
   *   'SELECT u.* FROM users u INNER JOIN orders o ON o.user_id = u.id GROUP BY u.id HAVING COUNT(o.id) > @p0',
   *   [5]
   * );
   * ```
   */
  public async fromSql(sql: string, params?: unknown[]): Promise<T[]> {
    const adapterParams = params
      ? params.map((val, idx) => ({ name: `p${idx}`, value: val }))
      : undefined;
    const rows = await this.adapter.executeQuery<Record<string, unknown>>(
      sql,
      adapterParams,
      this.transaction,
    );
    return rows.map(r => this.mapRowToEntity(r));
  }

  // --- Internal Helpers ---
  private createClone<R extends object = T>(
    qb?: QueryBuilder<R>,
    overrideOptions?: Partial<DbSetOptions>,
    transaction?: DbTransaction,
  ): DbSet<R> {
    return new DbSet<R>(
      this.adapter,
      this.entityTarget as any,
      qb || (this.cloneQueryBuilder() as any),
      transaction !== undefined ? transaction : this.transaction,
      this.context,
      {
        ...this.options,
        ...overrideOptions,
      },
    );
  }

  private prepareFinalQueryBuilder(): QueryBuilder<T> {
    const qb = this.cloneQueryBuilder();

    // 1. Soft delete filter
    if (this.metadata?.softDelete && !this.options.withDeleted) {
      const col = this.metadata.softDelete.column;
      if (this.options.onlyDeleted) {
        qb.getWhereClause().isNotNull(col);
      } else {
        qb.getWhereClause().isNull(col);
      }
    }

    // 1.5. Multi-tenancy isolation filter
    if (
      !this.options.ignoreTenant &&
      this.metadata?.tenantIdProperty &&
      this.context?.tenantId !== undefined
    ) {
      const col = this.mapPropertyToColumn(this.metadata.tenantIdProperty);
      qb.getWhereClause().eq(col, this.context.tenantId);
    }

    // 2. Global query filters
    if (!this.options.ignoreQueryFilters) {
      if (this.metadata?.queryFilters) {
        for (const filter of this.metadata.queryFilters) {
          filter(qb.getWhereClause());
        }
      }
      if (typeof this.entityTarget === 'function') {
        const globalFilters = GlobalQueryFilterRegistry.getInstance().getFilters(this.entityTarget);
        for (const filter of globalFilters) {
          filter(qb.getWhereClause());
        }
      }
    }

    // 3. Map property names to column names in where clause if metadata exists
    if (this.metadata) {
      const mapConds = (conds: any[]) => {
        for (const c of conds) {
          if (c.column) {
            c.column = this.mapPropertyToColumn(c.column);
          }
          if (c.nested?.conditions) {
            mapConds(c.nested.conditions);
          }
        }
      };
      mapConds(qb.getWhereClause().conditions);
    }

    return qb;
  }

  private async loadIncludes(entities: T[], includePaths: string[]): Promise<void> {
    if (!this.metadata) return;

    for (const path of includePaths) {
      const parts = path.split('.');
      const relName = parts[0];
      const remainingPath = parts.slice(1).join('.');

      const rel: RelationMetadata | undefined = this.metadata.relations.get(relName);
      if (!rel) continue;

      const targetEntity = rel.target();
      const targetMeta = ModelMetadataRegistry.getInstance().get(targetEntity);
      const targetTable = targetMeta?.tableName || targetEntity.name;
      const targetPk = targetMeta?.primaryKeys[0] || 'id';
      const myPk = this.getPrimaryKeyProperty();

      const childSet = this.context
        ? this.context.set(targetEntity as any)
        : new DbSet(this.adapter, targetEntity as any);

      if (rel.type === 'hasMany') {
        const parentIds = entities
          .map(e => (e as any)[myPk])
          .filter(id => id !== undefined && id !== null);

        const normalizeKey = (val: unknown): string => {
          if (val === null || val === undefined) return '';
          const num = Number(val);
          if (!isNaN(num) && typeof val !== 'boolean') {
            return String(num);
          }
          return String(val);
        };

        if (parentIds.length === 0) continue;

        const children = await childSet
          .where((clause: any) => clause.in(rel.foreignKey, parentIds))
          .toList();

        if (remainingPath && children.length > 0) {
          await (childSet as any).loadIncludes(children, [remainingPath]);
        }

        const map = new Map<string, any[]>();
        for (const c of children) {
          const fkVal =
            (c as any)[rel.foreignKey] ??
            (c as any)[(childSet as any).mapPropertyToColumn(rel.foreignKey)];
          const key = normalizeKey(fkVal);
          const list = map.get(key) || [];
          list.push(c);
          map.set(key, list);
        }

        for (const parent of entities) {
          const pId = (parent as any)[myPk];
          const key = normalizeKey(pId);
          (parent as any)[relName] = map.get(key) || [];
        }
      } else if (rel.type === 'hasOne') {
        const normalizeKey = (val: unknown): string => {
          if (val === null || val === undefined) return '';
          const num = Number(val);
          if (!isNaN(num) && typeof val !== 'boolean') {
            return String(num);
          }
          return String(val);
        };

        const parentIds = entities
          .map(e => (e as any)[myPk])
          .filter(id => id !== undefined && id !== null);

        if (parentIds.length === 0) continue;

        const children = await childSet
          .where((clause: any) => clause.in(rel.foreignKey, parentIds))
          .toList();

        if (remainingPath && children.length > 0) {
          await (childSet as any).loadIncludes(children, [remainingPath]);
        }

        const map = new Map<string, any>();
        for (const c of children) {
          const fkVal =
            (c as any)[rel.foreignKey] ??
            (c as any)[(childSet as any).mapPropertyToColumn(rel.foreignKey)];
          const key = normalizeKey(fkVal);
          map.set(key, c);
        }

        for (const parent of entities) {
          const pId = (parent as any)[myPk];
          const key = normalizeKey(pId);
          (parent as any)[relName] = map.get(key) || null;
        }
      } else if (rel.type === 'belongsTo') {
        const normalizeKey = (val: unknown): string => {
          if (val === null || val === undefined) return '';
          const num = Number(val);
          if (!isNaN(num) && typeof val !== 'boolean') {
            return String(num);
          }
          return String(val);
        };

        const fkValues = entities
          .map(
            e => (e as any)[rel.foreignKey] ?? (e as any)[this.mapPropertyToColumn(rel.foreignKey)],
          )
          .filter(id => id !== undefined && id !== null);

        if (fkValues.length === 0) continue;

        const children = await childSet
          .where((clause: any) => clause.in(targetPk, fkValues))
          .toList();

        if (remainingPath && children.length > 0) {
          await (childSet as any).loadIncludes(children, [remainingPath]);
        }

        const map = new Map<string, any>();
        for (const c of children) {
          const pkVal = (c as any)[targetPk];
          const key = normalizeKey(pkVal);
          map.set(key, c);
        }

        for (const parent of entities) {
          const fkVal =
            (parent as any)[rel.foreignKey] ??
            (parent as any)[this.mapPropertyToColumn(rel.foreignKey)];
          const key = normalizeKey(fkVal);
          (parent as any)[relName] = map.get(key) || null;
        }
      }
    }
  }

  private cloneQueryBuilder<R = T>(): QueryBuilder<R> {
    return this.queryBuilder.clone<R>();
  }

  private mapPropertyToColumn(propName: string): string {
    if (this.metadata) {
      const col = this.metadata.columns.get(propName);
      if (col && col.columnName) {
        return col.columnName;
      }
    }
    return propName;
  }

  private getPrimaryKeyProperty(): string {
    if (this.metadata && this.metadata.primaryKeys.length > 0) {
      return this.metadata.primaryKeys[0];
    }
    return 'id';
  }

  private ensureNotView(operation: string): void {
    if (this.metadata?.isView) {
      throw new Error(
        `Cannot execute '${operation}' on '${this.tableName}': View entities decorated with @ViewEntity are read-only.`,
      );
    }
  }

  private mapRowToEntity(row: Record<string, unknown>): T {
    if (typeof this.entityTarget === 'function') {
      const instance = new (this.entityTarget as any)();
      if (this.metadata) {
        for (const [propName, col] of this.metadata.columns) {
          const colKey = Object.keys(row).find(
            k => k.toLowerCase() === col.columnName.toLowerCase(),
          );
          if (colKey !== undefined) {
            let val = row[colKey];
            if (col.isEncrypted && typeof val === 'string') {
              val = EncryptionEngine.decrypt(val, col.encryptionOptions);
            }
            instance[propName] = val;
          }
        }
        for (const [key, val] of Object.entries(row)) {
          if (!(key in instance)) {
            instance[key] = val;
          }
        }
        if (this.metadata.relations) {
          for (const [relName, relMeta] of this.metadata.relations) {
            const shouldBeLazy = relMeta.lazy || this.options.lazy;
            if (shouldBeLazy && (!(relName in instance) || instance[relName] === undefined)) {
              instance[relName] = new LazyRelation(instance, relMeta, this);
            }
          }
        }
        return instance;
      }
      return Object.assign(instance, row);
    }
    return row as T;
  }

  private mapEntityToRow(entity: Partial<T>): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(entity)) {
      if (val === undefined || this.metadata?.ignoredProperties.has(key)) {
        continue;
      }
      const colMeta = this.metadata?.columns.get(key);
      if (colMeta?.isComputed) {
        continue;
      }
      const colName = this.mapPropertyToColumn(key);
      let finalVal = val;
      if (colMeta?.isEncrypted && finalVal !== null && finalVal !== undefined) {
        finalVal = EncryptionEngine.encrypt(finalVal as any, colMeta.encryptionOptions);
      }
      row[colName] = finalVal;
    }
    return row;
  }

  private generateUuid(): string {
    try {
      const { randomUUID } = require('crypto');
      return randomUUID();
    } catch {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }
  }

  private async executeHooks(entity: any, eventName: keyof EntityLifecycleHooks): Promise<void> {
    if (!this.metadata?.lifecycleHooks || !entity) return;
    const methods = this.metadata.lifecycleHooks[eventName];
    if (!methods || methods.length === 0) return;

    const proto =
      typeof this.entityTarget === 'function'
        ? (this.entityTarget as any).prototype
        : Object.getPrototypeOf(entity);

    for (const method of methods) {
      if (typeof entity[method] === 'function') {
        await Promise.resolve(entity[method]());
      } else if (proto && typeof proto[method] === 'function') {
        await Promise.resolve(proto[method].call(entity));
      }
    }
  }
}
