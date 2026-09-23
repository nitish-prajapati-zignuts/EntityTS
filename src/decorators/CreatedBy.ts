import { ModelMetadataRegistry } from '../model/EntityMetadata';

/**
 * Property decorator indicating that this field is auto-populated with the current user / author identifier on INSERT.
 *
 * Reads value from `context.currentUser` if set.
 *
 * @usecase Audit logging and tracking record ownership (e.g. which user created this resource).
 * @param columnName - Optional custom database column name.
 * @example
 * ```ts
 * @CreatedBy()
 * createdBy?: string;
 * ```
 */
export function CreatedBy(columnName?: string): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(target.constructor);
    metadata.createdByProperty = propName;

    const colName = columnName || propName;
    if (!metadata.columns.has(propName)) {
      metadata.columns.set(propName, {
        propertyName: propName,
        columnName: colName,
        isNullable: true,
      });
    } else {
      const col = metadata.columns.get(propName)!;
      if (columnName) col.columnName = columnName;
    }
  };
}
