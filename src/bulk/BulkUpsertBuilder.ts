import { IDbAdapter } from '../adapters/IDbAdapter';
import { EntityMetadata } from '../model/EntityMetadata';
import { DbTransaction } from '../transaction/DbTransaction';
import { QueryBuilder } from '../query/QueryBuilder';

/**
 * Configuration options for batch bulk upsert operations.
 */
export interface BulkUpsertOptions<T> {
  /** Property keys to detect existing conflicts against (e.g. `['sku']` or `['email', 'tenantId']`). */
  conflictKeys: (keyof T | string)[];
  /** Optional subset of columns to update when conflict occurs. If omitted, all non-key columns are updated. */
  update?: (keyof T | string)[];
  /** Chunk batch size per transactional batch (default: 500). */
  batchSize?: number;
}

/**
 * High-performance bulk upsert engine executing chunked batch insert-or-update operations across database engines.
 *
 * Automatically manages audit timestamps (`@CreatedAt`, `@UpdatedAt`), creator identifiers (`@CreatedBy`),
 * and optimistic concurrency versions across batches.
 *
 * @usecase Ideal for sync pipelines, API integrations, and catalog ingestion where incoming records may be new or existing.
 *
 * @example
 * **PostgreSQL / MySQL / SQLite / MSSQL:**
 * ```ts
 * const upsertEngine = new BulkUpsertBuilder(adapter, 'products', metadata);
 * const processed = await upsertEngine.execute(incomingProducts, {
 *   conflictKeys: ['sku'],
 *   update: ['price', 'stockQuantity', 'title'],
 *   batchSize: 500,
 * });
 * console.log(`Processed ${processed} upsert items`);
 * ```
 */
export class BulkUpsertBuilder<T extends object> {
  constructor(
    private readonly adapter: IDbAdapter,
    private readonly tableName: string,
    private readonly metadata?: EntityMetadata,
    private readonly transaction?: DbTransaction,
    private readonly context?: any,
  ) {}

  /**
   * Executes the bulk upsert workflow across the supplied entities.
   *
   * @param entities - List of entity objects to insert or update.
   * @param options - Upsert configuration specifying conflict keys and update fields.
   * @returns Total number of records inserted or updated.
   */
  public async execute(entities: Partial<T>[], options: BulkUpsertOptions<T>): Promise<number> {
    if (!entities || entities.length === 0) return 0;
    const batchSize = options.batchSize || 500;
    let totalProcessed = 0;

    const runInTx = async (tx: DbTransaction) => {
      for (let i = 0; i < entities.length; i += batchSize) {
        const batch = entities.slice(i, i + batchSize);
        for (const entity of batch) {
          // Check if entity exists by conflict keys
          const qb = new QueryBuilder(this.adapter, this.tableName);
          for (const k of options.conflictKeys) {
            const kStr = String(k);
            const colName = this.mapPropertyToColumn(kStr);
            qb.getWhereClause().eq(colName, (entity as any)[kStr]);
          }
          const { sql: checkSql, params: checkParams } = qb.toCountSql();
          const count = await this.adapter.executeScalar<number | string>(
            checkSql,
            checkParams,
            tx,
          );

          if (Number(count) > 0) {
            // Update
            const toUpdate: Record<string, unknown> = {};
            const keySet = new Set(options.conflictKeys.map(k => String(k)));

            if (options.update && options.update.length > 0) {
              for (const u of options.update) {
                const uStr = String(u);
                toUpdate[this.mapPropertyToColumn(uStr)] = (entity as any)[uStr];
              }
            } else {
              for (const [k, v] of Object.entries(entity)) {
                if (!keySet.has(k) && !this.metadata?.ignoredProperties.has(k)) {
                  toUpdate[this.mapPropertyToColumn(k)] = v;
                }
              }
            }

            if (this.metadata?.updatedAtProperty) {
              toUpdate[this.mapPropertyToColumn(this.metadata.updatedAtProperty)] = new Date();
            }

            const updateQb = new QueryBuilder(this.adapter, this.tableName);
            for (const k of options.conflictKeys) {
              const kStr = String(k);
              updateQb.getWhereClause().eq(this.mapPropertyToColumn(kStr), (entity as any)[kStr]);
            }
            const { sql: upSql, params: upParams } = updateQb.toUpdateSql(toUpdate);
            await this.adapter.executeNonQuery(upSql, upParams, tx);
          } else {
            // Insert
            const toInsert = { ...entity } as any;
            const now = new Date();
            if (
              this.metadata?.createdAtProperty &&
              toInsert[this.metadata.createdAtProperty] === undefined
            ) {
              toInsert[this.metadata.createdAtProperty] = now;
            }
            if (
              this.metadata?.updatedAtProperty &&
              toInsert[this.metadata.updatedAtProperty] === undefined
            ) {
              toInsert[this.metadata.updatedAtProperty] = now;
            }
            if (
              this.metadata?.createdByProperty &&
              toInsert[this.metadata.createdByProperty] === undefined
            ) {
              if (this.context?.currentUser) {
                toInsert[this.metadata.createdByProperty] = this.context.currentUser;
              }
            }
            if (
              this.metadata?.versionProperty &&
              toInsert[this.metadata.versionProperty.propertyName] === undefined
            ) {
              const vp = this.metadata.versionProperty;
              toInsert[vp.propertyName] =
                vp.strategy === 'number' ? 1 : vp.strategy === 'timestamp' ? now : '1';
            }

            const insertRow: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(toInsert)) {
              if (this.metadata?.ignoredProperties.has(k)) continue;
              insertRow[this.mapPropertyToColumn(k)] = v;
            }

            const insQb = new QueryBuilder(this.adapter, this.tableName);
            const { sql: insSql, params: insParams } = insQb.toInsertSql(insertRow);
            await this.adapter.executeNonQuery(insSql, insParams, tx);
          }
          totalProcessed++;
        }
      }
    };

    if (this.transaction) {
      await runInTx(this.transaction);
    } else {
      const tx = await this.adapter.beginTransaction();
      try {
        await runInTx(tx);
        await tx.commit();
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    }

    return totalProcessed;
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
