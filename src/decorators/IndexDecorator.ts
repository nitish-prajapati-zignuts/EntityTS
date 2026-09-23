import { ModelMetadataRegistry, IndexMetadata } from '../model/EntityMetadata';

export interface IndexOptions {
  name?: string;
  unique?: boolean;
}

/**
 * Decorator defining an index on an entity table.
 *
 * Can be used either as a class decorator to define composite or single-column indexes,
 * or as a property decorator on a specific entity field.
 *
 * @usecase Speed up lookups, enforce uniqueness constraints, and declare indexes for Code-First migrations.
 * @example
 * ```ts
 * // Class-level composite or named index:
 * @Index(['email'], { unique: true })
 * @Index(['firstName', 'lastName'])
 * class User {
 *   // Or property-level index:
 *   @Index({ unique: true })
 *   username!: string;
 * }
 * ```
 */
export function Index(columnsOrOptions?: string[] | IndexOptions, options?: IndexOptions): any {
  return (target: Function | Object, propertyKey?: string | symbol, _descriptor?: any) => {
    if (propertyKey !== undefined) {
      // Property decorator usage
      const constructor = (target as any).constructor;
      const metadata = ModelMetadataRegistry.getInstance().getOrCreate(constructor);
      const propName = String(propertyKey);
      const opts = (Array.isArray(columnsOrOptions) ? {} : columnsOrOptions) || {};

      if (!metadata.indexes) {
        metadata.indexes = [];
      }

      const colName = metadata.columns.get(propName)?.columnName || propName;
      metadata.indexes.push({
        columns: [colName],
        unique: opts.unique,
        name: opts.name,
      });
      return;
    }

    // Class decorator usage
    const constructor = target as Function;
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(constructor);
    if (!metadata.indexes) {
      metadata.indexes = [];
    }

    const cols = Array.isArray(columnsOrOptions) ? columnsOrOptions : [];
    const opts = options || (Array.isArray(columnsOrOptions) ? {} : columnsOrOptions) || {};

    const resolvedCols = cols.map(c => metadata.columns.get(c)?.columnName || c);

    metadata.indexes.push({
      columns: resolvedCols,
      unique: opts.unique,
      name: opts.name,
    });
  };
}
