import { IDbAdapter } from '../adapters/IDbAdapter';
import { AdapterParam } from '../adapters/AdapterParam';
import { QueryBuilder } from './QueryBuilder';
import { DbTransaction } from '../transaction/DbTransaction';
import { EntityMetadata } from '../model/EntityMetadata';
import { ColumnKey } from './WhereClause';
import { EntityNotFoundException } from '../errors';

export interface HavingCondition {
  expression: string;
  operator: string;
  value?: unknown;
  value2?: unknown;
}

export class HavingExpressionBuilder {
  constructor(public readonly sqlExpr: string) {}

  public greaterThan(val: unknown): HavingCondition {
    return { expression: this.sqlExpr, operator: '>', value: val };
  }

  public greaterThanOrEqual(val: unknown): HavingCondition {
    return { expression: this.sqlExpr, operator: '>=', value: val };
  }

  public lessThan(val: unknown): HavingCondition {
    return { expression: this.sqlExpr, operator: '<', value: val };
  }

  public lessThanOrEqual(val: unknown): HavingCondition {
    return { expression: this.sqlExpr, operator: '<=', value: val };
  }

  public equals(val: unknown): HavingCondition {
    return { expression: this.sqlExpr, operator: '=', value: val };
  }

  public notEquals(val: unknown): HavingCondition {
    return { expression: this.sqlExpr, operator: '<>', value: val };
  }

  public between(val1: unknown, val2: unknown): HavingCondition {
    return { expression: this.sqlExpr, operator: 'BETWEEN', value: val1, value2: val2 };
  }
}

export class AggregateExpression<R = number> {
  declare readonly _resultType: R;

  constructor(
    public readonly func: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
    public readonly column: string,
  ) {}

  public toSql(adapter: IDbAdapter): string {
    const colStr = this.column === '*' ? '*' : adapter.escapeIdentifier(this.column);
    return `${this.func}(${colStr})`;
  }

  private get rawSql(): string {
    return `${this.func}(${this.column})`;
  }

  // Support chaining in having: g.sum(o => o.total).greaterThan(1000)
  public greaterThan(val: unknown): HavingCondition {
    return new HavingExpressionBuilder(this.rawSql).greaterThan(val);
  }

  public greaterThanOrEqual(val: unknown): HavingCondition {
    return new HavingExpressionBuilder(this.rawSql).greaterThanOrEqual(val);
  }

  public lessThan(val: unknown): HavingCondition {
    return new HavingExpressionBuilder(this.rawSql).lessThan(val);
  }

  public lessThanOrEqual(val: unknown): HavingCondition {
    return new HavingExpressionBuilder(this.rawSql).lessThanOrEqual(val);
  }

  public equals(val: unknown): HavingCondition {
    return new HavingExpressionBuilder(this.rawSql).equals(val);
  }

  public notEquals(val: unknown): HavingCondition {
    return new HavingExpressionBuilder(this.rawSql).notEquals(val);
  }

  public between(val1: unknown, val2: unknown): HavingCondition {
    return new HavingExpressionBuilder(this.rawSql).between(val1, val2);
  }
}

export class GroupKeyExpression<K = any> extends HavingExpressionBuilder {
  declare readonly _keyType: K;

  constructor(public readonly column: string) {
    super(column);
  }

  public toSql(adapter: IDbAdapter): string {
    return adapter.escapeIdentifier(this.column);
  }
}

export interface IGroupProxy<T, TKey = any> {
  readonly key: TKey & GroupKeyExpression<TKey> & Record<string, any>;
  count(selector?: ColumnKey<T> | ((entity: T) => unknown)): AggregateExpression<number>;
  sum(selector: ColumnKey<T> | ((entity: T) => number)): AggregateExpression<number>;
  avg(selector: ColumnKey<T> | ((entity: T) => number)): AggregateExpression<number>;
  min<R = number>(selector: ColumnKey<T> | ((entity: T) => R)): AggregateExpression<R>;
  max<R = number>(selector: ColumnKey<T> | ((entity: T) => R)): AggregateExpression<R>;
}

export type UnpackAggregate<V> =
  V extends AggregateExpression<infer R> ? R : V extends GroupKeyExpression<infer K> ? K : V;

export type ProjectedResult<TProjection> = {
  [K in keyof TProjection]: UnpackAggregate<TProjection[K]>;
};

/**
 * Builds and executes fluent GROUP BY, HAVING, and projected aggregation queries.
 */
export class GroupedQueryBuilder<T extends object, TKey = any> {
  private readonly groupColumns: string[] = [];
  private readonly havingConditions: HavingCondition[] = [];
  private readonly rawKeyNames: string[] = [];

  constructor(
    private readonly adapter: IDbAdapter,
    private readonly queryBuilder: QueryBuilder<T>,
    keySelector: (entity: T) => TKey,
    private readonly metadata?: EntityMetadata,
    private readonly transaction?: DbTransaction,
  ) {
    this.extractGroupColumns(keySelector);
  }

  private extractGroupColumns(selector: (entity: T) => TKey): void {
    const accessed: string[] = [];
    const proxy = new Proxy({} as any, {
      get: (_, prop) => {
        accessed.push(String(prop));
        return String(prop);
      },
    });

    try {
      const res = selector(proxy);
      if (typeof res === 'string' && accessed.length === 0) {
        accessed.push(res);
      } else if (Array.isArray(res)) {
        for (const item of res) {
          if (typeof item === 'string' && !accessed.includes(item)) {
            accessed.push(item);
          }
        }
      }
    } catch {
      // ignore
    }

    this.rawKeyNames.push(...accessed);
    for (const prop of accessed) {
      const col = this.mapPropertyToColumn(prop);
      this.groupColumns.push(col);
    }
  }

  private mapPropertyToColumn(prop: string): string {
    if (!this.metadata) return prop;
    return this.metadata.columns.get(prop)?.columnName || prop;
  }

  private resolveSelector(selector?: ColumnKey<T> | ((entity: T) => unknown)): string {
    if (!selector) return '*';
    if (typeof selector === 'string') {
      return selector === '*' ? '*' : this.mapPropertyToColumn(selector);
    }
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
    const prop = accessed[0] || '*';
    return prop === '*' ? '*' : this.mapPropertyToColumn(prop);
  }

  private createGroupProxy(): IGroupProxy<T, TKey> {
    const isComposite = this.rawKeyNames.length > 1;
    let keyObject: any;

    if (isComposite) {
      keyObject = {};
      for (const raw of this.rawKeyNames) {
        const col = this.mapPropertyToColumn(raw);
        keyObject[raw] = new GroupKeyExpression(col);
      }
    } else {
      const singleCol = this.groupColumns[0] || 'id';
      keyObject = new GroupKeyExpression(singleCol);
    }

    return {
      key: keyObject as any,
      count: (sel?: (e: T) => unknown) =>
        new AggregateExpression<number>('COUNT', this.resolveSelector(sel)),
      sum: (sel: (e: T) => number) =>
        new AggregateExpression<number>('SUM', this.resolveSelector(sel)),
      avg: (sel: (e: T) => number) =>
        new AggregateExpression<number>('AVG', this.resolveSelector(sel)),
      min: <R = number>(sel: (e: T) => R) =>
        new AggregateExpression<R>('MIN', this.resolveSelector(sel)),
      max: <R = number>(sel: (e: T) => R) =>
        new AggregateExpression<R>('MAX', this.resolveSelector(sel)),
    };
  }

  public having(
    havingFn: (group: IGroupProxy<T, TKey>) => HavingCondition | HavingCondition[],
  ): this {
    const proxy = this.createGroupProxy();
    const conditionOrConditions = havingFn(proxy);
    if (Array.isArray(conditionOrConditions)) {
      this.havingConditions.push(...conditionOrConditions);
    } else if (conditionOrConditions) {
      this.havingConditions.push(conditionOrConditions);
    }
    return this;
  }

  public select<TProjection extends Record<string, unknown>>(
    projectionFn: (group: IGroupProxy<T, TKey>) => TProjection,
  ): ProjectedGroupedQuery<T, ProjectedResult<TProjection>> {
    const proxy = this.createGroupProxy();
    const projection = projectionFn(proxy);

    return new ProjectedGroupedQuery<T, ProjectedResult<TProjection>>(
      this.adapter,
      this.queryBuilder,
      this.groupColumns,
      this.havingConditions,
      projection as any,
      this.transaction,
    );
  }
}

/**
 * Projected query awaiting terminal execution (`toList`, `first`, etc.)
 */
export class ProjectedGroupedQuery<T extends object, TResult extends Record<string, unknown>> {
  private _limit?: number;
  private _offset?: number;
  private _orderByClauses: { column: string; direction: 'ASC' | 'DESC' }[] = [];

  constructor(
    private readonly adapter: IDbAdapter,
    private readonly queryBuilder: QueryBuilder<T>,
    private readonly groupColumns: string[],
    private readonly havingConditions: HavingCondition[],
    private readonly projection: TResult,
    private readonly transaction?: DbTransaction,
  ) {}

  public orderBy(
    field: (keyof TResult & string) | (string & {}),
    direction: 'asc' | 'desc' = 'asc',
  ): this {
    this._orderByClauses.push({
      column: String(field),
      direction: direction.toUpperCase() as 'ASC' | 'DESC',
    });
    return this;
  }

  public take(limit: number): this {
    this._limit = limit;
    return this;
  }

  public skip(offset: number): this {
    this._offset = offset;
    return this;
  }

  public toSql(): { sql: string; params: AdapterParam[] } {
    const qb = this.queryBuilder.clone();

    // Map projected properties to SQL column expressions with aliases
    const selectPieces: string[] = [];
    for (const [alias, expr] of Object.entries(this.projection)) {
      const escapedAlias = this.adapter.escapeIdentifier(alias);
      if (expr instanceof AggregateExpression) {
        selectPieces.push(`${expr.toSql(this.adapter)} AS ${escapedAlias}`);
      } else if (expr instanceof GroupKeyExpression) {
        selectPieces.push(`${expr.toSql(this.adapter)} AS ${escapedAlias}`);
      } else if (typeof expr === 'string') {
        selectPieces.push(`${this.adapter.escapeIdentifier(expr)} AS ${escapedAlias}`);
      } else {
        selectPieces.push(`${escapedAlias}`);
      }
    }

    qb.select(...selectPieces);
    qb.groupBy(...this.groupColumns);

    for (const h of this.havingConditions) {
      qb.having(h.expression, h.operator, h.value, h.value2);
    }

    if (this._limit !== undefined) qb.limit(this._limit);
    if (this._offset !== undefined) qb.offset(this._offset);

    for (const ord of this._orderByClauses) {
      qb.orderBy(ord.column, ord.direction.toLowerCase() as 'asc' | 'desc');
    }

    return qb.toSelectSql();
  }

  public async toList(): Promise<TResult[]> {
    const { sql, params } = this.toSql();
    const rows = await this.adapter.executeQuery<Record<string, unknown>>(
      sql,
      params,
      this.transaction,
    );

    return rows.map(r => this.mapRow(r));
  }

  public async first(): Promise<TResult | null> {
    const items = await this.take(1).toList();
    return items.length > 0 ? items[0] : null;
  }

  public async firstOrThrow(): Promise<TResult> {
    const item = await this.first();
    if (!item) {
      throw new EntityNotFoundException('No grouped result found.');
    }
    return item;
  }

  private mapRow(row: Record<string, unknown>): TResult {
    const result: any = {};
    for (const [key, expr] of Object.entries(this.projection)) {
      let val = row[key];
      // Numeric conversion for aggregate counts and sums which some drivers return as strings
      if (expr instanceof AggregateExpression) {
        if (expr.func === 'COUNT' || expr.func === 'SUM' || expr.func === 'AVG') {
          if (val !== null && val !== undefined) {
            val = Number(val);
          }
        }
      }
      result[key] = val;
    }
    return result;
  }
}
