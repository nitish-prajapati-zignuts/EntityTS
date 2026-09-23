import { IDbAdapter } from '../adapters/IDbAdapter';
import { EntityMetadata } from '../model/EntityMetadata';
import { DbTransaction } from '../transaction/DbTransaction';
import { QueryBuilder } from '../query/QueryBuilder';

export interface BulkDeleteOptions {
  batchSize?: number;
  hardDelete?: boolean;
}

export class BulkDeleteBuilder<T extends object> {
  constructor(
    private readonly adapter: IDbAdapter,
    private readonly tableName: string,
    private readonly metadata?: EntityMetadata,
    private readonly transaction?: DbTransaction,
  ) {}

  public async execute(predicate: Partial<T>, options?: BulkDeleteOptions): Promise<number> {
    const isSoft = !!this.metadata?.softDelete && !options?.hardDelete;

    if (isSoft) {
      const colName = this.metadata!.softDelete!.column;
      const qb = new QueryBuilder(this.adapter, this.tableName);
      for (const [k, v] of Object.entries(predicate)) {
        qb.getWhereClause().eq(this.mapPropertyToColumn(k), v);
      }
      const { sql, params } = qb.toUpdateSql({ [colName]: new Date() });
      const res = await this.adapter.executeNonQuery(sql, params, this.transaction);
      return res.rowsAffected;
    } else {
      const qb = new QueryBuilder(this.adapter, this.tableName);
      for (const [k, v] of Object.entries(predicate)) {
        qb.getWhereClause().eq(this.mapPropertyToColumn(k), v);
      }
      const { sql, params } = qb.toDeleteSql();
      const res = await this.adapter.executeNonQuery(sql, params, this.transaction);
      return res.rowsAffected;
    }
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
}
