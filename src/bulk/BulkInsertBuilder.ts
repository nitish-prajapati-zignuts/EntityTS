import { IDbAdapter } from '../adapters/IDbAdapter';
import { EntityMetadata } from '../model/EntityMetadata';
import { DbTransaction } from '../transaction/DbTransaction';

/**
 * Options for high-performance chunked bulk insertion.
 */
export interface BulkInsertOptions {
  /** Maximum number of records per individual SQL INSERT command (default: 500). */
  batchSize?: number;
  /** If true, ignores duplicate key constraint violations (e.g. `INSERT ... ON CONFLICT DO NOTHING` or `INSERT IGNORE`). */
  ignoreDuplicates?: boolean;
}

/**
 * High-throughput batch insert engine that splits large entity arrays into chunked multi-row INSERT queries.
 *
 * Automatically assigns audit timestamps, creator IDs, version tokens, and default values across all batches.
 *
 * @usecase Ideal for seeding test datasets, bulk data migrations, event stream ingestion, and telemetry logging.
 *
 * @example
 * **PostgreSQL / MySQL / SQLite / MSSQL:**
 * ```ts
 * const bulkInsert = new BulkInsertBuilder(adapter, 'audit_logs', metadata);
 * const insertedCount = await bulkInsert.execute(logsArray, {
 *   batchSize: 1000,
 *   ignoreDuplicates: true,
 * });
 * ```
 */
export class BulkInsertBuilder<T extends object> {
  constructor(
    private readonly adapter: IDbAdapter,
    private readonly tableName: string,
    private readonly metadata?: EntityMetadata,
    private readonly transaction?: DbTransaction,
    private readonly context?: any,
  ) {}

  /**
   * Executes the bulk insert operation across all provided entities.
   *
   * @param entities - Array of entity objects to insert.
   * @param options - Batching configuration options.
   * @returns Total number of rows inserted across all chunks.
   */
  public async execute(entities: Partial<T>[], options?: BulkInsertOptions): Promise<number> {
    if (!entities || entities.length === 0) return 0;
    const batchSize = options?.batchSize || 500;
    let totalInserted = 0;

    const runInTx = async (tx: DbTransaction) => {
      for (let i = 0; i < entities.length; i += batchSize) {
        const batch = entities.slice(i, i + batchSize);
        const processedRows: Record<string, unknown>[] = [];

        for (const item of batch) {
          const rowData = { ...item } as any;
          if (this.metadata) {
            const now = new Date();
            if (
              this.metadata.createdAtProperty &&
              rowData[this.metadata.createdAtProperty] === undefined
            ) {
              rowData[this.metadata.createdAtProperty] = now;
            }
            if (
              this.metadata.updatedAtProperty &&
              rowData[this.metadata.updatedAtProperty] === undefined
            ) {
              rowData[this.metadata.updatedAtProperty] = now;
            }
            if (
              this.metadata.createdByProperty &&
              rowData[this.metadata.createdByProperty] === undefined
            ) {
              if (this.context?.currentUser) {
                rowData[this.metadata.createdByProperty] = this.context.currentUser;
              }
            }
            if (
              this.metadata.versionProperty &&
              rowData[this.metadata.versionProperty.propertyName] === undefined
            ) {
              const vp = this.metadata.versionProperty;
              rowData[vp.propertyName] =
                vp.strategy === 'number' ? 1 : vp.strategy === 'timestamp' ? now : '1';
            }
            for (const [propName, colMeta] of this.metadata.columns.entries()) {
              if (rowData[propName] === undefined && colMeta.defaultValue !== undefined) {
                rowData[propName] =
                  typeof colMeta.defaultValue === 'function'
                    ? (colMeta.defaultValue as Function)()
                    : colMeta.defaultValue;
              }
            }
          }
          processedRows.push(this.mapEntityToRow(rowData));
        }

        const inserted = await this.insertBatch(processedRows, tx, options?.ignoreDuplicates);
        totalInserted += inserted;
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

    return totalInserted;
  }

  private async insertBatch(
    rows: Record<string, unknown>[],
    tx: DbTransaction,
    ignoreDuplicates?: boolean,
  ): Promise<number> {
    if (rows.length === 0) return 0;

    const columns = Object.keys(rows[0]);
    const escapedTable = this.adapter.escapeIdentifier(this.tableName);
    const escapedCols = columns.map(c => this.adapter.escapeIdentifier(c)).join(', ');

    const params: any[] = [];
    const valueTuples: string[] = [];
    let paramIndex = 1;

    for (const row of rows) {
      const placeholders: string[] = [];
      for (const col of columns) {
        const paramName = `p${paramIndex}`;
        placeholders.push(this.adapter.formatParameterPlaceholder(paramName, paramIndex));
        params.push({ name: paramName, value: row[col] });
        paramIndex++;
      }
      valueTuples.push(`(${placeholders.join(', ')})`);
    }

    let sql = `INSERT INTO ${escapedTable} (${escapedCols}) VALUES ${valueTuples.join(', ')}`;
    if (ignoreDuplicates) {
      const p = this.adapter.provider;
      if (p === 'postgres' || p === 'neon' || p === 'cockroachdb' || p === 'supabase') {
        sql += ' ON CONFLICT DO NOTHING';
      } else if (p === 'mysql' || p === 'planetscale') {
        sql = `INSERT IGNORE INTO ${escapedTable} (${escapedCols}) VALUES ${valueTuples.join(', ')}`;
      } else if (p === 'sqlite' || p === 'turso' || p === 'd1') {
        sql = `INSERT OR IGNORE INTO ${escapedTable} (${escapedCols}) VALUES ${valueTuples.join(', ')}`;
      }
    }

    const res = await this.adapter.executeNonQuery(sql, params, tx);
    return res.rowsAffected !== undefined && res.rowsAffected > 0 ? res.rowsAffected : rows.length;
  }

  private mapEntityToRow(entity: Partial<T>): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(entity)) {
      if (this.metadata?.ignoredProperties.has(key) || this.metadata?.columns.get(key)?.isComputed)
        continue;
      const col = this.metadata?.columns.get(key);
      const colName = col?.columnName || key;
      row[colName] = val;
    }
    return row;
  }
}
