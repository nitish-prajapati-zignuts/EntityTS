import { ModelMetadataRegistry } from '../model/EntityMetadata';

/**
 * Property decorator indicating that this field is auto-updated with current timestamp (`new Date()`) on INSERT and UPDATE.
 *
 * @usecase Automatically track when records were last modified in the database.
 * @param columnName - Optional custom database column name.
 * @example
 * ```ts
 * @UpdatedAt()
 * updatedAt!: Date;
 * ```
 */
export function UpdatedAt(columnName?: string): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(target.constructor);
    metadata.updatedAtProperty = propName;

    const colName = columnName || propName;
    if (!metadata.columns.has(propName)) {
      metadata.columns.set(propName, {
        propertyName: propName,
        columnName: colName,
      });
    } else {
      const col = metadata.columns.get(propName)!;
      if (columnName) col.columnName = columnName;
    }
  };
}
