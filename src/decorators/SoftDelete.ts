import { ModelMetadataRegistry } from '../model/EntityMetadata';

/**
 * Options for the `@SoftDelete` decorator.
 */
export interface SoftDeleteOptions {
  /**
   * Override the database column name that stores the soft-delete timestamp.
   * @default 'deleted_at'
   */
  column?: string;

  /**
   * When `true`, calling `dbSet.remove(id)` on a parent entity also cascades the
   * soft-delete (sets `deletedAt`) to all `@HasMany` / `@HasOne` child relations.
   * Likewise, `dbSet.restore(id)` restores children alongside the parent.
   *
   * Child entities must also have `@SoftDelete` configured for the cascade to
   * produce any effect on them.
   *
   * @default false
   */
  cascade?: boolean;
}

/**
 * Class or Property decorator to enable soft deletion for an entity model.
 *
 * When an entity is soft-deleted with `context.set(Entity).remove(id)`, the ORM updates
 * this column with the current deletion timestamp instead of physically removing the row.
 * Subsequent queries automatically exclude rows where `deletedAt IS NOT NULL`, unless `.withDeleted()` is used.
 *
 * @usecase Safely retain records for audits or recovery instead of permanent physical data loss.
 * @param columnNameOrOptions - Optional column name, or an options object with `{ column, cascade }`.
 * @example
 * ```ts
 * // Basic soft-delete
 * @SoftDelete()
 * deletedAt?: Date;
 *
 * // With cascade — removing a User also soft-deletes their Posts
 * @Table('users')
 * @SoftDelete({ cascade: true })
 * export class User { ... }
 * ```
 */
export function SoftDelete(columnNameOrOptions?: string | SoftDeleteOptions): any {
  return (target: any, propertyKey?: string) => {
    if (propertyKey) {
      // Property decorator
      const constructor = target.constructor;
      const metadata = ModelMetadataRegistry.getInstance().getOrCreate(constructor);
      const colName =
        typeof columnNameOrOptions === 'string'
          ? columnNameOrOptions
          : columnNameOrOptions?.column || propertyKey;

      const cascade =
        typeof columnNameOrOptions === 'object' ? (columnNameOrOptions?.cascade ?? false) : false;

      metadata.softDelete = {
        column: colName,
        propertyName: propertyKey,
        cascade,
      };

      // Ensure column is mapped
      if (!metadata.columns.has(propertyKey)) {
        metadata.columns.set(propertyKey, {
          propertyName: propertyKey,
          columnName: colName,
          isNullable: true,
        });
      }
    } else {
      // Class decorator
      const constructor = target;
      const metadata = ModelMetadataRegistry.getInstance().getOrCreate(constructor);
      const colName =
        typeof columnNameOrOptions === 'string'
          ? columnNameOrOptions
          : columnNameOrOptions?.column || 'deleted_at';

      const cascade =
        typeof columnNameOrOptions === 'object' ? (columnNameOrOptions?.cascade ?? false) : false;

      metadata.softDelete = {
        column: colName,
        cascade,
      };
    }
  };
}
