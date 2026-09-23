import { IDbAdapter } from '../adapters/IDbAdapter';
import { EntityMetadata } from '../model/EntityMetadata';
import { DbTransaction } from '../transaction/DbTransaction';
import { QueryBuilder } from '../query/QueryBuilder';

/**
 * Options for high-performance bulk deletion.
 */
export interface BulkDeleteOptions {
  /** Batch chunk size per transaction (default: 500). */
  batchSize?: number;
  /** If true, forces physical hard DELETE even if `@SoftDelete` is enabled on the entity. */
  hardDelete?: boolean;
}

/**
 * High-performance bulk delete engine for removing multiple rows matching filter conditions.
 *
 * Automatically respects `@SoftDelete` annotations unless `hardDelete: true` is explicitly requested.
 *
 * @usecase Purging expired records, historical log cleanups, GDPR removal, and data maintenance.
 *
 * @example
 * **PostgreSQL / MySQL / SQLite / MSSQL:**
 * ```ts
 * const bulkDeleter = new BulkDeleteBuilder(adapter, 'notifications', metadata);
 * const deletedCount = await bulkDeleter.execute({ isRead: true, isArchived: true });
 * ```
 */
export class BulkDeleteBuilder<T extends object> {
  constructor(
    private readonly adapter: IDbAdapter,
    private readonly tableName: string,
    private readonly metadata?: EntityMetadata,
    private readonly transaction?: DbTransaction,
  ) {}

  /**
   * Executes the bulk delete command matching the predicate.
   *
   * @param predicate - Partial entity criteria matching rows to remove.
   * @param options - Deletion options (hardDelete, batchSize).
   * @returns Total number of rows deleted or soft-deleted.
   */
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
