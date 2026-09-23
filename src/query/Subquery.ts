import { AdapterParam } from '../adapters/AdapterParam';
import { QueryBuilder } from './QueryBuilder';

/**
 * Encapsulates a compiled or chainable subquery with an assigned table alias.
 */
export interface Subquery<T = any> {
  readonly alias: string;
  readonly tableName: string;
  readonly queryBuilder: QueryBuilder<T>;
  toSelectSql(params?: AdapterParam[], nextParamIdx?: () => number): { sql: string; params: AdapterParam[] };
}

/**
 * Definition of a Common Table Expression (WITH clause).
 */
export interface CommonTableExpression {
  readonly name: string;
  readonly query: QueryBuilder<any> | Subquery<any> | string | ((qb: any) => any);
  readonly recursive?: boolean;
}

/**
 * Options for AI vector embedding distance search.
 */
export interface NearestOptions {
  /** Distance metric. Defaults to 'cosine'. */
  distance?: 'cosine' | 'l2' | 'inner_product';
  /** Number of nearest neighbors to retrieve. */
  limit?: number;
}

export interface JoinFieldRef {
  readonly __isFieldRef: true;
  readonly table: string;
  readonly column: string;
}

export interface JoinComparison {
  readonly leftTable: string;
  readonly leftColumn: string;
  readonly operator: string;
  readonly rightTable?: string;
  readonly rightColumn?: string;
  readonly rightValue?: unknown;
}

export interface PredicateBuilder {
  eq(target: any): JoinComparison;
  ne(target: any): JoinComparison;
  gt(target: any): JoinComparison;
  gte(target: any): JoinComparison;
  lt(target: any): JoinComparison;
  lte(target: any): JoinComparison;
}

export type JoinProxy<T> = {
  [K in keyof T]: PredicateBuilder & JoinFieldRef;
} & { [key: string]: PredicateBuilder & JoinFieldRef };

/**
 * Creates a dynamic proxy tracking column access and operations for cross-table predicates.
 */
export function createJoinProxy<T = any>(
  tableName: string,
  recordedComparisons: JoinComparison[]
): JoinProxy<T> {
  return new Proxy({} as any, {
    get: (_, propName) => {
      const col = String(propName);
      const makeOp = (operator: string) => (target: any) => {
        let comp: JoinComparison;
        if (target && typeof target === 'object' && target.__isFieldRef) {
          comp = {
            leftTable: tableName,
            leftColumn: col,
            operator,
            rightTable: target.table,
            rightColumn: target.column,
          };
        } else {
          comp = {
            leftTable: tableName,
            leftColumn: col,
            operator,
            rightValue: target,
          };
        }
        recordedComparisons.push(comp);
        return comp;
      };

      return {
        __isFieldRef: true,
        table: tableName,
        column: col,
        eq: makeOp('='),
        ne: makeOp('<>'),
        gt: makeOp('>'),
        gte: makeOp('>='),
        lt: makeOp('<'),
        lte: makeOp('<='),
      };
    },
  });
}
