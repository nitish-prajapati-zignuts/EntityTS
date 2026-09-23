import { WhereClause } from '../query/WhereClause';

export type QueryFilterCallback<T = any> = (clause: WhereClause<T>) => void | WhereClause<T>;

export class GlobalQueryFilterRegistry {
  private static instance: GlobalQueryFilterRegistry;
  private readonly filters: Map<Function, QueryFilterCallback[]> = new Map();

  private constructor() {}

  public static getInstance(): GlobalQueryFilterRegistry {
    if (!GlobalQueryFilterRegistry.instance) {
      GlobalQueryFilterRegistry.instance = new GlobalQueryFilterRegistry();
    }
    return GlobalQueryFilterRegistry.instance;
  }

  public register<T>(target: Function, filter: QueryFilterCallback<T>): void {
    const list = this.filters.get(target) || [];
    list.push(filter);
    this.filters.set(target, list);
  }

  public getFilters<T>(target: Function): QueryFilterCallback<T>[] {
    return (this.filters.get(target) as QueryFilterCallback<T>[]) || [];
  }

  public clear(): void {
    this.filters.clear();
  }
}
