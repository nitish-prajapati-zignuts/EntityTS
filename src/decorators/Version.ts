import { ModelMetadataRegistry } from '../model/EntityMetadata';

export interface VersionOptions {
  strategy?: 'number' | 'timestamp' | 'uuid';
  name?: string;
}

/**
 * Property decorator for optimistic concurrency control.
 *
 * Automatically tracks and validates the version token on UPDATE and DELETE operations.
 * If another concurrent process has updated the row in the meantime, a `DbUpdateConcurrencyException` is thrown.
 *
 * Supported strategies:
 * - `'number'` (default): Auto-increments integer sequence (1, 2, 3...)
 * - `'timestamp'`: Updates with current timestamp
 * - `'uuid'`: Generates a new random UUID v4
 *
 * @usecase Prevent the "lost update" problem in multi-user applications where two users edit the same record simultaneously.
 * @param options - Version strategy and column options.
 * @example
 * ```ts
 * @Version()
 * version!: number;
 * ```
 */
export function Version(options?: VersionOptions | string): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(target.constructor);

    const opts: VersionOptions =
      typeof options === 'string' ? { name: options } : options || {};
    const strategy = opts.strategy || 'number';
    const colName = opts.name || propName;

    metadata.versionProperty = {
      propertyName: propName,
      columnName: colName,
      strategy,
    };

    if (!metadata.columns.has(propName)) {
      metadata.columns.set(propName, {
        propertyName: propName,
        columnName: colName,
      });
    } else {
      const col = metadata.columns.get(propName)!;
      if (opts.name) col.columnName = opts.name;
    }
  };
}

/**
 * Alias for `@Version()` configured with the sequential numeric strategy.
 *
 * @usecase Standard sequential row versioning for optimistic concurrency.
 * @param options - Column naming options.
 * @example
 * ```ts
 * @RowVersion()
 * rowVersion!: number;
 * ```
 */
export function RowVersion(options?: { name?: string } | string): PropertyDecorator {
  return Version(
    typeof options === 'string'
      ? { strategy: 'number', name: options }
      : { strategy: 'number', ...options }
  );
}

/**
 * Property decorator that verifies an individual property hasn't changed before executing UPDATE or DELETE.
 *
 * Injects `WHERE column = original_value` into the mutation SQL. If the value has changed in the database,
 * zero rows are affected and a `DbUpdateConcurrencyException` is raised.
 *
 * @usecase Protect sensitive business fields (like account balances or order statuses) from concurrent overwrite without a dedicated version column.
 * @example
 * ```ts
 * @ConcurrencyCheck()
 * balance!: number;
 * ```
 */
export function ConcurrencyCheck(): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(target.constructor);
    metadata.concurrencyCheckProperties.add(propName);
  };
}
