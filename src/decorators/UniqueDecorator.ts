import { ModelMetadataRegistry } from '../model/EntityMetadata';

/**
 * Property decorator that enforces a `UNIQUE` constraint on the mapped database column.
 *
 * DDL generation emits a `UNIQUE INDEX` on this column across all supported providers.
 * For composite unique constraints (unique across multiple columns together), use the
 * `@Index({ unique: true, columns: ['col1', 'col2'] })` decorator instead.
 *
 * @usecase Email addresses, usernames, slugs, and other naturally unique scalar fields.
 * @example
 * ```ts
 * @Unique()
 * @Column({ maxLength: 255 })
 * email!: string;
 * ```
 */
export function Unique(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const entityConstructor = target.constructor;
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(entityConstructor);

    const existing = metadata.columns.get(propName) || {
      propertyName: propName,
      columnName: propName,
    };

    metadata.columns.set(propName, {
      ...existing,
      isUnique: true,
    });

    // Also register as an index entry for DDL generation
    if (!metadata.indexes) {
      metadata.indexes = [];
    }

    const colName = existing.columnName || propName;
    const idxName = `uq_${colName}`;
    const alreadyRegistered = metadata.indexes.some(
      idx => idx.unique && idx.columns.length === 1 && idx.columns[0] === colName,
    );
    if (!alreadyRegistered) {
      metadata.indexes.push({ name: idxName, columns: [colName], unique: true });
    }
  };
}
