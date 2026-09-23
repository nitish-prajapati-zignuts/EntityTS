import { IDbAdapter } from '../adapters/IDbAdapter';
import { AdapterParam } from '../adapters/AdapterParam';
import { WhereClause, WhereCondition } from './WhereClause';
import { OrderByClause, JoinClause } from './OrderByClause';
import {
  Subquery,
  CommonTableExpression,
  NearestOptions,
  createJoinProxy,
  JoinComparison,
} from './Subquery';

/**
 * Low-level SQL AST and query compiler supporting multiple database dialects.
 *
 * `QueryBuilder` compiles SELECT, INSERT, UPDATE, DELETE, COUNT, and AGGREGATE queries
 * into parameterized SQL strings formatted for SQLite, PostgreSQL, MySQL, SQL Server, etc.
 */
export class QueryBuilder<T = any> {
  private _tableName: string;
  private _tableAlias?: string;
  private _selectColumns: string[] = [];
  private _whereClause: WhereClause<T> = new WhereClause<T>();
  private _orderByClauses: OrderByClause[] = [];
  private _joinClauses: JoinClause[] = [];
  private _groupByColumns: string[] = [];
  private _havingConditions: {
    expression: string;
    operator: string;
    value?: unknown;
    value2?: unknown;
  }[] = [];
  private _limit?: number;
  private _offset?: number;
  private _isDistinct = false;
  private _usePrimary = false;
  private _lockMode?: 'FOR_UPDATE' | 'FOR_SHARE' | 'FOR_UPDATE_NOWAIT' | 'FOR_UPDATE_SKIP_LOCKED';
  private _ctes: CommonTableExpression[] = [];
  private _vectorSearch?: { column: string; vector: number[]; options?: NearestOptions };

  /**
   * Initializes a new QueryBuilder instance for a given table.
   *
   * @param adapter - Database adapter used for identifier escaping and placeholder formatting.
   * @param tableName - Target table name.
   * @param alias - Optional table alias for self-joins and subqueries.
   */
  constructor(
    private readonly adapter: IDbAdapter,
    tableName: string,
    alias?: string,
  ) {
    this._tableName = tableName;
    this._tableAlias = alias;
  }

  /**
   * Sets or updates the alias for the target table.
   */
  public as(alias: string): this {
    this._tableAlias = alias;
    return this;
  }

  /**
   * Defines a Common Table Expression (WITH clause).
   *
   * @param name - CTE identifier name.
   * @param query - QueryBuilder, Subquery, or SQL string defining the CTE dataset.
   * @param recursive - Whether the CTE is RECURSIVE.
   */
  public withCte(
    name: string,
    query: QueryBuilder<any> | Subquery<any> | string | ((qb: QueryBuilder<any>) => any),
    recursive = false,
  ): this {
    this._ctes.push({ name, query, recursive });
    return this;
  }

  /**
   * Converts this query into an aliased Subquery usable inside FROM, JOIN, or EXISTS clauses.
   *
   * @param alias - Alias for referencing this subquery.
   */
  public asSubquery(alias: string): Subquery<T> {
    const cloned = this.clone();
    cloned.as(alias);
    return {
      alias,
      tableName: this._tableName,
      queryBuilder: cloned,
      toSelectSql: (params?: AdapterParam[], nextParamIdx?: () => number) =>
        cloned.toSelectSql(params, nextParamIdx),
    };
  }

  /**
   * Performs semantic / vector distance search on an embedding column using pgvector operators.
   *
   * @param column - Vector column name.
   * @param vector - Query embedding coordinates array.
   * @param options - Distance metric ('cosine', 'l2', 'inner_product') and limit.
   */
  public nearest(column: string, vector: number[], options?: NearestOptions): this {
    this._vectorSearch = { column, vector, options };
    if (options?.limit) {
      this._limit = options.limit;
    }
    return this;
  }

  /**
   * Creates an independent deep clone of this QueryBuilder instance.
   *
   * @usecase Immutable query chaining in `DbSet` where new query modifications do not alter earlier instances.
   * @returns Cloned `QueryBuilder` instance.
   */
  public clone<R = T>(): QueryBuilder<R> {
    const qb = new QueryBuilder<R>(this.adapter, this._tableName, this._tableAlias);
    qb._selectColumns = [...this._selectColumns];
    qb._isDistinct = this._isDistinct;
    qb._orderByClauses = this._orderByClauses.map(o => ({ ...o }));
    qb._joinClauses = this._joinClauses.map(j => ({ ...j }));
    qb._groupByColumns = [...this._groupByColumns];
    qb._havingConditions = this._havingConditions.map(h => ({ ...h }));
    qb._limit = this._limit;
    qb._offset = this._offset;
    qb._usePrimary = this._usePrimary;
    qb._lockMode = this._lockMode;
    qb._ctes = this._ctes.map(c => ({ ...c }));
    if (this._vectorSearch) {
      qb._vectorSearch = { ...this._vectorSearch };
    }
    for (const c of this._whereClause.conditions) {
      qb._whereClause.conditions.push(c);
    }
    return qb;
  }

  /**
   * Adds columns to the SQL GROUP BY clause.
   *
   * @usecase Grouping rows by categories or status for aggregate calculations.
   * @param columns - Names of columns to group by.
   * @returns `this` builder instance for chaining.
   */
  public groupBy(...columns: string[]): this {
    this._groupByColumns.push(...columns);
    return this;
  }

  /**
   * Adds an SQL HAVING clause condition to filter aggregated groups.
   *
   * @usecase Filter grouped rows after aggregation (e.g. `HAVING COUNT(*) > 5`).
   * @param expression - Aggregate SQL expression (e.g. `'COUNT(*)'`).
   * @param operator - Comparison operator (e.g. `'>'`, `'='`, `'BETWEEN'`).
   * @param value - Target value.
   * @param value2 - Secondary value when using `BETWEEN`.
   * @returns `this` builder instance for chaining.
   */
  public having(expression: string, operator: string, value?: unknown, value2?: unknown): this {
    this._havingConditions.push({ expression, operator, value, value2 });
    return this;
  }

  /**
   * Configures whether to force execution on the primary database connection rather than read replicas.
   *
   * @usecase Read-after-write consistency in multi-replica environments.
   * @param use - `true` to force primary connection.
   * @returns `this` builder instance for chaining.
   */
  public usePrimary(use = true): this {
    this._usePrimary = use;
    return this;
  }

  /**
   * Checks whether the primary database connection is forced for this query.
   *
   * @returns `true` if primary connection routing is enabled.
   */
  public isUsePrimary(): boolean {
    return this._usePrimary;
  }

  /**
   * Returns a copy of the configured GROUP BY column names.
   */
  public getGroupByColumns(): string[] {
    return [...this._groupByColumns];
  }

  /**
   * Specifies which columns to project in the SELECT clause.
   *
   * @usecase Restrict returned columns to improve query performance.
   * @param columns - List of column names or SQL expressions.
   * @returns `this` builder instance for chaining.
   */
  public select(...columns: string[]): this {
    this._selectColumns = columns;
    return this;
  }

  /**
   * Enables or disables `SELECT DISTINCT` to eliminate duplicate rows.
   *
   * @usecase Filter out duplicates from joined or multi-row queries.
   * @param distinct - `true` to enable DISTINCT (defaults to `true`).
   * @returns `this` builder instance for chaining.
   */
  public distinct(distinct = true): this {
    this._isDistinct = distinct;
    return this;
  }

  /**
   * Attaches a `WhereClause` builder containing filter conditions.
   *
   * @usecase Set the WHERE clause filter tree on this query.
   * @param where - The `WhereClause` instance.
   * @returns `this` builder instance for chaining.
   */
  public where(where: WhereClause<T>): this {
    this._whereClause = where;
    return this;
  }

  /**
   * Returns the attached mutable `WhereClause` builder.
   *
   * @usecase Access and mutate conditions directly on the query builder.
   */
  public getWhereClause(): WhereClause<T> {
    return this._whereClause;
  }

  /**
   * Adds an ORDER BY sorting clause.
   *
   * @usecase Sort query results ascending or descending by column.
   * @param column - Column name to sort by.
   * @param direction - Sort direction (`'asc'` or `'desc'`).
   * @returns `this` builder instance for chaining.
   */
  public orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this._orderByClauses.push({
      column,
      direction: direction.toUpperCase() as 'ASC' | 'DESC',
    });
    return this;
  }

  /**
   * Adds a relational SQL JOIN clause against another table.
   *
   * @usecase Combine rows from two or more tables based on a related column.
   * @param type - JOIN type (`'INNER'`, `'LEFT'`, `'RIGHT'`, or `'FULL'`).
   * @param tableName - Foreign table name.
   * @param leftColumn - Primary table column key.
   * @param rightColumn - Foreign table column key.
   * @param alias - Optional table alias for the joined table.
   * @returns `this` builder instance for chaining.
   */
  public join(
    type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL',
    tableName: string,
    leftColumn: string,
    rightColumn: string,
    alias?: string,
  ): this {
    this._joinClauses.push({
      type,
      tableName,
      leftColumn,
      rightColumn,
      alias,
    });
    return this;
  }

  /**
   * Sets the maximum number of records to return (LIMIT / TOP).
   *
   * @usecase Restrict result set size for pagination or top-N lists.
   * @param limit - Maximum rows count.
   * @returns `this` builder instance for chaining.
   */
  public limit(limit: number): this {
    this._limit = limit;
    return this;
  }

  public getLimit(): number | undefined {
    return this._limit;
  }

  public getOffset(): number | undefined {
    return this._offset;
  }

  /**
   * Sets the number of rows to skip before returning results (OFFSET).
   *
   * @usecase Offset-based pagination.
   * @param offset - Number of rows to skip.
   * @returns `this` builder instance for chaining.
   */
  public offset(offset: number): this {
    this._offset = offset;
    return this;
  }

  /**
   * Applies pessimistic row locking (FOR UPDATE / WITH (UPDLOCK, ROWLOCK)).
   * Prevents concurrent transactions from modifying the selected rows until this transaction commits.
   *
   * @param options - Optional lock modifiers:
   *   - `noWait`: Fail immediately if rows are locked.
   *   - `skipLocked`: Skip locked rows (ideal for high-concurrency worker queues).
   * @returns `this` builder instance for chaining.
   */
  public forUpdate(options?: { noWait?: boolean; skipLocked?: boolean }): this {
    if (options?.noWait) {
      this._lockMode = 'FOR_UPDATE_NOWAIT';
    } else if (options?.skipLocked) {
      this._lockMode = 'FOR_UPDATE_SKIP_LOCKED';
    } else {
      this._lockMode = 'FOR_UPDATE';
    }
    return this;
  }

  /**
   * Applies exclusive row locking with NOWAIT (fails immediately if rows are locked).
   *
   * @returns `this` builder instance for chaining.
   */
  public forUpdateNoWait(): this {
    this._lockMode = 'FOR_UPDATE_NOWAIT';
    return this;
  }

  /**
   * Applies exclusive row locking skipping already locked rows (ideal for queue workers).
   *
   * @returns `this` builder instance for chaining.
   */
  public forUpdateSkipLocked(): this {
    this._lockMode = 'FOR_UPDATE_SKIP_LOCKED';
    return this;
  }

  /**
   * Applies shared read locking (FOR SHARE / LOCK IN SHARE MODE / WITH (HOLDLOCK)).
   *
   * @returns `this` builder instance for chaining.
   */
  public forShare(): this {
    this._lockMode = 'FOR_SHARE';
    return this;
  }

  /**
   * Fluent helper to set locking strategy explicitly.
   *
   * @param mode - Lock strategy: 'exclusive' | 'shared' | 'no-wait' | 'skip-locked'.
   * @returns `this` builder instance for chaining.
   */
  public withLock(mode: 'exclusive' | 'shared' | 'no-wait' | 'skip-locked'): this {
    switch (mode) {
      case 'exclusive':
        this._lockMode = 'FOR_UPDATE';
        break;
      case 'shared':
        this._lockMode = 'FOR_SHARE';
        break;
      case 'no-wait':
        this._lockMode = 'FOR_UPDATE_NOWAIT';
        break;
      case 'skip-locked':
        this._lockMode = 'FOR_UPDATE_SKIP_LOCKED';
        break;
    }
    return this;
  }

  /**
   * Compiles the current query AST into a dialect-specific SELECT SQL string with parameterized values.
   *
   * @usecase Generate executable parameterized SQL and parameter arrays for database adapters.
   * @returns Object containing compiled `sql` string and `params` array.
   */
  public toSelectSql(
    params: AdapterParam[] = [],
    nextParamIdx?: () => number,
  ): { sql: string; params: AdapterParam[] } {
    let localIndex = params.length;
    const getNextIdx = nextParamIdx || (() => localIndex++);

    const escape = (id: string) => this.formatIdentifier(id);

    // Common Table Expressions (WITH clauses)
    let ctePrefix = '';
    if (this._ctes.length > 0) {
      const isRecursive = this._ctes.some(c => c.recursive);
      const cteParts: string[] = [];
      for (const cte of this._ctes) {
        let innerSql = '';
        if (typeof cte.query === 'string') {
          innerSql = cte.query;
        } else if (typeof cte.query === 'function') {
          const generated = cte.query(new QueryBuilder(this.adapter, cte.name));
          if (generated && typeof generated.toSelectSql === 'function') {
            const res = generated.toSelectSql(params, getNextIdx);
            innerSql = res.sql;
          }
        } else if (cte.query && typeof cte.query.toSelectSql === 'function') {
          const res = cte.query.toSelectSql(params, getNextIdx);
          innerSql = res.sql;
        } else if (
          cte.query &&
          (cte.query as any).queryBuilder &&
          typeof (cte.query as any).queryBuilder.toSelectSql === 'function'
        ) {
          const res = (cte.query as any).queryBuilder.toSelectSql(params, getNextIdx);
          innerSql = res.sql;
        }
        cteParts.push(`${escape(cte.name)} AS (${innerSql})`);
      }
      ctePrefix = `WITH ${isRecursive ? 'RECURSIVE ' : ''}${cteParts.join(', ')} `;
    }

    // Columns
    const distinctStr = this._isDistinct ? 'DISTINCT ' : '';
    let colsStr = '*';
    if (this._selectColumns.length > 0) {
      colsStr = this._selectColumns
        .map(c => {
          if (
            c.includes(' AS ') ||
            c.includes(' as ') ||
            c.includes('(') ||
            c === '*' ||
            !isNaN(Number(c))
          ) {
            return c;
          }
          return escape(c);
        })
        .join(', ');
    }

    let mssqlLockHint = '';
    if (this._lockMode && this.adapter.provider === 'mssql') {
      if (this._lockMode === 'FOR_UPDATE') {
        mssqlLockHint = ' WITH (UPDLOCK, ROWLOCK, HOLDLOCK)';
      } else if (this._lockMode === 'FOR_UPDATE_NOWAIT') {
        mssqlLockHint = ' WITH (UPDLOCK, ROWLOCK, NOWAIT)';
      } else if (this._lockMode === 'FOR_UPDATE_SKIP_LOCKED') {
        mssqlLockHint = ' WITH (UPDLOCK, ROWLOCK, READPAST)';
      } else if (this._lockMode === 'FOR_SHARE') {
        mssqlLockHint = ' WITH (HOLDLOCK, ROWLOCK)';
      }
    }

    const tableIdentifier = this._tableAlias
      ? `${escape(this._tableName)} AS ${escape(this._tableAlias)}${mssqlLockHint}`
      : `${escape(this._tableName)}${mssqlLockHint}`;

    let sql = `${ctePrefix}SELECT ${distinctStr}${colsStr} FROM ${tableIdentifier}`;

    // Joins
    if (this._joinClauses.length > 0) {
      for (const j of this._joinClauses) {
        const jTable = j.alias
          ? `${escape(j.tableName)} AS ${escape(j.alias)}`
          : escape(j.tableName);
        sql += ` ${j.type} JOIN ${jTable} ON ${escape(j.leftColumn)} = ${escape(j.rightColumn)}`;
      }
    }

    // WHERE
    const whereSql = this.compileWhereConditions(this._whereClause.conditions, params, getNextIdx);
    if (whereSql) {
      sql += ` WHERE ${whereSql}`;
    }

    // GROUP BY
    if (this._groupByColumns.length > 0) {
      const groupStrs = this._groupByColumns.map(c => (c.includes('(') ? c : escape(c)));
      sql += ` GROUP BY ${groupStrs.join(', ')}`;
    }

    // HAVING
    if (this._havingConditions.length > 0) {
      const havingParts: string[] = [];
      for (const h of this._havingConditions) {
        if (h.operator === 'BETWEEN' && h.value !== undefined && h.value2 !== undefined) {
          const pIdx1 = getNextIdx();
          const pName1 = `p${pIdx1}`;
          params.push({ name: pName1, value: h.value });
          const ph1 = this.adapter.formatParameterPlaceholder(pName1, pIdx1 + 1);

          const pIdx2 = getNextIdx();
          const pName2 = `p${pIdx2}`;
          params.push({ name: pName2, value: h.value2 });
          const ph2 = this.adapter.formatParameterPlaceholder(pName2, pIdx2 + 1);

          havingParts.push(`${h.expression} BETWEEN ${ph1} AND ${ph2}`);
        } else if (h.operator === 'IS NULL' || h.operator === 'IS NOT NULL') {
          havingParts.push(`${h.expression} ${h.operator}`);
        } else {
          const pIdx = getNextIdx();
          const pName = `p${pIdx}`;
          params.push({ name: pName, value: h.value });
          const ph = this.adapter.formatParameterPlaceholder(pName, pIdx + 1);
          havingParts.push(`${h.expression} ${h.operator} ${ph}`);
        }
      }
      sql += ` HAVING ${havingParts.join(' AND ')}`;
    }

    // ORDER BY (with vector search support)
    const effectiveOrderBys = [...this._orderByClauses];
    if (this._vectorSearch) {
      const { column, vector, options } = this._vectorSearch;
      const metric = options?.distance || 'cosine';
      const pIdx = getNextIdx();
      const pName = `p${pIdx}`;
      const vectorStr = `[${vector.join(',')}]`;
      params.push({ name: pName, value: vectorStr });
      const ph = this.adapter.formatParameterPlaceholder(pName, pIdx + 1);

      const p = this.adapter.provider;
      const isPg = p === 'postgres' || p === 'neon' || p === 'supabase' || p === 'cockroachdb';

      let op = '<=>';
      if (metric === 'l2') {
        op = '<->';
      } else if (metric === 'inner_product') {
        op = '<#>';
      }

      const orderExpr = isPg
        ? `${escape(column)} ${op} ${ph}::vector`
        : `${escape(column)} ${op} ${ph}`;

      effectiveOrderBys.unshift({ column: orderExpr, direction: 'ASC' });
    }

    if (effectiveOrderBys.length > 0) {
      const orderStrs = effectiveOrderBys.map(
        o =>
          `${o.column.includes('(') || o.column.includes('<') ? o.column : escape(o.column)} ${o.direction}`,
      );
      sql += ` ORDER BY ${orderStrs.join(', ')}`;
    }

    // Pagination (dialect-dependent)
    sql = this.applyPagination(sql, this._limit, this._offset, this._orderByClauses.length > 0);

    // Locking (PostgreSQL, MySQL, CockroachDB, Neon, Supabase, PlanetScale)
    const p = this.adapter.provider;
    const supportsRowLockSyntax =
      p === 'postgres' ||
      p === 'neon' ||
      p === 'supabase' ||
      p === 'cockroachdb' ||
      p === 'mysql' ||
      p === 'planetscale';

    if (this._lockMode && supportsRowLockSyntax) {
      if (this._lockMode === 'FOR_UPDATE') {
        sql += ' FOR UPDATE';
      } else if (this._lockMode === 'FOR_UPDATE_NOWAIT') {
        sql += ' FOR UPDATE NOWAIT';
      } else if (this._lockMode === 'FOR_UPDATE_SKIP_LOCKED') {
        sql += ' FOR UPDATE SKIP LOCKED';
      } else if (this._lockMode === 'FOR_SHARE') {
        sql += p === 'mysql' || p === 'planetscale' ? ' LOCK IN SHARE MODE' : ' FOR SHARE';
      }
    }

    return { sql, params };
  }

  /**
   * Compiles the query into an SQL COUNT statement (`SELECT COUNT(...) AS total FROM ...`).
   *
   * @usecase Total record counting for pagination and metrics.
   * @param column - Column to count (defaults to `'*'`).
   * @returns Object containing compiled `sql` string and `params` array.
   */
  public toCountSql(column = '*'): { sql: string; params: AdapterParam[] } {
    const params: AdapterParam[] = [];
    let paramIndex = 0;
    const escape = (id: string) => this.formatIdentifier(id);

    const tableIdentifier = this._tableAlias
      ? `${escape(this._tableName)} AS ${escape(this._tableAlias)}`
      : escape(this._tableName);

    const countTarget = column === '*' ? '*' : escape(column);
    let sql = `SELECT COUNT(${countTarget}) AS total FROM ${tableIdentifier}`;

    // Joins
    if (this._joinClauses.length > 0) {
      for (const j of this._joinClauses) {
        const jTable = j.alias
          ? `${escape(j.tableName)} AS ${escape(j.alias)}`
          : escape(j.tableName);
        sql += ` ${j.type} JOIN ${jTable} ON ${escape(j.leftColumn)} = ${escape(j.rightColumn)}`;
      }
    }

    const whereSql = this.compileWhereConditions(
      this._whereClause.conditions,
      params,
      () => paramIndex++,
    );
    if (whereSql) {
      sql += ` WHERE ${whereSql}`;
    }

    return { sql, params };
  }

  /**
   * Compiles the query into an SQL aggregate function call (SUM, AVG, MIN, MAX).
   *
   * @usecase Aggregate calculations on database numeric columns.
   * @param fn - Aggregate function name.
   * @param column - Target column name.
   * @returns Object containing compiled `sql` string and `params` array.
   */
  public toAggregateSql(
    fn: 'SUM' | 'AVG' | 'MIN' | 'MAX',
    column: string,
  ): { sql: string; params: AdapterParam[] } {
    const params: AdapterParam[] = [];
    let paramIndex = 0;
    const escape = (id: string) => this.formatIdentifier(id);

    const tableIdentifier = this._tableAlias
      ? `${escape(this._tableName)} AS ${escape(this._tableAlias)}`
      : escape(this._tableName);

    let sql = `SELECT ${fn}(${escape(column)}) AS val FROM ${tableIdentifier}`;

    // Joins
    if (this._joinClauses.length > 0) {
      for (const j of this._joinClauses) {
        const jTable = j.alias
          ? `${escape(j.tableName)} AS ${escape(j.alias)}`
          : escape(j.tableName);
        sql += ` ${j.type} JOIN ${jTable} ON ${escape(j.leftColumn)} = ${escape(j.rightColumn)}`;
      }
    }

    const whereSql = this.compileWhereConditions(
      this._whereClause.conditions,
      params,
      () => paramIndex++,
    );
    if (whereSql) {
      sql += ` WHERE ${whereSql}`;
    }

    return { sql, params };
  }

  /**
   * Compiles an INSERT SQL statement for a row object with safe parameter placeholders.
   *
   * @usecase Insert a single row into the target table.
   * @param data - Key-value mapping of column names to values.
   * @returns Object containing compiled `sql` string and `params` array.
   */
  public toInsertSql(data: Record<string, unknown>): { sql: string; params: AdapterParam[] } {
    const params: AdapterParam[] = [];
    const keys = Object.keys(data);
    const escape = (id: string) => this.formatIdentifier(id);

    const cols = keys.map(k => escape(k)).join(', ');
    const placeholders = keys
      .map((k, idx) => {
        const pName = `p${idx}`;
        params.push({ name: pName, value: data[k] });
        return this.adapter.formatParameterPlaceholder(pName, idx + 1);
      })
      .join(', ');

    let sql = `INSERT INTO ${escape(this._tableName)} (${cols}) VALUES (${placeholders})`;
    const provider = this.adapter.provider;
    if (
      provider === 'postgres' ||
      provider === 'neon' ||
      provider === 'supabase' ||
      provider === 'cockroachdb'
    ) {
      sql += ' RETURNING *';
    }
    return { sql, params };
  }

  /**
   * Compiles an atomic dialect-specific UPSERT (INSERT ... ON CONFLICT / ON DUPLICATE KEY UPDATE / MERGE) SQL statement.
   *
   * @param conflictTarget - Column key-value pairs that define unique conflict constraints (e.g. `{ email: 'user@corp.com' }`).
   * @param updatePayload - Column key-value pairs to update when a conflict occurs.
   * @returns Object containing compiled `sql` string and `params` array.
   */
  public toUpsertSql(
    conflictTarget: Record<string, unknown>,
    updatePayload: Record<string, unknown>,
  ): { sql: string; params: AdapterParam[] } {
    const params: AdapterParam[] = [];
    const escape = (id: string) => this.formatIdentifier(id);
    const provider = this.adapter.provider;

    const mergedData: Record<string, unknown> = { ...conflictTarget, ...updatePayload };
    const allKeys = Object.keys(mergedData);
    const conflictKeys = Object.keys(conflictTarget);
    const updateKeys = Object.keys(updatePayload).filter(k => !conflictKeys.includes(k));
    const effectiveUpdateKeys = updateKeys.length > 0 ? updateKeys : Object.keys(updatePayload);

    const placeholders = allKeys.map((k, idx) => {
      const pName = `p${idx}`;
      params.push({ name: pName, value: mergedData[k] });
      return this.adapter.formatParameterPlaceholder(pName, idx + 1);
    });

    const cols = allKeys.map(k => escape(k)).join(', ');

    if (provider === 'mssql') {
      const sourceCols = allKeys.map(k => `source.${escape(k)}`).join(', ');
      const onClause = conflictKeys
        .map(k => `target.${escape(k)} = source.${escape(k)}`)
        .join(' AND ');
      const updateSet = effectiveUpdateKeys
        .map(k => `target.${escape(k)} = source.${escape(k)}`)
        .join(', ');

      const matchedClause =
        updateSet.length > 0 ? ` WHEN MATCHED THEN UPDATE SET ${updateSet}` : '';
      const sql = `MERGE INTO ${escape(this._tableName)} AS target USING (VALUES (${placeholders.join(', ')})) AS source (${cols}) ON ${onClause}${matchedClause} WHEN NOT MATCHED THEN INSERT (${cols}) VALUES (${sourceCols}) OUTPUT INSERTED.*;`;
      return { sql, params };
    }

    if (provider === 'mysql' || provider === 'planetscale') {
      const updateSet = effectiveUpdateKeys
        .map(k => `${escape(k)} = VALUES(${escape(k)})`)
        .join(', ');
      const sql = `INSERT INTO ${escape(this._tableName)} (${cols}) VALUES (${placeholders.join(', ')}) ON DUPLICATE KEY UPDATE ${updateSet}`;
      return { sql, params };
    }

    // Default: PostgreSQL, Neon, Supabase, CockroachDB, SQLite, Turso, D1, Mock
    const conflictCols = conflictKeys.map(k => escape(k)).join(', ');
    const updateSet = effectiveUpdateKeys
      .map(k => `${escape(k)} = EXCLUDED.${escape(k)}`)
      .join(', ');

    let sql = `INSERT INTO ${escape(this._tableName)} (${cols}) VALUES (${placeholders.join(', ')}) ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateSet}`;

    if (
      provider === 'postgres' ||
      provider === 'neon' ||
      provider === 'supabase' ||
      provider === 'cockroachdb' ||
      provider === 'sqlite' ||
      provider === 'turso' ||
      provider === 'd1' ||
      provider === 'mock'
    ) {
      sql += ' RETURNING *';
    }

    return { sql, params };
  }

  /**
   * Compiles an UPDATE SQL statement using the current WHERE clause conditions.
   *
   * @usecase Update matching rows with new column values.
   * @param data - Key-value mapping of columns to update.
   * @returns Object containing compiled `sql` string and `params` array.
   */
  public toUpdateSql(data: Record<string, unknown>): { sql: string; params: AdapterParam[] } {
    const params: AdapterParam[] = [];
    const keys = Object.keys(data);
    let paramIndex = 0;
    const escape = (id: string) => this.formatIdentifier(id);

    const setClauses = keys
      .map(k => {
        const pName = `p${paramIndex}`;
        params.push({ name: pName, value: data[k] });
        const placeholder = this.adapter.formatParameterPlaceholder(pName, paramIndex + 1);
        paramIndex++;
        return `${escape(k)} = ${placeholder}`;
      })
      .join(', ');

    let sql = `UPDATE ${escape(this._tableName)} SET ${setClauses}`;

    const whereSql = this.compileWhereConditions(
      this._whereClause.conditions,
      params,
      () => paramIndex++,
    );
    if (whereSql) {
      sql += ` WHERE ${whereSql}`;
    }

    return { sql, params };
  }

  /**
   * Compiles a DELETE SQL statement using the current WHERE clause conditions.
   *
   * @usecase Delete matching rows from the target table.
   * @returns Object containing compiled `sql` string and `params` array.
   */
  public toDeleteSql(): { sql: string; params: AdapterParam[] } {
    const params: AdapterParam[] = [];
    let paramIndex = 0;
    const escape = (id: string) => this.formatIdentifier(id);

    let sql = `DELETE FROM ${escape(this._tableName)}`;
    const whereSql = this.compileWhereConditions(
      this._whereClause.conditions,
      params,
      () => paramIndex++,
    );
    if (whereSql) {
      sql += ` WHERE ${whereSql}`;
    }

    return { sql, params };
  }

  private compileWhereConditions(
    conditions: WhereCondition[],
    params: AdapterParam[],
    nextParamIdx: () => number,
  ): string {
    if (!conditions || conditions.length === 0) {
      return '';
    }

    const parts: string[] = [];

    for (let i = 0; i < conditions.length; i++) {
      const c = conditions[i];
      const logical = i === 0 ? '' : ` ${c.logical} `;

      if (c.rawSql) {
        let compiledRaw = c.rawSql;
        if (c.rawParams && c.rawParams.length > 0) {
          for (const rp of c.rawParams) {
            const pIdx = nextParamIdx();
            const pName = `p${pIdx}`;
            params.push({ name: pName, value: rp });
            const placeholder = this.adapter.formatParameterPlaceholder(pName, pIdx + 1);
            compiledRaw = compiledRaw.replace('?', placeholder);
          }
        }
        parts.push(`${logical}(${compiledRaw})`);
        continue;
      }

      if (c.nested) {
        const nestedSql = this.compileWhereConditions(c.nested.conditions, params, nextParamIdx);
        if (nestedSql) {
          parts.push(`${logical}(${nestedSql})`);
        }
        continue;
      }

      if (c.search) {
        const searchSql = this.compileSearchCondition(c.search, params, nextParamIdx);
        if (searchSql) {
          parts.push(`${logical}${searchSql}`);
        }
        continue;
      }

      if (c.subquery) {
        const { subquery, joinPredicate, not } = c.subquery;
        let subQb: QueryBuilder<any> | undefined;
        let alias = '';
        let rawSql = '';

        if (typeof subquery === 'string') {
          rawSql = subquery;
        } else if (
          subquery &&
          typeof subquery.toSelectSql === 'function' &&
          subquery.alias &&
          subquery.queryBuilder
        ) {
          subQb = subquery.queryBuilder.clone();
          alias = subquery.alias;
        } else if (subquery && typeof subquery.toSelectSql === 'function') {
          subQb = subquery.clone();
          alias = (subquery as any)._tableAlias || (subquery as any)._tableName;
        } else if (subquery && (subquery as any).queryBuilder) {
          subQb = (subquery as any).queryBuilder.clone();
          alias = (subquery as any).tableName;
        }

        const joinComparisons: JoinComparison[] = [];
        if (joinPredicate && typeof joinPredicate === 'function') {
          if (joinPredicate.length <= 1 && subQb) {
            (joinPredicate as any)(subQb.getWhereClause());
          } else {
            const outerProxy = createJoinProxy(
              this._tableAlias || this._tableName,
              joinComparisons,
            );
            const innerProxy = createJoinProxy(
              alias || (subQb ? (subQb as any)._tableName : 'sub'),
              joinComparisons,
            );
            (joinPredicate as any)(outerProxy, innerProxy);
          }
        }

        if (subQb) {
          if (alias) {
            subQb.as(alias);
          }
          for (const comp of joinComparisons) {
            const leftRef = `${this.formatIdentifier(comp.leftTable)}.${this.formatIdentifier(comp.leftColumn)}`;
            if (comp.rightTable && comp.rightColumn) {
              const rightRef = `${this.formatIdentifier(comp.rightTable)}.${this.formatIdentifier(comp.rightColumn)}`;
              subQb.getWhereClause().raw(`${leftRef} ${comp.operator} ${rightRef}`);
            } else {
              const pIdx = nextParamIdx();
              const pName = `p${pIdx}`;
              params.push({ name: pName, value: comp.rightValue });
              const ph = this.adapter.formatParameterPlaceholder(pName, pIdx + 1);
              subQb.getWhereClause().raw(`${leftRef} ${comp.operator} ${ph}`);
            }
          }
          subQb.select('1');
          const res = subQb.toSelectSql(params, nextParamIdx);
          const prefix = not ? 'NOT EXISTS' : 'EXISTS';
          parts.push(`${logical}${prefix} (${res.sql})`);
        } else if (rawSql) {
          let joinSql = '';
          if (joinComparisons.length > 0) {
            joinSql =
              ' WHERE ' +
              joinComparisons
                .map(comp => {
                  const leftRef = `${this.formatIdentifier(comp.leftTable)}.${this.formatIdentifier(comp.leftColumn)}`;
                  if (comp.rightTable && comp.rightColumn) {
                    const rightRef = `${this.formatIdentifier(comp.rightTable)}.${this.formatIdentifier(comp.rightColumn)}`;
                    return `${leftRef} ${comp.operator} ${rightRef}`;
                  }
                  const pIdx = nextParamIdx();
                  const pName = `p${pIdx}`;
                  params.push({ name: pName, value: comp.rightValue });
                  const ph = this.adapter.formatParameterPlaceholder(pName, pIdx + 1);
                  return `${leftRef} ${comp.operator} ${ph}`;
                })
                .join(' AND ');
          }
          const prefix = not ? 'NOT EXISTS' : 'EXISTS';
          const aliasStr = alias ? ` AS ${this.formatIdentifier(alias)}` : '';
          parts.push(`${logical}${prefix} (SELECT 1 FROM (${rawSql})${aliasStr}${joinSql})`);
        }
        continue;
      }

      if (!c.column || !c.operator) {
        continue;
      }

      const colName = c.jsonPath
        ? this.formatJsonPathExpression(c.column, c.jsonPath)
        : this.formatIdentifier(c.column);

      if (c.operator === 'IS NULL' || c.operator === 'IS NOT NULL') {
        parts.push(`${logical}${colName} ${c.operator}`);
        continue;
      }

      if (c.operator === 'IN' || c.operator === 'NOT IN') {
        const list = Array.isArray(c.value) ? c.value : [c.value];
        if (list.length === 0) {
          parts.push(c.operator === 'IN' ? `${logical}1 = 0` : `${logical}1 = 1`);
          continue;
        }
        const placeholders = list
          .map(item => {
            const pIdx = nextParamIdx();
            const pName = `p${pIdx}`;
            params.push({ name: pName, value: item });
            return this.adapter.formatParameterPlaceholder(pName, pIdx + 1);
          })
          .join(', ');
        parts.push(`${logical}${colName} ${c.operator} (${placeholders})`);
        continue;
      }

      if (c.operator === 'BETWEEN') {
        const [start, end] = Array.isArray(c.value) ? c.value : [c.value, c.value];
        const pIdx1 = nextParamIdx();
        const pName1 = `p${pIdx1}`;
        params.push({ name: pName1, value: start });
        const ph1 = this.adapter.formatParameterPlaceholder(pName1, pIdx1 + 1);

        const pIdx2 = nextParamIdx();
        const pName2 = `p${pIdx2}`;
        params.push({ name: pName2, value: end });
        const ph2 = this.adapter.formatParameterPlaceholder(pName2, pIdx2 + 1);

        parts.push(`${logical}${colName} BETWEEN ${ph1} AND ${ph2}`);
        continue;
      }

      // Standard binary operator (=, <>, >, >=, <, <=, LIKE, NOT LIKE)
      const pIdx = nextParamIdx();
      const pName = `p${pIdx}`;
      params.push({ name: pName, value: c.value });
      const ph = this.adapter.formatParameterPlaceholder(pName, pIdx + 1);
      parts.push(`${logical}${colName} ${c.operator} ${ph}`);
    }

    return parts.join('');
  }

  private compileSearchCondition(
    search: { columns: string[]; query: string; options?: any },
    params: AdapterParam[],
    nextParamIdx: () => number,
  ): string {
    if (!search.columns || search.columns.length === 0 || !search.query) {
      return '';
    }

    const provider = this.adapter.provider;
    const mode = search.options?.mode || 'websearch';
    const lang = search.options?.language || 'english';

    // 1. PostgreSQL, Neon, Supabase, CockroachDB
    if (
      provider === 'postgres' ||
      provider === 'neon' ||
      provider === 'supabase' ||
      provider === 'cockroachdb'
    ) {
      const tsQueryFunc =
        mode === 'plain'
          ? 'plainto_tsquery'
          : mode === 'phrase'
            ? 'phraseto_tsquery'
            : mode === 'raw'
              ? 'to_tsquery'
              : 'websearch_to_tsquery';

      const vectorExpr = search.columns
        .map(col => `coalesce(${this.formatIdentifier(col)}, '')`)
        .join(" || ' ' || ");

      const pIdx = nextParamIdx();
      const pName = `p${pIdx}`;
      params.push({ name: pName, value: search.query });
      const ph = this.adapter.formatParameterPlaceholder(pName, pIdx + 1);

      return `to_tsvector('${lang}', ${vectorExpr}) @@ ${tsQueryFunc}('${lang}', ${ph})`;
    }

    // 2. MySQL, PlanetScale
    if (provider === 'mysql' || provider === 'planetscale') {
      const againstMode = mode === 'natural' ? 'IN NATURAL LANGUAGE MODE' : 'IN BOOLEAN MODE';
      const cols = search.columns.map(col => this.formatIdentifier(col)).join(', ');

      const pIdx = nextParamIdx();
      const pName = `p${pIdx}`;
      params.push({ name: pName, value: search.query });
      const ph = this.adapter.formatParameterPlaceholder(pName, pIdx + 1);

      return `MATCH(${cols}) AGAINST(${ph} ${againstMode})`;
    }

    // 3. MSSQL
    if (provider === 'mssql') {
      const cols =
        search.columns.length > 1
          ? `(${search.columns.map(col => this.formatIdentifier(col)).join(', ')})`
          : this.formatIdentifier(search.columns[0]);

      const pIdx = nextParamIdx();
      const pName = `p${pIdx}`;
      params.push({ name: pName, value: search.query });
      const ph = this.adapter.formatParameterPlaceholder(pName, pIdx + 1);

      return `CONTAINS(${cols}, ${ph})`;
    }

    // 4. SQLite, Turso, D1, Mock, default fallback
    const likeExprs = search.columns
      .map(col => {
        const pIdx = nextParamIdx();
        const pName = `p${pIdx}`;
        params.push({ name: pName, value: `%${search.query}%` });
        const ph = this.adapter.formatParameterPlaceholder(pName, pIdx + 1);
        return `${this.formatIdentifier(col)} LIKE ${ph}`;
      })
      .join(' OR ');

    return `(${likeExprs})`;
  }

  private applyPagination(
    sql: string,
    limit?: number,
    offset?: number,
    hasOrderBy = false,
  ): string {
    if (limit === undefined && offset === undefined) {
      return sql;
    }

    if (this.adapter.provider === 'mssql') {
      // SQL Server requires an ORDER BY for OFFSET/FETCH
      let pagedSql = sql;
      if (!hasOrderBy) {
        pagedSql += ' ORDER BY (SELECT NULL)';
      }
      const off = offset ?? 0;
      pagedSql += ` OFFSET ${off} ROWS`;
      if (limit !== undefined) {
        pagedSql += ` FETCH NEXT ${limit} ROWS ONLY`;
      }
      return pagedSql;
    }

    // Postgres, MySQL, SQLite standard syntax
    let paged = sql;
    if (limit !== undefined) {
      paged += ` LIMIT ${limit}`;
    }
    if (offset !== undefined) {
      paged += ` OFFSET ${offset}`;
    }
    return paged;
  }

  /**
   * Formats a JSON path extraction expression tailored to the active database provider.
   *
   * @param column - Column name holding the JSON document.
   * @param path - Property path within the JSON document (e.g. `'address.city'`).
   * @returns Dialect-specific SQL JSON extraction expression.
   */
  public formatJsonPathExpression(column: string, path: string): string {
    const cleanPath = path.startsWith('$.') ? path.slice(2) : path;
    const jsonDotPath = path.startsWith('$.') ? path : `$.${path}`;
    const colIdentifier = this.formatIdentifier(column);

    const provider = this.adapter.provider;

    // PostgreSQL, CockroachDB, Neon, Supabase
    if (
      provider === 'postgres' ||
      provider === 'neon' ||
      provider === 'supabase' ||
      provider === 'cockroachdb'
    ) {
      const segments = cleanPath.split('.');
      let expr = colIdentifier;
      for (let sIdx = 0; sIdx < segments.length; sIdx++) {
        const seg = segments[sIdx];
        const isLast = sIdx === segments.length - 1;
        const isNum = /^\d+$/.test(seg);
        const op = isLast ? '->>' : '->';
        expr += isNum ? `${op}${seg}` : `${op}'${seg}'`;
      }
      return expr;
    }

    // MySQL, PlanetScale
    if (provider === 'mysql' || provider === 'planetscale') {
      return `JSON_UNQUOTE(JSON_EXTRACT(${colIdentifier}, '${jsonDotPath}'))`;
    }

    // MSSQL
    if (provider === 'mssql') {
      return `JSON_VALUE(${colIdentifier}, '${jsonDotPath}')`;
    }

    // SQLite, Turso, D1, Mock, default
    return `json_extract(${colIdentifier}, '${jsonDotPath}')`;
  }

  private formatIdentifier(id: string): string {
    if (id === '*') return '*';
    if (id.includes('.')) {
      return id
        .split('.')
        .map(part => this.adapter.escapeIdentifier(part))
        .join('.');
    }
    return this.adapter.escapeIdentifier(id);
  }
}
