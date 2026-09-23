import { ModelMetadataRegistry } from '../model/EntityMetadata';

/**
 * Property decorator indicating that this field is auto-populated with the creation timestamp (`new Date()`) on INSERT.
 *
 * @usecase Automatically track when records are initially inserted into the database table.
 * @param columnName - Optional custom database column name.
 * @example
 * ```ts
 * @CreatedAt()
 * createdAt!: Date;
 * ```
 */
export function CreatedAt(columnName?: string): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(target.constructor);
    metadata.createdAtProperty = propName;

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
