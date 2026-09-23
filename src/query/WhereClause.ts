import { AdapterParam } from '../adapters/AdapterParam';

export type WhereOperator =
  | '='
  | '!='
  | '<>'
  | '>'
  | '>='
  | '<'
  | '<='
  | 'LIKE'
  | 'NOT LIKE'
  | 'IN'
  | 'NOT IN'
  | 'IS NULL'
  | 'IS NOT NULL'
  | 'BETWEEN';

export type LogicalOperator = 'AND' | 'OR';

export type SearchMode = 'websearch' | 'plain' | 'phrase' | 'raw' | 'natural' | 'boolean';

export interface SearchOptions {
  mode?: SearchMode;
  language?: string;
}

export interface SubqueryCondition {
  subquery: any;
  joinPredicate?: ((outer: any, inner?: any) => void) | ((clause: WhereClause<any>) => void);
  not?: boolean;
}

export interface WhereCondition {
  column?: string;
  operator?: WhereOperator;
  value?: unknown;
  logical: LogicalOperator;
  nested?: WhereClause<any>;
  rawSql?: string;
  rawParams?: unknown[];
  jsonPath?: string;
  search?: {
    columns: string[];
    query: string;
    options?: SearchOptions;
  };
  subquery?: SubqueryCondition;
}

export type ColumnKey<T> = (keyof T & string) | (string & {});

/**
 * Extracts a property or column name from either a string key or a lambda property accessor.
 *
 * @param column - Property name string or lambda selector `(e) => e.prop`.
 * @returns The resolved string property name.
 */
export function extractColumnName<T>(column: ColumnKey<T> | ((entity: T) => unknown)): string {
  if (typeof column === 'function') {
    const accessed: string[] = [];
    const proxy = new Proxy({} as any, {
      get: (_, prop) => {
        accessed.push(String(prop));
        return String(prop);
      },
    });
    try {
      const res = (column as any)(proxy);
      if (typeof res === 'string' && accessed.length === 0) {
        accessed.push(res);
      }
    } catch {
      // ignore
    }
    return accessed[0] || '';
  }
  return String(column);
}

/**
 * Fluent builder for constructing SQL WHERE filter conditions.
 *
 * Provides type-safe comparison operators, pattern matching, range queries,
 * nested grouped expressions, JSON path inspection, and full-text search.
 */
export class WhereClause<T = any> {
  public readonly conditions: WhereCondition[] = [];
  private currentLogical: LogicalOperator = 'AND';

  /**
   * Sets the conjunction operator for the next condition to `AND` (the default).
   *
   * @usecase Explicitly combine conditions with logical AND.
   * @returns `this` instance for method chaining.
   */
  public and(): this {
    this.currentLogical = 'AND';
    return this;
  }

  /**
   * Sets the conjunction operator for the next condition to `OR`.
   *
   * @usecase Combine conditions where at least one must evaluate to true.
   * @returns `this` instance for method chaining.
   * @example
   * ```ts
   * query.where(w => w.eq('role', 'admin').or().eq('role', 'manager'));
   * ```
   */
  public or(): this {
    this.currentLogical = 'OR';
    return this;
  }

  /**
   * Adds an equality condition (`column = value`).
   *
   * @usecase Filter records where a property exactly matches a specified value.
   * @param column - Property selector function or column name.
   * @param value - Expected value.
   * @returns `this` instance for method chaining.
   * @example
   * ```ts
   * w.eq(u => u.status, 'active')
   * ```
   */
  public eq<V>(selector: (entity: T) => V, value: V): this;
  public eq<K extends keyof T & string>(column: K, value: T[K]): this;
  public eq(column: string & {}, value: unknown): this;
  public eq(column: any, value: any): this {
    return this.addCondition(extractColumnName(column), '=', value);
  }

  /**
   * Adds an inequality condition (`column <> value`).
   *
   * @usecase Filter out records matching an undesirable value.
   * @param column - Property selector function or column name.
   * @param value - Value to exclude.
   * @returns `this` instance for method chaining.
   * @example
   * ```ts
   * w.ne('status', 'banned')
   * ```
   */
  public ne<V>(selector: (entity: T) => V, value: V): this;
  public ne<K extends keyof T & string>(column: K, value: T[K]): this;
  public ne(column: string & {}, value: unknown): this;
  public ne(column: any, value: any): this {
    return this.addCondition(extractColumnName(column), '<>', value);
  }

  /**
   * Adds a greater-than comparison (`column > value`).
   *
   * @usecase Numeric thresholds, date cutoffs, or price minimums.
   * @param column - Property selector function or column name.
   * @param value - Threshold value.
   * @returns `this` instance for method chaining.
   */
  public gt<V>(selector: (entity: T) => V, value: V): this;
  public gt<K extends keyof T & string>(column: K, value: T[K]): this;
  public gt(column: string & {}, value: unknown): this;
  public gt(column: any, value: any): this {
    return this.addCondition(extractColumnName(column), '>', value);
  }

  /**
   * Adds a greater-than-or-equal comparison (`column >= value`).
   *
   * @usecase Inclusive lower bounds on numbers and dates.
   * @param column - Property selector function or column name.
   * @param value - Minimum inclusive value.
   * @returns `this` instance for method chaining.
   */
  public gte<V>(selector: (entity: T) => V, value: V): this;
  public gte<K extends keyof T & string>(column: K, value: T[K]): this;
  public gte(column: string & {}, value: unknown): this;
  public gte(column: any, value: any): this {
    return this.addCondition(extractColumnName(column), '>=', value);
  }

  /**
   * Adds a less-than comparison (`column < value`).
   *
   * @usecase Upper bounds, maximum limits, or dates strictly prior to cutoff.
   * @param column - Property selector function or column name.
   * @param value - Threshold value.
   * @returns `this` instance for method chaining.
   */
  public lt<V>(selector: (entity: T) => V, value: V): this;
  public lt<K extends keyof T & string>(column: K, value: T[K]): this;
  public lt(column: string & {}, value: unknown): this;
  public lt(column: any, value: any): this {
    return this.addCondition(extractColumnName(column), '<', value);
  }

  /**
   * Adds a less-than-or-equal comparison (`column <= value`).
   *
   * @usecase Inclusive upper bounds on numbers and dates.
   * @param column - Property selector function or column name.
   * @param value - Maximum inclusive value.
   * @returns `this` instance for method chaining.
   */
  public lte<V>(selector: (entity: T) => V, value: V): this;
  public lte<K extends keyof T & string>(column: K, value: T[K]): this;
  public lte(column: string & {}, value: unknown): this;
  public lte(column: any, value: any): this {
    return this.addCondition(extractColumnName(column), '<=', value);
  }

  /**
   * Adds a pattern-matching condition (`column LIKE pattern`).
   *
   * @usecase Substring search or prefix/suffix wildcard matching with `%` and `_`.
   * @param column - Property selector function or column name.
   * @param pattern - SQL wildcard pattern (e.g. `'%example.com'`).
   * @returns `this` instance for method chaining.
   * @example
   * ```ts
   * w.like('email', '%@company.org')
   * ```
   */
  public like(selector: (entity: T) => string | unknown, pattern: string): this;
  public like(column: ColumnKey<T>, pattern: string): this;
  public like(column: any, pattern: string): this {
    return this.addCondition(extractColumnName(column), 'LIKE', pattern);
  }

  /**
   * Adds a negative pattern-matching condition (`column NOT LIKE pattern`).
   *
   * @usecase Exclude records matching a specific wildcard pattern.
   * @param column - Property selector function or column name.
   * @param pattern - SQL wildcard pattern.
   * @returns `this` instance for method chaining.
   */
  public notLike(selector: (entity: T) => string | unknown, pattern: string): this;
  public notLike(column: ColumnKey<T>, pattern: string): this;
  public notLike(column: any, pattern: string): this {
    return this.addCondition(extractColumnName(column), 'NOT LIKE', pattern);
  }

  /**
   * Adds a set inclusion test (`column IN (...)`).
   *
   * @usecase Filter records whose column matches any element in an array of candidate values.
   * @param column - Property selector function or column name.
   * @param values - Array of matching values.
   * @returns `this` instance for method chaining.
   * @example
   * ```ts
   * w.in('status', ['pending', 'processing', 'review'])
   * ```
   */
  public in<V>(selector: (entity: T) => V, values: V[]): this;
  public in<K extends keyof T & string>(column: K, values: T[K][]): this;
  public in(column: string & {}, values: unknown[]): this;
  public in(column: any, values: any): this {
    return this.addCondition(extractColumnName(column), 'IN', values);
  }

  /**
   * Adds a set exclusion test (`column NOT IN (...)`).
   *
   * @usecase Exclude records whose column matches any element in an array of values.
   * @param column - Property selector function or column name.
   * @param values - Array of excluded values.
   * @returns `this` instance for method chaining.
   */
  public notIn<V>(selector: (entity: T) => V, values: V[]): this;
  public notIn<K extends keyof T & string>(column: K, values: T[K][]): this;
  public notIn(column: string & {}, values: unknown[]): this;
  public notIn(column: any, values: any): this {
    return this.addCondition(extractColumnName(column), 'NOT IN', values);
  }

  /**
   * Adds an `IS NULL` condition.
   *
   * @usecase Filter records where a nullable column has no assigned value.
   * @param column - Property selector function or column name.
   * @returns `this` instance for method chaining.
   */
  public isNull(selector: (entity: T) => unknown): this;
  public isNull(column: ColumnKey<T>): this;
  public isNull(column: any): this {
    return this.addCondition(extractColumnName(column), 'IS NULL', undefined);
  }

  /**
   * Adds an `IS NOT NULL` condition.
   *
   * @usecase Filter records where a nullable column contains a value.
   * @param column - Property selector function or column name.
   * @returns `this` instance for method chaining.
   */
  public isNotNull(selector: (entity: T) => unknown): this;
  public isNotNull(column: ColumnKey<T>): this;
  public isNotNull(column: any): this {
    return this.addCondition(extractColumnName(column), 'IS NOT NULL', undefined);
  }

  /**
   * Adds an inclusive range condition (`column BETWEEN start AND end`).
   *
   * @usecase Filter date ranges or numeric ranges cleanly without separate `>=` and `<=` calls.
   * @param column - Property selector function or column name.
   * @param start - Lower range boundary (inclusive).
   * @param end - Upper range boundary (inclusive).
   * @returns `this` instance for method chaining.
   * @example
   * ```ts
   * w.between('price', 10, 50)
   * ```
   */
  public between<V>(selector: (entity: T) => V, start: V, end: V): this;
  public between<K extends keyof T & string>(column: K, start: T[K], end: T[K]): this;
  public between(column: string & {}, start: unknown, end: unknown): this;
  public between(column: any, start: any, end: any): this {
    return this.addCondition(extractColumnName(column), 'BETWEEN', [start, end]);
  }

  /**
   * Groups a set of conditions enclosed in parentheses `(cond1 OR cond2)`.
   *
   * @usecase Control operator precedence when mixing AND with OR logic.
   * @param builderFn - Callback receiving a sub-`WhereClause` builder.
   * @returns `this` instance for method chaining.
   * @example
   * ```ts
   * w.eq('isActive', true).and().group(g => g.eq('tier', 'gold').or().gt('points', 1000));
   * ```
   */
  public group(builderFn: (subClause: WhereClause<T>) => void): this {
    const sub = new WhereClause<T>();
    builderFn(sub);
    if (sub.conditions.length > 0) {
      this.conditions.push({
        logical: this.currentLogical,
        nested: sub,
      });
    }
    this.currentLogical = 'AND';
    return this;
  }

  /**
   * Adds a filter inside a JSON/JSONB document property.
   *
   * @usecase Query nested attributes inside JSON columns with database dialect-specific operators.
   * @param column - Property containing the JSON payload.
   * @param path - Dot-separated path inside the JSON object (e.g. `'address.zip'`).
   * @param operatorOrValue - Comparison operator (e.g. `'='`, `'>'`) or target value when testing equality.
   * @param value - Target value if operator was supplied.
   * @returns `this` instance for method chaining.
   */
  public whereJson(
    column: ColumnKey<T> | ((entity: T) => unknown),
    path: string,
    operatorOrValue: string | unknown,
    value?: unknown,
  ): this {
    let operator = '=';
    let val = operatorOrValue;
    if (value !== undefined) {
      operator = String(operatorOrValue);
      val = value;
    }
    const colName = extractColumnName(column);
    this.conditions.push({
      column: colName,
      jsonPath: path,
      operator: operator as WhereOperator,
      value: val,
      logical: this.currentLogical,
    });
    this.currentLogical = 'AND';
    return this;
  }

  /**
   * Shorthand alias for `whereJson`.
   *
   * @usecase Filter nested attributes inside JSON columns.
   */
  public json(
    column: ColumnKey<T> | ((entity: T) => unknown),
    path: string,
    operatorOrValue: string | unknown,
    value?: unknown,
  ): this {
    return this.whereJson(column, path, operatorOrValue, value);
  }

  /**
   * Adds native full-text search condition across multiple columns.
   *
   * @usecase Implement keyword search with database-native indexing across text fields.
   * @param columns - Columns or property selectors to search across.
   * @param query - Search keywords.
   * @param options - Full-text options (search mode, language).
   * @returns `this` instance for method chaining.
   */
  public whereSearch(
    columns: (ColumnKey<T> | ((entity: T) => unknown))[],
    query: string,
    options?: SearchOptions,
  ): this {
    const colNames = columns.map(c => extractColumnName(c));
    this.conditions.push({
      logical: this.currentLogical,
      search: {
        columns: colNames,
        query,
        options,
      },
    });
    this.currentLogical = 'AND';
    return this;
  }

  /**
   * Shorthand alias for `whereSearch`.
   *
   * @usecase Full-text search across text columns.
   */
  public search(
    columns: (ColumnKey<T> | ((entity: T) => unknown))[],
    query: string,
    options?: SearchOptions,
  ): this {
    return this.whereSearch(columns, query, options);
  }

  /**
   * Injects a raw SQL WHERE condition with parameterized values.
   *
   * @usecase Vendor-specific functions, geospatial expressions, or math calculations.
   * @param sql - Raw SQL condition string.
   * @param params - Optional parameter array.
   * @returns `this` instance for method chaining.
   */
  public raw(sql: string, params?: unknown[]): this {
    this.conditions.push({
      logical: this.currentLogical,
      rawSql: sql,
      rawParams: params,
    });
    this.currentLogical = 'AND';
    return this;
  }

  /**
   * Adds an SQL EXISTS (SELECT ...) subquery condition.
   *
   * @param subquery - QueryBuilder, Subquery instance, or SQL string.
   * @param joinPredicate - Callback defining join predicate between outer entity and subquery alias.
   * @returns `this` instance for method chaining.
   * @example
   * ```ts
   * w.exists(highValueCustomers, (order, hvc) => order.customerId.eq(hvc.id));
   * ```
   */
  public exists(subquery: any, joinPredicate?: (outer: any, inner: any) => void): this {
    this.conditions.push({
      logical: this.currentLogical,
      subquery: {
        subquery,
        joinPredicate,
        not: false,
      },
    });
    this.currentLogical = 'AND';
    return this;
  }

  /**
   * Adds an SQL NOT EXISTS (SELECT ...) subquery condition.
   *
   * @param subquery - QueryBuilder, Subquery instance, or SQL string.
   * @param joinPredicate - Callback defining join predicate between outer entity and subquery alias.
   * @returns `this` instance for method chaining.
   */
  public notExists(subquery: any, joinPredicate?: (outer: any, inner: any) => void): this {
    this.conditions.push({
      logical: this.currentLogical,
      subquery: {
        subquery,
        joinPredicate,
        not: true,
      },
    });
    this.currentLogical = 'AND';
    return this;
  }

  private addCondition(column: string, operator: WhereOperator, value: unknown): this {
    this.conditions.push({
      column,
      operator,
      value,
      logical: this.currentLogical,
    });
    this.currentLogical = 'AND';
    return this;
  }
}
