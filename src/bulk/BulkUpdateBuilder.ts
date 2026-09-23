import { IDbAdapter } from '../adapters/IDbAdapter';
import { EntityMetadata } from '../model/EntityMetadata';
import { DbTransaction } from '../transaction/DbTransaction';
import { QueryBuilder } from '../query/QueryBuilder';

export interface BulkUpdateOptions<T> {
  keys: (keyof T | string)[];
  update?: (keyof T | string)[];
  batchSize?: number;
}

export class BulkUpdateBuilder<T extends object> {
  constructor(
    private readonly adapter: IDbAdapter,
    private readonly tableName: string,
    private readonly metadata?: EntityMetadata,
    private readonly transaction?: DbTransaction
  ) {}

  public async execute(entities: Partial<T>[], options: BulkUpdateOptions<T>): Promise<number> {
    if (!entities || entities.length === 0) return 0;
    const batchSize = options.batchSize || 500;
    let totalUpdated = 0;

    const runInTx = async (tx: DbTransaction) => {
      for (let i = 0; i < entities.length; i += batchSize) {
        const batch = entities.slice(i, i + batchSize);
        for (const entity of batch) {
          const toUpdate: Record<string, unknown> = {};

          if (options.update && options.update.length > 0) {
            for (const k of options.update) {
              const propStr = String(k);
              if (propStr in entity) {
                toUpdate[this.mapPropertyToColumn(propStr)] = (entity as any)[propStr];
              }
            }
          } else {
            // Update all non-key properties
            const keySet = new Set(options.keys.map(k => String(k)));
            for (const [k, v] of Object.entries(entity)) {
              if (!keySet.has(k) && !this.metadata?.ignoredProperties.has(k)) {
                toUpdate[this.mapPropertyToColumn(k)] = v;
              }
            }
          }

          // UpdatedAt audit field
          if (this.metadata?.updatedAtProperty) {
            const upCol = this.mapPropertyToColumn(this.metadata.updatedAtProperty);
            if (!(upCol in toUpdate)) {
              toUpdate[upCol] = new Date();
            }
          }

          const qb = new QueryBuilder(this.adapter, this.tableName);
          for (const key of options.keys) {
            const keyStr = String(key);
            const keyCol = this.mapPropertyToColumn(keyStr);
            qb.getWhereClause().eq(keyCol, (entity as any)[keyStr]);
          }

          const { sql, params } = qb.toUpdateSql(toUpdate);
          const res = await this.adapter.executeNonQuery(sql, params, tx);
          totalUpdated += res.rowsAffected;
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

    return totalUpdated;
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
